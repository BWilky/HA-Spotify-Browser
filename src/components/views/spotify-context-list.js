import { LitElement, html, css } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { listRowStyles } from '../../styles/list-row.styles.js';
import { renderTrackSkeletonTemplate, renderListRow, renderEmptyState, itemSubtitle, SUBTITLE_STYLE, rowChevronIcon } from '../media-templates.js';
import { listPageScroll } from '../controllers/hero-scroll-controller.js';

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
                .main-scroll-container {
                    width: 100%;
                    height: 100%;
                    overflow-y: auto;
                    overflow-x: hidden;
                    overscroll-behavior-y: auto;
                    overscroll-behavior-x: none;
                    padding-bottom: 50px; /* Spacer */
                    background: var(--spf-bg);
                }

                .content-list {
                    display: flex;
                    flex-direction: column;
                    /* Clear the app header (which overlays the top) + safe
                       area, as on the section page. */
                    padding: calc(64px + var(--spf-safe-top, 0px)) 0 0;
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
        // The app header (opaque, titled "<Artist> Discography", with its own
        // back button) and infinite scroll: load-more within 100px of the end.
        this._scroll = listPageScroll(this, { nearBottom: 100 });
    }

    updated(changedProperties) {
        if (changedProperties.has('data')) this._scroll.sync();
    }

    /** Called by the parent context-view when this page becomes visible again. */
    updateHeaderState() {
        this._scroll.updateHeaderState();
    }

    render() {
        const items = this.data?.items || [];
        const isLoading = this.data?.isLoading || false;
        const type = this.type || this.data?.type || 'track';

        return html`
            <div class="main-scroll-container" @scroll=${this._scroll.onScroll}>
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
            subtitle: itemSubtitle(item, itemType, SUBTITLE_STYLE.discography),
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
