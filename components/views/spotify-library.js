import { LitElement, html } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { libraryStyles } from '../../styles/spotify-library.styles.js';
import { getItemImage, isContextPlaying, getLibrarySort, setLibrarySort } from '../../utils.js';
import { menuIcon } from '../common/icons.js';

// Filter pills. `null` = the default "Recents" view; the rest map to a saved /
// followed bucket. The integration has no podcast/show support, so no Podcasts.
const FILTERS = [
    { type: 'playlist', label: 'Playlists' },
    { type: 'album', label: 'Albums' },
    { type: 'artist', label: 'Artists' },
];

const HEART_SVG = html`<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;

const PAGE_SIZE = 50;
// A–Z can't page incrementally (the integration sorts each fetched page
// independently), so it's one capped full fetch revealed in PAGE_SIZE chunks.
const ALPHA_LIMIT_TOTAL = 500;

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
        this._paging = {};   // per-filter: { offset, after, hasMore, visible }
    }

    firstUpdated() {
        this._loadRecent();
    }

    updated() {
        // Re-observe the sentinel every render: observe() always fires an initial
        // callback, which chains page loads when the sentinel is still in view
        // (a plain observer only fires on intersection *changes*).
        this._observer?.disconnect();
        const sentinel = this.renderRoot.querySelector('.scroll-sentinel');
        if (!sentinel) return;
        if (!this._observer) {
            this._observer = new IntersectionObserver((entries) => {
                if (entries.some(e => e.isIntersecting) && this._filter) this._loadMore(this._filter);
            }, { root: this.renderRoot.querySelector('.l-scroll'), rootMargin: '300px' });
        }
        this._observer.observe(sentinel);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._observer?.disconnect();
        this._observer = null;
    }

    // ---- Data ----

    async _loadRecent() {
        if (this._recent || this._loading.recent || !this.api) return;
        this._loading.recent = true;
        try {
            // Play history drives the top of the list; the favorites fetches
            // (newest first) fill the tail. Only the history call is fatal.
            const quiet = (p) => p.catch(() => null);
            const [res, albumsRes, playlistsRes, followedRes] = await Promise.all([
                this.api.fetchSpotifyPlus('get_player_recent_tracks', { limit: 50 }),
                quiet(this.api.fetchSpotifyPlus('get_album_favorites', { limit: 12, sort_result: false })),
                quiet(this.api.fetchSpotifyPlus('get_playlist_favorites', { limit: 12, sort_result: false })),
                quiet(this.api.fetchSpotifyPlus('get_artists_followed', { limit: 12, sort_result: false })),
            ]);
            const items = res?.result?.items || [];
            const seen = new Set();
            const entries = [];
            const playlists = [];
            const artistEntries = [];
            for (const h of items) {
                if (entries.length >= 30) break;
                const ctx = h.context;
                if (ctx?.type === 'playlist' && ctx.uri) {
                    const id = ctx.uri.split(':').pop();
                    if (!seen.has('p' + id)) {
                        seen.add('p' + id);
                        const entry = { type: 'playlist', id, uri: ctx.uri, name: null };
                        entries.push(entry);
                        playlists.push(entry);
                    }
                } else if (h.track?.album?.id) {
                    const al = h.track.album;
                    if (!seen.has('a' + al.id)) {
                        seen.add('a' + al.id);
                        entries.push({ type: 'album', id: al.id, uri: al.uri, name: al.name, images: al.images, artists: h.track.artists });
                    }
                }
                // Interleave the track's main artist at its first appearance.
                const ar = h.track?.artists?.[0];
                if (ar?.id && artistEntries.length < 8 && !seen.has('r' + ar.id) && entries.length < 30) {
                    seen.add('r' + ar.id);
                    const entry = { type: 'artist', id: ar.id, uri: ar.uri || `spotify:artist:${ar.id}`, name: ar.name };
                    entries.push(entry);
                    artistEntries.push(entry);
                }
            }

            // Tail: newest saved playlists/albums + last-followed artists not
            // already shown, round-robin for variety.
            const savedAlbums = (albumsRes?.result?.items || []).map(i => i.album).filter(Boolean);
            const savedPlaylists = playlistsRes?.result?.items || [];
            let fd = followedRes?.result;
            if (fd?.artists) fd = fd.artists;
            const followedArtists = fd?.items || [];
            const pools = [
                { type: 'playlist', prefix: 'p', items: savedPlaylists },
                { type: 'album', prefix: 'a', items: savedAlbums },
                { type: 'artist', prefix: 'r', items: followedArtists },
            ];
            let added = 0;
            for (let i = 0; added < 12; i++) {
                let any = false;
                for (const pool of pools) {
                    if (added >= 12) break;
                    const it = pool.items[i];
                    if (!it?.id) continue;
                    any = true;
                    const key = pool.prefix + it.id;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    entries.push({ ...it, type: pool.type });
                    added++;
                }
                if (!any) break;
            }

            // Hydrate in parallel: playlist contexts only carry a URI; history
            // artists are simplified objects with no images.
            const followedById = new Map(followedArtists.map(a => [a.id, a]));
            await Promise.all([
                ...playlists.map(async (e) => {
                    try {
                        const pr = await this.api.fetchSpotifyPlus('get_playlist', { playlist_id: e.id });
                        const p = pr?.result;
                        if (p) { e.name = p.name; e.images = p.images; e.owner = p.owner; e.uri = p.uri || e.uri; }
                    } catch (_) { /* drop below if unhydrated */ }
                }),
                ...artistEntries.map(async (e) => {
                    const f = followedById.get(e.id);
                    if (f?.images?.length) { e.images = f.images; return; }
                    try {
                        const ar = await this.api.fetchSpotifyPlus('get_artist', { artist_id: e.id });
                        if (ar?.result?.images) e.images = ar.result.images;
                    } catch (_) { /* renders with fallback art */ }
                }),
            ]);
            this._recent = entries.filter(e => e.type !== 'playlist' || e.name);
        } catch (e) {
            console.error('[Library] Recent load failed', e);
            this._recent = [];
        } finally {
            this._loading.recent = false;
        }
    }

    _bucketKey(filter) {
        return filter === 'playlist' ? '_playlists' : filter === 'album' ? '_albums' : '_artists';
    }

    /** One service call for a bucket. Returns { items, after } (after = artist page cursor). */
    async _fetchPage(filter, params) {
        if (filter === 'playlist') {
            const res = await this.api.fetchSpotifyPlus('get_playlist_favorites', params);
            return { items: res?.result?.items || [] };
        }
        if (filter === 'album') {
            const res = await this.api.fetchSpotifyPlus('get_album_favorites', params);
            return { items: (res?.result?.items || []).map(i => i.album).filter(Boolean) };
        }
        // Artists page by cursor (`after` = last artist id), not offset.
        const { offset, ...rest } = params;
        const res = await this.api.fetchSpotifyPlus('get_artists_followed', rest);
        let d = res?.result;
        if (d?.artists) d = d.artists;
        const items = d?.items || [];
        return { items, after: d?.cursors?.after || items[items.length - 1]?.id || null };
    }

    async _loadBucket(filter) {
        const stateKey = this._bucketKey(filter);
        if (this[stateKey] || this._loading[filter] || !this.api) return;
        this._loading[filter] = true;
        const pg = this._paging[filter] = { offset: 0, after: null, hasMore: false, visible: PAGE_SIZE };
        try {
            if (getLibrarySort(filter) === 'alpha') {
                const page = await this._fetchPage(filter, { limit_total: ALPHA_LIMIT_TOTAL, sort_result: true });
                this[stateKey] = page.items;
            } else {
                const page = await this._fetchPage(filter, { limit: PAGE_SIZE, offset: 0, sort_result: false });
                this[stateKey] = page.items;
                pg.offset = page.items.length;
                pg.after = page.after || null;
                pg.hasMore = page.items.length >= PAGE_SIZE;
            }
        } catch (e) {
            console.error(`[Library] ${filter} load failed`, e);
            this[stateKey] = [];
        } finally {
            this._loading[filter] = false;
            this.requestUpdate();
        }
    }

    async _loadMore(filter) {
        const stateKey = this._bucketKey(filter);
        const pg = this._paging[filter];
        const list = this[stateKey];
        if (!pg || !list || this._loading[filter]) return;
        // A–Z already holds the full (capped) set — just reveal another chunk.
        if (getLibrarySort(filter) === 'alpha') {
            if (pg.visible < list.length) {
                pg.visible += PAGE_SIZE;
                this.requestUpdate();
            }
            return;
        }
        if (!pg.hasMore) return;
        this._loading[filter] = true;
        this.requestUpdate();
        try {
            const params = filter === 'artist'
                ? { limit: PAGE_SIZE, after: pg.after, sort_result: false }
                : { limit: PAGE_SIZE, offset: pg.offset, sort_result: false };
            const page = await this._fetchPage(filter, params);
            this[stateKey] = list.concat(page.items);
            pg.offset += page.items.length;
            pg.after = page.after || null;
            pg.hasMore = page.items.length >= PAGE_SIZE;
        } catch (e) {
            console.error(`[Library] ${filter} page load failed`, e);
            pg.hasMore = false;
        } finally {
            this._loading[filter] = false;
            this.requestUpdate();
        }
    }

    _setFilter(type) {
        this._filter = type;
        if (type) this._loadBucket(type);
    }

    /**
     * Re-fetch after a playlist mutation elsewhere in the app (create, rename,
     * delete) so names/artwork/ordering here don't go stale.
     */
    refresh() {
        this._playlists = null;
        this._recent = null;
        delete this._paging.playlist;
        if (this._filter) this._loadBucket(this._filter);
        else this._loadRecent();
    }

    _createPlaylist() {
        this.dispatchEvent(new CustomEvent('open-playlist-dialog', {
            detail: { mode: 'create' },
            bubbles: true, composed: true
        }));
    }

    /** Flip Recents <-> A–Z for the active bucket, persist, and refetch it. */
    _toggleSort() {
        const filter = this._filter;
        if (!filter) return;
        setLibrarySort(filter, getLibrarySort(filter) === 'alpha' ? 'recents' : 'alpha');
        this[this._bucketKey(filter)] = null;
        delete this._paging[filter];
        this._loadBucket(filter);
        this.requestUpdate();
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
                    <button class="l-icon-btn" @click=${this._createPlaylist} aria-label="Create playlist" title="Create playlist">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                    </button>
                </div>

                <div class="pills">
                    ${FILTERS.map(f => html`
                        <button class="pill ${this._filter === f.type ? 'active' : ''}"
                                @click=${() => this._setFilter(this._filter === f.type ? null : f.type)}>${f.label}</button>`)}
                    <button class="pill pill-create" @click=${this._createPlaylist} title="Create playlist">+ New</button>
                    ${this._filter ? html`
                        <button class="pill pill-sort" @click=${this._toggleSort} title="Change sort order">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v14m0 0l-3-3m3 3l3-3M17 20V6m0 0l-3 3m3-3l3 3"/></svg>
                            ${getLibrarySort(this._filter) === 'alpha' ? 'A–Z' : 'Recents'}
                        </button>` : ''}
                </div>

                <div class="body">${this._renderBody()}</div>
            </div>
        `;
    }

    _renderBody() {
        if (this._filter) return this._renderBucket(this._filter);

        // Default view: Liked Songs pinned at #1, then recently played +
        // newest-added items (built in _loadRecent).
        return html`
            ${this._renderLikedRow()}
            ${this._recent === null
                ? this._renderSkeletons(5)
                : this._recent.map(item => this._renderRow(item, item.type))}
        `;
    }

    _renderBucket(filter) {
        const list = this[this._bucketKey(filter)];
        if (list === null) return this._renderSkeletons(8);
        if (!list.length) {
            const label = FILTERS.find(f => f.type === filter)?.label.toLowerCase() || 'items';
            return html`<div class="empty">No ${label} yet.</div>`;
        }
        const pg = this._paging[filter];
        const alpha = getLibrarySort(filter) === 'alpha';
        const visible = alpha && pg ? list.slice(0, pg.visible) : list;
        const more = alpha ? visible.length < list.length : !!pg?.hasMore;
        return html`
            ${visible.map(item => this._renderRow(item, filter))}
            ${this._loading[filter] ? this._renderSkeletons(2) : ''}
            ${more && !this._loading[filter] ? html`<div class="scroll-sentinel"></div>` : ''}
        `;
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
                <div class="art ${isArtist ? 'circle' : ''} ${img ? '' : 'art-fallback'}" style="${img ? `background-image: url('${img}')` : ''}"></div>
                <div class="info">
                    <div class="name ${playing ? 'playing' : ''}">${item.name || ''}</div>
                    <div class="sub">${sub}</div>
                </div>
                ${isArtist ? '' : html`
                    <button class="row-menu-btn" aria-label="More options"
                            @click=${(e) => this._openRowMenu(e, item, type)}>${menuIcon}</button>`}
            </div>
        `;
    }

    /** Context menu for a library row (playlist: pin/edit/delete; album: go to artist). */
    async _openRowMenu(e, item, type) {
        e.stopPropagation();
        const anchor = e.currentTarget.getBoundingClientRect();
        const items = [];
        const actions = {};

        if (type === 'playlist') {
            const canPin = !!(this.pinned?.canEdit() && this.pinned.sensorEntity);
            const [userId, pinnedItems] = await Promise.all([
                this.api.getCurrentUserId().catch(() => null),
                canPin ? this.pinned.getItems().catch(() => []) : Promise.resolve([]),
            ]);
            if (canPin) {
                const isPinned = !!pinnedItems.find(p => p.id === item.id);
                items.push({ id: 'lm-pin', label: isPinned ? 'Unpin from Home' : 'Pin to Home', icon: 'pin' });
                actions['lm-pin'] = () => this._togglePinItem(item);
            }
            if (userId && item.owner?.id === userId) {
                items.push({ id: 'lm-edit', label: 'Edit Playlist', icon: 'pencil' });
                actions['lm-edit'] = () => this.dispatchEvent(new CustomEvent('navigate', {
                    detail: { pageId: `playlist:${item.id}`, data: { title: item.name, type: 'playlist', autoEdit: true } },
                    bubbles: true, composed: true
                }));
                items.push({ id: 'lm-delete', label: 'Delete Playlist', icon: 'trash', danger: true });
                actions['lm-delete'] = () => this._confirmDeletePlaylist(item);
            }
        } else if (type === 'album') {
            const artist = (item.artists || []).find(a => a.id);
            if (artist) {
                items.push({ id: 'lm-artist', label: 'Go to Artist', icon: 'artist' });
                actions['lm-artist'] = () => this.dispatchEvent(new CustomEvent('navigate', {
                    detail: { pageId: `artist:${artist.id}`, data: { title: artist.name, type: 'artist', subtitle: 'Artist' } },
                    bubbles: true, composed: true
                }));
            }
        }
        if (!items.length) return;

        this.dispatchEvent(new CustomEvent('open-context-menu', {
            detail: {
                header: { image: getItemImage(item, type), name: item.name, subtitle: type === 'playlist' ? 'Playlist' : 'Album' },
                items,
                anchor,
                onAction: (id) => actions[id]?.(),
            },
            bubbles: true, composed: true
        }));
    }

    async _togglePinItem(item) {
        const result = await this.pinned.toggle({
            id: item.id,
            type: 'playlist',
            name: item.name,
            images: item.images,
            uri: item.uri,
            description: item.description
        });
        if (result.success) {
            this.dispatchEvent(new CustomEvent('pinned-changed', { bubbles: true, composed: true }));
        } else {
            this.dispatchEvent(new CustomEvent('show-alert', {
                detail: { title: 'Pinning Failed', message: result.error || 'Unknown error', confirmText: 'OK', size: 'mini' },
                bubbles: true, composed: true
            }));
        }
    }

    _confirmDeletePlaylist(item) {
        this.dispatchEvent(new CustomEvent('show-alert', {
            detail: {
                title: 'Delete playlist?',
                message: `"${item.name}" will be removed from Your Library.`,
                confirmText: 'Delete',
                cancelText: 'Cancel',
                onConfirm: async () => {
                    const res = await this.api.unfollowPlaylist(item.id);
                    if (!res?.success) {
                        this.dispatchEvent(new CustomEvent('show-toast', {
                            detail: { message: "Couldn't delete playlist" }, bubbles: true, composed: true
                        }));
                        return;
                    }
                    this.dispatchEvent(new CustomEvent('playlist-changed', {
                        detail: { playlistId: item.id, action: 'delete' }, bubbles: true, composed: true
                    }));
                }
            },
            bubbles: true, composed: true
        }));
    }

    _renderSkeletons(n) {
        return html`${Array(n).fill(0).map(() => html`
            <div class="skel skeleton-pulse"><div class="art"></div><div class="skel-lines"><div></div><div></div></div></div>`)}`;
    }
}

customElements.define('spotify-library', SpotifyLibrary);
