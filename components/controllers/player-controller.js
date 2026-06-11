
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
        // console.log('[PlayerController] updateHass called');
        this._updateStateFromHass();
    }

    /* --- STATE SYNC LOGIC --- */

    _updateStateFromHass() {
        if (!this.hass || !this.config || !this.config.entity) {
            // console.warn('[PlayerController] Missing HASS or Config Entity');
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
            if (this.state.queue.length === 0) {
                this.refreshQueue();
            } else {
                this._debounceRefreshQueue();
            }
        }

        // Check for Optimistic Handoff
        if (this._optimisticTrack) {
            const optUri = this._optimisticTrack.uri;
            const optName = this._optimisticTrack.name;
            const stateUri = attrs.media_content_id;
            const stateName = attrs.media_title;
            const isMatch = (optUri && stateUri && stateUri.includes(optUri)) || (optName && stateName === optName);

            if (isMatch) {
                this._optimisticTrack = null;
                this._queueBackup = null;
                if (this._optimisticTimer) clearTimeout(this._optimisticTimer);
            }
        }

        // Sync EOS Timer
        this._resyncEOSTimer(stateObj);

        // Diff and Emit
        if (JSON.stringify(this.state) !== JSON.stringify(newState)) {
            // console.log('[PlayerController] State Changed. New Track:', newState.track?.name);
            this.state = newState;
            this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));
        }
    }

    _calculateEffectiveTrack(stateObj) {
        const attrs = stateObj.attributes;
        if (!attrs.media_title) return null;

        const uri = attrs.media_content_id;

        // Helper to check match
        const matches = (t) => t && (t.uri === uri || t.name === attrs.media_title);

        // 1. Optimistic
        if (matches(this._optimisticTrack)) {
            return { ...this._optimisticTrack, is_optimistic_match: true };
        }

        // 2. Queue (Next Up)
        const fromQueue = this.state.queue.find(t => matches(t));
        if (fromQueue) return fromQueue;

        // 3. Recent
        const fromRecent = this.state.recentTracks.find(t => matches(t) || (t.track && matches(t.track)));
        if (fromRecent) return fromRecent.track || fromRecent;

        // 4. Cached API State (Now Playing)
        if (this._cachedApiQueue && this._cachedApiQueue.currently_playing && matches(this._cachedApiQueue.currently_playing)) {
            return this._cachedApiQueue.currently_playing;
        }

        // 5. Fallback: Construct from HASS
        return {
            name: attrs.media_title,
            artists: [{ name: attrs.media_artist }],
            album: {
                name: attrs.media_album_name,
                images: [{ url: attrs.entity_picture }]
            },
            duration_ms: attrs.media_duration * 1000,
            id: null, // HASS doesn't give ID reliably
            uri: uri
        };
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

                // If we found a track ID in the now playing of queue, check liked status
                const np = res.result.currently_playing;
                if (np && np.id) {
                    this.checkTrackFavorites(np.id);
                }

                // Trigger update
                // Re-calculate state to ensure 'track' picks up the new API data if HASS was missing it
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
        // logic to check liked status
        const result = await this.api.checkTrackFavorites(trackId);
        if (result && result.result) {
            const isLiked = result.result[trackId] === true;
            if (this.state.isLiked !== isLiked) {
                this.state.isLiked = isLiked;
                this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));
            }
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

        // Optimistic
        this.state.isLiked = !this.state.isLiked;
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
                if (this._queueBackup) {
                    this.state.queue = this._queueBackup;
                    this._queueBackup = null;
                }
                this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));
            }
        }, 8000);

        this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));

        // Logic for Context Skip vs Direct Play (Same as before)
        const stateObj = this.hass.states[this.config.entity];
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

        // Fallback
        await this.api.playMedia(track.uri, 'track');
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
