import { playbackProgress, pickImage } from '../../utils.js';

/**
 * The shared half of the two "now playing" surfaces (the desktop sidebar block
 * and the mobile full-screen view): read-only views of the PlayerController
 * state, the progress ticker, and the playback actions. What each surface
 * looks like and how it is laid out stays in the component.
 *
 * Host wiring (a LitElement with a `playerController` property):
 *   this._np = new NowPlayingController(this, {
 *       interval: 500,                       // progress tick, ms
 *       isActive: () => this.visible,        // tick only while on screen
 *       renderProgress: (p) => { ... },      // write p into the DOM (see tick())
 *       watch: ['volume'],                   // optional, see below
 *   });
 *
 * The ticker starts when the host is connected/updated while isActive() is
 * true, stops on the first update where it is false, and is always cleared on
 * disconnect. renderProgress receives `{ position, duration, held }`
 * (seconds); `held` is true for a short while after a skip, when the bar
 * should sit at 0 instead of showing the outgoing track's position.
 *
 * `watch` lists PlayerController state fields the host renders but is not
 * otherwise re-rendered for (its parent binds no property that changes with
 * them). When one of them changes while isActive() is true the controller
 * calls host.requestUpdate(). Hosts that receive the whole state as a
 * property leave it empty.
 */
export class NowPlayingController {
    constructor(host, { interval = 1000, isActive = () => true, renderProgress = null, watch = [] } = {}) {
        this.host = host;
        this.interval = interval;
        this.isActive = isActive;
        this.renderProgress = renderProgress;
        this.watch = watch;
        this._timer = null;
        this._holdUntil = 0;
        this._subscribed = null; // PlayerController the watch listener is on
        this._onStateChanged = this._onStateChanged.bind(this);
        host.addController(this);
    }

    hostConnected() {
        this._subscribe();
        this._syncTicker();
    }

    hostUpdated() {
        this._subscribe(); // follows a replaced playerController
        this._syncTicker();
    }

    hostDisconnected() {
        this._stopTicker();
        this._unsubscribe();
    }

    /* --- State (read-only) --- */

    get player() { return this.host.playerController || null; }
    get state() { return this.player?.state || {}; }
    get track() { return this.state.track || null; }
    get isPlaying() { return !!this.state.isPlaying; }
    get isShuffle() { return !!this.state.isShuffle; }
    get isLiked() { return !!this.state.isLiked; }
    get repeat() { return this.state.repeat || 'off'; }
    get contextName() { return this.state.contextName || null; }
    get contextUri() { return this.state.contextUri || null; }
    get deviceId() { return this.state.deviceId || null; }
    /** The active Connect device's display name, or null. */
    get deviceName() { return this.state.activeDevice || null; }
    /** Artist names joined with ", ", or ''. */
    get artistLine() { return this.track?.artists?.map(a => a.name).join(', ') || ''; }

    /** Album art URL for the current track: the first image, or the smallest >= minPx. */
    artUrl(minPx = 0) { return pickImage(this.track?.album?.images, minPx); }

    /** `{ position, duration }` in seconds, read off the entity actually driving playback. */
    position() {
        const pc = this.player;
        const stateObj = pc?.playbackStateObj?.() || pc?.hass?.states?.[pc?.config?.entity] || null;
        return playbackProgress(stateObj, this.track);
    }

    /* --- Progress ticker --- */

    /** Write the current progress via renderProgress (a no-op while inactive). */
    tick() {
        if (!this.renderProgress || !this.isActive()) return;
        const held = !!this._holdUntil && Date.now() < this._holdUntil;
        this.renderProgress(held ? { position: 0, duration: 0, held: true } : { ...this.position(), held: false });
    }

    /** Hold the bar at 0 while a skip settles, and show that right away. */
    holdProgress(ms = 2500) {
        this._holdUntil = Date.now() + ms;
        this.tick();
    }

    _syncTicker() {
        const active = !!this.isActive();
        if (active && !this._timer) {
            this._timer = setInterval(() => this.tick(), this.interval);
            this.tick();
        } else if (!active && this._timer) {
            this._stopTicker();
        }
    }

    _stopTicker() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }

    /* --- Re-render on watched fields --- */

    _subscribe() {
        if (!this.watch.length || this._subscribed === this.player) return;
        this._unsubscribe();
        const pc = this.player;
        if (!pc?.addEventListener) return;
        pc.addEventListener('state-changed', this._onStateChanged);
        this._subscribed = pc;
        this._watched = this._pick(pc.state);
    }

    _unsubscribe() {
        this._subscribed?.removeEventListener?.('state-changed', this._onStateChanged);
        this._subscribed = null;
    }

    _pick(state) { return this.watch.map(k => state?.[k]); }

    _onStateChanged(e) {
        const next = this._pick(e.detail);
        const changed = next.some((v, i) => v !== this._watched?.[i]);
        this._watched = next;
        // While inactive the host renders fresh values when it becomes active.
        if (changed && this.isActive()) this.host.requestUpdate();
    }

    /* --- Actions --- */

    playPause() { return this.player?.pause(); }

    /** Optimistic skip forward; the bar holds at 0 until the new track settles. */
    next() {
        if (!this.player) return;
        this.holdProgress();
        return this.player.skipNext();
    }

    /** Optimistic skip back. `{ allowRestart: true }` restarts the track when >3s in. */
    prev(opts = { allowRestart: true }) {
        if (!this.player) return;
        this.holdProgress();
        return this.player.skipPrev(opts);
    }

    toggleShuffle() { return this.player?.toggleShuffle(); }
    toggleLike() { return this.player?.toggleLike(); }
    cycleRepeat() { return this.player?.cycleRepeat(); }

    /**
     * Seek to `ratio` (0..1, clamped) of the current track. Returns the ratio
     * applied, or null when there is nothing to seek (no api or no duration).
     */
    seekRatio(ratio) {
        const api = this.host.api || this.player?.api;
        if (!api) return null;
        const { duration } = this.position();
        if (!duration) return null;
        const r = Math.max(0, Math.min(1, ratio));
        if (api.seek) api.seek(r * duration);
        return r;
    }
}
