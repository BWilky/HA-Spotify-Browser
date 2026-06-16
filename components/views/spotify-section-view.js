import { LitElement, html, css } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { getItemImage } from '../../utils.js';

export class SpotifySectionView extends LitElement {
    static get properties() {
        return {
            data: { type: Object },
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
                 }
                 .section-table-container {
                     padding: 0; /* Remove padding to allow full width rows */
                     /* Clear the app header (which overlays the top) + safe area */
                     padding-top: calc(64px + var(--spf-safe-top, 0px));
                     padding-bottom: 24px;
                     background: var(--spf-bg);
                     min-height: 100%;
                 }

                 /* Table Styles */
                 .table-row {
                     display: grid;
                     grid-template-columns: 56px 1fr; /* Image, Details */
                     gap: 16px;
                     padding: 8px 16px;
                     cursor: pointer;
                     transition: background 0.2s;
                     align-items: center;
                     border-bottom: 1px solid rgba(255,255,255,0.05);
                 }
                 .table-row:hover { background: rgba(255,255,255,0.1); }
                 .row-img { width: 48px; height: 48px; background-size: cover; background-position: center; border-radius: 4px; background-color: #282828; box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
                 .row-info { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
                 .row-title { font-size: 16px; font-weight: 500; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                 .row-sub { font-size: 14px; color: #b3b3b3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 4px; }
                 
                 @media (min-width: 769px) {
                     .table-row {
                         grid-template-columns: 56px 2fr 1fr; /* Image, Title/Sub, Extra Info? */
                     }
                 }
            `
        ];
    }

    updated(changedProperties) {
        // Drive the shared app header (back button + centered title) instead of
        // rendering our own header bar.
        if (changedProperties.has('data')) this._emitHeaderState();
    }

    /** Called by the parent context-view when this page becomes visible again. */
    updateHeaderState() {
        this._emitHeaderState();
    }

    _emitHeaderState() {
        this.dispatchEvent(new CustomEvent('header-scroll', {
            detail: { alpha: 1, title: this.data?.name || '', textAlpha: 1 },
            bubbles: true, composed: true
        }));
    }

    _handleScroll(e) {
        // Keep the title pinned in the app header during scroll
        this._emitHeaderState();
        // Infinite scroll: request the next page when near the bottom.
        if (!this.data || this.data.isLoading || !this.data.hasMore) return;
        const el = e.target;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
            this.dispatchEvent(new CustomEvent('load-more', { bubbles: true, composed: true }));
        }
    }

    render() {
        if (!this.data) return html``;
        const { items, isLoading } = this.data;

        return html`
            <div class="main-scroll-container" @scroll=${this._handleScroll} style="height: 100%; overflow-y: auto; overflow-x: hidden; overscroll-behavior-y: auto; overscroll-behavior-x: none; position: relative;">
                <div class="section-table-container">
                    ${items && items.length > 0 ? items.map(item => this.renderTableRow(item)) : ''}
                    ${isLoading ? html`<div style="padding: 20px; text-align: center; color: #b3b3b3;">Loading more...</div>` : ''}
                </div>
            </div>
        `;
    }

    renderTableRow(item) {
        if (!item) return '';
        const title = item.name || 'Unknown';

        const img = getItemImage(item);

        // Robust Subtitle Logic
        let subtitle = '';
        if (item.type === 'playlist') {
            if (item.owner) subtitle = `By ${item.owner.display_name}`;
            else if (item.description) subtitle = item.description;
        }
        else if (item.type === 'album') {
            const artistName = item.artists ? item.artists.map(a => a.name).join(', ') : 'Unknown Artist';
            const year = item.release_date ? ` • ${item.release_date.split('-')[0]}` : '';
            subtitle = `${artistName}${year}`;
        }
        else if (item.type === 'artist') {
            subtitle = 'Artist';
        }
        else {
            // Fallback (e.g. track)
            if (item.artists) subtitle = item.artists.map(a => a.name).join(', ');
            else if (item.owner) subtitle = `By ${item.owner.display_name}`;
        }

        const type = item.type;
        const id = item.id;

        return html`
            <div class="table-row" @click=${(e) => {
                this.dispatchEvent(new CustomEvent('navigate', {
                    detail: {
                        pageId: `${type}:${id}`,
                        data: item
                    },
                    bubbles: true, composed: true
                }));
            }}>
                <div class="row-img" style="background-image: url('${img}'); ${type === 'artist' ? 'border-radius: 50%;' : ''}"></div>
                <div class="row-info">
                    <div class="row-title">${title}</div>
                    <div class="row-sub">${subtitle}</div>
                </div>
            </div>
        `;
    }
}

customElements.define('spotify-section-view', SpotifySectionView);
