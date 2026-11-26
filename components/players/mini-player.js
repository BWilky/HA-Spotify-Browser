import { LitElement, html, css } from "../../lit.js";
import { fireHaptic, playbackProgress, pickImage } from '../../utils.js';
import { PlayerStateController } from '../controllers/player-state-controller.js';
import { castIcon } from '../common/icons.js';

/**
 * Mobile mini-player bar: album art, "title • artist", the active device line,
 * a device button, play/pause and a thin progress bar. Sits above the bottom
 * nav while the overlay is open on the mobile layout.
 *
 * Driven by the app: `playerController` (state + play/pause), `config` (the
 * player entity, for the progress fallback) and `active` — true while the
 * overlay is open and the mobile layout is in use. It subscribes itself to the
 * PlayerController, so a player-state change re-renders this bar and nothing
 * above it. Inactive, it renders nothing and runs no timer.
 *
 * Emits (bubbling, composed) what the user asked for; the app decides which
 * surface opens:
 *   `open-now-playing`  the bar was tapped
 *   `open-devices`      the device button or the device line was tapped
 * Play/pause goes straight to the PlayerController.
 */
export class SpotifyMiniPlayer extends LitElement {
    static get properties() {
        return {
            playerController: { type: Object },
            config: { type: Object },
            active: { type: Boolean },
        };
    }

    static get styles() {
        // The bar is positioned against the app's .browser-wrapper (the host
        // is display: contents, so it adds no box and no stacking context).
        // Rules are scoped to the mobile breakpoint exactly as they were in
        // shared-styles; the --spf-* variables are inherited from the app.
        return css`
            :host { display: contents; }

            button { font-family: inherit; }

            @media (max-width: 768px) {
                .mobile-mini-player {
                    position: absolute;
                    bottom: calc(60px + var(--spf-safe-bottom, 0px) + 8px);
                    left: 8px;
                    right: 8px;
                    height: 62px;
                    background: rgba(40, 40, 40, 0.95);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border-radius: 8px;
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    padding: 8px 8px 8px 10px;
                    z-index: 9999;
                    cursor: pointer;
                    box-sizing: border-box;
                    gap: 10px;
                    overflow: hidden;
                }
                .mini-player-art {
                    width: 44px;
                    height: 44px;
                    border-radius: 4px;
                    background-size: cover;
                    background-position: center;
                    background-color: var(--spf-skeleton-bg);
                    flex-shrink: 0;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                }
                .mini-player-info {
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    gap: 3px;
                }
                .mini-player-title {
                    font-size: var(--spf-text-base, 13.5px);
                    font-weight: 700;
                    color: #ffffff;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    line-height: 1.2;
                }
                .mini-player-sep { color: #b3b3b3; }
                .mini-player-artist-inline { color: #b3b3b3; font-weight: 500; }
                .mini-player-device-line {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    cursor: pointer;
                    color: var(--spf-brand, #1ed760);
                    font-size: var(--spf-text-sm, 12px);
                    font-weight: 700;
                    line-height: 1.2;
                    min-width: 0;
                }
                .mini-player-device-line svg {
                    width: 14px; height: 14px; fill: currentColor; flex-shrink: 0;
                }
                .mini-player-device-line span {
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .mini-player-device-btn {
                    background: transparent;
                    border: none;
                    color: #ffffff;
                    width: 38px;
                    height: 38px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    padding: 0;
                    flex-shrink: 0;
                    border-radius: 50%;
                    transition: transform 0.1s ease, color 0.15s ease;
                }
                .mini-player-device-btn.connected { color: var(--spf-brand, #1ed760); }
                .mini-player-device-btn:active { transform: scale(0.9); }
                .mini-player-device-btn svg { width: 22px; height: 22px; }
                .mini-player-play-btn {
                    background: transparent;
                    border: none;
                    color: #ffffff;
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    padding: 0;
                    flex-shrink: 0;
                    border-radius: 50%;
                    transition: transform 0.1s ease;
                }
                .mini-player-play-btn:active {
                    transform: scale(0.9);
                }
                .mini-player-play-btn svg {
                    width: 24px;
                    height: 24px;
                    fill: currentColor;
                }
                .mini-player-progress {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    height: 2px;
                    background: rgba(255, 255, 255, 0.1);
                }
                .mini-player-progress-bar {
                    height: 100%;
                    background: var(--spf-brand, #1ed760);
                    width: 0%;
                    transition: width 0.5s linear;
                }
            }
        `;
    }

    constructor() {
        super();
        this.playerController = null;
        this.config = null;
        this.active = false;
        this._progressTimer = null;
        this._player = new PlayerStateController(this, { isActive: () => !!this.active });
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._stopProgressTimer();
    }

    updated() {
        this._syncProgressTimer();
    }

    /* --- Progress (1 Hz, only while active and playing) --- */

    _syncProgressTimer() {
        const run = !!this.active && !!this._player.state?.isPlaying;
        if (run && !this._progressTimer) {
            this._progressTimer = setInterval(() => this._renderProgress(), 1000);
        } else if (!run) {
            this._stopProgressTimer();
        }
        // Every render that leaves the bar ticking shows the position right away.
        if (run) this._renderProgress();
    }

    _stopProgressTimer() {
        if (this._progressTimer) {
            clearInterval(this._progressTimer);
            this._progressTimer = null;
        }
    }

    _renderProgress() {
        const pc = this.playerController;
        const state = this._player.state;
        if (!this.active || !pc) return;
        // The entity driving playback: the Sonos speaker during local Sonos
        // playback (the SpotifyPlus entity sits idle then), else config.entity.
        const stateObj = pc.playbackStateObj() || pc.hass?.states?.[this.config?.entity];
        if (!stateObj) return;

        const progressBar = this.shadowRoot?.getElementById('mini-player-progress-bar');
        if (!progressBar) return;

        // Same computation as the sidebar and the full-screen view.
        const { position, duration } = playbackProgress(stateObj, state?.track);
        const percent = duration ? (position / duration) * 100 : 0;
        progressBar.style.width = `${percent}%`;
    }

    /* --- User intent --- */

    _emit(name) {
        this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
    }

    _onBarClick(e) {
        if (e.target.closest('.mini-player-play-btn') || e.target.closest('.mini-player-device-btn')) return;
        this._emit('open-now-playing');
    }

    _onDeviceClick(e) {
        e.stopPropagation();
        fireHaptic('light');
        this._emit('open-devices');
    }

    _onPlayPause(e) {
        e.stopPropagation();
        fireHaptic('medium');
        this.playerController?.pause(); // pause() toggles play/pause
    }

    render() {
        const state = this._player.state;
        const track = state?.track;
        if (!this.active || !track) return html``;

        // Deliberately the full-size cover although the slot is small: the
        // full-screen now-playing view shows this same image, and having it
        // loaded here is what lets that view slide up with its art in place.
        const art = pickImage(track.album?.images);

        return html`
            <div class="mobile-mini-player" @click=${this._onBarClick}>
                <div class="mini-player-art" style="${art ? `background-image: url('${art}')` : ''}"></div>
                <div class="mini-player-info">
                    <div class="mini-player-title">
                        ${track.name || 'Unknown Track'}
                        ${track.artists?.length ? html`<span class="mini-player-sep"> • </span><span class="mini-player-artist-inline">${track.artists.map(a => a.name).join(', ')}</span>` : ''}
                    </div>
                    ${state.activeDevice ? html`
                        <div class="mini-player-device-line" @click=${this._onDeviceClick}>
                            ${castIcon}
                            <span>${state.activeDevice}</span>
                        </div>
                    ` : ''}
                </div>
                <button class="mini-player-device-btn ${state.activeDevice ? 'connected' : ''}" @click=${this._onDeviceClick} aria-label="Connect to a device">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="6" y="2" width="12" height="20" rx="2.5"/>
                        <circle cx="12" cy="6.5" r="1.2" fill="currentColor" stroke="none"/>
                        <circle cx="12" cy="14.5" r="3.2"/>
                    </svg>
                </button>
                <button class="mini-player-play-btn" @click=${this._onPlayPause}>
                    <svg viewBox="0 0 24 24">
                        <path fill="currentColor" d="${state.isPlaying ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z'}"/>
                    </svg>
                </button>
                <div class="mini-player-progress">
                    <div class="mini-player-progress-bar" id="mini-player-progress-bar"></div>
                </div>
            </div>
        `;
    }
}

customElements.define('spotify-mini-player', SpotifyMiniPlayer);
