import { LitElement, html } from "../lit.js";
import { sharedStyles } from '../styles/shared-styles.js';
import { renderCardTemplate } from './media-templates.js';

class SpotifySearch extends LitElement {
    static get properties() {
        return {
            hass: { type: Object },
            api: { type: Object },
            config: { type: Object },
            _results: { type: Object },
            _query: { type: String },
        };
    }

    static get styles() {
        return [sharedStyles];
    }

    constructor() {
        super();
        this._results = null;
        this._query = '';
    }

    updated(changedProperties) {
        if (changedProperties.has('_query') && this._query && this.api) {
            this._performSearch(this._query);
        }
    }

    search(query) {
        this._query = query;
    }

    async _performSearch(query) {
        if (!query) return;
        const searchId = (this._searchId = (this._searchId || 0) + 1);
        try {
            const res = await this.api.fetchSpotifyPlus('search_all', {
                criteria: query,
                criteria_type: 'album,artist,playlist,track',
                limit_total: 20
            });
            // Drop out-of-order responses from fast typing
            if (searchId !== this._searchId) return;
            if (res && res.result) {
                this._results = res.result;
            }
        } catch (e) {
            console.error("Search failed:", e);
        }
    }

    render() {
        if (!this._results) {
            return html`<div class="loading" style="padding: 24px;">Searching for "${this._query}"...</div>`;
        }

        // No in-page title: the query is already visible in the header search
        // field, so results start right under the header.
        return html`
            <div class="scroll-content" style="padding-top: 8px;">
                ${this.renderSection('Songs', this._results.tracks, 'track')}
                ${this.renderSection('Artists', this._results.artists, 'artist')}
                ${this.renderSection('Albums', this._results.albums, 'album')}
                ${this.renderSection('Playlists', this._results.playlists, 'playlist')}
            </div>
        `;
    }

    renderSection(title, data, type) {
        if (!data || !data.items || data.items.length === 0) return html``;

        return html`
            <section class="home-section" data-section="search-${type}">
                <div class="section-header">
                    <h3 class="section-title">${title}</h3>
                </div>
                <div class="carousel-wrapper">
                    <div class="carousel-layout">
                        ${data.items.map(item => this.renderCard(item, type))}
                    </div>
                </div>
            </section>
        `;
    }

    renderCard(item, type) {
        const subtitle = type === 'artist' ? 'Artist'
            : type === 'playlist' ? (item.owner?.display_name || 'Playlist')
                : (item.artists?.[0]?.name || type);

        return renderCardTemplate({ ...item, subtitle }, type, () => {
            // Tracks have no detail page — play them directly
            if (type === 'track') {
                this.api.playMedia(item.uri, 'track');
                this.dispatchEvent(new CustomEvent('show-toast', {
                    detail: { message: `Playing "${item.name}"` },
                    bubbles: true, composed: true
                }));
                return;
            }

            this.dispatchEvent(new CustomEvent('navigate', {
                detail: {
                    pageId: `${type}:${item.id}`,
                    data: { title: item.name, type, subtitle }
                },
                bubbles: true,
                composed: true
            }));
        });
    }
}

customElements.define('spotify-search', SpotifySearch);
