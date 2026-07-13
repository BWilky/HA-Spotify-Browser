import { LitElement, html, css } from "../lit.js";
import { sharedStyles } from '../styles/shared-styles.js';
import { getItemImage } from '../utils.js';

// Filter pills. "All" (type null) is the mixed/relevance view. SpotifyPlus
// search exposes these four content types (no Profiles/Podcasts/Audiobooks),
// so they map straight to result buckets.
const FILTERS = [
    { type: null, label: 'All', key: null },
    { type: 'track', label: 'Songs', key: 'tracks' },
    { type: 'playlist', label: 'Playlists', key: 'playlists' },
    { type: 'artist', label: 'Artists', key: 'artists' },
    { type: 'album', label: 'Albums', key: 'albums' },
];

const TYPE_LABEL = { track: 'Song', playlist: 'Playlist', artist: 'Artist', album: 'Album' };

class SpotifySearch extends LitElement {
    static get properties() {
        return {
            hass: { type: Object },
            api: { type: Object },
            config: { type: Object },
            _results: { type: Object },
            _query: { type: String },
            _filter: { type: String, state: true },     // active pill type, or null = mixed (All)
            _topFollow: { type: Boolean, state: true },  // follow state of the top-result artist
        };
    }

    static get styles() {
        return [sharedStyles, css`
            :host { display: block; height: 100%; }

            .s-scroll {
                height: 100%; overflow-y: auto; overflow-x: hidden;
                background: var(--spf-bg);
            }

            /* ---- Top bar (mobile owns its own search input) ---- */
            .m-top {
                position: sticky; top: 0; z-index: 5;
                display: flex; align-items: center; gap: 12px;
                padding: calc(var(--spf-safe-top, 0px) + 10px) 16px 10px;
                background: var(--spf-bg);
            }
            .m-bar {
                flex: 1; display: flex; align-items: center; gap: 10px;
                height: 44px; padding: 0 12px; border-radius: 8px; background: #2a2a2a;
            }
            .m-bar svg { flex: 0 0 auto; }
            .m-bar input {
                flex: 1; min-width: 0; border: none; outline: none;
                background: transparent; color: #fff; font-size: var(--spf-text-md, 15px);
            }
            .m-bar input::placeholder { color: var(--spf-text-sub); }
            .m-clear { background: none; border: none; color: var(--spf-text-sub); cursor: pointer; padding: 4px; display: flex; }
            .m-cancel { background: none; border: none; color: #fff; font-size: var(--spf-text-md, 15px); cursor: pointer; white-space: nowrap; padding: 0; }

            /* ---- Filter pills ---- */
            .pills {
                position: sticky; z-index: 4;
                display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none;
                background: var(--spf-bg);
            }
            .pills::-webkit-scrollbar { display: none; }
            .pill {
                flex: 0 0 auto; border: none; cursor: pointer; white-space: nowrap;
                padding: 8px 16px; border-radius: 999px; font-size: var(--spf-text-base, 13.5px); font-weight: 700;
                background: #232323; color: #fff;
            }
            .pill.active { background: #fff; color: #000; }

            .body { padding-bottom: 120px; }
            .section-h { font-size: var(--spf-text-xl, 22px); font-weight: 700; color: #fff; padding: 18px 16px 8px; }
            .empty { padding: 48px 24px; text-align: center; color: var(--spf-text-sub); }

            /* ---- Top result (artist) ---- */
            .top-result { display: flex; align-items: center; gap: 16px; padding: 12px 16px 20px; }
            .top-avatar {
                width: 64px; height: 64px; border-radius: 50%;
                background-size: cover; background-position: center;
                background-color: var(--spf-bg-card-hover); flex: 0 0 auto;
            }
            .top-meta { flex: 1; min-width: 0; }
            .top-name {
                font-size: var(--spf-text-xl, 22px); font-weight: 900; color: #fff;
                display: flex; align-items: center; gap: 6px;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .verified { color: #4cb3ff; flex: 0 0 auto; }
            .top-sub { color: var(--spf-text-sub); font-size: var(--spf-text-base, 13.5px); margin-top: 2px; }
            .follow-btn {
                flex: 0 0 auto; background: transparent; color: #fff;
                border: 1px solid rgba(255,255,255,0.4); border-radius: 999px;
                padding: 7px 18px; font-size: var(--spf-text-base, 13.5px); font-weight: 700; cursor: pointer;
            }
            .play-btn {
                flex: 0 0 auto; width: 48px; height: 48px; border-radius: 50%;
                background: var(--spf-brand); color: #000; border: none; cursor: pointer;
                display: none; align-items: center; justify-content: center;
            }
            .play-btn svg { width: 24px; height: 24px; fill: currentColor; }

            /* ---- Result rows ---- */
            .row {
                display: grid; grid-template-columns: 48px 1fr auto;
                align-items: center; gap: 12px; padding: 8px 16px; cursor: pointer; min-height: 64px;
            }
            @media (hover: hover) { .row:hover { background: var(--spf-hover-white); } }
            .art {
                width: 48px; height: 48px; border-radius: 4px;
                background-size: cover; background-position: center;
                background-color: var(--spf-bg-card-hover);
            }
            .art.circle { border-radius: 50%; }
            .info { min-width: 0; }
            .name { color: #fff; font-size: var(--spf-text-md, 15px); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .sub { color: var(--spf-text-sub); font-size: var(--spf-text-base, 13.5px); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .type-badge { display: none; color: var(--spf-text-sub); font-size: var(--spf-text-base, 13.5px); padding: 4px 10px; background: var(--spf-bg-card-hover); border-radius: 4px; white-space: nowrap; }
            .row-btn { background: none; border: none; color: var(--spf-text-sub); cursor: pointer; padding: 8px; display: flex; }
            @media (hover: hover) { .row-btn:hover { color: #fff; } }

            /* ---- Skeletons ---- */
            .skel { display: grid; grid-template-columns: 48px 1fr; gap: 12px; align-items: center; padding: 8px 16px; min-height: 64px; }
            /* skeleton-pulse (shared) fills the whole row; keep it transparent so
               only the art + text-line shapes read as a skeleton, not a flat block. */
            .skel.skeleton-pulse { background: transparent; }
            .skel .art { background: var(--spf-skeleton-bg); }
            .skel-lines > div { height: 12px; border-radius: 3px; background: var(--spf-skeleton-bg); }
            .skel-lines > div:first-child { width: 60%; margin-bottom: 8px; }
            .skel-lines > div:last-child { width: 35%; }

            /* ================= MOBILE ================= */
            @media (max-width: 768px) {
                .pills { top: calc(var(--spf-safe-top, 0px) + 64px); padding: 6px 16px 12px; }
            }

            /* ================= DESKTOP ================= */
            @media (min-width: 769px) {
                .body, .pills, .top-result, .row, .skel { max-width: 1100px; margin-left: auto; margin-right: auto; }
                .pills { top: 0; justify-content: flex-start; padding: 16px 16px 12px; }
                .m-top { display: none; }

                /* Top result becomes a card with a hover play button */
                .top-result {
                    margin: 8px 16px 24px; padding: 20px; border-radius: 8px;
                    background: var(--spf-bg-card, #1a1a1a);
                    transition: background 0.2s;
                }
                .top-result:hover { background: var(--spf-bg-card-hover, #2a2a2a); }
                .top-avatar { width: 80px; height: 80px; }
                .top-name { font-size: var(--spf-text-2xl, 26px); }
                .top-result:hover .play-btn { display: flex; }

                /* Rows gain a type badge column + show the add affordance */
                .row { grid-template-columns: 48px 1fr auto auto; }
                .type-badge { display: inline-block; }
            }
        `];
    }

    constructor() {
        super();
        this._results = null;
        this._query = '';
        this._filter = null;
        this._topFollow = null;
        this._isMobile = window.matchMedia('(max-width: 768px)').matches;
    }

    firstUpdated() {
        if (this._isMobile) {
            const input = this.shadowRoot.getElementById('page-search-input');
            if (input) {
                if (this._query) input.value = this._query;
                setTimeout(() => input.focus(), 120);
            }
        }
    }

    updated(changedProperties) {
        if (changedProperties.has('_query') && this._query && this.api) {
            this._performSearch(this._query);
        }
    }

    _onInput(e) {
        const q = e.target.value;
        if (this._inputDebounce) clearTimeout(this._inputDebounce);
        this._inputDebounce = setTimeout(() => this.search(q), 350);
    }

    search(query) {
        if (query !== this._query) {
            this._results = null;
            this._filter = null;
            this._topFollow = null;
        }
        this._query = query;
    }

    _clearQuery() {
        this._results = null;
        this._filter = null;
        this._query = '';
        const input = this.shadowRoot.getElementById('page-search-input');
        if (input) { input.value = ''; input.focus(); }
    }

    _cancel() {
        this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }));
    }

    _setFilter(type) {
        this._filter = type;
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
            if (searchId !== this._searchId) return;
            if (res && res.result) {
                this._results = res.result;
                this._checkTopFollow();
            }
        } catch (e) {
            console.error("Search failed:", e);
        }
    }

    async _checkTopFollow() {
        this._topFollow = null;
        const artist = this._topArtist();
        if (!artist?.id || !this.api) return;
        try {
            const res = await this.api.checkArtistsFollowing(artist.id);
            if (typeof res === 'boolean') this._topFollow = res;
            else if (Array.isArray(res)) this._topFollow = !!res[0];
            else if (res && typeof res === 'object') this._topFollow = !!res[artist.id];
        } catch (e) { /* leave unknown */ }
    }

    /** The first artist whose name closely matches the query, else null. */
    _topArtist() {
        const artists = this._results?.artists?.items || [];
        if (!artists.length) return null;
        const q = (this._query || '').trim().toLowerCase();
        const a = artists[0];
        const name = (a.name || '').toLowerCase();
        if (!name) return null;
        if (name === q || name.startsWith(q) || q.startsWith(name)) return a;
        return null;
    }

    render() {
        return html`
            <div class="s-scroll">
                ${this._isMobile ? html`
                    <div class="m-top">
                        <div class="m-bar">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--spf-text-sub)" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                            <input id="page-search-input" type="text" placeholder="What do you want to listen to?" @input=${this._onInput}>
                            ${this._query ? html`
                                <button class="m-clear" @click=${this._clearQuery} aria-label="Clear">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                </button>` : ''}
                        </div>
                        <button class="m-cancel" @click=${this._cancel}>Cancel</button>
                    </div>
                ` : ''}

                ${this._query ? html`
                    <div class="pills">
                        ${FILTERS.map(f => html`
                            <button class="pill ${(this._filter || null) === f.type ? 'active' : ''}"
                                    @click=${() => this._setFilter(f.type)}>${f.label}</button>`)}
                    </div>
                ` : ''}

                <div class="body">${this._renderBody()}</div>
            </div>
        `;
    }

    _renderBody() {
        if (!this._query) {
            return html`<div class="empty">Search for songs, artists, albums, and playlists.</div>`;
        }
        if (!this._results) {
            return html`${Array(8).fill(0).map(() => html`
                <div class="skel skeleton-pulse"><div class="art"></div><div class="skel-lines"><div></div><div></div></div></div>`)}`;
        }

        // Single-type (pill) view
        if (this._filter) {
            const f = FILTERS.find(x => x.type === this._filter);
            const items = this._results[f.key]?.items || [];
            if (!items.length) return html`<div class="empty">No ${f.label.toLowerCase()} found.</div>`;
            return html`${items.map(item => this._renderRow(item, this._filter))}`;
        }

        // Mixed / relevance (All) view
        const top = this._topArtist();
        const mixed = this._mixedItems(top);
        if (!top && mixed.length === 0) return html`<div class="empty">No results found.</div>`;
        return html`
            ${top ? html`<div class="section-h">Top result</div>${this._renderTopResult(top)}` : ''}
            ${mixed.length ? html`
                <div class="section-h">Results</div>
                ${mixed.map(({ item, type }) => this._renderRow(item, type))}
            ` : ''}
        `;
    }

    _renderTopResult(artist) {
        const img = getItemImage(artist, 'artist');
        const following = this._topFollow;
        return html`
            <div class="top-result" @click=${() => this._navigate('artist', artist)}>
                <div class="top-avatar" style="background-image: url('${img}')"></div>
                <div class="top-meta">
                    <div class="top-name">
                        ${artist.name}
                        <svg class="verified" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 2.4 3.3-.5.6 3.3L21 11l-2.4 2.4.5 3.3-3.3.6L12 21l-2.4-2.4-3.3.5-.6-3.3L3 11l2.4-2.4-.5-3.3 3.3-.6L12 2z"/><path d="M10.6 14.6L7.8 11.8l1.2-1.2 1.6 1.6 4-4 1.2 1.2-5.2 5.2z" fill="#000"/></svg>
                    </div>
                    <div class="top-sub">Artist</div>
                </div>
                ${following !== null ? html`
                    <button class="follow-btn" @click=${(e) => this._toggleFollow(e, artist)}>
                        ${following ? 'Following' : 'Follow'}
                    </button>` : ''}
                <button class="play-btn" @click=${(e) => this._playArtist(e, artist)} aria-label="Play">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </button>
            </div>
        `;
    }

    /** Interleave the result buckets into one relevance-mixed list. */
    _mixedItems(topArtist) {
        const r = this._results || {};
        const buckets = [
            (r.tracks?.items || []).map(item => ({ item, type: 'track' })),
            (r.playlists?.items || []).map(item => ({ item, type: 'playlist' })),
            (r.albums?.items || []).map(item => ({ item, type: 'album' })),
            (r.artists?.items || [])
                .filter(a => !topArtist || a.id !== topArtist.id)
                .map(item => ({ item, type: 'artist' })),
        ];
        const out = [];
        const max = Math.max(...buckets.map(b => b.length), 0);
        for (let i = 0; i < max && out.length < 30; i++) {
            for (const b of buckets) if (b[i]) out.push(b[i]);
        }
        return out;
    }

    _renderRow(item, type) {
        const img = getItemImage(item, type);
        const isArtist = type === 'artist';
        const isTrack = type === 'track';

        let sub;
        if (isArtist) sub = 'Artist';
        else if (type === 'playlist') sub = `Playlist • ${item.owner?.display_name || 'Spotify'}`;
        else if (type === 'album') {
            const yr = item.release_date ? item.release_date.split('-')[0] : '';
            const who = item.artists?.map(a => a.name).join(', ') || '';
            sub = `Album${yr ? ' • ' + yr : ''}${who ? ' • ' + who : ''}`;
        } else {
            sub = `Song • ${item.artists?.map(a => a.name).join(', ') || ''}`;
        }

        const onClick = () => isTrack ? this._playTrack(item) : this._navigate(type, item);

        return html`
            <div class="row" @click=${onClick}>
                <div class="art ${isArtist ? 'circle' : ''}" style="background-image: url('${img}')"></div>
                <div class="info">
                    <div class="name">${item.name}</div>
                    <div class="sub">${sub}</div>
                </div>
                <span class="type-badge">${TYPE_LABEL[type] || ''}</span>
                ${isTrack ? html`
                    <button class="row-btn" @click=${(e) => this._trackMenu(e, item)} aria-label="More">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>
                    </button>
                ` : html`
                    <button class="row-btn" aria-label="Open">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
                    </button>
                `}
            </div>
        `;
    }

    _playTrack(item) {
        this.api?.playMedia(item.uri, 'track');
        this.dispatchEvent(new CustomEvent('show-toast', {
            detail: { message: `Playing "${item.name}"` }, bubbles: true, composed: true
        }));
    }

    _playArtist(e, artist) {
        e.stopPropagation();
        this.api?.playMedia(artist.uri, 'artist');
    }

    _trackMenu(e, item) {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('open-track-menu', {
            detail: {
                name: item.name,
                artist: item.artists?.map(a => a.name).join(', ') || '',
                album: item.album?.name || '',
                uri: item.uri,
                id: item.id,
                image: getItemImage(item, 'track'),
                anchor: e.currentTarget.getBoundingClientRect(),
            }, bubbles: true, composed: true
        }));
    }

    async _toggleFollow(e, artist) {
        e.stopPropagation();
        if (!this.api || !artist?.id) return;
        const next = !this._topFollow;
        this._topFollow = next;
        const res = next ? await this.api.followArtist(artist.id) : await this.api.unfollowArtist(artist.id);
        if (!res || res.success === false) {
            this._topFollow = !next;
            this.dispatchEvent(new CustomEvent('show-toast', {
                detail: { message: 'Failed to update follow' }, bubbles: true, composed: true
            }));
        }
    }

    _navigate(type, item) {
        this.dispatchEvent(new CustomEvent('navigate', {
            detail: {
                pageId: `${type}:${item.id}`,
                data: { title: item.name, type, subtitle: type === 'artist' ? 'Artist' : '' }
            }, bubbles: true, composed: true
        }));
    }
}

customElements.define('spotify-search', SpotifySearch);
