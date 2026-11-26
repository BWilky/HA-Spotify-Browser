import { LitElement, html, css } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { listRowStyles } from '../../styles/list-row.styles.js';
import { renderTrackSkeletonTemplate, renderListRow, renderEmptyState, itemSubtitle, SUBTITLE_STYLE, rowChevronIcon } from '../media-templates.js';

export class SpotifyContextList extends LitElement {
    static get properties() {
        return {
            data: { type: Object }, // Contains { items: [], total: 0, isLoading: bool, hasMore: bool }
            type: { type: String }, // 'track', 'album', 'playlist', etc.
        };
    }

    static get styles() {
        return [
            sharedStyles,
            listRowStyles,
            css`
                :host { 
                    display: block; 
                    width: 100%; 
                    height: 100%; 
                    position: relative; 
                    z-index: 0;
                    box-sizing: border-box;
                    overflow: hidden; 
                    --list-row-art: 64px;
                    --list-row-gap: 0px;
                }
                .list-container {
                    width: 100%;
                    height: 100%;
                    overflow-y: auto;
                    overflow-x: hidden;
                    overscroll-behavior-y: auto;
                    overscroll-behavior-x: none;
                    padding-bottom: 50px; /* Spacer */
                    background: var(--spf-bg);
                }
                .list-header {
                    padding: 16px 24px;
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    /* sticky header? */
                    position: sticky; top: 0; z-index: 10;
                    background: rgba(18,18,18,0.95);
                    backdrop-filter: blur(8px);
                    border-bottom: 1px solid var(--spf-border);
                }
                .back-btn {
                    background: none; border: none; color: white; cursor: pointer;
                }
                .list-title {
                    font-size: var(--spf-text-lg, 17px); font-weight: bold; color: white;
                }

                .content-list {
                    display: flex;
                    flex-direction: column;
                    padding: 0;
                }

                /* Rows (renderListRow) keep the discography's larger look: 64px
                   art in an 80px column, 12px padding, regular-weight names and
                   subtitles that wrap instead of truncating. */
                .row {
                    grid-template-columns: 80px 1fr auto;
                    padding: 12px; min-height: 56px; box-sizing: border-box; border-radius: 4px;
                }
                @media (hover: hover) { .row:active { background: var(--spf-active-white); } }
                .info { min-width: auto; }
                .name {
                    font-weight: inherit; margin-bottom: 4px;
                    white-space: normal; overflow: visible; text-overflow: clip;
                }
                .sub { margin-top: 0; white-space: normal; overflow: visible; text-overflow: clip; }
                .empty { padding: 24px; color: inherit; }
            `
        ];
    }

    constructor() {
        super();
        this.data = { items: [], isLoading: true };
    }

    _handleScroll(e) {
        const target = e.target;
        // Infinite Scroll Logic
        if (target.scrollTop + target.clientHeight >= target.scrollHeight - 100) {
            if (!this.data.isLoading && this.data.hasMore) {
                this.dispatchEvent(new CustomEvent('load-more', { bubbles: true, composed: true }));
            }
        }
    }

    _handleBack(e) {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }));
    }

    render() {
        const items = this.data?.items || [];
        const isLoading = this.data?.isLoading || false;
        const type = this.type || this.data?.type || 'track';

        return html`
            <div class="list-container" @scroll=${this._handleScroll}>
                <div class="list-header">
                    <button class="back-btn" @click=${this._handleBack}>
                        <svg height="24" width="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                    </button>
                    <div class="list-title">${this.data?.name || 'List'}</div>
                </div>

                <div class="content-list">
                    ${items.map((item) => this._renderRow(item, item.type || type))}
                    
                    ${isLoading
                ? Array(10).fill(0).map(() => renderTrackSkeletonTemplate()) // Track skeleton doubles for list rows
                : ''}
                </div>
                
                ${!isLoading && items.length === 0 ? renderEmptyState('No items found') : ''}
            </div>
        `;
    }

    /** One row; item.type (e.g. 'artist') wins over the list's type. Tapping navigates. */
    _renderRow(item, itemType) {
        return renderListRow(item, itemType, {
            name: item.name || 'Unknown',
            subtitle: itemSubtitle(item, itemType, SUBTITLE_STYLE.mediaRow),
            onClick: () => {
                this.dispatchEvent(new CustomEvent('navigate', {
                    detail: { pageId: `${itemType}:${item.id}`, data: item },
                    bubbles: true,
                    composed: true
                }));
            },
            trailing: html`<div class="track-actions-right">${rowChevronIcon}</div>`,
        });
    }
}

customElements.define('spotify-context-list', SpotifyContextList);
