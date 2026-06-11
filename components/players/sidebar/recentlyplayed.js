import { LitElement, html, css } from "../../../lit.js";
import { sharedStyles } from '../../../styles/shared-styles.js';
import { queueStyles } from '../../../styles/spotify-queue.styles.js';
import { msToTime } from '../../../utils.js';

export class SpotifySidebarRecent extends LitElement {
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
                ${this.items.map(item => this.renderRow(item))}
            </div>
        `;
    }

    renderRow(item) {
        const track = item.track || item;
        return html`
            <div class="queue-item" @click=${() => this._playTrack(track)}>
                <div class="queue-art" 
                    style="${track?.album?.images?.[0]?.url ? `background-image: url('${track.album.images[0].url}')` : 'background-color: #333'}"
                ></div>
                <div class="queue-info">
                    <div class="queue-title">${track?.name || 'Unknown Track'}</div>
                    <div class="queue-artist">${track?.artists?.map(a => a.name).join(', ') || 'Unknown Artist'}</div>
                    ${item.played_at ? html`<div class="queue-context-sub">${msToTime(new Date(item.played_at).getTime())} ago</div>` : ''}
                </div>
            </div>
        `;
    }

    renderEmpty() {
        return html`
            <div class="queue-empty-state">
                <div class="empty-text">No recent tracks found</div>
                <button class="device-refresh-btn" style="margin-top:16px;" @click=${() => this.playerController?.refreshRecent()}>Refresh</button>
            </div>
        `;
    }

    _playTrack(track) {
        if (this.playerController) {
            this.playerController.playTrackFromQueue(track);
        }
    }
}

customElements.define('spotify-sidebar-recent', SpotifySidebarRecent);
