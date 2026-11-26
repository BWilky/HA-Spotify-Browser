import { LitElement, html, css } from "../../../lit.js";
import { sharedStyles } from '../../../styles/shared-styles.js';
import { queueSidebarStyles } from './index.styles.js';
import { PlayerStateController } from '../../controllers/player-state-controller.js';

import './nowplaying.js';
import './queue.js';

/**
 * Desktop sidebar: the now-playing block, the queue / recently-played list
 * and the tab bar.
 *
 * Driven by the app: `visible`, `api`, `config`, `deviceManager` and
 * `playerController`. Player state is read through PlayerStateController (the
 * sidebar subscribes itself and re-renders on a state change only while
 * visible); nothing here takes `hass`. A device picked in the now-playing
 * block's dropdown leaves this element as a bubbling, composed
 * `device-selected` event (detail: the device) for the app to transfer to.
 */
export class SpotifySidebarPlayer extends LitElement {
    static get properties() {
        return {
            api: { type: Object },
            config: { type: Object },
            visible: { type: Boolean, reflect: true },
            playerController: { type: Object },
            deviceManager: { type: Object },

            _activeTab: { type: String, state: true },
            _isVolumeOverlayOpen: { type: Boolean, state: true }
        };
    }

    static get styles() {
        return [sharedStyles, css`
            /* Rules that sat in sharedStyles but can only match in this
               element's shadow root (.queue-panel, .queue-header-wrapper).
               Kept between sharedStyles and queueSidebarStyles: their place in
               the cascade before they moved. */
            @media (min-width: 769px) {
                .queue-header-wrapper {
                    position: relative;
                    padding: 0 !important; /* Critical: Remove wrapper padding */
                    overflow: visible;      /* Allow floating volume to hang out */
                    background: var(--spf-bg);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    z-index: 5;
                }
            }
            @media (max-width: 768px) {
                .queue-panel {
                    top: 0 !important;
                    padding-top: 0;
                    height: 100% !important;
                }

                .queue-panel::before {
                    content: '';
                    position: absolute;
                    bottom: 0; left: 0; width: 100%; height: 200vh;
                    background: rgba(0, 0, 0, 0.3);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    z-index: -1;
                    pointer-events: none;
                    opacity: var(--blur-opacity);
                    transition: opacity 0.3s ease;
                }

                .queue-panel.is-dragging::before {
                    transition: none !important;
                }

                .queue-header-wrapper {
                    border-radius: 20px 20px 0 0;
                    border-top: 1px solid var(--spf-border);
                    padding-bottom: 8px;
                    background: var(--spf-bg);
                    box-shadow: 0 -10px 40px rgba(0,0,0,0.5);
                    padding-top: 12px;
                    overflow: hidden;
                }
            }
        `, queueSidebarStyles, css`
            :host {
                display: flex;
                flex-direction: column;
                /* height & overflow handled by queueSidebarStyles to match layout positioning */
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
            }

            /* Rows inherit this (the tracklist host no longer forces auto), so
               taps land on the container itself and reach _handleBlurClick. */
            .queue-list-container.blurred > * {
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
                font-size: var(--spf-text-base, 13.5px);
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
        // Player state: subscribes to the controller (and follows a replaced
        // one), re-rendering on a state change only while the sidebar shows.
        this._player = new PlayerStateController(this, { isActive: () => !!this.visible });
    }

    /**
     * Skip rendering while the sidebar is off screen: each render also
     * re-renders the now-playing header and track list. `visible` is true
     * whenever the sidebar is shown, including docked open on desktop. The
     * `visible` flip itself always renders (slide + the state as it is then),
     * and a new playerController always gets through so the subscription
     * moves to it.
     */
    shouldUpdate(changedProperties) {
        return this.visible
            || changedProperties.has('visible')
            || changedProperties.has('playerController')
            || !this.hasUpdated;
    }

    updated(changedProperties) {
        if (changedProperties.has('visible') && this.visible) {
            this._refreshCurrentTab();
        }
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
        // The blur is shared by the volume overlay and the device dropdown:
        // dismiss whichever one is open (toggling volume here used to OPEN it
        // when the dropdown was the one showing).
        if (nowPlaying) nowPlaying.closeOverlays();
    }

    render() {
        const state = this._player.state;
        const track = state?.track;
        const queue = state?.queue || [];
        const recent = state?.recentTracks || [];

        // Context label, off the SpotifyPlus entity's attributes.
        let contextLabel = "Up Next";
        const spAttributes = this.playerController?.sourceAttributes?.() || {};
        const contextUri = spAttributes.sp_context_uri || spAttributes.media_playlist;
        if (contextUri) {
            if (contextUri.includes(':playlist:')) contextLabel = "Next From Playlist";
            else if (contextUri.includes(':album:')) contextLabel = "Next From Album";
            else if (contextUri.includes(':artist:')) contextLabel = "Next From Artist";
            else if (contextUri.includes(':collection')) contextLabel = "Next From Liked";
        }

        return html`
            <div class="queue-panel">
                <div class="queue-header-wrapper">
                    <!-- Mobile Drag Handle could go here -->
                    <spotify-sidebar-nowplaying
                        .config=${this.config}
                        .api=${this.api}
                        .deviceManager=${this.deviceManager}
                        .playerController=${this.playerController}
                        .visible=${this.visible}
                        .track=${track}
                        .isPlaying=${state?.isPlaying}
                        .isShuffle=${state?.isShuffle}
                        .isLiked=${state?.isLiked}
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
