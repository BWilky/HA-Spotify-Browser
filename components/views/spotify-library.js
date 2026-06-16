import { LitElement, html } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { libraryStyles } from '../../styles/spotify-library.styles.js';
import { getItemImage, isContextPlaying } from '../../utils.js';

// Filter pills. `null` = the default "Recents" view; the rest map to a saved /
// followed bucket. The integration has no podcast/show support, so no Podcasts.
const FILTERS = [
    { type: 'playlist', label: 'Playlists' },
    { type: 'album', label: 'Albums' },
    { type: 'artist', label: 'Artists' },
];

const HEART_SVG = html`<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;

class SpotifyLibrary extends LitElement {
    static get properties() {
        return {
            hass: { type: Object },
            api: { type: Object },
            config: { type: Object },
            pinned: { type: Object },
            _filter: { type: String, state: true },   // null = Recents, else playlist|album|artist
            _recent: { type: Array, state: true },     // merged recently-played albums + playlists
            _playlists: { type: Array, state: true },
            _albums: { type: Array, state: true },
            _artists: { type: Array, state: true },
        };
    }

    static get styles() {
        return [sharedStyles, libraryStyles];
    }

    constructor() {
        super();
        this._filter = null;
        this._recent = null;
        this._playlists = null;
        this._albums = null;
        this._artists = null;
        this._loading = {};
    }

    firstUpdated() {
        this._loadRecent();
    }

    // ---- Data ----

    async _loadRecent() {
        if (this._recent || this._loading.recent || !this.api) return;
        this._loading.recent = true;
        try {
            const res = await this.api.fetchSpotifyPlus('get_player_recent_tracks', { limit: 50 });
            const items = res?.result?.items || [];
            const seen = new Set();
            const entries = [];
            const playlists = [];
            for (const h of items) {
                if (entries.length >= 30) break;
                const ctx = h.context;
                if (ctx?.type === 'playlist' && ctx.uri) {
                    const id = ctx.uri.split(':').pop();
                    if (seen.has('p' + id)) continue;
                    seen.add('p' + id);
                    const entry = { type: 'playlist', id, uri: ctx.uri, name: null };
                    entries.push(entry);
                    playlists.push(entry);
                } else if (h.track?.album?.id) {
                    const al = h.track.album;
                    if (seen.has('a' + al.id)) continue;
                    seen.add('a' + al.id);
                    entries.push({ type: 'album', id: al.id, uri: al.uri, name: al.name, images: al.images, artists: h.track.artists });
                }
            }
            // Playlist contexts only carry a URI — hydrate name/images in parallel.
            await Promise.all(playlists.map(async (e) => {
                try {
                    const pr = await this.api.fetchSpotifyPlus('get_playlist', { playlist_id: e.id });
                    const p = pr?.result;
                    if (p) { e.name = p.name; e.images = p.images; e.owner = p.owner; e.uri = p.uri || e.uri; }
                } catch (_) { /* drop below if unhydrated */ }
            }));
            this._recent = entries.filter(e => e.type !== 'playlist' || e.name);
        } catch (e) {
            console.error('[Library] Recent load failed', e);
            this._recent = [];
        } finally {
            this._loading.recent = false;
        }
    }

    async _loadBucket(filter) {
        const stateKey = filter === 'playlist' ? '_playlists' : filter === 'album' ? '_albums' : '_artists';
        if (this[stateKey] || this._loading[filter] || !this.api) return;
        this._loading[filter] = true;
        try {
            let list = [];
            if (filter === 'playlist') {
                const res = await this.api.fetchSpotifyPlus('get_playlist_favorites', { limit: 50 });
                list = res?.result?.items || [];
            } else if (filter === 'album') {
                const res = await this.api.fetchSpotifyPlus('get_album_favorites', { limit: 50 });
                list = (res?.result?.items || []).map(i => i.album).filter(Boolean);
            } else if (filter === 'artist') {
                const res = await this.api.fetchSpotifyPlus('get_artists_followed', { limit: 50 });
                let d = res?.result;
                if (d?.artists) d = d.artists;
                list = d?.items || [];
            }
            this[stateKey] = list;
        } catch (e) {
            console.error(`[Library] ${filter} load failed`, e);
            this[stateKey] = [];
        } finally {
            this._loading[filter] = false;
            this.requestUpdate();
        }
    }

    _setFilter(type) {
        this._filter = type;
        if (type) this._loadBucket(type);
    }

    _isPlaying(uri) {
        return uri ? isContextPlaying(this.hass, this.config?.entity, uri) : false;
    }

    // ---- Navigation ----

    _navigate(type, item) {
        this.dispatchEvent(new CustomEvent('navigate', {
            detail: {
                pageId: `${type}:${item.id}`,
                data: { title: item.name, type, subtitle: type === 'artist' ? 'Artist' : '' }
            }, bubbles: true, composed: true
        }));
    }

    _navigateLiked() {
        this.dispatchEvent(new CustomEvent('navigate', {
            detail: { pageId: 'likedsongs' }, bubbles: true, composed: true
        }));
    }

    _openSearch() {
        this.dispatchEvent(new CustomEvent('navigate', {
            detail: { pageId: 'search' }, bubbles: true, composed: true
        }));
    }

    // ---- Render ----

    render() {
        return html`
            <div class="l-scroll">
                <div class="l-top">
                    <div class="l-title">Your Library</div>
                    <button class="l-icon-btn" @click=${this._openSearch} aria-label="Search">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                    </button>
                </div>

                <div class="pills">
                    ${FILTERS.map(f => html`
                        <button class="pill ${this._filter === f.type ? 'active' : ''}"
                                @click=${() => this._setFilter(this._filter === f.type ? null : f.type)}>${f.label}</button>`)}
                </div>

                <div class="body">${this._renderBody()}</div>
            </div>
        `;
    }

    _renderBody() {
        if (this._filter) return this._renderBucket(this._filter);

        // Default "Recents" view: Liked Songs pinned at #1, then recents.
        return html`
            <div class="section-h">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h13M3 12h9M3 17h5M17 5v14m0 0l-3-3m3 3l3-3"/></svg>
                Recents
            </div>
            ${this._renderLikedRow()}
            ${this._recent === null
                ? this._renderSkeletons(5)
                : this._recent.map(item => this._renderRow(item, item.type))}
        `;
    }

    _renderBucket(filter) {
        const list = filter === 'playlist' ? this._playlists : filter === 'album' ? this._albums : this._artists;
        if (list === null) return this._renderSkeletons(8);
        if (!list.length) {
            const label = FILTERS.find(f => f.type === filter)?.label.toLowerCase() || 'items';
            return html`<div class="empty">No ${label} yet.</div>`;
        }
        return html`${list.map(item => this._renderRow(item, filter))}`;
    }

    _renderLikedRow() {
        return html`
            <div class="row" @click=${this._navigateLiked}>
                <div class="art liked">${HEART_SVG}</div>
                <div class="info">
                    <div class="name">Liked Songs</div>
                    <div class="sub">
                        <svg class="pin" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/></svg>
                        Playlist
                    </div>
                </div>
            </div>
        `;
    }

    _renderRow(item, type) {
        const img = getItemImage(item, type);
        const isArtist = type === 'artist';
        let sub;
        if (isArtist) sub = 'Artist';
        else if (type === 'playlist') sub = `Playlist • ${item.owner?.display_name || item.owner?.name || 'Spotify'}`;
        else {
            const who = (item.artists || []).map(a => a.name).join(', ');
            sub = `Album${who ? ' • ' + who : ''}`;
        }
        const playing = this._isPlaying(item.uri);
        return html`
            <div class="row" @click=${() => this._navigate(type, item)}>
                <div class="art ${isArtist ? 'circle' : ''}" style="background-image: url('${img}')"></div>
                <div class="info">
                    <div class="name ${playing ? 'playing' : ''}">${item.name || ''}</div>
                    <div class="sub">${sub}</div>
                </div>
            </div>
        `;
    }

    _renderSkeletons(n) {
        return html`${Array(n).fill(0).map(() => html`
            <div class="skel skeleton-pulse"><div class="art"></div><div class="skel-lines"><div></div><div></div></div></div>`)}`;
    }
}

customElements.define('spotify-library', SpotifyLibrary);
