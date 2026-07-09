import { LitElement, html, css } from "../../../lit.js";
import { sharedStyles } from '../../../styles/shared-styles.js';
import { queueStyles } from '../../../styles/spotify-queue.styles.js';

import './nowplaying.js';
import './queue.js';

export class SpotifySidebarPlayer extends LitElement {
    static get properties() {
        return {
            hass: { type: Object },
            api: { type: Object },
            config: { type: Object },
            visible: { type: Boolean, reflect: true },
            playerController: { type: Object },
            deviceManager: { type: Object },

            _state: { type: Object, state: true },
            _activeTab: { type: String, state: true },
            _isVolumeOverlayOpen: { type: Boolean, state: true }
        };
    }

    static get styles() {
        return [sharedStyles, queueStyles, css`
            :host {
                display: flex;
                flex-direction: column;
                /* height & overflow handled by queueStyles to match layout positioning */
            }

            .queue-panel {
                display: flex;
                flex-direction: column;
                height: 100%;
                background-color: #000;
            }

            .queue-header-wrapper {
                flex-shrink: 0;
            }

            .queue-list-container {
                flex: 1;
                overflow-y: auto;
                position: relative;
                transition: filter 0.3s ease, opacity 0.3s ease;
            }

            .queue-list-container.blurred {
                filter: blur(8px);
                opacity: 0.4;
                pointer-events: none;
            }

            /* Tab Bar Styling */
            .tabs-container {
                display: flex;
                align-items: center;
                justify-content: center;
                background-color: #121212;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                padding: 0 16px;
                height: 60px;
                width: 100%;
                flex-shrink: 0; 
                z-index: 20; 
            }

            .tab-button {
                background: transparent;
                border: none;
                color: #b3b3b3;
                padding: 0 16px;
                height: 100%;
                font-size: 0.9rem;
                font-weight: 700;
                cursor: pointer;
                transition: color 0.2s ease;
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .tab-button:hover, .tab-button.active {
                color: #fff;
            }

            .tab-button.active::after {
                content: '';
                position: absolute;
                bottom: 0px; 
                left: 0;
                width: 100%; 
                height: 4px;
                border-radius: 2px 2px 0 0; 
                background-color: #1ed760; 
            }
        `];
    }

    constructor() {
        super();
        this._activeTab = 'queue';
        this._isVolumeOverlayOpen = false;
        this._onStateChange = this._onStateChange.bind(this);
    }

    connectedCallback() {
        super.connectedCallback();
        if (this.playerController) {
            this.playerController.addEventListener('state-changed', this._onStateChange);
            this._state = this.playerController.state;
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this.playerController) {
            this.playerController.removeEventListener('state-changed', this._onStateChange);
        }
    }

    updated(changedProperties) {
        if (changedProperties.has('playerController')) {
            const oldCtrl = changedProperties.get('playerController');
            if (oldCtrl) oldCtrl.removeEventListener('state-changed', this._onStateChange);
            if (this.playerController) {
                this.playerController.addEventListener('state-changed', this._onStateChange);
                this._state = this.playerController.state;
                this.requestUpdate();
            }
        }

        if (changedProperties.has('visible') && this.visible) {
            this._refreshCurrentTab();
        }
    }

    _onStateChange(e) {
        this._state = e.detail;
        this.requestUpdate();
    }

    _refreshCurrentTab() {
        if (this._activeTab === 'recent') {
            this.playerController?.refreshRecent();
        } else {
            this.playerController?.refreshQueue();
        }
    }

    _handleTabClick(tab) {
        if (this._activeTab === tab) return;
        this._activeTab = tab;
        this._refreshCurrentTab();
    }

    _handleBlurClick(e) {
        if (!this._isVolumeOverlayOpen) return;
        e.stopPropagation();
        const nowPlaying = this.shadowRoot.querySelector('spotify-sidebar-nowplaying');
        if (nowPlaying) nowPlaying.toggleVolumeOverlay();
    }

    render() {
        const track = this._state?.track;
        const queue = this._state?.queue || [];
        const recent = this._state?.recentTracks || [];

        // Determine Context Label
        let contextLabel = "Up Next";
        if (this.config && this.hass) {
            const stateObj = this.hass.states[this.config.entity];
            const spAttributes = stateObj?.attributes || {};
            const contextUri = spAttributes.sp_context_uri || spAttributes.media_playlist;

            if (contextUri) {
                if (contextUri.includes(':playlist:')) contextLabel = "Next From Playlist";
                else if (contextUri.includes(':album:')) contextLabel = "Next From Album";
                else if (contextUri.includes(':artist:')) contextLabel = "Next From Artist";
                else if (contextUri.includes(':collection')) contextLabel = "Next From Liked";
            }
        }

        return html`
            <div class="queue-panel">
                <div class="queue-header-wrapper">
                    <!-- Mobile Drag Handle could go here -->
                    <spotify-sidebar-nowplaying
                        .hass=${this.hass}
                        .config=${this.config}
                        .api=${this.api}
                        .deviceManager=${this.deviceManager}
                        .playerController=${this.playerController}
                        .track=${track}
                        .isPlaying=${this._state?.isPlaying}
                        .isShuffle=${this._state?.isShuffle}
                        .isLiked=${this._state?.isLiked}
                        @volume-overlay-toggle=${(e) => this._isVolumeOverlayOpen = e.detail.visible}
                    ></spotify-sidebar-nowplaying>
                </div>
                
                <div class="queue-list-container ${this._isVolumeOverlayOpen ? 'blurred' : ''}" @click=${this._handleBlurClick}>
                    ${this._activeTab === 'queue'
                ? html`<spotify-sidebar-tracklist mode="queue" .items=${queue} .playerController=${this.playerController}></spotify-sidebar-tracklist>`
                : html`<spotify-sidebar-tracklist mode="recent" .items=${recent} .playerController=${this.playerController}></spotify-sidebar-tracklist>`
            }
                </div>

                <div class="tabs-container">
                    <button class="tab-button ${this._activeTab === 'queue' ? 'active' : ''}" @click=${() => this._handleTabClick('queue')}>
                        ${contextLabel}
                    </button>
                    <button class="tab-button ${this._activeTab === 'recent' ? 'active' : ''}" @click=${() => this._handleTabClick('recent')}>
                        Recently Played
                    </button>
                </div>
            </div>
        `;
    }
}

customElements.define('spotify-sidebar-player', SpotifySidebarPlayer);
