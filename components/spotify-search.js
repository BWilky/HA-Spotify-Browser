import { LitElement, html, unsafeHTML } from "../lit.js";
import { sharedStyles } from '../styles/shared-styles.js';

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
        try {
            const res = await this.api.fetchSpotifyPlus('search_all', {
                criteria: query,
                criteria_type: 'album,artist,playlist,track',
                limit_total: 20
            });
            if (res && res.result) {
                this._results = res.result;
            }
        } catch (e) {
            console.error("Search failed:", e);
        }
    }

    render() {
        if (!this._results) {
            return html`<div class="loading">Searching for "${this._query}"...</div>`;
        }

        return html`
            <div class="scroll-content" style="padding-top: 20px;" @click=${this._handleClick}>
                <div class="section-header" style="margin-bottom: 24px; padding: 0 24px;">
                    <h2 class="section-title" style="font-size: 2rem; margin: 0;">Search Results "${this._query}"</h2>
                </div>
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
        const id = item.id;
        const uri = item.uri;
        const title = item.name;
        let subtitle = '';
        let img = '';

        if (type === 'artist') {
            img = item.images?.[0]?.url || '';
            subtitle = 'Artist';
        } else if (type === 'album') {
            img = item.images?.[0]?.url || '';
            subtitle = item.artists?.[0]?.name || 'Album';
        } else if (type === 'playlist') {
            img = item.images?.[0]?.url || '';
            subtitle = item.owner?.display_name || 'Playlist';
        } else if (type === 'track') {
            img = item.album?.images?.[0]?.url || '';
            subtitle = item.artists?.[0]?.name || 'Track';
        }

        const isArtist = type === 'artist';
        const imageStyle = isArtist ? 'border-radius: 50%;' : '';
        const containerClass = isArtist ? 'media-card artist-card interactive' : 'media-card interactive';

        return html`
              <div class="${containerClass}" 
                   data-id="${id}" 
                   data-type="${type}" 
                   data-uri="${uri || ''}" 
                   data-title="${title}"
                   data-subtitle="${subtitle}">
                
                <div class="media-image-wrapper">
                    <div class="media-image" style="background-image: url('${img}'); background-color: #282828; ${imageStyle}"></div>
                    ${!isArtist ? html`
                    <button class="play-btn-overlay">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                    ` : ''}
                </div>
                
                <div class="media-title" style="${isArtist ? 'text-align:center;' : ''}">${title}</div>
                <div class="media-subtitle" style="${isArtist ? 'text-align:center;' : ''}">${subtitle}</div>
              </div>
        `;
    }

    _handleClick(e) {
        const card = e.target.closest('.interactive');
        if (card) {
            const { id, type, title, subtitle } = card.dataset;
            if (id && type) {
                this.dispatchEvent(new CustomEvent('navigate', {
                    detail: {
                        pageId: `${type}:${id}`,
                        data: { title, type, subtitle }
                    },
                    bubbles: true,
                    composed: true
                }));
            }
        }
    }
}

customElements.define('spotify-search', SpotifySearch);
