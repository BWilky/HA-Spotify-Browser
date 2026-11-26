import { LitElement, html, css } from "../../../lit.js";
import { sharedStyles } from '../../../styles/shared-styles.js';
import { queueListStyles } from './queue.styles.js';
import { msToTime } from '../../../utils.js';
import { renderQueueRow } from '../queue-row.js';
import { menuIcon } from '../../common/icons.js';
import { openTrackMenu } from '../../track-menu.js';

/**
 * Sidebar track list. Renders either the upcoming queue (`mode="queue"`) or
 * the recently played history (`mode="recent"`) — recent items carry a
 * `played_at` timestamp shown under the artist line. Tapping a row plays it.
 */
export class SpotifySidebarTrackList extends LitElement {
    static get properties() {
        return {
            items: { type: Array },
            mode: { type: String },
            playerController: { type: Object }
        };
    }

    static get styles() {
        // Undo sharedStyles' :host (absolute, 0x0, z-index). pointer-events is
        // deliberately NOT set here: it must inherit, so the sidebar's .blurred
        // state can block row taps.
        return [sharedStyles, css`
            /* Rules that sat in sharedStyles but can only match in this
               element's shadow root (.queue-list, .device-refresh-btn). Kept
               between sharedStyles and queueListStyles: their place in the
               cascade before they moved. */
            @media (max-width: 768px) {
                .queue-list { background: var(--spf-bg); }
            }

            /* The list's share of sharedStyles' scrollbar treatment (hidden
               on mobile; on desktop thin, shown while hovered). */
            @media (max-width: 768px) {
                .queue-list {
                    scrollbar-width: none;
                    -ms-overflow-style: none;
                }
            }
            @media (min-width: 769px) {
                .queue-list {
                    overflow-y: overlay !important;
                    scrollbar-width: thin;
                    scrollbar-color: transparent transparent;
                    transition: scrollbar-color 0.3s;
                }
                .queue-list:hover { scrollbar-color: rgba(255,255,255,0.2) transparent; }
                .queue-list:hover::-webkit-scrollbar-thumb { background-color: rgba(255, 255, 255, 0.25); }
            }

            /* Re-add device refresh btn styling compatible with new popup */
            .device-refresh-btn {
                margin-top: 16px; background: transparent;
                border: 1px solid var(--spf-border);
                color: var(--spf-text-main); padding: 8px 20px;
                border-radius: 20px; cursor: pointer;
                font-size: var(--spf-text-sm, 12px); font-weight: 700;
                text-transform: uppercase; letter-spacing: 1px;
                transition: all 0.2s;
            }
            .device-refresh-btn:hover { border-color: var(--spf-text-main); background: var(--spf-hover-white); }
        `, queueListStyles, css`
            :host {
                display: block;
                position: static;
                height: auto;
                width: 100%;
                transform: none;
                z-index: auto;
            }
        `];
    }

    constructor() {
        super();
        this.mode = 'queue';
    }

    render() {
        if (!this.items || this.items.length === 0) {
            return this.renderEmpty();
        }

        return html`
            <div class="queue-list">
                ${this.items.map(item => this.renderRow(item))}
            </div>
        `;
    }

    renderRow(item) {
        const track = item.track || item;
        return renderQueueRow(track, {
            onClick: () => this._playTrack(track),
            playedAt: item.played_at ? `${msToTime(new Date(item.played_at).getTime())} ago` : '',
            trailing: html`
                <button class="row-menu-btn" @click=${(e) => this._trackMenu(e, track)} aria-label="More options">
                    ${menuIcon}
                </button>
            `
        });
    }

    _trackMenu(e, track) {
        e.stopPropagation();
        openTrackMenu(this, track, {
            anchorEl: e.currentTarget,
            context: { surface: 'queue', sourceUri: this.playerController?.sourceContextUri() || null }
        });
    }

    renderEmpty() {
        if (this.mode === 'recent') {
            return html`
                <div class="queue-empty-state">
                    <div class="empty-text">No recent tracks found</div>
                    <button class="device-refresh-btn" style="margin-top:16px;" @click=${() => this.playerController?.refreshRecent()}>Refresh</button>
                </div>
            `;
        }
        return html`
            <div class="queue-empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="1"><path d="M9 17H5v-2h4v2zm9-2h-4v2h4v-2zm-9-4H5v-2h4v2zm9-2h-4v2h4v-2zm-9-4H5V3h4v2zm9-2h-4v2h4V3zM3 21h18v-2H3v2z"/></svg>
                <div class="empty-text">Queue is empty</div>
                <div class="empty-sub">Add songs to start listening</div>
                <button class="device-refresh-btn" style="margin-top:16px;" @click=${() => this.playerController?.refreshQueue()}>Refresh</button>
            </div>
        `;
    }

    _playTrack(track) {
        if (this.playerController) {
            this.playerController.playTrackFromQueue(track);
        }
    }
}

customElements.define('spotify-sidebar-tracklist', SpotifySidebarTrackList);
