import { LitElement, html, css } from "../../../lit.js";
import { parseDeviceItems, normalizeDevice, parseSpotifyUri, formatTime, IMG_THUMB } from "../../../utils.js";
import { NowPlayingController } from "../../controllers/now-playing-controller.js";
import "../../common/spotify-slider.js";
import "../../devices/index.js";


export class SpotifySidebarNowPlaying extends LitElement {
    static get properties() {
        return {
            api: { type: Object },
            config: { type: Object },
            // track / isPlaying / isShuffle / isLiked are bound by the parent from
            // the PlayerController state: they re-render this block when those
            // change. What is shown is read through the NowPlayingController.
            track: { type: Object },
            isPlaying: { type: Boolean },
            isShuffle: { type: Boolean },
            isLiked: { type: Boolean },
            deviceManager: { type: Object },
            playerController: { type: Object }, // Added
            visible: { type: Boolean }, // Sidebar is on screen (drives the progress timer)
            _volumeVisible: { type: Boolean, state: true },
            _devicesVisible: { type: Boolean, state: true }, // Added
            _devices: { type: Array, state: true }, // Added
            _loadingDevices: { type: Boolean, state: true } // Added
        };
    }

    static get styles() {
        return css`
            :host {
                display: block;
                width: 100%;
            }
            * { box-sizing: border-box; }

            .queue-now-playing-row {
                position: relative;
                padding: 16px 16px 8px 16px; 
                display: flex;
                flex-direction: column;
            }

            .queue-item-content { 
                display: flex; 
                align-items: center; 
                gap: 16px; 
            }

            .queue-art.large { 
                width: 56px; 
                height: 56px; 
                box-shadow: 0 4px 12px rgba(0,0,0,0.3); 
                border-radius: 4px;
                background-size: cover;
                background-position: center;
                flex-shrink: 0;
                background-color: #282828;
                animation: imageFadeIn 0.5s ease-out;
                cursor: pointer;
                transition: transform 0.2s ease;
            }

            .queue-art.large:hover {
                transform: scale(1.02);
            }

            @keyframes imageFadeIn {
                0% { opacity: 0; transform: scale(0.95); }
                100% { opacity: 1; transform: scale(1); }
            }

            .queue-info { 
                flex: 1; 
                overflow: hidden; 
                display: flex; 
                flex-direction: column; 
                justify-content: center; 
                margin-right: 12px; 
                gap: 2px; 
                min-width: 0;
            }

            .queue-title { 
                font-size: var(--spf-text-base, 13.5px); 
                font-weight: 700; 
                color: #fff; 
                white-space: nowrap; 
                overflow: hidden; 
                text-overflow: ellipsis;
                line-height: 1.2;
            }
            .queue-title.active { color: var(--spf-brand, #1ed760); }
            
            .queue-artist {
                font-size: var(--spf-text-sm, 12px);
                color: #b3b3b3;
                white-space: nowrap; 
                overflow: hidden; 
                text-overflow: ellipsis;
                line-height: 1.2;
            }

            .queue-device-row {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: var(--spf-text-xs, 11px); 
                font-weight: 500;
                color: var(--spf-brand, #1ed760);
                opacity: 0.9;
                margin-top: 2px;
                line-height: 1.2;
                white-space: nowrap; 
                overflow: hidden; 
                text-overflow: ellipsis;
                /* Tap the device name to switch speakers (#5) */
                cursor: pointer;
                background: none; border: none; padding: 0; text-align: left;
                font-family: inherit;
                max-width: 100%;
            }
            .queue-device-row:hover { opacity: 1; text-decoration: underline; }

            .queue-device-row svg {
                width: 12px; height: 12px;
                fill: currentColor;
                flex-shrink: 0;
            }

            .device-name-text {
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            /* --- Big Play Button --- */
            .queue-play-btn.large-side-btn {
                width: 48px; height: 48px;
                border-radius: 50%;
                background: #fff; 
                color: black; 
                border: none;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                display: flex; align-items: center; justify-content: center;
                cursor: pointer; 
                transition: transform 0.2s;
                flex-shrink: 0;
            }

            .queue-play-btn.large-side-btn:hover {
                transform: scale(1.05);
                background: var(--spf-brand-hover, #1fdf64);
            }

            .queue-play-btn.large-side-btn svg { fill: black; width: 28px; height: 28px; }

            /* --- Controls Row --- */
            .queue-mini-controls {
                display: flex;
                align-items: center;
                width: 100%;
                height: 48px;       
                margin-top: 0;    
                padding: 0 8px;    
                box-sizing: border-box;
                justify-content: space-between; 
            }

            .mini-btn {
                background: transparent; 
                border: none; 
                color: var(--spf-text-sub); 
                cursor: pointer; 
                padding: 8px;
                display: flex; 
                align-items: center; 
                justify-content: center;
                transition: color 0.2s, transform 0.2s;
            }

            .mini-btn:hover { color: var(--spf-text-main); transform: scale(1.1); }
            .mini-btn svg { width: 20px; height: 20px; } 
            .mini-btn.is-favorite { color: var(--spf-brand, #1ed760); }
            .mini-btn.is-favorite svg { fill: var(--spf-brand, #1ed760); }

            /* --- FLOATING VOLUME --- */
            .floating-volume-container {
                position: absolute;
                bottom: -50px; /* Overlap queue list */
                left: 12px; 
                right: 12px;
                height: 44px;
                background: rgba(30,30,30,0.9);
                border-radius: 12px;
                overflow: hidden;
                z-index: 200; /* Above queue content */
                box-shadow: 0 4px 20px rgba(0,0,0,0.6);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                display: flex;
                flex-direction: column;
                opacity: 0;
                transform: translateY(10px) scale(0.95);
                pointer-events: none;
                transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), height 0.2s ease;
            }

            .floating-volume-container.visible {
                opacity: 1;
                transform: translateY(0) scale(1);
                pointer-events: auto;
            }

            /* Grow to fit the capability hint below the slider row */
            .floating-volume-container.disabled {
                height: 62px;
            }

            .volume-row {
                position: relative;
                display: flex;
                align-items: center;
                height: 44px;
                flex-shrink: 0;
            }

            .volume-wrapper {
                flex: 1;
                position: relative;
                overflow: hidden;
            }

            .volume-hint {
                font-size: var(--spf-text-xs, 11px);
                color: rgba(255,255,255,0.6);
                text-align: center;
                padding: 0 12px 6px;
                line-height: 1.2;
            }

            .floating-icon {
                position: absolute;
                left: 12px;
                top: 50%;
                transform: translateY(-50%);
                width: 24px;
                height: 24px;
                /* Mix blend mode for visibility over the fill bar if needed */
                z-index: 10;
                pointer-events: none;
                color: #000;
                mix-blend-mode: overlay;
                opacity: 0.8;
            }

            /* --- Elapsed / remaining (#12) --- */
            .queue-time-row {
                display: flex;
                justify-content: space-between;
                padding: 0 8px 6px;
                font-size: var(--spf-text-xs, 11px);
                color: var(--spf-text-sub, #b3b3b3);
                font-variant-numeric: tabular-nums;
                line-height: 1;
            }

            /* --- Progress Bar --- */
            .queue-progress-container {
                position: absolute; 
                bottom: 0;          
                left: 0;            
                width: 100%;        
                height: 2px;        
                margin: 0;
                padding: 0;
                background: rgba(255, 255, 255, 0.1);
                z-index: 10;
            }
            
            .queue-progress-bar {
                height: 100%;
                background: var(--spf-brand, #1ed760);
                width: 0%;
                border-radius: 0 2px 2px 0;
                transition: width 0.5s linear;
            }

            .queue-progress-bar::after {
                content: ''; position: absolute; right: -3px; top: -3px;
                width: 8px; height: 8px; background: #fff;
                border-radius: 50%; opacity: 0; transition: opacity 0.2s;
            }

            .queue-now-playing-row:hover .queue-progress-bar::after { opacity: 1; }
        `;
    }

    constructor() {
        super();
        this._volumeVisible = false;
        // `hass` is still assigned by the parent but deliberately not a
        // declared property, so a Home Assistant tick doesn't re-render this
        // block. Volume, device id and device name come from the
        // PlayerController state instead: the parent binds no property that
        // changes with them, so the controller re-renders for those (`watch`).
        this._np = new NowPlayingController(this, {
            interval: 1000,
            isActive: () => !!this.visible, // the progress tick only runs while on screen
            renderProgress: (p) => this._renderProgress(p),
            watch: ['volume', 'deviceId', 'activeDevice'],
        });
        this._volumeTimeout = null;
        this._lastVolumeUpdate = 0;
        this._pendingVolume = null;
        this._volumeThrottleTimer = null;
        this._localVolume = null;
        this._ignoreUpdatesUntil = 0;
        this._devices = [];
        this._devicesVisible = false;
        this._loadingDevices = false;
        this._deviceTimeout = null;
    }

    disconnectedCallback() {
        super.disconnectedCallback(); // the progress ticker stops with the controller
        if (this._volumeTimeout) clearTimeout(this._volumeTimeout);
        if (this._volumeThrottleTimer) clearTimeout(this._volumeThrottleTimer);
        if (this._deviceTimeout) clearTimeout(this._deviceTimeout);
        if (this._overlayCloseTimer) clearTimeout(this._overlayCloseTimer);
        if (this._volumeHoldTimer) clearTimeout(this._volumeHoldTimer);
        this._volumeHoldTimer = null;
        this._volumeTimeout = null;
        this._volumeThrottleTimer = null;
        this._deviceTimeout = null;
        this._overlayCloseTimer = null;
    }

    _renderProgress({ position, duration, held }) {
        const progressBar = this.shadowRoot?.getElementById('queue-progress-bar');
        if (!progressBar) return;
        const cur = this.shadowRoot.getElementById('queue-time-cur');
        // While a skip/restart settles, hold the bar at 0 instead of showing
        // the stale position of the outgoing track.
        if (held) {
            progressBar.style.width = '0%';
            if (cur) cur.textContent = '0:00';
            return;
        }
        progressBar.style.width = duration ? `${(position / duration) * 100}%` : '0%';

        const rem = this.shadowRoot.getElementById('queue-time-rem');
        const hasDuration = duration > 1;
        if (cur) cur.textContent = hasDuration ? formatTime(position) : '--:--';
        if (rem) rem.textContent = hasDuration ? `-${formatTime(duration - position)}` : '--:--';
    }

    toggleVolumeOverlay() {
        this._volumeVisible = !this._volumeVisible;
        this.requestUpdate();

        if (this._volumeVisible) {
            this._resetVolumeTimeout();
            // Keep the shared volume-capability cache fresh; non-blocking and
            // only on this user-initiated open — no per-tick work.
            if (this.deviceManager) this._fetchDevices();
        } else {
            if (this._volumeTimeout) clearTimeout(this._volumeTimeout);
        }

        // Critical: Dispatch event for parent to blur queue
        this.dispatchEvent(new CustomEvent('volume-overlay-toggle', {
            detail: { visible: this._volumeVisible },
            bubbles: true,
            composed: true
        }));
    }

    /** Close whichever overlay (volume or device dropdown) is open. */
    closeOverlays() {
        if (this._devicesVisible) this.toggleDeviceOverlay();
        if (this._volumeVisible) this.toggleVolumeOverlay();
    }

    _resetVolumeTimeout() {
        if (this._volumeTimeout) clearTimeout(this._volumeTimeout);
        this._volumeTimeout = setTimeout(() => {
            if (this._volumeVisible) {
                this.toggleVolumeOverlay(); // Close it cleanly via toggle
            }
        }, 6000);
    }

    /* --- DEVICE PICKER LOGIC --- */

    toggleDeviceOverlay() {
        this._devicesVisible = !this._devicesVisible;

        // Close volume if opening devices
        if (this._devicesVisible && this._volumeVisible) {
            this._volumeVisible = false;
        }

        if (this._devicesVisible) {
            this._fetchDevices();
            this._resetDeviceTimeout();
        } else {
            if (this._deviceTimeout) clearTimeout(this._deviceTimeout);
        }
        this.requestUpdate();

        // Dispatch blur event if needed (reuse volume toggle event or generic?)
        this.dispatchEvent(new CustomEvent('volume-overlay-toggle', {
            detail: { visible: this._devicesVisible }, // Treat same as volume for blur effect
            bubbles: true,
            composed: true
        }));
    }

    _resetDeviceTimeout() {
        if (this._deviceTimeout) clearTimeout(this._deviceTimeout);
        this._deviceTimeout = setTimeout(() => {
            if (this._devicesVisible) this.toggleDeviceOverlay();
        }, 8000); // 8 seconds
    }

    async _fetchDevices() {
        if (!this.api) return;
        this._loadingDevices = true;
        this.requestUpdate();

        try {
            if (this.deviceManager) {
                const attributes = this.playerController?.sourceAttributes?.() || {};
                this._devices = await this.deviceManager.fetchMergedDevices(this.api, attributes, { refresh: true });
            } else {
                const response = await this.api.fetchSpotifyPlus('get_spotify_connect_devices', { refresh: true });
                this._devices = parseDeviceItems(response).map(normalizeDevice);
            }
        } catch (e) {
            console.error("Failed to fetch devices", e);
        } finally {
            this._loadingDevices = false;
            this.requestUpdate();
        }
    }

    async _transferPlayback(device) {
        if (!this.api) return;
        // Optimistic update
        this._devices = this._devices.map(d => ({ ...d, isActive: d.id === device.id }));
        this.requestUpdate();

        this.playerController?.beginTransferHold();
        await this.api.transferPlayback(device);

        // Close the overlay shortly after transfer
        if (this._overlayCloseTimer) clearTimeout(this._overlayCloseTimer);
        this._overlayCloseTimer = setTimeout(() => {
            this._overlayCloseTimer = null;
            if (this._devicesVisible) this.toggleDeviceOverlay();
        }, 500);
    }

    async onVolumeChange(e) {
        if (!this.api) return;
        const vol = e.detail.value / 100;

        // Check for rate control (default enabled)
        const rateControlFn = this.config?.devices?.volume?.rate_control !== false;

        // Check for optimistic update (default enabled)
        const optimistic = this.config?.devices?.volume?.optimistic !== false;

        if (optimistic) {
            this._localVolume = e.detail.value;
            this._ignoreUpdatesUntil = Date.now() + 3000;
            this.requestUpdate();
            // This component no longer re-renders on every Home Assistant
            // tick, so nothing would drop the held value once the hold ends:
            // render once then, to show whatever the speaker settled on.
            if (this._volumeHoldTimer) clearTimeout(this._volumeHoldTimer);
            this._volumeHoldTimer = setTimeout(() => {
                this._volumeHoldTimer = null;
                this.requestUpdate();
            }, 3050);
        }

        if (rateControlFn) {
            // Rate Control: Limit updates to avoid spamming the device
            const now = Date.now();
            if (this._lastVolumeUpdate && (now - this._lastVolumeUpdate < 200)) {
                // If throttled, save pending value to apply later
                this._pendingVolume = vol;

                if (!this._volumeThrottleTimer) {
                    this._volumeThrottleTimer = setTimeout(() => {
                        this._volumeThrottleTimer = null;
                        if (this._pendingVolume !== null) {
                            this.api.setVolume(this._pendingVolume);
                            this._lastVolumeUpdate = Date.now();
                            this._pendingVolume = null;
                        }
                    }, 200);
                }
                return;
            }
            this._lastVolumeUpdate = now;
        }

        this.playerController?.setVolume(vol);
        this._resetVolumeTimeout();
    }

    _handleArtClick(e) {
        e.stopPropagation();

        // 1. Try to navigate to the playing context
        const context = parseSpotifyUri(this._np.contextUri);
        if (context && ['playlist', 'album', 'artist'].includes(context.type)) {
            this.dispatchEvent(new CustomEvent('navigate', {
                detail: { pageId: `${context.type}:${context.id}` },
                bubbles: true,
                composed: true
            }));
            return;
        }

        // 2. Fallback to Album (Default Behavior)
        const track = this._np.track;
        if (track?.album?.id) {
            this.dispatchEvent(new CustomEvent('navigate', {
                detail: { pageId: `album:${track.album.id}` },
                bubbles: true,
                composed: true
            }));
        } else {
            console.warn('[SidebarNowPlaying] Cannot navigate: Missing album ID and no Context', track);
        }
    }

    render() {
        const np = this._np;
        const track = np.track;
        if (!track || !track.name) {
            return html`
                <div class="queue-now-playing-row">
                    <div class="queue-item-content" style="opacity:0.5">
                        <div class="queue-art large" style="background-color:#333"></div>
                        <div class="queue-info">
                            <div class="queue-title">Nothing playing</div>
                            <div class="queue-artist">Select music to start</div>
                        </div>
                    </div>
                </div>`;
        }

        const miniplayer = this.config?.queue?.miniplayer || { enabled: true };
        const art = np.artUrl(IMG_THUMB); // 56px slot

        return html`
            <div class="queue-now-playing-row">
                <div class="queue-item-content">
                    <div class="queue-art large" 
                         style="${art ? `background-image: url('${art}')` : 'background-color: #333'}"
                         @click=${this._handleArtClick}></div>
                    <div class="queue-info">
                        <div class="queue-title active">${track.name || 'Unknown Track'}</div>
                        <div class="queue-artist">${np.artistLine || 'Unknown Artist'}</div>
                        <button class="queue-device-row" @click=${(e) => { e.stopPropagation(); this.toggleDeviceOverlay(); }}
                                title="Switch device" aria-label="Switch device">
                            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3v9.28a4.39 4.39 0 0 0-1.5-.28 4.5 4.5 0 1 0 4.5 4.5V6h4V3h-7z" fill="none"/><path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 6h-8v-1h8v1zm0-3h-8V4h8v1z" fill="none"/><path d="M7 24h2v-2H7v2zm-4 0h2v-2H3v2zm8 0h2v-2h-2v2zM2 9h2v2H2V9zm0 4h2v2H2v-2zm0 4h2v2H2v-2z" fill="none"/><path d="M19 1H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 16H5V3h14v14zM7 10h10v2H7zm0-4h10v2H7z"/></svg>
                            <span class="device-name-text">${np.deviceName || 'Device'}</span>
                        </button>
                    </div>
                    
                    <button class="queue-play-btn large-side-btn" @click=${() => np.playPause()}>
                        <svg viewBox="0 0 24 24"><path fill="currentColor" d="${np.isPlaying ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z'}"/></svg>
                    </button>
                </div>
                
                ${this.renderControls(miniplayer)}
                ${this.renderFloatingVolume()}
                ${this.renderFloatingDevices()}

                <div class="queue-time-row">
                    <span id="queue-time-cur">--:--</span>
                    <span id="queue-time-rem">--:--</span>
                </div>
                
                <div class="queue-progress-container">
                    <div class="queue-progress-bar" id="queue-progress-bar"></div>
                </div>
            </div>
        `;
    }

    renderControls(miniplayer) {
        // queue.miniplayer: enabled gates the whole row; each button has its
        // own flag (parser fills all six with defaults).
        if (miniplayer.enabled === false) return '';
        const np = this._np;
        return html`
            <div class="queue-mini-controls">
                ${miniplayer.shuffle !== false ? html`<button class="mini-btn ${np.isShuffle ? 'is-favorite' : ''}" @click=${() => np.toggleShuffle()}>
                    <svg viewBox="0 0 24 24"><path fill="currentColor" d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                </button>` : ''}

                ${miniplayer.device !== false ? html`<button class="mini-btn ${this._devicesVisible ? 'is-favorite' : ''}" @click=${() => this.toggleDeviceOverlay()}>
                    <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3v9.28a4.39 4.39 0 0 0-1.5-.28 4.5 4.5 0 1 0 4.5 4.5V6h4V3h-7z" fill="none"/><path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 6h-8v-1h8v1zm0-3h-8V4h8v1z" fill="none"/><path d="M7 24h2v-2H7v2zm-4 0h2v-2H3v2zm8 0h2v-2h-2v2zM2 9h2v2H2V9zm0 4h2v2H2v-2zm0 4h2v2H2v-2z" fill="none"/><path d="M19 1H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 16H5V3h14v14zM7 10h10v2H7zm0-4h10v2H7z"/></svg>
                </button>` : ''}

                ${miniplayer.previous !== false ? html`<button class="mini-btn" @click=${() => np.prev({ allowRestart: true })}><svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>` : ''}

                ${miniplayer.next !== false ? html`<button class="mini-btn" @click=${() => np.next()}><svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>` : ''}

                ${miniplayer.like !== false ? html`<button class="mini-btn ${np.isLiked ? 'is-favorite' : ''}" @click=${() => np.toggleLike()}>
                    <svg viewBox="0 0 24 24"><path fill="currentColor" d="${np.isLiked ? 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' : 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z'}"/></svg>
                </button>` : ''}

                ${miniplayer.volume !== false ? html`<button class="mini-btn ${this._volumeVisible ? 'is-favorite' : ''}" @click=${() => this.toggleVolumeOverlay()}>
                    <svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                </button>` : ''}
            </div>
        `;
    }

    renderFloatingVolume() {
        // PlayerController volume: read off the entity driving playback.
        let volume = this.playerController?.state?.volume || 0;

        // Optimistic Override
        const optimistic = this.config?.devices?.volume?.optimistic !== false;
        if (optimistic && this._ignoreUpdatesUntil && Date.now() < this._ignoreUpdatesUntil && this._localVolume !== null) {
            volume = this._localVolume;
        }

        // The Sonos entity has no sp_device_id attribute, so a Sonos target
        // resolves to null here — unknown means volume-capable.
        const deviceId = this._np.deviceId;
        const volDisabled = this.deviceManager?.getVolumeCapability(deviceId) === false;

        return html`
            <div class="floating-volume-container ${this._volumeVisible ? 'visible' : ''} ${volDisabled ? 'disabled' : ''}">
                <div class="volume-row">
                    <div class="volume-wrapper" style="margin: 3px; width: calc(100% - 6px); height: calc(100% - 6px);">
                        <spotify-slider
                            .value=${volume}
                            .min=${0}
                            .max=${100}
                            .disabled=${volDisabled}
                            @input=${this.onVolumeChange}
                        ></spotify-slider>
                    </div>

                    <!-- Icon Overlay (Click through) -->
                    <div class="floating-icon">
                         <svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                    </div>
                </div>
                ${volDisabled ? html`<div class="volume-hint">Volume is controlled on the device</div>` : ''}
            </div>
        `;
    }

    renderFloatingDevices() {
        return html`
            <spotify-device-picker-small
                .devices=${this._devices}
                .visible=${this._devicesVisible}
                .loading=${this._loadingDevices}
                @device-selected=${(e) => this._transferPlayback(e.detail)}
            ></spotify-device-picker-small>
        `;
    }
}

customElements.define('spotify-sidebar-nowplaying', SpotifySidebarNowPlaying);
