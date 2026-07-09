import { LitElement, html, css } from "../../lit.js";
import { fireHaptic, getVibrantColor } from "../../utils.js";

/**
 * Full-screen mobile "Now Playing" view, styled after the iOS Spotify app.
 * Slides up from the mini-player. Driven by the PlayerController state and the
 * SpotifyApi; emits events for the app to open the device picker / queue.
 */
export class SpotifyNowPlayingMobile extends LitElement {
    static get properties() {
        return {
            visible: { type: Boolean, reflect: true },
            hass: { type: Object },
            config: { type: Object },
            api: { type: Object },
            playerController: { type: Object },
            state: { type: Object },
        };
    }

    static get styles() {
        return css`
            /* Register the accent channels as animatable so the gradient
               cross-fades between tracks instead of snapping. Falls back to an
               instant change where @property is unsupported. */
            @property --np-r { syntax: '<number>'; initial-value: 40; inherits: true; }
            @property --np-g { syntax: '<number>'; initial-value: 40; inherits: true; }
            @property --np-b { syntax: '<number>'; initial-value: 48; inherits: true; }

            :host {
                position: fixed;
                inset: 0;
                z-index: 210000;
                transform: translateY(100%);
                transition: transform 0.42s cubic-bezier(0.16, 1, 0.3, 1);
                pointer-events: none;
                will-change: transform;
                --np-r: 40; --np-g: 40; --np-b: 48;
            }
            :host([visible]) {
                transform: translateY(0);
                pointer-events: auto;
            }

            .np {
                position: absolute; inset: 0;
                display: flex; flex-direction: column;
                padding: calc(12px + var(--spf-safe-top, 0px)) 20px 28px 20px;
                box-sizing: border-box;
                overflow: hidden;
                color: #fff;
                background: #101010;
            }

            /* Vibrant album-art accent gradient (Spotify-style). The selectors are
               scoped (.np > …) so they out-specify the .np > * content rule below
               and keep their absolute positioning / z-index. */
            .np > .np-bg {
                position: absolute; inset: 0;
                background: linear-gradient(180deg,
                    rgb(var(--np-r) var(--np-g) var(--np-b)) 0%,
                    rgb(var(--np-r) var(--np-g) var(--np-b) / 0.55) 26%,
                    rgb(var(--np-r) var(--np-g) var(--np-b) / 0.12) 46%,
                    #101010 72%);
                transition: --np-r 0.6s ease, --np-g 0.6s ease, --np-b 0.6s ease;
                z-index: 0;
            }
            .np > .np-bg-overlay {
                position: absolute; inset: 0;
                background: linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.45) 100%);
                z-index: 0;
            }
            .np > * { position: relative; z-index: 1; }

            /* Header */
            .np-header {
                display: flex; align-items: center; justify-content: space-between;
                flex-shrink: 0; height: 40px;
            }
            .np-header .np-context {
                font-size: 13px; font-weight: 700; letter-spacing: 0.4px;
                text-transform: uppercase; opacity: 0.95;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                max-width: 60%; text-align: center;
            }
            .icon-btn {
                background: none; border: none; color: #fff; cursor: pointer;
                width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;
                flex-shrink: 0; padding: 0;
            }
            .icon-btn svg { width: 26px; height: 26px; fill: currentColor; }

            /* Album art carousel (swipe left/right to skip) */
            .np-art-wrap {
                flex: 1; position: relative; min-height: 0;
                overflow: hidden; padding: 16px 0;
            }
            .np-track {
                position: absolute; inset: 0;
                touch-action: pan-y; /* we own horizontal drags */
            }
            .np-card {
                position: absolute; top: 50%; left: 50%;
                width: min(78vw, 60vh, 420px);
                aspect-ratio: 1 / 1;
                border-radius: 8px;
                background-size: cover; background-position: center;
                background-color: var(--spf-skeleton-bg, #282828);
                transform: translate(-50%, -50%) translateX(var(--cx, 0px));
                will-change: transform;
            }
            /* Shadow only on the centered card — otherwise the off-screen
               neighbours' shadows bleed in as vertical bands at the edges. The
               negative spread keeps it from extending past the art's left/right
               edges, so it grounds the art from below without side shading. */
            .np-card.is-cur { box-shadow: 0 24px 40px -20px rgba(0,0,0,0.6); }
            .np-card.is-prev { --cx: calc(-1 * (min(78vw, 60vh, 420px) + 28px)); }
            .np-card.is-next { --cx: calc(min(78vw, 60vh, 420px) + 28px); }

            /* Track info row */
            .np-info {
                display: flex; align-items: center; gap: 16px;
                flex-shrink: 0; margin-top: 4px;
            }
            .np-info-text { flex: 1; min-width: 0; }
            .np-title {
                font-size: 22px; font-weight: 800; line-height: 1.2;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .np-artist {
                font-size: 16px; color: rgba(255,255,255,0.7); margin-top: 2px;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .np-like {
                flex-shrink: 0; width: 32px; height: 32px; border-radius: 50%;
                border: 2px solid rgba(255,255,255,0.7); background: transparent;
                color: rgba(255,255,255,0.8); cursor: pointer;
                display: flex; align-items: center; justify-content: center; padding: 0;
                transition: all 0.15s ease;
            }
            .np-like svg { width: 18px; height: 18px; fill: currentColor; }
            .np-like.liked {
                background: var(--spf-brand, #1ed760);
                border-color: var(--spf-brand, #1ed760);
                color: #000;
            }

            /* Progress */
            .np-progress { flex-shrink: 0; margin-top: 20px; }
            .np-bar {
                position: relative; height: 5px; border-radius: 3px;
                background: rgba(255,255,255,0.28); cursor: pointer;
            }
            .np-bar-fill {
                position: absolute; top: 0; left: 0; height: 100%;
                background: #fff; border-radius: 3px; width: 0%;
            }
            .np-times {
                display: flex; justify-content: space-between;
                font-size: 11px; color: rgba(255,255,255,0.65); margin-top: 6px;
                font-variant-numeric: tabular-nums;
            }

            /* Controls */
            .np-controls {
                display: flex; align-items: center; justify-content: space-between;
                flex-shrink: 0; margin-top: 18px;
            }
            .ctrl-btn {
                background: none; border: none; color: #fff; cursor: pointer;
                display: flex; align-items: center; justify-content: center; padding: 8px;
            }
            .ctrl-btn svg { width: 30px; height: 30px; fill: currentColor; }
            .ctrl-btn.active { color: var(--spf-brand, #1ed760); }
            .ctrl-btn.active::after {
                content: ''; display: block; position: absolute;
            }
            .np-play {
                width: 68px; height: 68px; border-radius: 50%;
                background: #fff; color: #000; border: none; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                box-shadow: 0 6px 16px rgba(0,0,0,0.35);
                transition: transform 0.12s ease;
            }
            .np-play:active { transform: scale(0.94); }
            .np-play svg { width: 34px; height: 34px; fill: #000; }

            /* Bottom actions */
            .np-bottom {
                display: flex; align-items: center; justify-content: space-between;
                flex-shrink: 0; margin-top: 22px;
            }
            .np-device {
                display: flex; align-items: center; gap: 8px;
                background: none; border: none; cursor: pointer; padding: 0;
                color: rgba(255,255,255,0.85); max-width: 70%;
            }
            .np-device.connected { color: var(--spf-brand, #1ed760); }
            .np-device svg { width: 20px; height: 20px; fill: currentColor; flex-shrink: 0; }
            .np-device-name {
                font-size: 13px; font-weight: 600;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
        `;
    }

    constructor() {
        super();
        this.visible = false;
        this._progressTimer = null;
        this._swiping = false;
        this._committing = false;
        this._progressHoldUntil = 0;
        this._onArtMove = this._onArtMove.bind(this);
        this._onArtUp = this._onArtUp.bind(this);
    }

    connectedCallback() {
        super.connectedCallback();
        this._startProgressTimer();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._stopProgressTimer();
        this._cleanupSwipeListeners();
        if (this._commitTimer) clearTimeout(this._commitTimer);
        if (this._commitResetTimer) clearTimeout(this._commitResetTimer);
    }

    updated(changedProps) {
        if (changedProps.has('visible')) {
            if (this.visible) {
                this._startProgressTimer();
                // Re-verify the like state for the current track each time the
                // sheet opens, so the heart can't show a stale value.
                const id = this.state?.track?.id;
                if (id) this.playerController?.checkTrackFavorites(id);
            } else {
                this._stopProgressTimer();
            }
        }
        if (changedProps.has('state')) {
            this._updateAccent(this.state?.track?.album?.images?.[0]?.url || '');
        }
        // After an optimistic skip re-renders with the new track centered, snap
        // the carousel back to 0 (no transition) so the swap is seamless — the
        // image that just slid to center is the same one now in the center slot.
        if (this._committing && changedProps.has('state')) {
            this._committing = false;
            this._fired = false;
            if (this._commitTimer) { clearTimeout(this._commitTimer); this._commitTimer = null; }
            if (this._commitResetTimer) { clearTimeout(this._commitResetTimer); this._commitResetTimer = null; }
            const t = this.shadowRoot.getElementById('np-track');
            if (t) { t.style.transition = 'none'; t.style.transform = 'translateX(0)'; }
        }
    }

    /* --- Progress --- */
    _startProgressTimer() {
        this._stopProgressTimer();
        this._progressTimer = setInterval(() => this._updateProgress(), 500);
        this._updateProgress();
    }
    _stopProgressTimer() {
        if (this._progressTimer) { clearInterval(this._progressTimer); this._progressTimer = null; }
    }

    _playerPosition() {
        // Read from the entity actually driving playback (the Sonos entity when
        // casting to Sonos), not always SpotifyPlus, so the bar tracks correctly.
        const stateObj = this.playerController?.playbackStateObj?.() || this.hass?.states[this.config?.entity];
        if (!stateObj) return { position: 0, duration: 0 };
        const attrs = stateObj.attributes;
        let duration = attrs.media_duration || (this.state?.track?.duration_ms ? this.state.track.duration_ms / 1000 : 0);
        let position = attrs.media_position || 0;
        if (stateObj.state === 'playing' && attrs.media_position !== undefined) {
            const lastUpdated = new Date(stateObj.last_updated).getTime();
            position += (Date.now() - lastUpdated) / 1000;
        }
        if (duration && position > duration) position = duration;
        return { position, duration };
    }

    _updateProgress() {
        if (!this.visible) return;
        // While a skip/restart settles, silently hold the bar at 0 instead of
        // showing the stale position of the outgoing track.
        if (this._progressHoldUntil && Date.now() < this._progressHoldUntil) {
            const fill = this.shadowRoot.getElementById('np-bar-fill');
            const cur = this.shadowRoot.getElementById('np-time-cur');
            if (fill) fill.style.width = '0%';
            if (cur) cur.textContent = '0:00';
            return;
        }
        const { position, duration } = this._playerPosition();
        const fill = this.shadowRoot.getElementById('np-bar-fill');
        const cur = this.shadowRoot.getElementById('np-time-cur');
        const rem = this.shadowRoot.getElementById('np-time-rem');
        if (fill) fill.style.width = duration ? `${Math.min(100, (position / duration) * 100)}%` : '0%';
        if (cur) cur.textContent = this._fmt(position);
        if (rem) rem.textContent = duration ? `-${this._fmt(duration - position)}` : '--:--';
    }

    _fmt(seconds) {
        if (!seconds || seconds < 0 || isNaN(seconds)) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    _handleSeek(e) {
        if (!this.api) return;
        const { duration } = this._playerPosition();
        if (!duration) return;
        const bar = e.currentTarget;
        const rect = bar.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const target = ratio * duration;
        if (this.api.seek) this.api.seek(target);
        // Optimistic fill
        const fill = this.shadowRoot.getElementById('np-bar-fill');
        if (fill) fill.style.width = `${ratio * 100}%`;
    }

    /* --- Actions --- */
    _close() { this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true })); }

    _playPause() {
        fireHaptic('medium');
        if (this.playerController) this.playerController.pause();
        else if (this.api) this.api.togglePlayback(!this.state?.isPlaying);
    }
    _next() {
        fireHaptic('light');
        this._holdProgressReset();
        if (this.playerController) this.playerController.skipNext();
        else this.api?.fetchSpotifyPlus('player_media_next_track');
    }
    _prev() {
        // The on-screen button keeps native behaviour: restart if >3s in.
        fireHaptic('light');
        this._holdProgressReset();
        if (this.playerController) this.playerController.skipPrev({ allowRestart: true });
        else this.api?.fetchSpotifyPlus('player_media_previous_track');
    }

    /* --- Vibrant accent gradient --- */
    _updateAccent(art) {
        if (art === this._accentArt) return;
        this._accentArt = art;
        if (!art) { this._applyAccent([40, 40, 48]); return; }
        getVibrantColor(art).then((rgb) => {
            if (this._accentArt !== art) return; // track changed again; drop stale result
            this._applyAccent(rgb || [40, 40, 48]);
        });
    }

    _applyAccent([r, g, b]) {
        this.style.setProperty('--np-r', String(r));
        this.style.setProperty('--np-g', String(g));
        this.style.setProperty('--np-b', String(b));
    }

    /* --- Swipe-to-skip (album art) --- */
    _holdProgressReset() {
        this._progressHoldUntil = Date.now() + 2500;
        const fill = this.shadowRoot.getElementById('np-bar-fill');
        const cur = this.shadowRoot.getElementById('np-time-cur');
        if (fill) fill.style.width = '0%';
        if (cur) cur.textContent = '0:00';
    }

    _cleanupSwipeListeners() {
        window.removeEventListener('pointermove', this._onArtMove);
        window.removeEventListener('pointerup', this._onArtUp);
        window.removeEventListener('pointercancel', this._onArtUp);
    }

    _onArtDown(e) {
        if (this._swiping || this._committing) return;
        this._track = this.shadowRoot.getElementById('np-track');
        if (!this._track) return;
        this._startX = e.clientX;
        this._startY = e.clientY;
        this._dx = 0;
        this._hLock = false;
        this._swiping = true;
        const card = this.shadowRoot.querySelector('.np-card.is-cur');
        this._step = (card ? card.offsetWidth : this._track.offsetWidth * 0.8) + 28;
        this._track.style.transition = 'none';
        window.addEventListener('pointermove', this._onArtMove, { passive: false });
        window.addEventListener('pointerup', this._onArtUp);
        window.addEventListener('pointercancel', this._onArtUp);
    }

    _onArtMove(e) {
        if (!this._swiping || !this._track) return;
        const dx = e.clientX - this._startX;
        const dy = e.clientY - this._startY;
        if (!this._hLock) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            if (Math.abs(dy) > Math.abs(dx)) { this._endSwipe(false); return; } // vertical intent
            this._hLock = true;
        }
        e.preventDefault();
        this._dx = dx;
        this._track.style.transform = `translateX(${dx}px)`;
    }

    _onArtUp() {
        if (!this._swiping || !this._track) return;
        if (!this._hLock) { this._endSwipe(false); return; }
        const dx = this._dx;
        const step = this._step || 300;
        // Require dragging past the halfway mark to commit the skip; anything
        // less springs the carousel back to the current track (no flick shortcut).
        const threshold = step * 0.5;

        if (dx <= -threshold) return this._commit('next', step);
        if (dx >= threshold) return this._commit('prev', step);
        this._endSwipe(true); // spring back
    }

    _endSwipe(animate) {
        this._cleanupSwipeListeners();
        this._swiping = false;
        const t = this._track;
        if (t) {
            t.style.transition = animate ? 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)' : 'none';
            t.style.transform = 'translateX(0)';
        }
    }

    _commit(dir, step) {
        this._cleanupSwipeListeners();
        this._swiping = false;
        this._committing = true;
        this._fired = false;
        const t = this._track;
        // If the queue/recent didn't give us a neighbour card to slide to (e.g.
        // empty queue), we still allow the skip — spring back and let the new
        // track swap in once HASS reports it (progress is held at 0 meanwhile).
        const hasCard = !!this.shadowRoot.querySelector(dir === 'next' ? '.np-card.is-next' : '.np-card.is-prev');

        const fire = () => {
            if (this._fired) return;
            this._fired = true;
            fireHaptic('light');
            this._holdProgressReset();
            if (dir === 'next') this.playerController?.skipNext();
            else this.playerController?.skipPrev({ allowRestart: false });
            // updated() snaps the carousel back to 0 once the new state renders.
        };

        if (hasCard && t) {
            const target = dir === 'next' ? -step : step;
            t.style.transition = 'transform 0.26s cubic-bezier(0.16, 1, 0.3, 1)';
            t.style.transform = `translateX(${target}px)`;
            t.addEventListener('transitionend', fire, { once: true });
            this._commitTimer = setTimeout(fire, 320);
        } else {
            if (t) { t.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)'; t.style.transform = 'translateX(0)'; }
            fire();
        }

        // Safety: clear the committing state / reset the carousel even if no
        // optimistic state change arrives to trigger updated().
        this._commitResetTimer = setTimeout(() => {
            if (!this._committing) return;
            this._committing = false;
            const tr = this.shadowRoot.getElementById('np-track');
            if (tr) { tr.style.transition = 'none'; tr.style.transform = 'translateX(0)'; }
        }, 1300);
    }
    _toggleShuffle() {
        fireHaptic('light');
        if (this.playerController) this.playerController.toggleShuffle();
        else this.api?.fetchSpotifyPlus('player_shuffle', { state: !this.state?.isShuffle }, false);
        this._refreshQueueSoon(); // shuffle reorders what's next
    }
    _toggleLike() {
        fireHaptic('success');
        if (this.playerController) this.playerController.toggleLike();
    }
    _cycleRepeat() {
        fireHaptic('light');
        const next = { off: 'all', all: 'one', one: 'off' };
        const current = this._repeatState();
        this.api?.fetchSpotifyPlus('player_repeat', { state: next[current] || 'all' }, false);
        this._refreshQueueSoon(); // repeat changes the upcoming queue
    }

    /**
     * Re-pull the queue after a shuffle/repeat toggle so the predicted next
     * track (carousel + skip) reflects the new order. Two passes give the server
     * a moment to regenerate the queue.
     */
    _refreshQueueSoon() {
        if (!this.playerController) return;
        setTimeout(() => this.playerController.refreshQueue(), 500);
        setTimeout(() => this.playerController.refreshQueue(), 1500);
    }
    _repeatState() {
        const stateObj = this.playerController?.playbackStateObj?.() || this.hass?.states[this.config?.entity];
        return stateObj?.attributes?.repeat || 'off';
    }

    _openDevices() { this.dispatchEvent(new CustomEvent('open-devices', { bubbles: true, composed: true })); }
    _openQueue() { this.dispatchEvent(new CustomEvent('open-queue', { bubbles: true, composed: true })); }

    _openMenu() {
        const track = this.state?.track;
        if (!track) return;
        this.dispatchEvent(new CustomEvent('open-track-menu', {
            detail: {
                name: track.name,
                artist: track.artists?.map(a => a.name).join(', ') || '',
                uri: track.uri,
                id: track.id,
                image: track.album?.images?.[0]?.url
            },
            bubbles: true, composed: true
        }));
    }

    render() {
        const track = this.state?.track;
        const art = track?.album?.images?.[0]?.url || '';
        const title = track?.name || 'Nothing playing';
        const artist = track?.artists?.map(a => a.name).join(', ') || '';
        const isPlaying = !!this.state?.isPlaying;
        const isShuffle = !!this.state?.isShuffle;
        const isLiked = !!this.state?.isLiked;
        const repeat = this._repeatState();
        const stateObj = this.hass?.states[this.config?.entity];
        const deviceName = stateObj?.attributes?.source || 'This device';
        // "Connected" (green) when playing on a non-local device
        const isRemote = !!stateObj?.attributes?.source;
        const context = stateObj?.attributes?.media_playlist || 'Now Playing';
        // Neighbour artwork for the swipe carousel (already in memory + preloaded).
        const prevArt = this.playerController?.peekPrev?.()?.album?.images?.[0]?.url || '';
        const nextArt = this.playerController?.peekNext?.()?.album?.images?.[0]?.url || '';

        return html`
            <div class="np">
                <div class="np-bg"></div>
                <div class="np-bg-overlay"></div>

                <div class="np-header">
                    <button class="icon-btn" @click=${this._close} aria-label="Close">
                        <svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
                    </button>
                    <div class="np-context">${context}</div>
                    <button class="icon-btn" @click=${this._openMenu} aria-label="More">
                        <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                    </button>
                </div>

                <div class="np-art-wrap">
                    <div class="np-track" id="np-track" @pointerdown=${this._onArtDown}>
                        ${prevArt ? html`<div class="np-card is-prev" style="background-image: url('${prevArt}')"></div>` : ''}
                        <div class="np-card is-cur" style="${art ? `background-image: url('${art}')` : ''}"></div>
                        ${nextArt ? html`<div class="np-card is-next" style="background-image: url('${nextArt}')"></div>` : ''}
                    </div>
                </div>

                <div class="np-info">
                    <div class="np-info-text">
                        <div class="np-title">${title}</div>
                        <div class="np-artist">${artist}</div>
                    </div>
                    <button class="np-like ${isLiked ? 'liked' : ''}" @click=${this._toggleLike} aria-label="Like">
                        <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                    </button>
                </div>

                <div class="np-progress">
                    <div class="np-bar" @click=${this._handleSeek}>
                        <div class="np-bar-fill" id="np-bar-fill"></div>
                    </div>
                    <div class="np-times">
                        <span id="np-time-cur">0:00</span>
                        <span id="np-time-rem">--:--</span>
                    </div>
                </div>

                <div class="np-controls">
                    <button class="ctrl-btn ${isShuffle ? 'active' : ''}" @click=${this._toggleShuffle} aria-label="Shuffle">
                        <svg viewBox="0 0 24 24"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                    </button>
                    <button class="ctrl-btn" @click=${this._prev} aria-label="Previous">
                        <svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                    </button>
                    <button class="np-play" @click=${this._playPause} aria-label="${isPlaying ? 'Pause' : 'Play'}">
                        <svg viewBox="0 0 24 24"><path d="${isPlaying ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z'}"/></svg>
                    </button>
                    <button class="ctrl-btn" @click=${this._next} aria-label="Next">
                        <svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                    </button>
                    <button class="ctrl-btn ${repeat !== 'off' ? 'active' : ''}" @click=${this._cycleRepeat} aria-label="Repeat">
                        ${repeat === 'one'
                ? html`<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2v-3.5h-.5l-1.5.5v.75l1.1-.35V15z"/></svg>`
                : html`<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>`}
                    </button>
                </div>

                <div class="np-bottom">
                    <button class="np-device ${isRemote ? 'connected' : ''}" @click=${this._openDevices} aria-label="Devices">
                        <svg viewBox="0 0 24 24"><path d="M4 6h16v9H4V6zm0 11h16v2H4v-2zM2 4v13h20V4H2z" fill="none"/><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>
                        <span class="np-device-name">${deviceName}</span>
                    </button>
                    <button class="icon-btn" @click=${this._openQueue} aria-label="Queue" style="width:auto;">
                        <svg viewBox="0 0 24 24"><path d="M3 10h11v2H3v-2zm0-4h11v2H3V6zm0 8h7v2H3v-2zm13-1v5.55c-.3-.17-.64-.3-1-.36-1.1-.18-2.13.61-2.13 1.71 0 1.1 1.03 1.89 2.13 1.71.96-.16 1.87-1.13 1.87-2.61V8h4V6h-5v7z"/></svg>
                    </button>
                </div>
            </div>
        `;
    }
}

customElements.define('spotify-now-playing-mobile', SpotifyNowPlayingMobile);
