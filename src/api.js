import { debugLog, playlistSortParams } from './utils.js';

// Known SpotifyPlus playback failures that deserve a specific, actionable
// message instead of a raw validation string. Ordered most-specific first.
// `reopenPicker` says whether popping the device picker again could help
// (pointless for a one-time server-side setup problem like the Cast token).
const PLAYBACK_ERROR_PATTERNS = [
    {
        code: 'cast_token',
        test: /Spotify Desktop Player authorization token was not found|Spotify Cast Application could not be activated/i,
        reopenPicker: false,
        duration: 8000,
        message: "This Chromecast needs SpotifyPlus's one-time Desktop Player token setup. See the SpotifyPlus wiki (\"Spotify Desktop Player Token\"), then try again."
    },
    {
        code: 'zeroconf',
        test: /discoverable via Zeroconf/i,
        reopenPicker: true,
        duration: 6000,
        message: "Device is unreachable on the network. Make sure it's awake and on the same network as Home Assistant, then pick it again."
    },
    {
        code: 'no_active_device',
        test: /no active Spotify player device/i,
        reopenPicker: true,
        duration: 4000,
        message: "No active Spotify player. Pick a device to start playback."
    },
    {
        // Synthesised by the launch watchdog (see _watchStalledLaunch): the
        // message already names the device, so it's used as-is.
        code: 'stalled_device',
        test: /did not start playing/i,
        reopenPicker: true,
        duration: 6000,
        message: null
    }
];

/**
 * Classify a SpotifyPlus/HA error into a friendly, actionable descriptor,
 * or null when it's not one we have specific guidance for. Accepts an error
 * object, a plain string, or anything with a `.message`.
 */
export function classifyPlaybackError(e) {
    const msg = e?.message || (typeof e === 'string' ? e : '');
    if (!msg) return null;
    const p = PLAYBACK_ERROR_PATTERNS.find(p => p.test.test(msg));
    return p ? { ...p, message: p.message || msg } : null;
}

/**
 * @typedef {{ items: any[], total: number|undefined }} ListPage
 * One page of a list read. `total` is passed through as SpotifyPlus sent it
 * (undefined when it sent none): callers default it their own way.
 */

/**
 * The page a list read's response holds: `{ result: { items, total } }` as
 * `{ items, total }`; null when the read failed or the response holds no
 * items list.
 * @param {any} res
 * @returns {ListPage|null}
 */
function listPage(res) {
    const page = res?.result;
    return Array.isArray(page?.items) ? { items: page.items, total: page.total } : null;
}

/**
 * The object a single-object read's response holds (`res.result`), or null
 * when the read failed or the response holds none.
 * @param {any} res
 */
function resultObject(res) {
    return res?.result || null;
}

/** JSON with object keys sorted, so equal params always serialize identically. */
function stableStringify(value) {
    return JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v))
        ? Object.keys(v).sort().reduce((sorted, k) => { sorted[k] = v[k]; return sorted; }, {})
        : v);
}

export class SpotifyApi {
    // Only these (user-initiated playback) services should surface a validation
    // error to the app's error callback, which opens the device picker. Reads
    // and background calls must never trigger it.
    static PLAYBACK_SERVICES = new Set([
        'player_media_play_context',
        'player_media_play_tracks',
        'player_media_play_track_favorites',
        'player_transfer_playback',
        'add_player_queue_items'
    ]);

    // SpotifyPlus caps `limit` at 10 for get_artist_albums and all search_* services
    // (Spotify's July 2026 API change; SpotifyPlus v1.0.215).
    static MAX_PAGE_LIMIT = 10;

    // Most pages of one fetchPaginated call that may be in flight at once.
    static MAX_PAGE_CONCURRENCY = 4;

    // Immutable catalog reads that fetchSpotifyPlus answers from the read cache
    // (see _cachedRead). A service belongs here only if its response is the
    // same whoever asks and nothing this card does can change it — so never
    // playlists (editable), get_player_*, favorites / followed lists, check_*,
    // search or devices.
    static CACHED_READ_SERVICES = new Set(['get_artist', 'get_album', 'get_track']);

    // Catalog objects all but never change, so the TTL only has to outlast one
    // stretch of browsing (home pins, library rows, the artist/album page and
    // its hero all asking for the same object) while keeping a card that stays
    // open for weeks from showing hour-old art or names.
    static READ_CACHE_TTL_MS = 5 * 60 * 1000;

    // Oldest-first cap for the read cache: above what one TTL of browsing
    // touches (a Liked Songs genre pass alone asks for 24 artists), and a hard
    // bound on what a card left open for weeks can hold.
    static READ_CACHE_MAX_ENTRIES = 200;

    // How long identical requests keep joining a read that has not landed yet.
    static READ_CACHE_PENDING_MS = 30000;

    // Tracks the shared recently-played read asks for (getRecentTracks): the
    // player keeps 30; home's row shows the first 20 of them.
    static RECENT_TRACKS_LIMIT = 30;

    // Cap for the genre / track-art memos (a few short strings per entry).
    static DERIVED_MEMO_MAX_ENTRIES = 500;

    // How long a failed launch is remembered for replay on the next device pick.
    static PENDING_PLAY_TTL_MS = 120000;

    // How long to give a device to start after a play call it accepted.
    static STALLED_LAUNCH_MS = 5000;

    /** True when the entity has a track loaded (title or content id). */
    static playerHasItem(stateObj) {
        const a = stateObj?.attributes;
        return !!(a && (a.media_title || a.media_content_id));
    }

    constructor(hass, entityId, deviceResolver = null, defaultVolumeConfig = null, onNotification = null, onError = null) {
        this.hass = hass;
        this.entityId = entityId;
        this.deviceResolver = deviceResolver; // Function that returns Promise<deviceId or null>
        this.sonosBridge = null; // Optional SonosBridge; set via setSonosBridge()
        this.deviceManager = null; // Optional DeviceManager; set via setDeviceManager()
        this.defaultVolumeConfig = defaultVolumeConfig;
        this.onNotification = onNotification;
        this.onError = onError;

        // Track foreground/background transitions so the scan timer can hold off
        // right after we return — the WebSocket is often still reconnecting then.
        // Seed the grace window at construction: the WebView wrapper hard-reloads
        // the whole page on every foreground return, so there is no
        // hidden -> visible transition to fire `visibilitychange`. Without this
        // seed `_resumedAt` stays 0, the grace check never holds, and the first
        // scan fires into a still-connecting socket — which makes HA surface a
        // "connection lost" toast + failure haptic.
        this._resumedAt = Date.now();
        this._onVisibility = () => {
            if (typeof document !== 'undefined' && !document.hidden) this._resumedAt = Date.now();
        };
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this._onVisibility);
        }

        // Track real socket readiness via the HA connection's lifecycle events so
        // background calls hold off until the socket is genuinely up. `ready`
        // fires after each successful (re)connection; treat it as a fresh resume
        // so the grace window restarts every reconnect.
        this._socketReady = this.hass?.connection?.connected === true;
        this._connection = null;
        this._transferScanTimers = [];
        this._lastScanAt = 0;
        // Remembers a launch that failed on a device, so re-picking a device
        // from the (re)opened picker replays it instead of a bare transfer.
        this._pendingPlay = null;
        // Read cache for CACHED_READ_SERVICES: key -> { promise, expires }.
        // Per instance on purpose: an instance is bound to one entity (one
        // Spotify account) and is rebuilt on account switch, so one account's
        // responses can never be served to another.
        this._readCache = new Map();
        // The latest recently-played read: { startedAt, promise } (see getRecentTracks).
        this._recentRead = null;
        this._readyScanTimer = null;
        this._readyScanPromise = null;
        this._onSocketReady = () => { this._socketReady = true; this._resumedAt = Date.now(); };
        this._onSocketDisconnected = () => { this._socketReady = false; };
        this._bindConnection();
    }

    /** (Re)subscribe to the active HA connection's ready/disconnected events. */
    _bindConnection() {
        const conn = this.hass?.connection || null;
        if (conn === this._connection) return;
        if (this._connection?.removeEventListener) {
            this._connection.removeEventListener('ready', this._onSocketReady);
            this._connection.removeEventListener('disconnected', this._onSocketDisconnected);
        }
        this._connection = conn;
        if (conn?.addEventListener) {
            conn.addEventListener('ready', this._onSocketReady);
            conn.addEventListener('disconnected', this._onSocketDisconnected);
        }
    }

    _notify(message) {
        if (this.onNotification) this.onNotification(message);
    }

    _reportError(error) {
        if (this.onError) this.onError(error);
    }

    /**
     * True when the SpotifyPlus entity is playing/paused/buffering AND has a
     * track loaded. A "paused" entity with nothing loaded is a stale Connect
     * session: Spotify accepts commands for it but the device never starts,
     * so for replay purposes it counts as not active.
     */
    _entityActive() {
        const stateObj = this.hass?.states?.[this.entityId];
        return ['playing', 'paused', 'buffering'].includes(stateObj?.state) && SpotifyApi.playerHasItem(stateObj);
    }

    /**
     * After a play call the device accepted while it had nothing loaded, check
     * that it actually started. If not, remember the launch and surface an
     * actionable error (the app reopens the device picker; picking a device
     * replays the launch there via transferPlayback).
     */
    _watchStalledLaunch(uri, type, extraOptions, deviceName) {
        const id = (this._launchWatchId = (this._launchWatchId || 0) + 1);
        setTimeout(() => {
            if (id !== this._launchWatchId) return; // superseded by a newer launch
            const s = this.hass?.states?.[this.entityId];
            if (s?.state === 'playing' || SpotifyApi.playerHasItem(s)) return;
            this._storePendingPlay(uri, type, extraOptions);
            const err = { code: 'stalled_device', _sbReported: true,
                message: `${deviceName} did not start playing. Pick a device to try again.` };
            this._reportError(err);
        }, SpotifyApi.STALLED_LAUNCH_MS);
    }

    _storePendingPlay(uri, type, extraOptions) {
        this._pendingPlay = { uri, type, extraOptions, at: Date.now() };
    }

    /** One-shot: return a fresh remembered launch and clear it, else null. */
    _takePendingPlay() {
        const p = this._pendingPlay;
        this._pendingPlay = null;
        if (!p || Date.now() - p.at > SpotifyApi.PENDING_PLAY_TTL_MS) return null;
        return p;
    }

    /** Whether a device selection would replay a remembered launch (UI wording). */
    hasPendingPlay() {
        const p = this._pendingPlay;
        if (!p || Date.now() - p.at > SpotifyApi.PENDING_PLAY_TTL_MS) return false;
        return !this._entityActive();
    }

    _resolveDefaultVolume() {
        if (!this.defaultVolumeConfig) return null;

        const { fallback, rules } = this.defaultVolumeConfig;

        if (!rules || rules.length === 0) return fallback;

        const now = new Date();
        const currentH = now.getHours();
        const currentM = now.getMinutes();
        const currentTotalM = currentH * 60 + currentM;

        for (const rule of rules) {
            if (!rule.start || !rule.end || !rule.level) continue;

            const [sH, sM] = rule.start.split(':').map(Number);
            const [eH, eM] = rule.end.split(':').map(Number);

            const startTotal = sH * 60 + sM;
            const endTotal = eH * 60 + eM;

            // Handle Overnight (23:00 to 07:00) vs Day (09:00 to 17:00)
            let match = false;
            if (startTotal < endTotal) {
                // Normal Range
                if (currentTotalM >= startTotal && currentTotalM < endTotal) match = true;
            } else {
                // Overnight Range
                if (currentTotalM >= startTotal || currentTotalM < endTotal) match = true;
            }

            if (match) return Number(rule.level);
        }

        return Number(fallback);
    }

    updateHass(hass) {
        this.hass = hass;
        if (this.sonosBridge) this.sonosBridge.setHass(hass);
        // The wrapper's page reload replaces the connection object; re-subscribe.
        this._bindConnection();
    }

    /** Attach the Sonos integration bridge (used for Sonos offset/queue routing). */
    setSonosBridge(bridge) {
        this.sonosBridge = bridge;
    }

    /** Attach the shared DeviceManager (volume-capability lookups for setVolume/playMedia). */
    setDeviceManager(deviceManager) {
        this.deviceManager = deviceManager;
    }

    /** Detach listeners. Call when replacing or discarding this instance. */
    destroy() {
        if (this._onVisibility && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this._onVisibility);
            this._onVisibility = null;
        }
        if (this._connection?.removeEventListener) {
            this._connection.removeEventListener('ready', this._onSocketReady);
            this._connection.removeEventListener('disconnected', this._onSocketDisconnected);
        }
        this._connection = null;
        this._transferScanTimers.forEach(clearTimeout);
        this._transferScanTimers = [];
        clearTimeout(this._readyScanTimer);
        this._readyScanTimer = null;
        this._readyScanPromise = null;
        this.clearReadCache();
    }

    /**
     * Forget every cached catalog read, plus the genre / track-art memos
     * derived from them and the shared recently-played read, so the next read
     * hits SpotifyPlus again. A request already in flight still answers its
     * own callers but is not remembered.
     */
    clearReadCache() {
        this._readCache.clear();
        this._artistGenreCache?.clear();
        this._trackArtCache?.clear();
        this._recentRead = null;
    }

    /**
     * The account's recently played tracks (get_player_recent_tracks), newest
     * first, as a ListPage of play-history items ({ track, context,
     * played_at }); null when the read failed or held no list.
     *
     * Asked for RECENT_TRACKS_LIMIT of them (the default `limit`), the read
     * is shared: home's "Recently Played" row and the player (the previous
     * track, the queue sheet's history) both re-read them on every open,
     * moments apart. `since` (a Date.now() stamp) lets a caller take the
     * latest read that started at or after it, landed or still in flight,
     * instead of asking again; without it the call always reads afresh (a
     * track change must not be answered from before it), and that read is
     * the one later callers share. A failed read is not shared. Each caller
     * gets its own copy of the page.
     *
     * Any other `limit` is a plain read of its own: never shared, `since`
     * ignored.
     * @param {{since?: number|null, limit?: number}} [options]
     * @returns {Promise<ListPage|null>}
     */
    getRecentTracks({ since = null, limit = SpotifyApi.RECENT_TRACKS_LIMIT } = {}) {
        if (limit !== SpotifyApi.RECENT_TRACKS_LIMIT) {
            return this.fetchSpotifyPlus('get_player_recent_tracks', { limit }).then(listPage);
        }
        const copy = (json) => listPage(typeof json === 'string' ? JSON.parse(json) : null);
        const last = this._recentRead;
        if (since !== null && last && last.startedAt >= since) return last.promise.then(copy);

        const entry = { startedAt: Date.now(), promise: null };
        const drop = () => { if (this._recentRead === entry) this._recentRead = null; };
        entry.promise = this.fetchSpotifyPlus('get_player_recent_tracks', { limit: SpotifyApi.RECENT_TRACKS_LIMIT })
            .then((res) => {
                if (res == null) { drop(); return null; }
                return JSON.stringify(res);
            }, (e) => { drop(); throw e; });
        this._recentRead = entry;
        return entry.promise.then(copy);
    }

    /**
     * The media_player entity that transport/volume commands should target. When
     * the active device is a Sonos speaker we drive the HA Sonos entity directly
     * (local, instant) instead of relaying through SpotifyPlus (cloud). Grouped
     * Sonos speakers only accept transport on the group coordinator, so resolve
     * it by default; volume is per-speaker on Sonos, so setVolume passes
     * `perSpeaker: true` to keep targeting the mapped speaker itself.
     */
    _controlEntity({ perSpeaker = false } = {}) {
        if (this.sonosBridge) {
            const attrs = this._activeAttributes();
            const target = this.sonosBridge.activeTarget(attrs);
            if (target.isSonos) {
                if (target.entity) {
                    const entity = perSpeaker ? target.entity : this.sonosBridge.coordinatorFor(target.entity);
                    this.sonosBridge.log(`control → ${entity} (LOCAL, bypassing SpotifyPlus cloud)`);
                    return entity;
                }
                this.sonosBridge.reportUnmapped(attrs.source || attrs.sp_device_name);
            }
        }
        return this.entityId;
    }

    /** Whether Sonos launches should try the local (HA Sonos entity) path first. */
    _sonosLaunchLocal() {
        return !!this.sonosBridge && this.sonosBridge.launchMode !== 'spotifyplus';
    }

    /**
     * Local Sonos launch for a context play. Regular playlist/album contexts go
     * straight onto the Sonos queue; the Liked Songs collection URI (which has no
     * playable local form) loads via SpotifyPlus track favorites — unshuffled so
     * queue order matches the list — then jumps to the tapped position once the
     * progressive load reaches it. Returns true when playback started.
     */
    async _playSonosLocal(sonosEntity, uri, offsetPosition, offsetUri) {
        if (!sonosEntity) return false;
        const isCollection = typeof uri === 'string' && uri.endsWith(':collection');
        if (isCollection) {
            // No usable position (genre-filtered list): play the tapped track
            // itself rather than silently starting the collection at track 0.
            if (offsetPosition == null && offsetUri) {
                const ok = await this.sonosBridge.playTrack(sonosEntity, offsetUri);
                if (ok) this.triggerScan();
                return ok;
            }
            const res = await this.fetchSpotifyPlus('player_media_play_track_favorites',
                { shuffle: false }, { expectResponse: false });
            if (!res) return false;
            if (offsetPosition != null && offsetPosition > 0) {
                // Favorites load at roughly 5 tracks/sec on the Sonos path; allow
                // a longer window before giving up (playback continues from 0).
                this.sonosBridge.jumpWhenLoaded(sonosEntity, offsetPosition, { tries: 40, intervalMs: 500 });
            }
            this.triggerScan();
            return true;
        }
        // Playlist/album contexts launch straight onto the Sonos queue; artist and
        // show contexts return false here and take the SpotifyPlus path instead.
        const ok = await this.sonosBridge.playContext(sonosEntity, uri, {
            offsetPosition: offsetPosition != null ? offsetPosition : 0
        });
        if (ok) this.triggerScan();
        return ok;
    }

    /**
     * Call a SpotifyPlus service. The flags go either positionally
     * (`expectResponse, logError, throwOnError`) or as one options object in
     * the third slot (`{ expectResponse, logError, throwOnError }`, extra
     * positional arguments then ignored); both forms share the defaults
     * true / true / false. Any non-object third argument (a boolean, null,
     * undefined) is the positional form, exactly as before.
     */
    async fetchSpotifyPlus(service, params = {}, expectResponse = true, logError = true, throwOnError = false) {
        if (expectResponse !== null && typeof expectResponse === 'object') {
            ({ expectResponse = true, logError = true, throwOnError = false } = expectResponse);
        }
        // Immutable catalog reads share one request per TTL (see _cachedRead).
        // A caller that asked for no response is never served a cached one.
        if (this.hass && expectResponse && SpotifyApi.CACHED_READ_SERVICES.has(service)) {
            return this._cachedRead(service, params, logError, throwOnError);
        }
        return this._callSpotifyPlus(service, params, expectResponse, logError, throwOnError);
    }

    /**
     * Answer a CACHED_READ_SERVICES call from the read cache: identical
     * requests (same service and params) share one in-flight call and, for
     * READ_CACHE_TTL_MS after it lands, its response. Only real responses are
     * kept — a failed or empty call is dropped at once, so the next identical
     * request goes back to SpotifyPlus. `logError` / `throwOnError` are applied
     * per caller, exactly as an uncached call would apply them.
     */
    async _cachedRead(service, params, logError, throwOnError) {
        const cache = this._readCache;
        const key = `${service}|${stableStringify(params)}`;
        const now = Date.now();
        // Drop what has expired from the old end.
        for (const [k, e] of cache) {
            if (e.expires > now) break;
            cache.delete(k);
        }

        let entry = cache.get(key);
        if (entry && entry.expires <= now) {
            cache.delete(key);
            entry = null;
        }
        if (!entry) {
            // Until it lands the entry only lives READ_CACHE_PENDING_MS, so a
            // call that never settles cannot hold up identical requests forever.
            entry = { promise: null, expires: now + SpotifyApi.READ_CACHE_PENDING_MS };
            const drop = () => { if (cache.get(key) === entry) cache.delete(key); };
            entry.promise = this._callSpotifyPlus(service, params, true, false, true).then((res) => {
                // Held as JSON text and parsed afresh for every caller: callers
                // are free to modify what they get (the album page back-fills
                // `tracks` onto it) without that reaching anyone else's copy.
                const json = res == null ? res : JSON.stringify(res);
                if (typeof json !== 'string') { drop(); return res; }
                entry.expires = Date.now() + SpotifyApi.READ_CACHE_TTL_MS;
                return json;
            }).catch((e) => { drop(); throw e; });
            cache.set(key, entry);
            if (cache.size > SpotifyApi.READ_CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
        }

        try {
            const body = await entry.promise;
            return typeof body === 'string' ? JSON.parse(body) : body;
        } catch (e) {
            if (throwOnError) throw e;

            if (logError) {
                console.warn(`[SpotifyAPI] Failed Call [${service}]:`, JSON.stringify(e, null, 2));
            }
            return null;
        }
    }

    /** One uncached SpotifyPlus call. Use fetchSpotifyPlus; this is its transport. */
    async _callSpotifyPlus(service, params = {}, expectResponse = true, logError = true, throwOnError = false) {
        if (!this.hass) return null;

        // --- FIX: MAP STANDARD CONTROLS TO MEDIA_PLAYER DOMAIN ---
        // SpotifyPlus doesn't have custom services for basic transport controls.
        // We must redirect these to the standard HA 'media_player' domain.
        const standardServices = {
            'player_media_next_track': 'media_next_track',
            'player_media_previous_track': 'media_previous_track',
            'player_shuffle': 'shuffle_set',
            'player_repeat': 'repeat_set'
        };

        if (standardServices[service]) {
            const haService = standardServices[service];
            let callParams = { entity_id: this._controlEntity() };

            // Handle Shuffle (Map 'state' -> 'shuffle')
            if (service === 'player_shuffle') {
                // If param is 'true' string or boolean true, use true.
                // Note: Standard HA toggle is hard, usually we just set it.
                // The UI sends { state: 'true' } usually.
                callParams.shuffle = params.state === 'true' || params.state === true;
            }

            // Handle Repeat (Map 'state' -> 'repeat')
            if (service === 'player_repeat') {
                callParams.repeat = params.state || 'all';
            }

            try {
                // HA Sonos quirk: shuffle_set can reset the repeat mode (core #13984).
                // Capture repeat before toggling shuffle on a Sonos entity so we can
                // re-assert it afterwards.
                let repeatToRestore = null;
                if (service === 'player_shuffle' && callParams.entity_id !== this.entityId) {
                    const attrs = this.hass.states?.[callParams.entity_id]?.attributes;
                    if (attrs?.repeat) repeatToRestore = attrs.repeat;
                }

                await this.hass.callService('media_player', haService, callParams);

                if (repeatToRestore) {
                    await this.hass.callService('media_player', 'repeat_set', {
                        entity_id: callParams.entity_id,
                        repeat: repeatToRestore
                    });
                }

                this.triggerScan(); // Trigger scan after standard transport
                return { success: true };
            } catch (e) {
                console.warn(`[SpotifyAPI] Standard Service Call Failed [${haService}]:`, e);
                return null;
            }
        }
        // ---------------------------------------------------------

        try {
            const payload = {
                type: 'call_service',
                domain: 'spotifyplus',
                service: service,
                service_data: {
                    entity_id: this.entityId,
                    ...params
                }
            };

            if (expectResponse) payload.return_response = true;

            const response = await this.hass.callWS(payload);

            // Transfers get no rescan from SpotifyPlus on their own, and restricted
            // Connect devices (Google Cast) are slow to appear in the Web API — so
            // force a scan now plus delayed retries to catch the handoff landing.
            if (service === 'player_transfer_playback') this._scheduleTransferScans();

            if (!expectResponse) return true;

            if (response && response.response) return response.response;
            return response;

        } catch (e) {
            // Report major errors via callback — but ONLY for playback actions.
            // A background read (get_player_queue_info, get_*, etc.) failing
            // validation must NOT pop the "select a device" picker; that should
            // happen only when the user actually tried to play something.
            const errCode = e.code || '';
            const errMsg = e.message || '';
            const isValidationError = errCode === 'service_validation_error' || errMsg.includes('Validation error');
            // The Cast-token and Zeroconf failures often arrive as plain
            // HomeAssistantError (not service_validation_error), so match them
            // by shape too — otherwise they'd never reach the app's onError from
            // the transfer path. Mark reported errors so callers can skip a
            // duplicate generic toast.
            if (SpotifyApi.PLAYBACK_SERVICES.has(service) && (isValidationError || classifyPlaybackError(e))) {
                e._sbReported = true;
                this._reportError(e);
            }

            if (throwOnError) throw e;

            if (logError) {
                console.warn(`[SpotifyAPI] Failed Call [${service}]:`, JSON.stringify(e, null, 2));
            }
            return null;
        }
    }

    /**
     * Fetch `desiredTotal` items from a `limit`/`offset`-paginated SpotifyPlus
     * service, in batches of at most `maxLimit` per call (SpotifyPlus rejects
     * `limit` above its per-service cap). Starts at `baseParams.offset` (default
     * 0) and stops once `desiredTotal` items are collected, the API-reported
     * `total` is reached, or a page comes back genuinely empty.
     *
     * Deliberately does NOT treat "page shorter than requested" as "no more
     * available" — Spotify's search/list endpoints can filter or de-dupe a
     * page below `limit` while still having more results at the next offset
     * (confirmed live: limit=10, items_count=8, total=11, next at offset 10).
     * `offset` is advanced by the requested `limit`, not by how many items
     * actually came back, to stay aligned with the API's own paging cursor.
     *
     * The first page goes out alone (it supplies `total`); after that, pages
     * whose `limit`/`offset` no longer depend on an earlier response go out
     * together, at most MAX_PAGE_CONCURRENCY at a time, and are read back in
     * offset order. The calls are the same ones a page-at-a-time loop would
     * make — except that a page which comes back empty (or fails) cannot stop
     * the calls already issued alongside it. Whatever those return is thrown
     * away: the result ends at the empty page, as it always did. With no
     * `total` in the response nothing can be planned ahead, so it stays one
     * page at a time.
     *
     * Resolves to `{ items, total, offset }`, plus `failed: true` when the
     * first call came back with no result at all (failed): an empty list
     * then means "could not read", not "there is nothing".
     */
    async fetchPaginated(service, baseParams, desiredTotal, maxLimit = SpotifyApi.MAX_PAGE_LIMIT) {
        const items = [];
        let offset = baseParams.offset || 0;
        let total = null;
        let failed = false;
        while (items.length < desiredTotal) {
            if (total !== null && offset >= total) break;
            // The next call is always known. The ones after it are known up
            // front only once `total` is, and only while a full `maxLimit` page
            // is still wanted beyond them — their limit is then `maxLimit`
            // however short the pages before them come back.
            const batch = [{ limit: Math.min(maxLimit, desiredTotal - items.length), offset }];
            let planned = batch[0].limit;
            while (total !== null && batch.length < SpotifyApi.MAX_PAGE_CONCURRENCY
                && desiredTotal - items.length - planned >= maxLimit
                && offset + planned < total) {
                batch.push({ limit: maxLimit, offset: offset + planned });
                planned += maxLimit;
            }
            const results = await Promise.all(batch.map(p =>
                this.fetchSpotifyPlus(service, { ...baseParams, limit: p.limit, offset: p.offset })));
            if (items.length === 0 && total === null && !results[0]?.result) failed = true;

            let done = false;
            for (let i = 0; i < batch.length && !done; i++) {
                const page = results[i]?.result?.items || [];
                if (total === null) total = results[i]?.result?.total ?? null;
                items.push(...page);
                offset += batch[i].limit;
                done = page.length === 0 || (total !== null && offset >= total);
            }
            if (done) break;
        }
        const out = { items, total: total ?? items.length, offset };
        return failed ? { ...out, failed: true } : out;
    }

    /** True only when the HA WebSocket is genuinely connected and ready. */
    get _connectionUp() {
        return this._socketReady && this.hass?.connection?.connected !== false;
    }

    /**
     * Whether triggerScan can fire right now (visible, socket up, grace elapsed).
     * Don't fire while the app is backgrounded or the socket is reconnecting:
     * HA's callService surfaces a "connection lost" toast (+ haptic) on failure,
     * and scans otherwise fire the moment we return to the foreground before
     * the WebSocket has re-established. The grace period covers the window
     * where the socket reports connected before it can actually service calls.
     */
    get _canScanNow() {
        if (typeof document !== 'undefined' && document.hidden) return false;
        if (!this._connectionUp) return false;
        if (Date.now() - this._resumedAt < 4000) return false;
        return true;
    }

    async triggerScan() {
        if (!this.hass || !this._canScanNow) return;
        try {
            // Force HA to scan Spotify immediately
            await this.hass.callService('spotifyplus', 'trigger_scan_interval', {
                entity_id: this.entityId
            });
            this._lastScanAt = Date.now();
            // Wait 40ms for propagation as requested
            await new Promise(r => setTimeout(r, 40));
        } catch (e) {
            console.warn("[SpotifyAPI] Trigger Scan Failed:", e);
        }
    }

    /**
     * Fire triggerScan as soon as its guards allow (socket up, grace window
     * elapsed, page visible), retrying every second for up to timeoutMs.
     * Single-flight, and deduped against any scan fired within dedupeMs by
     * any caller. Resolves true once a scan was fired, false otherwise.
     */
    scanWhenReady({ timeoutMs = 15000, dedupeMs = 4000 } = {}) {
        if (Date.now() - this._lastScanAt < dedupeMs) return Promise.resolve(false);
        if (this._readyScanPromise) return this._readyScanPromise;
        this._readyScanPromise = new Promise((resolve) => {
            const deadline = Date.now() + timeoutMs;
            const finish = (ok) => {
                clearTimeout(this._readyScanTimer);
                this._readyScanTimer = null;
                this._readyScanPromise = null;
                resolve(ok);
            };
            const attempt = async () => {
                if (!this.hass) return finish(false);
                if (this._canScanNow) { await this.triggerScan(); return finish(true); }
                if (Date.now() >= deadline) return finish(false);
                this._readyScanTimer = setTimeout(attempt, 1000);
            };
            attempt();
        });
        return this._readyScanPromise;
    }

    /**
     * Scan immediately, then again at 2s and 6s. A single scan right after a
     * transfer usually polls Spotify before the target device reports as
     * active (Cast handoffs take seconds), leaving the entity idle until the
     * integration's own interval. triggerScan's guards make the delayed
     * firings safe when backgrounded or disconnected.
     */
    _scheduleTransferScans() {
        this._transferScanTimers.forEach(clearTimeout);
        this.triggerScan();
        this._transferScanTimers = [2000, 6000].map(ms =>
            setTimeout(() => this.triggerScan(), ms));
    }

    async playMedia(uri, type, specificDevice = null, extraOptions = {}) {
        if (!this.hass) return { success: false, error: "No HASS" };

        // A new play intent supersedes any remembered failed launch (and this
        // also clears it on the success path). transferPlayback's replay takes
        // the memory before calling in, so it isn't lost here.
        this._pendingPlay = null;
        this._launchWatchId = (this._launchWatchId || 0) + 1; // cancel a pending watchdog

        const stateObj = this.hass.states[this.entityId];
        // Active = playing, paused, or buffering. Idle/Off is not active.
        const isActive = stateObj && ['playing', 'paused', 'buffering'].includes(stateObj.state);

        // 1. Determine Device Strategy
        let deviceToUse = null;
        let resolvedDeviceObj = null; // The full resolved device object (for brand/Sonos detection)

        if (specificDevice) {
            // specificDevice may be a device object (from a pending-play replay,
            // so Sonos/brand detection works) or a bare device id string.
            resolvedDeviceObj = typeof specificDevice === 'object' ? specificDevice : null;
            deviceToUse = resolvedDeviceObj ? resolvedDeviceObj.id : specificDevice;
        } else {
            if (!isActive) {
                if (this.deviceResolver) {
                    try {
                        // Returns the device to use (from Default or User Selection)
                        const resolvedDevice = await this.deviceResolver();

                        if (resolvedDevice) {
                            resolvedDeviceObj = typeof resolvedDevice === 'object' ? resolvedDevice : null;
                            deviceToUse = typeof resolvedDevice === 'object' ? resolvedDevice.id : resolvedDevice;
                        } else {
                            // User cancelled or no device available
                            debugLog("Playback cancelled: No device selected.");
                            return { success: false, error: "No Device Selected" };
                        }
                    } catch (e) {
                        console.error("[SpotifyBrowser] Device resolution failed:", e);
                        return { success: false, error: "Device Resolution Failed" };
                    }
                } else {
                    console.warn("[SpotifyBrowser] Player idle & no device resolver. Playback may fail.");
                }
            } else {
                deviceToUse = null; // Active -> Use current
            }
        }

        // Sonos rejects offset_uri and only honours offset_position. Detect the
        // target so context jumps pick the right parameter. For the active device
        // we read brand off the entity attributes; for an idle launch we read it
        // off the resolved device object.
        const isSonosTarget = !!this.sonosBridge && this.sonosBridge.isSonosTarget(
            resolvedDeviceObj,
            isActive ? (stateObj?.attributes || {}) : {}
        );
        let sonosEntity = null;
        if (isSonosTarget) {
            sonosEntity = this.sonosBridge.resolveSonosEntity(
                resolvedDeviceObj, isActive ? (stateObj?.attributes || {}) : {});
            // Remember the target before any volume/transport call below: a local
            // launch never engages Spotify Connect, so this memory is the only
            // thing that routes subsequent commands (and now-playing) to the
            // speaker instead of the idle SpotifyPlus entity.
            if (sonosEntity) this.sonosBridge.noteLaunch(sonosEntity);
        }
        if (isSonosTarget && ['playlist', 'album', 'artist', 'show'].includes(type)) {
            this.sonosBridge.log(`playMedia: Sonos target → ${extraOptions.offset_position != null ? `offset_position=${extraOptions.offset_position}` : 'offset_uri (no index)'}`);
        }

        // Apply Default Volume if configured (even if we resolved a device
        // dynamically). Sonos routes to the local HA speaker entity, which is
        // safe to set pre-play (noteLaunch above already mapped it). The
        // SpotifyPlus entity, though, rejects volume_set until the device is
        // actually active ("no active Spotify player device"), so defer that
        // path until playback has succeeded — see _applyLaunchVolume below.
        let deferredVolume = null;
        if (!specificDevice && !isActive) {
            const vol = this._resolveDefaultVolume();
            if (vol !== null) {
                const launchDeviceId = resolvedDeviceObj?.id || (typeof deviceToUse === 'string' ? deviceToUse : null);
                if (!sonosEntity && this.deviceManager?.getVolumeCapability(launchDeviceId) === false) {
                    debugLog(`[SpotifyAPI] Skipping default volume — ${launchDeviceId} does not support remote volume`);
                } else if (sonosEntity) {
                    debugLog("Applying Default Volume (Sonos local):", vol);
                    this.setVolume(vol / 100);
                } else {
                    deferredVolume = vol / 100;
                }
            }
        }

        const executePlay = async (deviceIdToTry) => {
            // Strip the offset hints from the spread; we set the right one explicitly below.
            const { offset_uri, offset_position, ...rest } = extraOptions;
            const params = { ...rest };
            if (deviceIdToTry) params.device_id = deviceIdToTry;

            try {
                if (['playlist', 'album', 'artist', 'show'].includes(type)) {
                    // LOCAL-FIRST for Sonos (sonos.launch_mode: local, the default):
                    // drive the HA Sonos entity directly. Falls through to the
                    // SpotifyPlus (cloud / elevated-token) path on any failure.
                    if (isSonosTarget && this._sonosLaunchLocal()) {
                        const played = await this._playSonosLocal(sonosEntity, uri, offset_position, offset_uri);
                        if (played) return { success: true };
                    }

                    params.context_uri = uri;
                    // Sonos -> offset_position (when we have an index); otherwise offset_uri.
                    if (isSonosTarget && offset_position != null) {
                        params.offset_position = offset_position;
                    } else if (offset_uri) {
                        params.offset_uri = offset_uri;
                    }

                    // throwOnError: a failed call throws (it never returns a
                    // falsy value), so it lands in the catch below with the
                    // error itself, for the caller and the classification
                    // after executePlay. A rejected context or offset is no
                    // exception: there is no play-the-track-alone fallback.
                    await this.fetchSpotifyPlus('player_media_play_context', params, { expectResponse: false, throwOnError: true });

                    // Trigger Scan on Success
                    this.triggerScan();
                    return { success: true };
                }
                else if (type === 'likedsongs') {
                    params.shuffle = true;
                    // throwOnError, as above.
                    await this.fetchSpotifyPlus('player_media_play_track_favorites', params, { expectResponse: false, throwOnError: true });

                    // Trigger Scan on Success
                    this.triggerScan();
                    return { success: true };
                }
                else {
                    // C. Tracks / Fallback
                    if (deviceIdToTry || Array.isArray(uri)) {
                        const uriArray = Array.isArray(uri) ? uri : [uri];
                        params.uris = uriArray.join(',');

                        // throwOnError, as above.
                        await this.fetchSpotifyPlus('player_media_play_tracks', params, { expectResponse: false, throwOnError: true });
                    } else {
                        const contentId = Array.isArray(uri) ? uri[0] : uri;
                        // Active-device single-track play: drive the Sonos entity
                        // locally when the active device is Sonos, else SpotifyPlus.
                        if (isSonosTarget && this._sonosLaunchLocal()) {
                            if (sonosEntity && await this.sonosBridge.playTrack(sonosEntity, contentId)) {
                                this.triggerScan();
                                return { success: true };
                            }
                        }
                        await this.hass.callService('media_player', 'play_media', {
                            entity_id: this.entityId,
                            media_content_id: contentId,
                            media_content_type: type
                        });
                    }
                    // Trigger Scan on Success
                    this.triggerScan();
                    return { success: true };
                }
            } catch (e) {
                console.error("Playback execution failed:", e);
                return { success: false, error: e };
            }
        };

        // --- EXECUTE PLAYBACK ---
        const result = await executePlay(deviceToUse);

        // Now that the device is active, apply the deferred launch volume.
        if (result.success && deferredVolume !== null) this._applyLaunchVolume(deferredVolume);

        // A bare play sent to an "active" device that has nothing loaded may be
        // silently ignored (stale Spotify Connect session). Verify it started.
        if (result.success && !specificDevice && isActive && !SpotifyApi.playerHasItem(stateObj)) {
            this._watchStalledLaunch(uri, type, extraOptions, stateObj.attributes?.source || 'The active device');
        }

        if (!specificDevice && !isActive && result.success === false && deviceToUse) {
            // Remember the launch when it died to a device problem, so re-picking
            // a device from the (re)opened picker replays it instead of a bare
            // transfer. (specificDevice replays re-store inside transferPlayback.)
            if (result.error?._sbReported || classifyPlaybackError(result.error)) {
                this._storePendingPlay(uri, type, extraOptions);
            }
            // Skip the generic toast when the API already surfaced a specific,
            // actionable message for this error via the onError callback.
            if (!result.error?._sbReported) {
                this._notify(`Playback failed on ${resolvedDeviceObj?.name || deviceToUse}`);
            }
        }

        return result;
    }

    /**
     * Apply the configured launch volume right after a cold-start play. The
     * Spotify device is active the moment play succeeds, but the Web API can
     * lag a beat before it accepts volume_set — retry once, silently. A missed
     * default volume isn't worth a toast.
     */
    async _applyLaunchVolume(level) {
        const res = await this.setVolume(level, { silent: true });
        if (res?.success || res?.skipped) return;
        setTimeout(() => this.setVolume(level, { silent: true }), 1500);
    }

    /**
     * Transfer playback to a device. If a recent launch failed on another
     * device and the player is still idle, replay that launch on the chosen
     * device (play-with-device_id transfers implicitly, and reuses all the
     * Sonos/offset/fallback logic) instead of a bare transfer. Returns
     * { success, replayed?, reported? }.
     */
    async transferPlayback(device, { play = true } = {}) {
        if (!this._entityActive()) {
            const pending = this._takePendingPlay();
            if (pending) {
                const res = await this.playMedia(pending.uri, pending.type, device, pending.extraOptions);
                if (!res?.success) {
                    // Keep the memory alive so the user can pick another device.
                    this._storePendingPlay(pending.uri, pending.type, pending.extraOptions);
                    return { success: false, replayed: true, reported: !!res?.error?._sbReported };
                }
                return { success: true, replayed: true };
            }
        }
        try {
            // expectResponse=false: player_transfer_playback doesn't support
            // return_response=true. throwOnError so we can classify failures.
            await this.fetchSpotifyPlus('player_transfer_playback', { device_id: device.id, play }, { expectResponse: false, throwOnError: true });
            return { success: true };
        } catch (e) {
            return { success: false, reported: !!e._sbReported };
        }
    }

    async togglePlayback(play) {
        if (!this.hass) return;
        const service = play ? 'media_play' : 'media_pause';
        try {
            await this.hass.callService('media_player', service, {
                entity_id: this._controlEntity()
            });
            // Trigger Scan
            this.triggerScan();
        } catch (e) {
            console.error(`Failed to ${service}:`, e);
        }
    }

    /** The active SpotifyPlus entity attributes (empty object if unavailable). */
    _activeAttributes() {
        return this.hass?.states?.[this.entityId]?.attributes || {};
    }

    /**
     * Add a track to the queue. For Sonos the queue lives on the device, so route
     * through the HA Sonos integration; otherwise use SpotifyPlus. Returns
     * { success: boolean }.
     */
    async addToQueue(uri) {
        if (!this.hass || !uri) return { success: false };
        const target = this.sonosBridge?.activeTarget(this._activeAttributes());
        if (target?.isSonos && target.entity) {
            return await this.sonosBridge.addToQueue(target.entity, uri);
        }
        if (target?.isSonos && !target.entity) {
            // Cloud queue-adds are ignored by an unmapped Sonos local queue —
            // tell the user how to fix it instead of failing silently.
            this.sonosBridge.reportUnmapped(this._activeAttributes().source);
        }
        const res = await this.fetchSpotifyPlus('add_player_queue_items', { uris: uri }, { expectResponse: false });
        return { success: !!res };
    }

    /**
     * A service call over the WebSocket (`call_service`, the message
     * hass.callService sends) without hass.callService's own failure toast.
     * For calls whose callers report a failure themselves: through
     * hass.callService the user would get Home Assistant's toast as well.
     */
    _callServiceQuietly(domain, service, serviceData) {
        return this.hass.callWS({ type: 'call_service', domain, service, service_data: serviceData });
    }

    /**
     * Fire-and-forget SpotifyPlus command: `{ success: true }` once HA accepts
     * it, else `{ success: false, error }` with a console.error "<label>
     * failed:". `buildData` returns the service data minus entity_id and runs
     * inside the try, so a bad argument fails the same way a refused call
     * does. Sent with _callServiceQuietly: every caller that shows the
     * outcome reports a failure itself.
     */
    async _command(service, label, buildData) {
        try {
            await this._callServiceQuietly('spotifyplus', service, {
                entity_id: this.entityId,
                ...buildData()
            });
            return { success: true };
        } catch (e) {
            console.error(`${label} failed:`, e);
            return { success: false, error: e };
        }
    }

    /** One id or a list of ids as the comma-separated string SpotifyPlus takes. */
    _joinIds(ids) {
        return Array.isArray(ids) ? ids.join(',') : ids;
    }

    /**
     * Whether `ids` (one id, a comma-separated string or a list) names any
     * id. With none, an ids service must not be called: SpotifyPlus then
     * acts on the playing track / album / artist instead.
     */
    _hasIds(ids) {
        return Array.isArray(ids) ? ids.some(Boolean) : !!ids;
    }

    /** A save / remove / follow command on `ids`; `{ success: false }` and no call when there are none. */
    async _idsCommand(service, label, ids) {
        if (!this.hass || !this._hasIds(ids)) return { success: false };
        return this._command(service, label, () => ({ ids: this._joinIds(ids) }));
    }

    /**
     * The check_* wrappers (artists followed, albums and tracks saved). For
     * one id (a string without commas) true/false; for a list or a comma
     * string an {id: bool} map ({} for a list with no ids, which sends
     * nothing). SpotifyPlus may answer with a list of booleans in id order or
     * a dict keyed by id, either possibly as JSON text; both are normalized.
     * Null when there is no hass or id, or when the call fails
     * (fetchSpotifyPlus has already warned). The catch only ever sees a bad
     * `ids` argument, logged as "<label> failed:".
     */
    async _checkIds(service, ids, label) {
        if (!this.hass || !ids) return null;
        if (!this._hasIds(ids)) return {};
        try {
            const idList = Array.isArray(ids) ? ids.slice() : String(ids).split(',');
            const idsParam = idList.join(',');
            const res = await this.fetchSpotifyPlus(service, { ids: idsParam });

            let result = res?.result ?? res;
            if (typeof result === 'string') {
                try { result = JSON.parse(result); } catch (e) { /* leave as-is */ }
            }
            if (result == null) return null;

            // SpotifyPlus may return either a list of booleans (in id order, like
            // the raw Spotify API) or a dict keyed by id. Normalize to {id: bool}.
            const truthy = (v) => v === true || v === 'true';
            let map = {};
            if (Array.isArray(result)) {
                idList.forEach((id, i) => { map[id] = truthy(result[i]); });
            } else if (typeof result === 'object') {
                for (const [k, v] of Object.entries(result)) map[k] = truthy(v);
                // If the dict isn't actually keyed by our ids, fall back to order.
                if (idList.length && !idList.some(id => id in map)) {
                    const vals = Object.values(result);
                    map = {};
                    idList.forEach((id, i) => { map[id] = truthy(vals[i]); });
                }
            } else if (typeof result === 'boolean') {
                map[idList[0]] = result;
            }

            // Single id -> boolean; multiple -> the {id: bool} map.
            const single = !Array.isArray(ids) && !idsParam.includes(',');
            return single ? (map[idList[0]] === true) : map;
        } catch (e) {
            console.error(`${label} failed:`, e);
            return null;
        }
    }

    /**
     * The playlist-items guard: `uris` (one or a list, blanks dropped) as
     * `{ list }`, or `{ error }` when there is no hass, playlist id or uri.
     */
    _playlistUriList(playlistId, uris) {
        const list = Array.isArray(uris) ? uris.filter(Boolean) : (uris ? [uris] : []);
        if (!this.hass || !playlistId || list.length === 0) {
            return { error: new Error('Playlist id and track URIs are required') };
        }
        return { list };
    }

    // --- PLAYLIST MANAGEMENT ---

    async followPlaylist(playlistId, isPublic = true) {
        if (!this.hass || !playlistId) return { success: false };
        return this._command('follow_playlist', 'Follow Playlist',
            () => ({ playlist_id: playlistId, public: isPublic }));
    }

    async unfollowPlaylist(playlistId) {
        if (!this.hass || !playlistId) return { success: false };
        return this._command('unfollow_playlist', 'Unfollow Playlist', () => ({ playlist_id: playlistId }));
    }

    async getCurrentUserProfile() {
        if (!this.hass) return null;
        try {
            // Workaround: Use get_playlist_favorites to retrieve user profile since no dedicated service exists
            const res = await this.fetchSpotifyPlus('get_playlist_favorites', { limit_total: 1 });
            return res?.user_profile; // Returns full user object including ID
        } catch (e) {
            console.warn("Get Current User Profile failed:", e);
            return null;
        }
    }

    /**
     * The current account's Spotify user id, memoized for the session. Prefers
     * the entity's `sp_user_id` attribute (no network) and falls back to the
     * profile lookup. Needed to build the playable Liked Songs context URI
     * (`spotify:user:<id>:collection`) — the `me` shorthand is not playable.
     */
    async getCurrentUserId() {
        if (this._currentUserId) return this._currentUserId;

        const attrId = this.hass?.states?.[this.entityId]?.attributes?.sp_user_id;
        if (attrId) {
            this._currentUserId = attrId;
            return attrId;
        }

        const profile = await this.getCurrentUserProfile();
        if (profile?.id) this._currentUserId = profile.id;
        return this._currentUserId || null;
    }

    async checkUserFollowsPlaylist(playlistId, userIds) {
        // No user ids: SpotifyPlus would check the current user instead.
        if (!this.hass || !playlistId || !this._hasIds(userIds)) return null;
        try {
            const idsParam = this._joinIds(userIds);
            const res = await this.fetchSpotifyPlus('check_playlist_followers', {
                playlist_id: playlistId,
                user_ids: idsParam
            });

            if (res?.result) {
                return Object.values(res.result);
            }
            return null;
        } catch (e) {
            console.warn("Check Playlist Followers failed:", e);
            return null;
        }
    }

    /**
     * Create a playlist for the current account. Spotify requires collaborative
     * playlists to be private, so `collaborative: true` forces `public: false`.
     * Returns { success, playlist } — playlist is the full object from Spotify
     * (note: its snapshot id field is camelCase `snapshotId`).
     */
    async createPlaylist({ name, description = '', isPublic = true, collaborative = false }) {
        if (!this.hass || !name) return { success: false, error: new Error('Playlist name is required') };
        try {
            const res = await this.fetchSpotifyPlus('playlist_create', {
                name,
                description,
                public: collaborative ? false : isPublic,
                collaborative
            }, { throwOnError: true });
            return { success: true, playlist: res?.result || null };
        } catch (e) {
            console.error("Create Playlist failed:", e);
            return { success: false, error: e };
        }
    }

    /**
     * Edit an owned playlist's details. The SpotifyPlus service requires ALL
     * FOUR fields on every call — callers must pass the playlist's current
     * values for anything they aren't changing, or those fields get clobbered.
     */
    async changePlaylistDetails(playlistId, { name, description = '', isPublic = true, collaborative = false }) {
        if (!this.hass || !playlistId || !name) return { success: false, error: new Error('Playlist id and name are required') };
        return this._command('playlist_change', 'Change Playlist Details', () => ({
            playlist_id: playlistId,
            name,
            description,
            public: collaborative ? false : isPublic,
            collaborative
        }));
    }

    /**
     * Append (or insert at `position`, 0-based) tracks to a playlist. Chunks
     * into batches of 100 (Spotify's per-call ceiling). Empty `uris` is an
     * error: the underlying service would silently target the currently
     * playing track. Returns { success, snapshotId }.
     */
    async addPlaylistItems(playlistId, uris, position = undefined) {
        const { list, error } = this._playlistUriList(playlistId, uris);
        if (error) return { success: false, error };
        try {
            let snapshotId = null;
            for (let i = 0; i < list.length; i += 100) {
                const params = { playlist_id: playlistId, uris: list.slice(i, i + 100).join(',') };
                if (Number.isInteger(position)) params.position = position + i;
                const res = await this.fetchSpotifyPlus('playlist_items_add', params, { throwOnError: true });
                if (typeof res?.result === 'string') snapshotId = res.result;
            }
            return { success: true, snapshotId };
        } catch (e) {
            console.error("Add Playlist Items failed:", e);
            return { success: false, error: e };
        }
    }

    /**
     * Remove tracks by URI. Spotify removes EVERY occurrence of a duplicated
     * URI — there is no position targeting in the SpotifyPlus wrapper. Chunks
     * into batches of 100, threading the returned snapshot id between chunks.
     */
    async removePlaylistItems(playlistId, uris, snapshotId = undefined) {
        const { list, error } = this._playlistUriList(playlistId, uris);
        if (error) return { success: false, error };
        try {
            let currentSnapshot = snapshotId || null;
            for (let i = 0; i < list.length; i += 100) {
                const params = { playlist_id: playlistId, uris: list.slice(i, i + 100).join(',') };
                if (currentSnapshot) params.snapshot_id = currentSnapshot;
                const res = await this.fetchSpotifyPlus('playlist_items_remove', params, { throwOnError: true });
                if (typeof res?.result === 'string') currentSnapshot = res.result;
            }
            return { success: true, snapshotId: currentSnapshot };
        } catch (e) {
            console.error("Remove Playlist Items failed:", e);
            return { success: false, error: e };
        }
    }

    /**
     * Move a contiguous range of tracks. NOTE: rangeStart and insertBefore are
     * 1-OFFSET (matching the SpotifyPlus service and on-screen track numbers),
     * NOT 0-based array indexes — callers convert with `index + 1`.
     */
    async reorderPlaylistItems(playlistId, rangeStart, insertBefore, rangeLength = 1, snapshotId = undefined) {
        if (!this.hass || !playlistId) return { success: false };
        try {
            const params = {
                playlist_id: playlistId,
                range_start: rangeStart,
                insert_before: insertBefore,
                range_length: rangeLength
            };
            if (snapshotId) params.snapshot_id = snapshotId;
            const res = await this.fetchSpotifyPlus('playlist_items_reorder', params, { throwOnError: true });
            return { success: true, snapshotId: typeof res?.result === 'string' ? res.result : null };
        } catch (e) {
            console.error("Reorder Playlist Items failed:", e);
            return { success: false, error: e };
        }
    }

    /**
     * Overwrite the playlist's entire contents (max 100 tracks — Spotify does
     * not page this call). Resets every track's added_at/added_by, so it's the
     * fallback for duplicate-precise removal, not the default save path. Empty
     * `uris` is an error: the raw service would CLEAR the playlist.
     */
    async replacePlaylistItems(playlistId, uris) {
        const { list, error } = this._playlistUriList(playlistId, uris);
        if (error) return { success: false, error };
        if (list.length > 100) {
            return { success: false, error: new Error('playlist_items_replace is limited to 100 tracks') };
        }
        try {
            const res = await this.fetchSpotifyPlus('playlist_items_replace', {
                playlist_id: playlistId,
                uris: list.join(',')
            }, { throwOnError: true });
            return { success: true, snapshotId: typeof res?.result === 'string' ? res.result : null };
        } catch (e) {
            console.error("Replace Playlist Items failed:", e);
            return { success: false, error: e };
        }
    }

    /**
     * One page of a playlist's tracks. When a `fields` filter is set, Spotify
     * caps the reported `total` at <=50 — page on `next`/short-page instead of
     * trusting `total` in that case.
     */
    async getPlaylistItemsPage(playlistId, offset = 0, limit = 50, fields = undefined) {
        if (!this.hass || !playlistId) return null;
        const params = { playlist_id: playlistId, offset, limit };
        if (fields) params.fields = fields;
        const res = await this.fetchSpotifyPlus('get_playlist_items', params);
        return res?.result || null;
    }

    /**
     * The current user's OWN playlists (owned, not merely followed) — the set
     * that "Add to playlist" may target. Ordered per the device's playlist
     * sort preference (Recents by default).
     */
    async getCurrentUserOwnedPlaylists() {
        if (!this.hass) return [];
        const res = await this.fetchSpotifyPlus('get_playlist_favorites', { limit_total: 200, ...playlistSortParams() });
        const items = res?.result?.items || [];
        const userId = res?.user_profile?.id || await this.getCurrentUserId();
        if (userId && !this._currentUserId) this._currentUserId = userId;
        if (!userId) return [];
        return items.filter(p => p?.owner?.id === userId);
    }

    // --- ARTIST FOLLOW MANAGEMENT ---

    async followArtist(ids) {
        return this._idsCommand('follow_artists', 'Follow Artist', ids);
    }

    async unfollowArtist(ids) {
        return this._idsCommand('unfollow_artists', 'Unfollow Artist', ids);
    }

    /** True/false (single id) or an id→bool map (several), or null on failure (see _checkIds). */
    async checkArtistsFollowing(ids) {
        return this._checkIds('check_artists_following', ids, 'Check Artists Following');
    }

    /** True/false (single id) or an id→bool map (several), or null on failure (see _checkIds). */
    async checkTrackFavorites(ids) {
        return this._checkIds('check_track_favorites', ids, 'Check Track Favorites');
    }

    // --- LIBRARY & CATALOG READS ---
    // Each makes the one fetchSpotifyPlus call its name says, with `params`
    // exactly as given, and unwraps the response here instead of at every
    // caller. A list read resolves to a ListPage, a single-object read to the
    // object; either resolves to null when the read failed (or the response
    // holds nothing of that shape). A thrown error (throwOnError is never set
    // here, so only a broken transport) passes through.

    /**
     * Saved playlists (get_playlist_favorites): playlist objects.
     * @param {object} [params]  limit / offset or limit_total, sort_result, ...
     * @returns {Promise<ListPage|null>}
     */
    async getSavedPlaylists(params = {}) {
        return listPage(await this.fetchSpotifyPlus('get_playlist_favorites', params));
    }

    /**
     * Saved albums (get_album_favorites): the album objects themselves, out of
     * Spotify's { added_at, album } wrappers; a wrapper without an album is
     * dropped. `total` counts wrappers, as Spotify reports it.
     * @param {object} [params]  limit / offset or limit_total, sort_result, ...
     * @returns {Promise<ListPage|null>}
     */
    async getSavedAlbums(params = {}) {
        const page = listPage(await this.fetchSpotifyPlus('get_album_favorites', params));
        return page && { items: page.items.map(i => i?.album).filter(Boolean), total: page.total };
    }

    /**
     * Saved tracks (get_track_favorites): Spotify's { added_at, track }
     * wrappers, kept as they are (Liked Songs renders them as playlist items).
     * @param {object} [params]  limit, offset, sort_result, ...
     * @returns {Promise<ListPage|null>}
     */
    async getSavedTracks(params = {}) {
        return listPage(await this.fetchSpotifyPlus('get_track_favorites', params));
    }

    /**
     * Followed artists (get_artists_followed), which page by cursor, not
     * offset: `after` is the cursor for the next page — the page's
     * `cursors.after`, else the last artist's id, else null. Robust parsing:
     * SpotifyPlus sends the page flat in `result`; the Web API's own shape
     * nests it under `result.artists`, which is read when it holds a list.
     * @param {object} [params]  limit, after, sort_result, ...
     * @returns {Promise<(ListPage & { after: string|null })|null>}
     */
    async getFollowedArtists(params = {}) {
        const r = (await this.fetchSpotifyPlus('get_artists_followed', params))?.result;
        const page = Array.isArray(r?.artists?.items) ? r.artists : r;
        if (!Array.isArray(page?.items)) return null;
        const items = page.items;
        return { items, total: page.total, after: page.cursors?.after || items[items.length - 1]?.id || null };
    }

    /** The artist object (get_artist, read-cached), or null. @param {string} artistId */
    async getArtist(artistId) {
        return resultObject(await this.fetchSpotifyPlus('get_artist', { artist_id: artistId }));
    }

    /** The album object (get_album, read-cached), or null. @param {string} albumId */
    async getAlbum(albumId) {
        return resultObject(await this.fetchSpotifyPlus('get_album', { album_id: albumId }));
    }

    /** The track object (get_track, read-cached), or null. @param {string} trackId */
    async getTrack(trackId) {
        return resultObject(await this.fetchSpotifyPlus('get_track', { track_id: trackId }));
    }

    /**
     * The playlist object (get_playlist; never cached: playlists are
     * editable), with only its first page of tracks inline. Null on failure.
     * @param {string} playlistId
     */
    async getPlaylist(playlistId) {
        return resultObject(await this.fetchSpotifyPlus('get_playlist', { playlist_id: playlistId }));
    }

    // Per-artist genre lookup. Returns string[] of genres (may be empty). Used
    // to build the Liked Songs filter pills, which ask again for every artist
    // on each visit — so beyond the read cache's few minutes, an answer is kept
    // for the session (see _remember). A failed lookup still returns [] but is
    // not kept, so the next call retries it.
    async getArtistGenres(artistId) {
        if (!this.hass || !artistId) return [];
        if (!this._artistGenreCache) this._artistGenreCache = new Map();
        if (this._artistGenreCache.has(artistId)) return this._artistGenreCache.get(artistId);
        let res = null;
        try {
            res = await this.fetchSpotifyPlus('get_artist', { artist_id: artistId });
        } catch (e) { res = null; }
        if (!res) return [];
        const genres = res.result?.genres || res.genres || [];
        this._remember(this._artistGenreCache, artistId, genres);
        return genres;
    }

    /**
     * Fetch a single track's album art URL by Spotify id, memoized for the
     * session. Used to enrich the Sonos queue (sonos.get_queue returns no art),
     * which asks again for the whole queue on every track change. Returns a
     * URL string or null. A failed lookup returns null but is not memoized, so
     * the next call retries it.
     */
    async getTrackArt(trackId) {
        if (!this.hass || !trackId) return null;
        if (!this._trackArtCache) this._trackArtCache = new Map();
        if (this._trackArtCache.has(trackId)) return this._trackArtCache.get(trackId);
        let res = null;
        try {
            res = await this.fetchSpotifyPlus('get_track', { track_id: trackId });
        } catch (e) { res = null; }
        if (!res) return null;
        const track = res.result || res;
        const url = track?.album?.images?.[0]?.url || null;
        this._remember(this._trackArtCache, trackId, url);
        return url;
    }

    /** Keep a small derived value for the session; past the cap the oldest goes. */
    _remember(memo, key, value) {
        memo.set(key, value);
        if (memo.size > SpotifyApi.DERIVED_MEMO_MAX_ENTRIES) memo.delete(memo.keys().next().value);
    }

    async searchPlaylists(query, limit = 10, offset = 0) {
        if (!this.hass || !query) return { result: { items: [] } };

        const { items, total } = await this.fetchPaginated('search_playlists', { criteria: query, offset }, limit);
        return { result: { items, total } };
    }

    async saveTrackFavorites(ids) {
        return this._idsCommand('save_track_favorites', 'Save Track Favorites', ids);
    }

    async removeTrackFavorites(ids) {
        return this._idsCommand('remove_track_favorites', 'Remove Track Favorites', ids);
    }

    /** True/false (single id) or an id→bool map (several), or null on failure (see _checkIds). */
    async checkAlbumFavorites(ids) {
        return this._checkIds('check_album_favorites', ids, 'Check Album Favorites');
    }

    async saveAlbumFavorites(ids) {
        return this._idsCommand('save_album_favorites', 'Save Album Favorites', ids);
    }

    async removeAlbumFavorites(ids) {
        return this._idsCommand('remove_album_favorites', 'Remove Album Favorites', ids);
    }

    async setVolume(volumeLevel, { silent = false } = {}) {
        if (!this.hass) return { success: false };
        const entityId = this._controlEntity({ perSpeaker: true });

        // Sonos volume goes to the local HA Sonos entity (always capable) —
        // only guard the SpotifyPlus path, where restricted Connect devices
        // like phones reject remote volume (Device.supports_volume === false).
        if (entityId === this.entityId) {
            const deviceId = this._activeAttributes().sp_device_id;
            if (this.deviceManager?.getVolumeCapability(deviceId) === false) {
                debugLog(`[SpotifyAPI] setVolume: ${deviceId} does not support remote volume — skipping`);
                return { success: false, skipped: true };
            }
        }

        try {
            // Quietly: a failure is reported below (or, `silent`, deliberately not at all).
            await this._callServiceQuietly('media_player', 'volume_set', {
                entity_id: entityId,
                volume_level: volumeLevel
            });
            return { success: true };
        } catch (e) {
            console.error("Failed to set volume:", e);
            if (!silent) {
                const info = classifyPlaybackError(e);
                this._notify(info ? info.message
                    : (e?.message || '').includes('Cannot control device volume')
                        ? "This device doesn't support remote volume control."
                        : "Couldn't change the volume.");
            }
            return { success: false, error: e };
        }
    }

    async seek(positionSeconds) {
        if (!this.hass) return { success: false };
        try {
            await this.hass.callService('media_player', 'media_seek', {
                entity_id: this._controlEntity(),
                seek_position: Math.max(0, Math.floor(positionSeconds))
            });
            this.triggerScan();
            return { success: true };
        } catch (e) {
            console.error("Failed to seek:", e);
            return { success: false, error: e };
        }
    }
}