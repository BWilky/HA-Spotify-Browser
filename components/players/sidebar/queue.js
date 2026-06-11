import { LitElement, html, css } from "../../../lit.js";
import { sharedStyles } from '../../../styles/shared-styles.js';
import { queueStyles } from '../../../styles/spotify-queue.styles.js';

export class SpotifySidebarQueue extends LitElement {
    static get properties() {
        return {
            items: { type: Array },
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

    render() {
        if (!this.items || this.items.length === 0) {
            return this.renderEmpty();
        }

        return html`
            <div class="queue-list">
                ${this.items.map(track => this.renderRow(track))}
            </div>
        `;
    }

    renderRow(track) {
        return html`
            <div class="queue-item" @click=${() => this._playTrack(track)}>
                <div class="queue-art" 
                    style="${track?.album?.images?.[0]?.url ? `background-image: url('${track.album.images[0].url}')` : 'background-color: #333'}"
                ></div>
                <div class="queue-info">
                    <div class="queue-title">${track?.name || 'Unknown Track'}</div>
                    <div class="queue-artist">${track?.artists?.map(a => a.name).join(', ') || 'Unknown Artist'}</div>
                </div>
            </div>
        `;
    }

    renderEmpty() {
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

customElements.define('spotify-sidebar-queue', SpotifySidebarQueue);
