/**
 * Optimistic playback state of a page that can play its context (the hero
 * play button) and start a track from its list: the page shows the result of
 * a click at once, before Home Assistant reports it.
 *
 *   this._playback = new OptimisticPlaybackController(this, {
 *       getApi: () => this.api,
 *       getContext: () => ({ uri: this.data.uri, type: this.data.type }),
 *   });
 *   hero button     @click -> this._playback.heroClick()
 *                   icon   -> this._playback.isPlaying
 *   track row       @click -> this._playback.startTrack(track.id) then play it
 *                   highlight -> this._playback.playingTrackId
 *   other "play"s          -> this._playback.hold('playing'); this._playback.playContext()
 *
 * Two optimistic values, each with its own safety timer:
 *   - the play state ('playing' / 'paused'), set by hold(): wins over the
 *     reported isPlaying for holdMs (3 s), restarted by every hold().
 *   - the playing track id, set by startTrack(): wins over the reported
 *     playingTrackId until Home Assistant reports that track as current
 *     (the handoff, checked on every host update) or trackHoldMs (8 s) pass.
 *     `startTrack(id, { playing: true })` also sets the play state to
 *     'playing' and lets the 8 s timer clear it too.
 * The reported values are read from the host (isPlaying, playingTrackId,
 * currentTrackId) unless other getters are given. Timers are cleared on
 * disconnect; the optimistic values are left as they are.
 */
export const HOLD_MS = 3000;
export const TRACK_HOLD_MS = 8000;

// "Never seen": the first host update counts as a currentTrackId change.
const UNSEEN = Symbol('unseen');

export class OptimisticPlaybackController {
    constructor(host, {
        getApi,
        getContext,
        getIsPlaying = () => host.isPlaying,
        getPlayingTrackId = () => host.playingTrackId,
        getCurrentTrackId = () => host.currentTrackId,
        holdMs = HOLD_MS,
        trackHoldMs = TRACK_HOLD_MS,
    }) {
        this.host = host;
        this._getApi = getApi;
        this._getContext = getContext;
        this._getIsPlaying = getIsPlaying;
        this._getPlayingTrackId = getPlayingTrackId;
        this._getCurrentTrackId = getCurrentTrackId;
        this.holdMs = holdMs;
        this.trackHoldMs = trackHoldMs;
        this._state = null;      // 'playing' | 'paused' | null
        this._trackId = null;    // row to highlight right away, or null
        this._stateTimer = null;
        this._trackTimer = null;
        this._lastCurrent = UNSEEN;
        host.addController(this);
    }

    /** The optimistic play state, or null when the reported one applies. */
    get playState() { return this._state; }

    /** The optimistically playing track id, or null. */
    get trackId() { return this._trackId; }

    /** Whether to show "playing": the optimistic state wins. */
    get isPlaying() {
        if (this._state) return this._state === 'playing';
        return !!this._getIsPlaying();
    }

    /** Spotify track id currently playing (the optimistic guess wins), or null. */
    get playingTrackId() {
        if (this._trackId) return this._trackId;
        return this._getPlayingTrackId() || null;
    }

    /**
     * Handoff: once Home Assistant reports the optimistic track as current,
     * drop the guess and let real state drive. Only on a change of the
     * reported track: HASS can report intermediate ids during a skip, which
     * must not clear it either.
     */
    hostUpdated() {
        const current = this._getCurrentTrackId();
        const changed = current !== this._lastCurrent;
        this._lastCurrent = current;
        if (this._trackId && changed && current === this._trackId) this._setTrackId(null);
    }

    hostDisconnected() {
        if (this._stateTimer) clearTimeout(this._stateTimer);
        if (this._trackTimer) clearTimeout(this._trackTimer);
        this._stateTimer = null;
        this._trackTimer = null;
    }

    /** Show `state` ('playing' / 'paused') for holdMs, whatever is reported. */
    hold(state) {
        this._setState(state);
        if (this._stateTimer) clearTimeout(this._stateTimer);
        this._stateTimer = setTimeout(() => { this._setState(null); }, this.holdMs);
    }

    /**
     * Highlight `trackId` as playing right away. `playing: true` also shows
     * the play state as playing; both are cleared after trackHoldMs if Home
     * Assistant never catches up.
     */
    startTrack(trackId, { playing = false } = {}) {
        this._setTrackId(trackId);
        if (playing) this._setState('playing');
        if (this._trackTimer) clearTimeout(this._trackTimer);
        this._trackTimer = setTimeout(() => {
            this._setTrackId(null);
            if (playing) this._setState(null);
        }, this.trackHoldMs);
    }

    /** The hero play button: pause what plays, else play the page's context. */
    heroClick() {
        const next = this.isPlaying ? 'paused' : 'playing';
        this.hold(next);
        if (next === 'playing') this.playContext();
        else this._getApi().togglePlayback(false);
    }

    /** Play the page's context (getContext: { uri, type }). */
    async playContext() {
        const { uri, type } = this._getContext();
        const api = this._getApi();
        if (!uri || !api) return;
        await api.playMedia(uri, type);
    }

    _setState(state) {
        if (state === this._state) return;
        this._state = state;
        this.host.requestUpdate();
    }

    _setTrackId(id) {
        if (id === this._trackId) return;
        this._trackId = id;
        this.host.requestUpdate();
    }
}
