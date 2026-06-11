import { LitElement, html, css } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { renderCardTemplate } from '../media-templates.js';

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
                     padding-top: 64px; /* Exact header height */
                     padding-bottom: 24px;
                     background: var(--spf-bg);
                     min-height: 100%;
                 }
                 .section-header-fixed {
                     position: absolute; top: 0; left: 0; right: 0; height: 64px;
                     background: rgba(18,18,18,0.95); 
                     border-bottom: 1px solid rgba(255,255,255,0.1);
                     display: flex; align-items: center; 
                     padding: 0 16px; /* Match standard padding */
                     z-index: 10;
                     backdrop-filter: blur(20px); /* Stronger blur */
                     box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                 }
                 .back-btn { 
                     background: none; border: none; color: white; margin-right: 16px; 
                     cursor: pointer; display: flex; align-items: center; justify-content: center;
                     padding: 8px; border-radius: 50%;
                     transition: background 0.2s;
                 }
                 .back-btn:hover { background: rgba(255,255,255,0.1); }
                 .header-title { font-weight: 700; font-size: 20px; letter-spacing: -0.02em; }
                 
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
                 
                 @media (min-width: 768px) {
                     .table-row {
                         grid-template-columns: 56px 2fr 1fr; /* Image, Title/Sub, Extra Info? */
                     }
                 }
            `
        ];
    }

    _handleScroll(e) {
        // Infinite scroll: request the next page when near the bottom.
        if (!this.data || this.data.isLoading || !this.data.hasMore) return;
        const el = e.target;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
            this.dispatchEvent(new CustomEvent('load-more', { bubbles: true, composed: true }));
        }
    }

    render() {
        if (!this.data) return html``;
        const { name, items, isLoading } = this.data;

        return html`
            <div class="main-scroll-container" @scroll=${this._handleScroll} style="height: 100%; overflow-y: auto; position: relative;">
                <div class="section-header-fixed">
                    <button class="back-btn" @click=${(e) => { e.stopPropagation(); this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true })); }}>
                        <svg height="24" width="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                    </button>
                    <div class="header-title">${name}</div>
                </div>
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

        // Robust Image Logic
        let img = '';
        if (item.images && item.images.length > 0) img = item.images[0].url;
        else if (item.album && item.album.images && item.album.images.length > 0) img = item.album.images[0].url;
        else if (item.track && item.track.album && item.track.album.images) img = item.track.album.images[0].url;

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
