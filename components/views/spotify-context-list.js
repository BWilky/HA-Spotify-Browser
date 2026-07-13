import { LitElement, html, css } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { renderTrackSkeletonTemplate, renderMediaRowTemplate } from '../media-templates.js';

export class SpotifyContextList extends LitElement {
    static get properties() {
        return {
            data: { type: Object }, // Contains { items: [], total: 0, isLoading: bool, hasMore: bool }
            type: { type: String }, // 'track', 'album', 'playlist', etc.
            layout: { type: String }, // 'list' or 'grid'
        };
    }

    static get styles() {
        return [
            sharedStyles,
            css`
                :host { 
                    display: block; 
                    width: 100%; 
                    height: 100%; 
                    position: relative; 
                    z-index: 0;
                    box-sizing: border-box;
                    overflow: hidden; 
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

                .content-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                    gap: 16px;
                    padding: 24px;
                }

                /* Loader at bottom */
                .loading-indicator {
                    padding: 24px; text-align: center; color: var(--spf-text-sub);
                }
            `
        ];
    }

    constructor() {
        super();
        this.data = { items: [], isLoading: true };
        this.layout = 'list';
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

        // Use layout property
        const isListView = this.layout !== 'grid';

        return html`
            <div class="list-container" @scroll=${this._handleScroll}>
                <div class="list-header">
                    <button class="back-btn" @click=${this._handleBack}>
                        <svg height="24" width="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                    </button>
                    <div class="list-title">${this.data?.name || 'List'}</div>
                </div>

                <div class="${isListView ? 'content-list' : 'content-grid'}">
                    ${items.map((item) => {
            // Render Generic List Row
            // Prioritize item.type (e.g. 'artist') over container type
            const itemType = item.type || type;
            return renderMediaRowTemplate(item, itemType, () => {
                // Navigate
                this.dispatchEvent(new CustomEvent('navigate', {
                    detail: {
                        pageId: `${itemType}:${item.id}`,
                        data: item
                    },
                    bubbles: true,
                    composed: true
                }));
            });
        })}
                    
                    ${isLoading
                ? Array(10).fill(0).map(() => renderTrackSkeletonTemplate()) // Track skeleton doubles for list rows
                : ''}
                </div>
                
                ${!isLoading && items.length === 0 ? html`<div style="padding: 24px; text-align: center;">No items found</div>` : ''}
            </div>
        `;
    }
}

customElements.define('spotify-context-list', SpotifyContextList);
