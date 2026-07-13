import { debugLog, playlistSortParams } from './utils.js';

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
                { shuffle: false }, false);
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

    async fetchSpotifyPlus(service, params = {}, expectResponse = true, logError = true, throwOnError = false) {
        if (!this.hass) return null;

        // --- FIX: MAP STANDARD CONTROLS TO MEDIA_PLAYER DOMAIN ---
        // SpotifyPlus doesn't have custom services for basic transport controls.
        // We must redirect these to the standard HA 'media_player' domain.
        const standardServices = {
            'player_media_next_track': 'media_next_track',
            'player_media_previous_track': 'media_previous_track',
            'player_media_play': 'media_play',
            'player_media_pause': 'media_pause',
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
            if (isValidationError && SpotifyApi.PLAYBACK_SERVICES.has(service)) {
                this._reportError(e);
            }

            if (throwOnError) throw e;

            if (logError) {
                console.warn(`[SpotifyAPI] Failed Call [${service}]:`, JSON.stringify(e, null, 2));
            }
            return null;
        }
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

        const stateObj = this.hass.states[this.entityId];
        // Active = playing, paused, or buffering. Idle/Off is not active.
        const isActive = stateObj && ['playing', 'paused', 'buffering'].includes(stateObj.state);

        // 1. Determine Device Strategy
        let deviceToUse = null;
        let resolvedDeviceObj = null; // The full resolved device object (for brand/Sonos detection)

        if (specificDevice) {
            deviceToUse = specificDevice;
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
        // dynamically). Runs after Sonos detection so the volume_set routes to
        // the Sonos speaker on a Sonos launch, not the idle SpotifyPlus entity
        // (which rejects it with "no active Spotify player device").
        if (!specificDevice && !isActive) {
            const vol = this._resolveDefaultVolume();
            if (vol !== null) {
                const launchDeviceId = resolvedDeviceObj?.id || (typeof deviceToUse === 'string' ? deviceToUse : null);
                if (!sonosEntity && this.deviceManager?.getVolumeCapability(launchDeviceId) === false) {
                    debugLog(`[SpotifyAPI] Skipping default volume — ${launchDeviceId} does not support remote volume`);
                } else {
                    debugLog("Applying Default Volume:", vol);
                    this.setVolume(vol / 100);
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

                    // Enable throwOnError to catch validation errors
                    const res = await this.fetchSpotifyPlus('player_media_play_context', params, false, true, true);

                    if ((!res || res.error) && offset_uri) {
                        console.warn("[SpotifyAPI] Context jump failed. Falling back to Track Play.");
                        return await this.playMedia(extraOptions.offset_uri, 'track', deviceIdToTry);
                    }
                    if (!res) return { success: false, error: "Call Failed" };

                    // Trigger Scan on Success
                    this.triggerScan();
                    return { success: true };
                }
                else if (type === 'likedsongs') {
                    params.shuffle = true;
                    // Enable throwOnError
                    const res = await this.fetchSpotifyPlus('player_media_play_track_favorites', params, false, true, true);
                    if (!res) return { success: false, error: "Call Failed" };

                    // Trigger Scan on Success
                    this.triggerScan();
                    return { success: true };
                }
                else {
                    // C. Tracks / Fallback
                    if (deviceIdToTry || Array.isArray(uri)) {
                        const uriArray = Array.isArray(uri) ? uri : [uri];
                        params.uris = uriArray.join(',');

                        // Enable throwOnError
                        const res = await this.fetchSpotifyPlus('player_media_play_tracks', params, false, true, true);
                        if (!res) return { success: false, error: "Call Failed" };
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

        if (!specificDevice && !isActive && result.success === false && deviceToUse) {
            this._notify(`Playback Failed on ${deviceToUse}`);
        }

        return result;
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
        const res = await this.fetchSpotifyPlus('add_player_queue_items', { uris: uri }, false);
        return { success: !!res };
    }

    // --- PLAYLIST MANAGEMENT ---

    async followPlaylist(playlistId, isPublic = true) {
        if (!this.hass || !playlistId) return { success: false };
        try {
            await this.hass.callService('spotifyplus', 'follow_playlist', {
                entity_id: this.entityId,
                playlist_id: playlistId,
                public: isPublic
            });
            return { success: true };
        } catch (e) {
            console.error("Follow Playlist failed:", e);
            return { success: false, error: e };
        }
    }

    async unfollowPlaylist(playlistId) {
        if (!this.hass || !playlistId) return { success: false };
        try {
            await this.hass.callService('spotifyplus', 'unfollow_playlist', {
                entity_id: this.entityId,
                playlist_id: playlistId
            });
            return { success: true };
        } catch (e) {
            console.error("Unfollow Playlist failed:", e);
            return { success: false, error: e };
        }
    }

    async getCurrentUserProfile() {
        if (!this.hass) return null;
        try {
            // Workaround: Use get_playlist_favorites to retrieve user profile since no dedicated service exists
            const res = await this.fetchSpotifyPlus('get_playlist_favorites', { limit_total: 1 }, true);
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
        if (!this.hass || !playlistId || !userIds) return null;
        try {
            const idsParam = Array.isArray(userIds) ? userIds.join(',') : userIds;
            const res = await this.fetchSpotifyPlus('check_playlist_followers', {
                playlist_id: playlistId,
                user_ids: idsParam
            }, true);

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
            }, true, true, true);
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
        try {
            await this.hass.callService('spotifyplus', 'playlist_change', {
                entity_id: this.entityId,
                playlist_id: playlistId,
                name,
                description,
                public: collaborative ? false : isPublic,
                collaborative
            });
            return { success: true };
        } catch (e) {
            console.error("Change Playlist Details failed:", e);
            return { success: false, error: e };
        }
    }

    /**
     * Append (or insert at `position`, 0-based) tracks to a playlist. Chunks
     * into batches of 100 (Spotify's per-call ceiling). Empty `uris` is an
     * error: the underlying service would silently target the currently
     * playing track. Returns { success, snapshotId }.
     */
    async addPlaylistItems(playlistId, uris, position = undefined) {
        const list = Array.isArray(uris) ? uris.filter(Boolean) : (uris ? [uris] : []);
        if (!this.hass || !playlistId || list.length === 0) {
            return { success: false, error: new Error('Playlist id and track URIs are required') };
        }
        try {
            let snapshotId = null;
            for (let i = 0; i < list.length; i += 100) {
                const params = { playlist_id: playlistId, uris: list.slice(i, i + 100).join(',') };
                if (Number.isInteger(position)) params.position = position + i;
                const res = await this.fetchSpotifyPlus('playlist_items_add', params, true, true, true);
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
        const list = Array.isArray(uris) ? uris.filter(Boolean) : (uris ? [uris] : []);
        if (!this.hass || !playlistId || list.length === 0) {
            return { success: false, error: new Error('Playlist id and track URIs are required') };
        }
        try {
            let currentSnapshot = snapshotId || null;
            for (let i = 0; i < list.length; i += 100) {
                const params = { playlist_id: playlistId, uris: list.slice(i, i + 100).join(',') };
                if (currentSnapshot) params.snapshot_id = currentSnapshot;
                const res = await this.fetchSpotifyPlus('playlist_items_remove', params, true, true, true);
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
            const res = await this.fetchSpotifyPlus('playlist_items_reorder', params, true, true, true);
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
        const list = Array.isArray(uris) ? uris.filter(Boolean) : (uris ? [uris] : []);
        if (!this.hass || !playlistId || list.length === 0) {
            return { success: false, error: new Error('Playlist id and track URIs are required') };
        }
        if (list.length > 100) {
            return { success: false, error: new Error('playlist_items_replace is limited to 100 tracks') };
        }
        try {
            const res = await this.fetchSpotifyPlus('playlist_items_replace', {
                playlist_id: playlistId,
                uris: list.join(',')
            }, true, true, true);
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
        if (!this.hass || !ids) return { success: false };
        try {
            await this.hass.callService('spotifyplus', 'follow_artists', {
                entity_id: this.entityId,
                ids: Array.isArray(ids) ? ids.join(',') : ids
            });
            return { success: true };
        } catch (e) {
            console.error("Follow Artist failed:", e);
            return { success: false, error: e };
        }
    }

    async unfollowArtist(ids) {
        if (!this.hass || !ids) return { success: false };
        try {
            await this.hass.callService('spotifyplus', 'unfollow_artists', {
                entity_id: this.entityId,
                ids: Array.isArray(ids) ? ids.join(',') : ids
            });
            return { success: true };
        } catch (e) {
            console.error("Unfollow Artist failed:", e);
            return { success: false, error: e };
        }
    }

    async checkArtistsFollowing(ids) {
        if (!this.hass || !ids) return null;
        try {
            const idsParam = Array.isArray(ids) ? ids.join(',') : ids;
            // The response structure is tricky:
            // "result": { "artistID": true }
            const res = await this.fetchSpotifyPlus('check_artists_following', {
                ids: idsParam
            }, true);

            if (res?.result) {
                // If checking single ID, return single boolean
                if (!Array.isArray(ids) && !idsParam.includes(',')) {
                    return res.result[idsParam];
                }
                return res.result;
            }
            return null;
        } catch (e) {
            console.error("Check Artists Following failed:", e);
            return null;
        }
    }

    async checkTrackFavorites(ids) {
        if (!this.hass || !ids) return null;
        try {
            const idList = Array.isArray(ids) ? ids.slice() : String(ids).split(',');
            const idsParam = idList.join(',');
            const res = await this.fetchSpotifyPlus('check_track_favorites', {
                ids: idsParam
            }, true);

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
            console.error("Check Track Favorites failed:", e);
            return null;
        }
    }

    async getTrackFavorites(options = {}) {
        if (!this.hass) return null;
        // options: limit, offset, market
        return await this.fetchSpotifyPlus('get_track_favorites', options);
    }

    async getCurrentUserPlaylists(options = {}) {
        if (!this.hass) return null;
        // options: limit, offset
        // Using 'get_playlist_favorites' as confirmed in old code and Wiki
        return await this.fetchSpotifyPlus('get_playlist_favorites', { ...playlistSortParams(), ...options });
    }

    // Per-artist genre lookup, cached on the instance. Returns string[] of
    // genres (may be empty). Used to build the Liked Songs filter pills.
    async getArtistGenres(artistId) {
        if (!this.hass || !artistId) return [];
        if (!this._artistGenreCache) this._artistGenreCache = new Map();
        if (this._artistGenreCache.has(artistId)) return this._artistGenreCache.get(artistId);
        let genres = [];
        try {
            const res = await this.fetchSpotifyPlus('get_artist', { artist_id: artistId });
            genres = res?.result?.genres || res?.genres || [];
        } catch (e) { genres = []; }
        this._artistGenreCache.set(artistId, genres);
        return genres;
    }

    /**
     * Fetch a single track's album art URL by Spotify id, memoized for the
     * session. Used to enrich the Sonos queue (sonos.get_queue returns no art).
     * Returns a URL string or null.
     */
    async getTrackArt(trackId) {
        if (!this.hass || !trackId) return null;
        if (!this._trackArtCache) this._trackArtCache = new Map();
        if (this._trackArtCache.has(trackId)) return this._trackArtCache.get(trackId);
        let url = null;
        try {
            const res = await this.fetchSpotifyPlus('get_track', { track_id: trackId });
            const track = res?.result || res;
            url = track?.album?.images?.[0]?.url || null;
        } catch (e) { url = null; }
        this._trackArtCache.set(trackId, url);
        return url;
    }

    async searchPlaylists(query, limit = 10, offset = 0) {
        if (!this.hass || !query) return { result: { items: [] } };

        // Use 'search_playlists' service
        return await this.fetchSpotifyPlus('search_playlists', {
            criteria: query,
            limit: limit,
            offset: offset
        });
    }

    async saveTrackFavorites(ids) {
        if (!this.hass || !ids) return { success: false };
        try {
            await this.hass.callService('spotifyplus', 'save_track_favorites', {
                entity_id: this.entityId,
                ids: Array.isArray(ids) ? ids.join(',') : ids
            });
            return { success: true };
        } catch (e) {
            console.error("Save Track Favorites failed:", e);
            return { success: false, error: e };
        }
    }

    async removeTrackFavorites(ids) {
        if (!this.hass || !ids) return { success: false };
        try {
            await this.hass.callService('spotifyplus', 'remove_track_favorites', {
                entity_id: this.entityId,
                ids: Array.isArray(ids) ? ids.join(',') : ids
            });
            return { success: true };
        } catch (e) {
            console.error("Remove Track Favorites failed:", e);
            return { success: false, error: e };
        }
    }

    /** True/false (single id) or an id→bool map (multiple), or null on failure. */
    async checkAlbumFavorites(ids) {
        if (!this.hass || !ids) return null;
        try {
            const idsParam = Array.isArray(ids) ? ids.join(',') : ids;
            const res = await this.fetchSpotifyPlus('check_album_favorites', { ids: idsParam }, true);
            if (res?.result) {
                if (!Array.isArray(ids) && !idsParam.includes(',')) return res.result[idsParam];
                return res.result;
            }
            return null;
        } catch (e) {
            console.error("Check Album Favorites failed:", e);
            return null;
        }
    }

    async saveAlbumFavorites(ids) {
        if (!this.hass || !ids) return { success: false };
        try {
            await this.hass.callService('spotifyplus', 'save_album_favorites', {
                entity_id: this.entityId,
                ids: Array.isArray(ids) ? ids.join(',') : ids
            });
            return { success: true };
        } catch (e) {
            console.error("Save Album Favorites failed:", e);
            return { success: false, error: e };
        }
    }

    async removeAlbumFavorites(ids) {
        if (!this.hass || !ids) return { success: false };
        try {
            await this.hass.callService('spotifyplus', 'remove_album_favorites', {
                entity_id: this.entityId,
                ids: Array.isArray(ids) ? ids.join(',') : ids
            });
            return { success: true };
        } catch (e) {
            console.error("Remove Album Favorites failed:", e);
            return { success: false, error: e };
        }
    }

    async setVolume(volumeLevel) {
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
            await this.hass.callService('media_player', 'volume_set', {
                entity_id: entityId,
                volume_level: volumeLevel
            });
            return { success: true };
        } catch (e) {
            console.error("Failed to set volume:", e);
            this._notify((e?.message || '').includes('Cannot control device volume')
                ? "This device doesn't support remote volume control."
                : "Couldn't change the volume.");
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