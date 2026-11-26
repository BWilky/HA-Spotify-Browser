import { LitElement, html, css } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { listRowStyles } from '../../styles/list-row.styles.js';
import { renderListRow, renderEmptyState, itemSubtitle, SUBTITLE_STYLE } from '../media-templates.js';
import { HeroScrollController } from '../controllers/hero-scroll-controller.js';

/** No hero: the app header stays opaque and titled at every scroll offset. */
const OPAQUE_HEADER = () => ({ alpha: 1, textAlpha: 1 });

export class SpotifySectionView extends LitElement {
    static get properties() {
        return {
            data: { type: Object },
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
                     --list-row-art: 48px;
                     --list-row-gap: 16px;
                 }
                 .section-table-container {
                     padding: 0; /* Remove padding to allow full width rows */
                     /* Clear the app header (which overlays the top) + safe area */
                     padding-top: calc(64px + var(--spf-safe-top, 0px));
                     padding-bottom: 24px;
                     background: var(--spf-bg);
                     min-height: 100%;
                 }

                 /* Rows (renderListRow): 48px art in a 56px column, ruled
                    lines, no minimum height, hover even on touch screens. */
                 .row {
                     grid-template-columns: 56px 1fr; /* Image, Details */
                     min-height: 0;
                     transition: background 0.2s;
                     border-bottom: 1px solid rgba(255,255,255,0.05);
                 }
                 .row:hover { background: rgba(255,255,255,0.1); }
                 .art { box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
                 .sub { margin-top: 4px; }
                 /* "Loading more..." */
                 .empty { padding: 20px; }
                 
                 @media (min-width: 769px) {
                     .row {
                         grid-template-columns: 56px 2fr 1fr; /* Image, Title/Sub, Extra Info? */
                     }
                 }
            `
        ];
    }

    constructor() {
        super();
        // Drives the shared app header (back button + centered title) instead
        // of rendering our own header bar. The header is sent while the page is
        // on screen (a cached page's data can still change, e.g. a load-more
        // finishing after navigating away) and only when the title changed,
        // except from updateHeaderState: another page may have changed the app
        // header in between.
        this._scroll = new HeroScrollController(this, {
            getTitle: () => this.data?.name || '',
            heroClass: null,
            fade: OPAQUE_HEADER,
            dedupe: true,
            // Infinite scroll: request the next page when near the bottom.
            nearBottom: 300,
            onNearBottom: () => {
                if (!this.data || this.data.isLoading || !this.data.hasMore) return;
                this.dispatchEvent(new CustomEvent('load-more', { bubbles: true, composed: true }));
            },
        });
    }

    updated(changedProperties) {
        if (changedProperties.has('data')) this._scroll.sync();
    }

    /** Called by the parent context-view when this page becomes visible again. */
    updateHeaderState() {
        this._scroll.updateHeaderState();
    }

    render() {
        if (!this.data) return html``;
        const { items, isLoading } = this.data;

        return html`
            <div class="main-scroll-container" @scroll=${this._scroll.onScroll} style="height: 100%; overflow-y: auto; overflow-x: hidden; overscroll-behavior-y: auto; overscroll-behavior-x: none; position: relative;">
                <div class="section-table-container">
                    ${items && items.length > 0 ? items.map(item => this.renderTableRow(item)) : ''}
                    ${isLoading ? renderEmptyState('Loading more...') : ''}
                </div>
            </div>
        `;
    }

    renderTableRow(item) {
        if (!item) return '';
        const type = item.type;
        return renderListRow(item, type, {
            name: item.name || 'Unknown',
            subtitle: itemSubtitle(item, type, SUBTITLE_STYLE.section),
            fallbackArt: false,
            onClick: () => {
                this.dispatchEvent(new CustomEvent('navigate', {
                    detail: { pageId: `${type}:${item.id}`, data: item },
                    bubbles: true, composed: true
                }));
            },
        });
    }
}

customElements.define('spotify-section-view', SpotifySectionView);
