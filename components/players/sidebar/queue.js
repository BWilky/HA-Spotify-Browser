import { LitElement, html, css } from "../../../lit.js";
import { sharedStyles } from '../../../styles/shared-styles.js';
import { queueStyles } from '../../../styles/spotify-queue.styles.js';
import { msToTime } from '../../../utils.js';
import { renderQueueRow } from '../queue-row.js';

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
        return [sharedStyles, queueStyles, css`
            :host {
                display: block;
                position: static;
                height: auto;
                width: 100%;
                transform: none;
                z-index: auto;
                pointer-events: auto;
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
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>
                </button>
            `
        });
    }

    _trackMenu(e, track) {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('open-track-menu', {
            detail: {
                name: track?.name,
                artist: track?.artists?.map(a => a.name).join(', ') || '',
                album: track?.album?.name || '',
                uri: track?.uri,
                id: track?.id,
                image: track?.album?.images?.[0]?.url,
                anchor: e.currentTarget.getBoundingClientRect(),
                context: { surface: 'queue', sourceUri: this.playerController?.sourceContextUri() || null }
            },
            bubbles: true, composed: true
        }));
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
