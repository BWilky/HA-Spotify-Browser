import { LitElement, html } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { listRowStyles, filterPillStyles } from '../../styles/list-row.styles.js';
import { libraryStyles } from './spotify-library.styles.js';
import { getItemImage, isContextPlaying, getPlayerStateObj, getLibrarySort, setLibrarySort, IMG_THUMB } from '../../utils.js';
import { menuIcon, heartIcon, sortIcon, searchIcon } from '../common/icons.js';
import { renderListRow, renderRowSkeletons, renderEmptyState, itemSubtitle, SUBTITLE_STYLE } from '../media-templates.js';
import {
    playlistMenuItems, playlistMenuState, openActionMenu, togglePin, playlistPinItem,
    openPlaylistEditor, togglePlaylistFlag, setPlaylistFollowed, confirmDeletePlaylist,
} from '../playlist-actions.js';

// Filter pills. `null` = the default "Recents" view; the rest map to a saved /
// followed bucket. The integration has no podcast/show support, so no Podcasts.
const FILTERS = [
    { type: 'playlist', label: 'Playlists' },
    { type: 'album', label: 'Albums' },
    { type: 'artist', label: 'Artists' },
];

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
        return [sharedStyles, listRowStyles, filterPillStyles, libraryStyles];
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

    /**
     * Gate re-renders on HASS ticks: hass arrives ~1/s while playing, but the
     * only thing this page reads from it is which context is playing (the
     * green row title, via _isPlaying). Skip hass-only ticks that didn't change
     * that; any other changed property renders as usual.
     */
    shouldUpdate(changedProperties) {
        const sig = this._playingSignature();
        const sigChanged = sig !== this._playingSig;
        this._playingSig = sig;
        if (changedProperties.has('hass') && changedProperties.size === 1 && !sigChanged) {
            return false;
        }
        return true;
    }

    /** Everything _isPlaying() reads from hass, as a comparable string. */
    _playingSignature() {
        const stateObj = getPlayerStateObj(this.hass, this.config?.entity);
        if (!stateObj || stateObj.state !== 'playing') return '';
        const attrs = stateObj.attributes || {};
        return `${attrs.media_context_content_id}|${attrs.media_content_id}`;
    }

    connectedCallback() {
        super.connectedCallback();
        // disconnectedCallback dropped the observer; render once so updated()
        // re-observes the sentinel (hass ticks no longer re-render on their own).
        if (this.hasUpdated) this.requestUpdate();
    }

    updated() {
        // Re-observe the sentinel when it may need another load: observe() always
        // fires an initial callback, which chains page loads when the sentinel is
        // still in view (a plain observer only fires on intersection *changes*).
        // That's only needed when the sentinel element is new (a paged load
        // removes it while loading, then renders a fresh one) or the rows above
        // it changed (A–Z reveals keep the same sentinel; a filter switch can
        // reuse it). Other renders keep the existing observation.
        const sentinel = this.renderRoot.querySelector('.scroll-sentinel');
        const filter = this._filter;
        const rowsKey = `${filter}|${filter ? this[this._bucketKey(filter)]?.length : ''}|${this._paging[filter]?.visible}`;
        if (sentinel === this._observedSentinel && rowsKey === this._observedRowsKey) return;
        this._observedSentinel = sentinel;
        this._observedRowsKey = rowsKey;
        this._observer?.disconnect();
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
        this._observedSentinel = null;
    }

    // ---- Data ----

    async _loadRecent() {
        if (this._recent || this._loading.recent || !this.api) return;
        this._loading.recent = true;
        try {
            // Play history drives the top of the list; the favorites fetches
            // (newest first) fill the tail. Only the history call is fatal.
            const quiet = (p) => p.catch(() => null);
            const [history, albumsPage, playlistsPage, followedPage] = await Promise.all([
                this.api.getRecentTracks({ limit: 50 }),
                quiet(this.api.getSavedAlbums({ limit: 12, sort_result: false })),
                quiet(this.api.getSavedPlaylists({ limit: 12, sort_result: false })),
                quiet(this.api.getFollowedArtists({ limit: 12, sort_result: false })),
            ]);
            const items = history?.items || [];
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
            const savedAlbums = albumsPage?.items || [];
            const savedPlaylists = playlistsPage?.items || [];
            const followedArtists = followedPage?.items || [];
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
                        const p = await this.api.getPlaylist(e.id);
                        if (p) {
                            e.name = p.name; e.images = p.images; e.owner = p.owner; e.uri = p.uri || e.uri;
                            // The row menu's privacy / collaborative items read these.
                            e.public = p.public; e.collaborative = p.collaborative; e.description = p.description;
                        }
                    } catch (_) { /* drop below if unhydrated */ }
                }),
                ...artistEntries.map(async (e) => {
                    const f = followedById.get(e.id);
                    if (f?.images?.length) { e.images = f.images; return; }
                    try {
                        const ar = await this.api.getArtist(e.id);
                        if (ar?.images) e.images = ar.images;
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
            return { items: (await this.api.getSavedPlaylists(params))?.items || [] };
        }
        if (filter === 'album') {
            return { items: (await this.api.getSavedAlbums(params))?.items || [] };
        }
        // Artists page by cursor (`after`), not offset.
        const { offset, ...rest } = params;
        const page = await this.api.getFollowedArtists(rest);
        return { items: page?.items || [], after: page?.after || null };
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
     * A playlist changed somewhere in the app (the app passes on every
     * `playlist-changed` detail), so names, artwork, order and membership
     * here don't go stale. A settings patch (public / collaborative, from
     * "Make Private" and the like) is applied to its rows in place; an
     * unfollowed playlist's rows are dropped; anything else (create, delete,
     * items, follow) re-reads playlists and recents.
     */
    playlistChanged({ playlistId, action, patch } = {}) {
        if (playlistId && action === 'edit' && patch) {
            this._updatePlaylistRows(playlistId, (row) => ({ ...row, ...patch }));
        } else if (playlistId && action === 'unfollow') {
            this._updatePlaylistRows(playlistId, () => null);
        } else {
            this.refresh();
        }
    }

    /**
     * Replace (`update` returns the new row) or drop (it returns null) every
     * row of one playlist in the Playlists bucket and in Recents. Paging by
     * offset then resumes where Spotify's list now is: each dropped row
     * moved the ones after it up (A–Z holds its whole list: offset 0).
     */
    _updatePlaylistRows(playlistId, update) {
        const apply = (list, isRow) => {
            if (!list?.some(isRow)) return { list, dropped: 0 };
            const next = [];
            for (const row of list) {
                const kept = isRow(row) ? update(row) : row;
                if (kept) next.push(kept);
            }
            return { list: next, dropped: list.length - next.length };
        };
        const playlists = apply(this._playlists, (row) => row.id === playlistId);
        this._playlists = playlists.list;
        this._recent = apply(this._recent, (row) => row.type === 'playlist' && row.id === playlistId).list;
        const pg = this._paging.playlist;
        if (pg && playlists.dropped) pg.offset = Math.max(0, pg.offset - playlists.dropped);
    }

    /**
     * Re-read the library. By default only what a playlist edit can change
     * (playlists + recents); `all` (the header's "Refresh Data") also drops
     * the saved-albums and followed-artists buckets.
     */
    refresh(all = false) {
        this._playlists = null;
        this._recent = null;
        delete this._paging.playlist;
        if (all) {
            this._albums = null;
            this._artists = null;
            delete this._paging.album;
            delete this._paging.artist;
        }
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
                        ${searchIcon(24)}
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
                            ${sortIcon}
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
                ? renderRowSkeletons(5)
                : this._recent.map(item => this._renderRow(item, item.type))}
        `;
    }

    _renderBucket(filter) {
        const list = this[this._bucketKey(filter)];
        if (list === null) return renderRowSkeletons(8);
        if (!list.length) {
            const label = FILTERS.find(f => f.type === filter)?.label.toLowerCase() || 'items';
            return renderEmptyState(`No ${label} yet.`);
        }
        const pg = this._paging[filter];
        const alpha = getLibrarySort(filter) === 'alpha';
        const visible = alpha && pg ? list.slice(0, pg.visible) : list;
        const more = alpha ? visible.length < list.length : !!pg?.hasMore;
        return html`
            ${visible.map(item => this._renderRow(item, filter))}
            ${this._loading[filter] ? renderRowSkeletons(2) : ''}
            ${more && !this._loading[filter] ? html`<div class="scroll-sentinel"></div>` : ''}
        `;
    }

    _renderLikedRow() {
        return html`
            <div class="row" @click=${this._navigateLiked}>
                <div class="art liked">${heartIcon(true)}</div>
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

    /** A playlist / album / artist row; playlists and albums get a menu button. */
    _renderRow(item, type) {
        return renderListRow(item, type, {
            subtitle: itemSubtitle(item, type, SUBTITLE_STYLE.list),
            playing: this._isPlaying(item.uri),
            onClick: () => this._navigate(type, item),
            trailing: type === 'artist' ? '' : html`
                <button class="row-menu-btn" aria-label="More options"
                        @click=${(e) => this._openRowMenu(e, item, type)}>${menuIcon}</button>`,
        });
    }

    /**
     * Context menu for a library row. Playlist: the playlist page's menu
     * (playlist-actions.js); album: go to artist.
     */
    async _openRowMenu(e, item, type) {
        e.stopPropagation();
        const anchor = e.currentTarget.getBoundingClientRect();
        let items = [];
        let actions = {};

        if (type === 'playlist') {
            // The Playlists filter lists the playlists you own or follow;
            // Recents also holds recently played ones, so the state asks.
            const state = await playlistMenuState(this.api, this.pinned, item,
                this._filter === 'playlist' ? { isFollowing: true } : {});
            items = playlistMenuItems(item, state);
            // The row's playlist as the menu opened; a change patches the
            // rows (playlistChanged), so the next menu reads the new state.
            actions = {
                'edit': () => openPlaylistEditor(this, item),
                'toggle-public': () => togglePlaylistFlag(this, this.api, item, 'public'),
                'toggle-collab': () => togglePlaylistFlag(this, this.api, item, 'collaborative'),
                'follow': () => setPlaylistFollowed(this, this.api, item, true),
                'unfollow': () => setPlaylistFollowed(this, this.api, item, false),
                'pin': () => togglePin(this, this.pinned, playlistPinItem(item)),
                'delete': () => confirmDeletePlaylist(this, this.api, item),
            };
        } else if (type === 'album') {
            const artist = (item.artists || []).find(a => a.id);
            if (artist) {
                items.push({ id: 'lm-artist', label: 'Go to Artist', icon: 'artist' });
                actions.artist = () => this.dispatchEvent(new CustomEvent('navigate', {
                    detail: { pageId: `artist:${artist.id}`, data: { title: artist.name, type: 'artist', subtitle: 'Artist' } },
                    bubbles: true, composed: true
                }));
            }
        }
        if (!items.length) return;

        openActionMenu(this, {
            header: { image: getItemImage(item, type, IMG_THUMB), name: item.name, subtitle: type === 'playlist' ? 'Playlist' : 'Album' },
            items,
            anchor,
            actions,
        });
    }
}

customElements.define('spotify-library', SpotifyLibrary);
