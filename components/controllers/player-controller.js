import { parseSpotifyUri } from '../../utils.js';

export class PlayerController extends EventTarget {
    constructor(api) {
        super();
        this.api = api;
        this.hass = null;
        this.config = null;

        // State
        this.state = {
            track: null,
            isPlaying: false,
            isShuffle: false,
            isLiked: false,
            queue: [],
            recentTracks: [],
            volume: 0,
            isMuted: false,
            activeDevice: null
        };

        // Internal State
        this._lastStateObj = null; // Added

        // Internal State
        this._optimisticTrack = null;
        this._optimisticFromUri = null;
        this._richCurrent = null; // stable rich object for the playing track (anti-flash)
        this._optimisticTimer = null;
        this._queueBackup = null;
        this._lastTrackId = null;
        this._cachedApiQueue = null; // Store full API response
        this._eosTimer = null;
        this._queueFetchId = 0; // Invalidates in-flight queue refreshes
    }

    /** Cancel all pending timers. Call when replacing or discarding this controller. */
    destroy() {
        if (this._optimisticTimer) clearTimeout(this._optimisticTimer);
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        if (this._eosTimer) clearTimeout(this._eosTimer);
        this._optimisticTimer = null;
        this._refreshTimer = null;
        this._eosTimer = null;
        this._queueFetchId++;
    }

    updateConfig(config) {
        this.config = config;
    }

    updateHass(hass) {
        if (!hass) return;
        this.hass = hass;
        this._updateStateFromHass();
    }

    /* --- STATE SYNC LOGIC --- */

    _updateStateFromHass() {
        if (!this.hass || !this.config || !this.config.entity) {
            return;
        }
        const stateObj = this.hass.states[this.config.entity];
        this._lastStateObj = stateObj; // Store for re-calculation
        if (!stateObj) {
            console.warn('[PlayerController] Entity not found in HASS:', this.config.entity);
            return;
        }

        const attrs = stateObj.attributes;

        // 1. Determine Effective Track (HASS + Optimistic + API Fallback)
        const track = this._calculateEffectiveTrack(stateObj);

        // Keep the liked status in sync with the track we actually DISPLAY. This
        // can differ from media_content_id — e.g. right after a swipe-skip we show
        // an optimistic target while HASS still reports the previous track — so
        // keying the check off the displayed id (not media_content_id) keeps the
        // heart matching the visible track instead of lagging a song behind.
        if (track?.id && track.id !== this._likedCheckId) {
            this._likedCheckId = track.id;
            this.checkTrackFavorites(track.id);
        }

        // 2. Determine Playback Status
        const isPlaying = this._optimisticTrack ? true : (stateObj.state === 'playing');

        // 3. Update State Object
        const newState = {
            track: track,
            isPlaying: isPlaying,
            isShuffle: attrs.shuffle === true,
            isLiked: this.state.isLiked, // Persist until refreshed
            volume: (attrs.volume_level || 0) * 100,
            isMuted: attrs.is_volume_muted || false,
            activeDevice: attrs.source || null,
            queue: this.state.queue, // Persist queue
            recentTracks: this.state.recentTracks // Persist recent
        };

        // Check if track changed to trigger Queue Refresh
        const currentTrackId = attrs.media_content_id || attrs.media_title;
        if (this._lastTrackId !== currentTrackId) {
            this._lastTrackId = currentTrackId;
            // (Liked status is refreshed above, keyed off the displayed track id.)
            if (this.state.queue.length === 0) {
                this.refreshQueue();
            } else {
                this._debounceRefreshQueue();
            }
            // Keep recents fresh so the "previous" track (and its art) is always
            // ready for an instant swipe/prev, and warm the neighbour images.
            this.refreshRecent();
            this._preloadNeighborArt();
        }

        // Optimistic handoff: clear the prediction once HASS confirms it OR once
        // HASS has moved off the track we skipped from (right or wrong) — so a
        // bad prediction never lingers past the real switch.
        if (this._optimisticTrack) {
            const optUri = this._optimisticTrack.uri;
            const optName = this._optimisticTrack.name;
            const stateUri = attrs.media_content_id;
            const stateName = attrs.media_title;
            const isMatch = (optUri && stateUri && stateUri.includes(optUri)) || (optName && stateName === optName);
            const stillFrom = this._optimisticFromUri && stateUri && stateUri.includes(this._optimisticFromUri);

            if (isMatch) {
                // Confirmed: keep the optimistic object as the stable current so
                // its artwork URL doesn't switch to entity_picture (a flash).
                this._richCurrent = this._optimisticTrack;
            }
            if (isMatch || !stillFrom) {
                this._optimisticTrack = null;
                this._optimisticFromUri = null;
                this._queueBackup = null;
                if (this._optimisticTimer) clearTimeout(this._optimisticTimer);
            }
        }

        // Sync EOS Timer
        this._resyncEOSTimer(stateObj);

        // Diff and Emit
        if (JSON.stringify(this.state) !== JSON.stringify(newState)) {
            this.state = newState;
            this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));
        }
    }

    _calculateEffectiveTrack(stateObj) {
        const attrs = stateObj.attributes;
        if (!attrs.media_title) { this._richCurrent = null; return null; }

        const uri = attrs.media_content_id;

        // Helper to check match
        const matches = (t) => t && (t.uri === uri || t.name === attrs.media_title);

        // 1. Optimistic override: after a skip / queue-jump show the chosen track
        // immediately — but only while HASS still reports the track we skipped
        // FROM (the switch hasn't propagated yet) or once it confirms the chosen
        // track. As soon as HASS reports any *other* track, our prediction was
        // wrong (or stale), so we stop overriding and show what's actually
        // playing instead of sticking on the wrong song until the safety timer.
        if (this._optimisticTrack) {
            const opt = this._optimisticTrack;
            const optMatch = (opt.uri && uri && uri.includes(opt.uri)) || (opt.name && attrs.media_title === opt.name);
            const stillFrom = this._optimisticFromUri && uri && uri.includes(this._optimisticFromUri);
            if (optMatch || stillFrom) {
                return { ...opt, is_optimistic_match: true };
            }
        }

        // 2. Stable current: once we've resolved a rich object for the playing
        // track, keep returning it (same artwork URL) for as long as HASS stays
        // on that track. Otherwise a later queue refresh drops the track from
        // `queue` and we'd fall back to `entity_picture` — a different URL for
        // the same art, which reloads the image and flashes.
        if (this._richCurrent && matches(this._richCurrent)) {
            return this._richCurrent;
        }

        // Resolve the richest available source for this (newly seen) track.
        let resolved = this.state.queue.find(t => matches(t));
        if (!resolved) {
            const fromRecent = this.state.recentTracks.find(t => matches(t) || (t.track && matches(t.track)));
            if (fromRecent) resolved = fromRecent.track || fromRecent;
        }
        if (!resolved && this._cachedApiQueue?.currently_playing && matches(this._cachedApiQueue.currently_playing)) {
            resolved = this._cachedApiQueue.currently_playing;
        }
        if (!resolved) {
            // Fallback: construct from HASS.
            resolved = {
                name: attrs.media_title,
                artists: [{ name: attrs.media_artist }],
                album: {
                    name: attrs.media_album_name,
                    images: [{ url: attrs.entity_picture }]
                },
                duration_ms: attrs.media_duration * 1000,
                // HASS omits a dedicated ID field, but media_content_id is the
                // track URI — derive the id from it so like/check still works.
                id: parseSpotifyUri(uri)?.id || null,
                uri: uri
            };
        }

        this._richCurrent = resolved;
        return resolved;
    }

    /* --- DATA FETCHING --- */

    async refreshQueue() {
        if (!this.api) return;
        const fetchId = ++this._queueFetchId;
        try {
            const res = await this.api.fetchSpotifyPlus('get_player_queue_info');
            // Drop stale responses (a newer refresh or optimistic action superseded this one)
            if (fetchId !== this._queueFetchId) return;
            if (res && res.result) {
                this._cachedApiQueue = res.result;
                this.state.queue = res.result.queue || [];

                // Trigger update. Re-calculating state picks up the new API data if
                // HASS was missing it, and refreshes the liked status off the
                // displayed track id (the API's currently_playing can lag behind an
                // optimistic skip, so we no longer check it directly here).
                this._updateStateFromHass();
            }
        } catch (e) {
            console.error('[PlayerController] Queue fetch failed', e);
        }
    }

    async refreshRecent() {
        if (!this.api) return;
        try {
            const res = await this.api.fetchSpotifyPlus('get_player_recent_tracks', { limit: 30 });
            if (res) {
                let items = [];
                if (res.result && res.result.items) items = res.result.items;
                else if (res.items) items = res.items; // Direct

                this.state.recentTracks = items;
                this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));
            }
        } catch (e) {
            console.error('[PlayerController] Recent fetch failed', e);
        }
    }

    async checkTrackFavorites(trackId) {
        if (!this.api || !trackId) return;
        // api.checkTrackFavorites returns a single boolean for a single id,
        // or an object keyed by id when given multiple — handle both.
        const result = await this.api.checkTrackFavorites(trackId);
        let isLiked;
        if (typeof result === 'boolean') isLiked = result;
        else if (result && typeof result === 'object') isLiked = result[trackId] === true;
        else return;

        if (this.state.isLiked !== isLiked) {
            // New object reference so Lit consumers (identity check) re-render.
            this.state = { ...this.state, isLiked };
            this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));
        }
    }

    /* --- ACTIONS --- */

    async play(uri) {
        if (!this.api) return;
        await this.api.playMedia(uri, 'track');
        // We could set optimistic track here if we had full track details
    }

    async pause() {
        // Toggle based on current state
        await this.api.togglePlayback(!this.state.isPlaying);
    }

    async next() {
        await this.api.fetchSpotifyPlus('player_media_next_track');
    }

    async prev() {
        await this.api.fetchSpotifyPlus('player_media_previous_track');
    }

    async setVolume(vol) {
        await this.api.setVolume(vol);
    }

    async toggleShuffle() {
        await this.api.fetchSpotifyPlus('player_shuffle', { state: !this.state.isShuffle }, false);
    }

    async toggleLike() {
        const track = this.state.track;
        if (!track || !track.id) return;

        // Optimistic (new object reference so Lit consumers re-render).
        this.state = { ...this.state, isLiked: !this.state.isLiked };
        this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));

        if (this.state.isLiked) {
            await this.api.saveTrackFavorites(track.id);
        } else {
            await this.api.removeTrackFavorites(track.id);
        }
        this.checkTrackFavorites(track.id);
    }

    async playTrackFromQueue(track) {
        if (!this.api || !track || !track.uri) return;

        // Optimistic
        this._optimisticFromUri = this.state.track?.uri;
        this._optimisticTrack = track;
        this._queueFetchId++; // Invalidate any in-flight queue refresh so it can't stomp this state
        const queueIndex = this.state.queue.findIndex(t => t.uri === track.uri);
        if (queueIndex !== -1) {
            this._queueBackup = [...this.state.queue];
            this.state.queue = this.state.queue.slice(queueIndex + 1);
        }

        // Timer to revert
        if (this._optimisticTimer) clearTimeout(this._optimisticTimer);
        this._optimisticTimer = setTimeout(() => {
            if (this._optimisticTrack) {
                this._optimisticTrack = null;
                this._optimisticFromUri = null;
                if (this._queueBackup) {
                    this.state.queue = this._queueBackup;
                    this._queueBackup = null;
                }
                this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));
            }
        }, 8000);

        this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));

        await this._playTrackInContext(track);
    }

    /**
     * Play a specific track within the current playback context (playlist/album),
     * so playback continues correctly afterward. Falls back to playing the track
     * URI directly when there's no valid context. Shared by the queue panel and
     * the deterministic "previous" skip (which avoids the device's flaky
     * 3-second restart behaviour on the native previous endpoint).
     */
    async _playTrackInContext(track) {
        if (!this.api || !track || !track.uri) return;
        const stateObj = this.hass?.states?.[this.config?.entity];
        const spAttributes = stateObj?.attributes || {};
        const contextUri = spAttributes.sp_context_uri || spAttributes.media_playlist;

        const isValidContext = contextUri && (
            contextUri.includes(':playlist:') ||
            contextUri.includes(':album:') ||
            contextUri.includes(':collection')
        );

        if (isValidContext) {
            const res = await this.api.fetchSpotifyPlus('player_media_play_context', {
                context_uri: contextUri,
                offset_uri: track.uri
            }, false);
            if (res && res.success !== false) {
                this.api.triggerScan();
                return;
            }
        }

        // Fallback: play the track on its own (context continuation is lost).
        await this.api.playMedia(track.uri, 'track');
    }

    /* --- NEIGHBOUR (next/prev) RESOLUTION + OPTIMISTIC SKIP --- */

    /** The upcoming track (first queue entry), or null. */
    peekNext() {
        return (this.state.queue && this.state.queue[0]) || null;
    }

    /** The most recent distinct track (the one we'd go "back" to), or null. */
    peekPrev() {
        const curUri = this.state.track?.uri;
        for (const item of (this.state.recentTracks || [])) {
            const t = item.track || item;
            if (t && t.uri && t.uri !== curUri) return t;
        }
        return null;
    }

    /** Current playback position in seconds (with playing-time extrapolation). */
    _currentPositionSec() {
        const stateObj = this._lastStateObj;
        if (!stateObj) return 0;
        const attrs = stateObj.attributes || {};
        let pos = attrs.media_position || 0;
        if (stateObj.state === 'playing' && attrs.media_position !== undefined && stateObj.last_updated) {
            pos += (Date.now() - new Date(stateObj.last_updated).getTime()) / 1000;
        }
        return pos;
    }

    /** Warm the browser image cache for the neighbouring tracks' artwork. */
    _preloadNeighborArt() {
        [this.peekNext(), this.peekPrev()].forEach(t => {
            const url = t?.album?.images?.[0]?.url;
            if (url) { const img = new Image(); img.src = url; }
        });
    }

    /**
     * Show `track` immediately. `fromUri` is the track we're leaving — the
     * override holds only while HASS still reports it (the propagation window).
     * The timer is a last-resort safety net if HASS never updates at all.
     */
    _armOptimistic(track, fromUri = null) {
        this._optimisticTrack = track;
        this._optimisticFromUri = fromUri;
        this._queueFetchId++; // invalidate any in-flight queue refresh
        if (this._optimisticTimer) clearTimeout(this._optimisticTimer);
        this._optimisticTimer = setTimeout(() => {
            this._optimisticTrack = null;
            this._optimisticFromUri = null;
            this._queueBackup = null;
            this.refreshQueue();
            this.refreshRecent();
        }, 8000);
    }

    /** Skip to the next track with instant optimistic art. */
    async skipNext() {
        const next = this.peekNext();
        if (next) {
            const current = this.state.track;
            this.state = {
                ...this.state,
                track: next,
                queue: this.state.queue.slice(1),
                recentTracks: current
                    ? [{ track: current }, ...(this.state.recentTracks || [])]
                    : (this.state.recentTracks || []),
            };
            this._armOptimistic(next, current?.uri);
            this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));
            this._preloadNeighborArt();
        }
        if (this.api) {
            await this.api.fetchSpotifyPlus('player_media_next_track');
            this.api.triggerScan?.();
        }
    }

    /**
     * Skip backwards. With `allowRestart` (the on-screen prev button) and the
     * track is >3s in, restart it instead — matching native behaviour, but
     * decided client-side so it's deterministic and the optimistic art is right.
     * Otherwise (swipe, or button near the start) go to the previous track
     * deterministically via context-offset play.
     */
    async skipPrev({ allowRestart = false } = {}) {
        if (allowRestart && this._currentPositionSec() > 3) {
            if (this.api) await this.api.seek(0);
            return;
        }
        const prev = this.peekPrev();
        if (!prev) {
            if (this.api) await this.api.seek(0); // nothing to go back to → restart
            return;
        }
        const current = this.state.track;
        this.state = {
            ...this.state,
            track: prev,
            recentTracks: (this.state.recentTracks || []).filter(it => (it.track || it)?.uri !== prev.uri),
            queue: current ? [current, ...(this.state.queue || [])] : (this.state.queue || []),
        };
        this._armOptimistic(prev, current?.uri);
        this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));
        this._preloadNeighborArt();
        await this._playTrackInContext(prev);
    }

    /* --- PRIVATE HELPERS --- */

    _debounceRefreshQueue() {
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => this.refreshQueue(), 1000);
    }

    _resyncEOSTimer(stateObj) {
        if (this._eosTimer) {
            clearTimeout(this._eosTimer);
            this._eosTimer = null;
        }

        if (stateObj.state !== 'playing') return;

        const position = stateObj.attributes.media_position;
        const duration = stateObj.attributes.media_duration;
        if (position === undefined || duration === undefined) return;

        const lastUpdated = new Date(stateObj.last_updated).getTime();
        const now = Date.now();
        const currentPos = position + (now - lastUpdated) / 1000;
        const remainingSeconds = duration - currentPos;

        if (remainingSeconds <= 0) {
            this._eosTimer = setTimeout(() => this.refreshQueue(), 300);
            return;
        }

        const timeoutMs = (remainingSeconds * 1000) + 300;
        if (timeoutMs > 0 && timeoutMs < 3600000) {
            this._eosTimer = setTimeout(() => this.refreshQueue(), timeoutMs);
        }
    }
}
