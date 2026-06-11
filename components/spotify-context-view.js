
import { LitElement, html } from "../lit.js";
import { sharedStyles } from '../styles/shared-styles.js';
import { contextViewStyles } from '../styles/spotify-context-view.styles.js';
import { loadMadeForYouItems } from './controllers/home-content.js';

// Import new sub-views
import './views/spotify-context-list.js';
import './views/spotify-playlist-view.js';
import './views/spotify-artist-view.js';
import './views/spotify-section-view.js';

class SpotifyContextView extends LitElement {
    static get properties() {
        return {
            hass: { type: Object },
            api: { type: Object },
            config: { type: Object },
            pageId: { type: String },
            data: { type: Object },
            _contextData: { type: Object, state: true },
            _isFollowing: { type: Boolean, state: true },

            _currentUserId: { type: String, state: true },
            pinned: { type: Object }, // Add pinned dependency
        };
    }

    static get styles() {
        return [sharedStyles, contextViewStyles];
    }

    /* shouldUpdate removed to allow reactive HASS updates to propagate to children (Artist View) */

    constructor() {
        super();
        this._contextData = null;
        this._isFollowing = false;
        this._currentUserId = null;
    }

    connectedCallback() {
        super.connectedCallback();
        console.log('[ContextView] Connected. PageId:', this.pageId);
        // loadPageData will be called by updated() when properties are set
    }

    updated(changedProperties) {
        if (changedProperties.has('pageId') || changedProperties.has('hass') || changedProperties.has('api')) {
            if (this.pageId && this.hass && this.api) {
                this.loadPageData();
            }
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
    }

    _handleTrackMenuClick(e) {
        // ... Logic remains same ...
        const button = e.target.closest('.track-action-btn[data-action="menu"]');
        if (button) {
            e.stopPropagation();
            const rawData = button.dataset.trackData;
            if (rawData) {
                try {
                    const data = JSON.parse(rawData);
                    this.dispatchEvent(new CustomEvent('open-track-menu', {
                        detail: data,
                        bubbles: true,
                        composed: true
                    }));
                } catch (err) {
                    console.error("[SpotifyBrowser] JSON Parse Error:", err);
                }
            }
        }
    }

    async _handleLoadMore() {
        if (!this._contextData || this._contextData.isLoading || !this._contextData.hasMore) return;

        const type = this._contextData.type;
        const offset = this._contextData.offset || 0;
        const limit = 50;

        console.log('[ContextView] Load More Triggered. Type:', type, 'Offset:', offset);

        this._contextData = { ...this._contextData, isLoading: true };
        this.requestUpdate();

        try {
            let newItems = [];
            let total = this._contextData.total;

            if (type === 'likedsongs') {
                const res = await this.api.getTrackFavorites({ limit, offset, sort_result: false });
                newItems = res?.result?.items || [];
                total = res?.result?.total || total;
            } else if (type === 'collection-playlists') {
                const res = await this.api.getCurrentUserPlaylists({ limit, offset });
                newItems = res?.result?.items || [];
                total = res?.result?.total || total;
            } else if (type === 'artist-discography') {
                const res = await this.api.fetchSpotifyPlus('get_artist_albums', {
                    artist_id: this._contextData.id,
                    limit: limit,
                    offset: offset
                });
                newItems = res?.result?.items || [];
                total = res?.result?.total || total;
            }

            if (newItems.length > 0) {
                const updatedItems = [...this._contextData.items, ...newItems];
                this._contextData = {
                    ...this._contextData,
                    items: updatedItems,
                    total: total,
                    offset: offset + newItems.length,
                    hasMore: updatedItems.length < total,
                    isLoading: false
                };
                SpotifyContextView.cacheSet(this.pageId, this._contextData);
            } else {
                this._contextData = { ...this._contextData, isLoading: false, hasMore: false };
            }
            this.requestUpdate();

        } catch (e) {
            console.error('[ContextView] Load More Failed:', e);
            this._contextData = { ...this._contextData, isLoading: false };
            this.requestUpdate();
        }
    }

    _handleScroll(e) {
        // No longer needed here as sub-views handle their own scroll events.
        // But we keep it if we need to bubble 'header-scroll' from children?
        // Children dispatch 'header-scroll' with bubbling, so it passes through.
    }

    // Static cache for persistence across navigations (LRU, capped)
    static stateCache = new Map();
    static MAX_CACHE_ENTRIES = 30;

    static cacheSet(pageId, data) {
        if (this.stateCache.has(pageId)) this.stateCache.delete(pageId);
        this.stateCache.set(pageId, data);
        if (this.stateCache.size > this.MAX_CACHE_ENTRIES) {
            this.stateCache.delete(this.stateCache.keys().next().value);
        }
    }

    async loadPageData() {
        if (!this.pageId) return;

        let type, id;
        if (this.pageId === 'likedsongs') {
            type = 'likedsongs';
            id = 'me';
        } else {
            [type, id] = this.pageId.split(':');
        }

        // 0. Prevent re-fetching if data is already loaded for this instance
        if (this._contextData && this._contextData.id === id && this._contextData.type === type && !this._contextData.isLoading) {
            return;
        }

        // 1. Check Static Cache first (User requested persistence)
        if (SpotifyContextView.stateCache.has(this.pageId)) {
            // console.log('[SpotifyContextView] Restoring from static cache:', this.pageId);
            this._contextData = SpotifyContextView.stateCache.get(this.pageId);
            this.requestUpdate();
            // If it's a section, we might want to check if more data is available or just let user scroll?
            // For now, simple restore is what was asked.
            return;
        }

        // ... Initial State Setup ...
        this._contextData = {
            type, id, isLoading: true, name: 'Loading...', items: [], offset: 0, total: null, hasMore: true,
            images: [], tracks: null, albums: null, playlists: null, topTracks: null, similarArtists: null
        };
        this.requestUpdate();
        // Cache initial state immediately? No, wait for data.

        try {
            if (type === 'section') {
                await this._loadSectionData(id, 0);
            } else if (type === 'playlist') {
                // ... (rest of function) ...
                // ...
                // existing playlist logic ...
                const response = await this.api.fetchSpotifyPlus('get_playlist', {
                    playlist_id: id,
                    fields: "description,id,name,images,owner,type,uri,tracks(items(track(id,name,uri,duration_ms,artists(name),album(images,name))))"
                });
                if (response?.result) {
                    this._contextData = { ...this._contextData, ...response.result, type: 'playlist', isLoading: false };

                    // Fetch Current User & Follow Status (existing logic)
                    if (!this._currentUserId) {
                        try {
                            const user = await this.api.getCurrentUserProfile();
                            if (user?.id) this._currentUserId = user.id;
                        } catch (e) { }
                    }
                    if (this._currentUserId && this._contextData.id) {
                        try {
                            const follows = await this.api.checkUserFollowsPlaylist(this._contextData.id, this._currentUserId);
                            if (follows && Array.isArray(follows) && follows.length > 0) this._isFollowing = follows[0];
                        } catch (e) { }
                    }

                    // Update cache
                    SpotifyContextView.cacheSet(this.pageId, this._contextData);
                    this.requestUpdate();
                }
            } else if (type === 'artist') {
                // ... existing artist logic ...
                // Artist loading is complex with multiple promises. 
                // We should probably rely on `requestUpdate` in the promises to refresh UI, 
                // but we should update cache on final settled or progressively?
                // Let's update cache in each promise resolution.

                const artistPromise = this.api.fetchSpotifyPlus('get_artist', { artist_id: id });
                // ... (definitions) ...
                const albumsPromise = this.api.fetchSpotifyPlus('get_artist_albums', { artist_id: id, limit: 12 });
                const topTracksPromise = (async () => {
                    // ...
                    try {
                        const artistRes = await artistPromise;
                        if (!artistRes?.result?.name) return [];
                        const searchResult = await this.api.fetchSpotifyPlus('search_tracks', {
                            criteria: `artist:"${artistRes.result.name}"`,
                            limit: 12
                        });
                        return searchResult?.result?.items || [];
                    } catch (e) { return []; }
                })();
                const similarArtistsPromise = (async () => {
                    const artistRes = await artistPromise;
                    if (!artistRes?.result?.name) return [];
                    return this._fetchLastFmSimilarArtists(artistRes.result.name);
                })();

                const artistResult = await artistPromise;
                if (artistResult?.result) {
                    this._contextData = { ...this._contextData, ...artistResult.result, isLoading: false };
                    SpotifyContextView.cacheSet(this.pageId, this._contextData);
                    this.requestUpdate();
                }

                albumsPromise.then(res => {
                    if (res?.result?.items) {
                        this._contextData = { ...this._contextData, albums: res.result.items };
                        SpotifyContextView.cacheSet(this.pageId, this._contextData);
                        this.requestUpdate();
                    }
                });

                topTracksPromise.then(tracks => {
                    this._contextData = { ...this._contextData, topTracks: tracks };
                    SpotifyContextView.cacheSet(this.pageId, this._contextData);
                    this.requestUpdate();
                });

                const playlistsPromise = (async () => {
                    try {
                        const artistRes = await artistPromise;
                        if (!artistRes?.result?.name) return [];
                        const res = await this.api.searchPlaylists(artistRes.result.name, 12);
                        return res?.result?.items || [];
                    } catch (e) { return []; }
                })();

                playlistsPromise.then(playlists => {
                    this._contextData = { ...this._contextData, playlists: playlists };
                    SpotifyContextView.cacheSet(this.pageId, this._contextData);
                    this.requestUpdate();
                });

                // ... (similar artists promise) ...
                similarArtistsPromise.then(async (artists) => {
                    // ...
                    if (artists.length > 0) {
                        const hydrated = await this._hydrateSimilarArtists(artists);
                        this._contextData = { ...this._contextData, similarArtists: hydrated };
                    } else {
                        this._contextData = { ...this._contextData, similarArtists: [] };
                    }
                    SpotifyContextView.cacheSet(this.pageId, this._contextData);
                    this.requestUpdate();
                });

            } else if (type === 'album') {
                console.log('[ContextView] Loading Album:', id);
                const response = await this.api.fetchSpotifyPlus('get_album', { album_id: id });
                console.log('[ContextView] Album API Response:', response);
                if (response?.result) {
                    let albumData = response.result;

                    // Check if tracks are missing or empty (API quirk)
                    if (!albumData.tracks || !albumData.tracks.items || albumData.tracks.items.length === 0) {
                        console.log('[ContextView] Album tracks missing, fetching separately...');
                        const tracksRes = await this.api.fetchSpotifyPlus('get_album_tracks', { album_id: id, limit: 50 });
                        if (tracksRes?.result?.items) {
                            console.log('[ContextView] Album tracks fetched:', tracksRes.result);
                            if (!albumData.tracks) albumData.tracks = {};
                            albumData.tracks.items = tracksRes.result.items;
                            albumData.tracks.total = tracksRes.result.total;
                        }
                    }

                    this._contextData = { ...this._contextData, ...albumData, type: 'album', isLoading: false };
                    SpotifyContextView.cacheSet(this.pageId, this._contextData);
                    this.requestUpdate();
                } else {
                    console.error('[ContextView] Album Load Failed:', response);
                }
            } else if (type === 'artist-discography') {
                // ...
                let artistName = this._contextData?.name;
                if (!artistName) {
                    const artistRes = await this.api.fetchSpotifyPlus('get_artist', { artist_id: id });
                    artistName = artistRes?.result?.name || 'Artist';
                }
                const limit = 50;
                const offset = 0;
                const albumsPromise = this.api.fetchSpotifyPlus('get_artist_albums', { artist_id: id, limit: limit, offset: offset });
                const albumsRes = await albumsPromise;
                const items = albumsRes?.result?.items || [];
                const total = albumsRes?.result?.total || 0;

                this._contextData = {
                    id,
                    type: 'artist-discography', // This tells context-list what it IS
                    name: `${artistName} Discography`,
                    items: items,
                    total: total,
                    offset: items.length,
                    hasMore: items.length < total,
                    isLoading: false
                };
                SpotifyContextView.cacheSet(this.pageId, this._contextData);
                this.requestUpdate();
            } else if (type === 'likedsongs') {
                // ...
                this._contextData = {
                    type: 'likedsongs',
                    id: 'me',
                    isLoading: true,
                    name: 'Liked Songs',
                    images: [{ url: 'https://t.scdn.co/images/3099b3803ad9496896c43f22fe9be8c4.png' }],
                    tracks: null
                };
                this.requestUpdate();
                try {
                    const res = await this.api.getTrackFavorites({ limit: 50, offset: 0, sort_result: false });
                    if (res?.result?.items) {
                        this._contextData = {
                            ...this._contextData,
                            tracks: { items: res.result.items, total: res.result.total },
                            total: res.result.total,
                            isLoading: false,
                            uri: 'spotify:user:me:collection'
                        };
                        this.requestUpdate();
                    }
                } catch (e) { }

            } else if (type === 'collection' && id === 'playlists') {
                // ... existing collection logic ...
                this._contextData = {
                    type: 'collection-playlists',
                    id: 'library',
                    isLoading: true,
                    name: 'Your Library',
                    playlists: null
                };
                this.requestUpdate();
                try {
                    const res = await this.api.getCurrentUserPlaylists({ limit: 50 });
                    if (res?.result?.items) {
                        this._contextData = { ...this._contextData, playlists: res.result.items, isLoading: false };
                        this.requestUpdate();
                    }
                } catch (e) { }
            }
        } catch (e) {
            console.error("Failed to load context data", e);
        }
    }

    async _loadSectionData(sectionId, offset, cursor = null) {
        const limit = 50; // Use larger limit for lists?
        let newItems = [];
        let total = null;
        let title = '';
        let nextCursor = null;

        try {
            if (sectionId === 'recent') {
                title = 'Recently Played';
                // Recent tracks API doesn't support standard offset paging well effectively beyond history, 
                // but we can try generic call or just limited history.
                // Actually `get_player_recent_tracks` takes limit (max 50 normally).
                // It doesn't strictly support 'offset' in the same way, it uses 'before'/'after' cursors usually.
                // However, SpotifyPlus might wrap it. 
                // Let's assume for now we can just load the max 50 and that's it for "Recent" as per API limits usually?
                // Or maybe we can't scroll infinitely on recent.
                const res = await this.api.fetchSpotifyPlus('get_player_recent_tracks', { limit: limit });
                // Note: Recent tracks endpoint usually returns history. 
                // If we want "infinite", we might be limited by Spotify API (usually last 50).

                // For this implementation, we will just load max available if offset is 0, else nothing?
                // Let's assume we can only load 50 total for recent.
                if (offset === 0 && res?.result?.items) {
                    // Deduplicate albums logic like Home
                    const seenAlbumIds = new Set();
                    res.result.items.forEach(h => {
                        if (h.track && h.track.album) {
                            if (!seenAlbumIds.has(h.track.album.id)) {
                                seenAlbumIds.add(h.track.album.id);
                                newItems.push({ ...h.track.album, name: h.track.name, artists: h.track.artists, type: 'album', uri: h.track.album.uri });
                            }
                        }
                    });
                    total = newItems.length; // Approximate
                }
            } else if (sectionId === 'favorites') {
                title = 'Your Favorite Playlists';
                const res = await this.api.fetchSpotifyPlus('get_playlist_favorites', { limit, offset });
                if (res?.result?.items) {
                    newItems = res.result.items;
                    total = res.result.total;
                }
            } else if (sectionId === 'albums') {
                title = 'Your Favorite Albums';
                // User requested logic for Albums (Offset based)
                const res = await this.api.fetchSpotifyPlus('get_album_favorites', { limit, offset });
                if (res?.result?.items) {
                    // Saved Album object structure: item.album is the album object
                    newItems = res.result.items.map(i => i.album).filter(Boolean);
                    total = res.result.total;
                    // console.log('[SpotifyContextView] Albums Loaded:', newItems.length, 'Total:', total, 'Offset:', offset);
                }
            } else if (sectionId === 'artists') {
                title = 'Followed Artists';
                // User requested specific logic: limit 15, sort_result false
                const params = { limit: 15, sort_result: false };

                // STRICT CURSOR LOGIC:
                // User requirement: feed the last artist ID received.
                if (cursor) {
                    params.after = cursor;
                }

                // console.log('[SpotifyContextView] Fetching Artists. Params:', params);
                const res = await this.api.fetchSpotifyPlus('get_artists_followed', params);

                if (res?.result) {
                    // Check for flattened structure first
                    if (res.result.items) {
                        newItems = res.result.items;
                        total = res.result.total;
                    } else if (res.result.artists && res.result.artists.items) {
                        newItems = res.result.artists.items;
                        total = res.result.artists.total;
                    }

                    // Logic: Cursor is strictly the ID of the last item
                    if (newItems.length > 0) {
                        nextCursor = newItems[newItems.length - 1].id;
                        // console.log('[SpotifyContextView] Artist Cursor (Last ID):', nextCursor);
                    }
                }
            } else if (sectionId === 'madeforyou') {
                title = 'Made For You';
                if (offset === 0) {
                    newItems = await loadMadeForYouItems(this.api, this.config);
                    total = newItems.length;
                }
            } else if (sectionId === 'new_releases') {
                title = 'New Album Releases';
                const res = await this.api.fetchSpotifyPlus('get_album_new_releases', { limit, offset });
                if (res?.result) {
                    // Check for nested albums object (standard Spotify API structure)
                    const albumsData = res.result.albums || res.result;
                    if (albumsData.items) {
                        newItems = albumsData.items;
                        total = albumsData.total;
                    }
                }
            }

            // Update State
            const currentItems = (offset === 0) ? [] : (this._contextData.items || []);

            // Deduplicate logic
            const currentIds = new Set(currentItems.map(i => i.id));
            const distinctNewItems = newItems.filter(i => !currentIds.has(i.id));
            const allItems = [...currentItems, ...distinctNewItems];

            // console.log('[SpotifyContextView] Update State - New Items (Raw):', newItems.length, 'Distinct:', distinctNewItems.length, 'Total Items:', allItems.length, 'Next Cursor:', nextCursor);

            // STOP CONDITIONS
            const reachedTotal = (total !== null && allItems.length >= total);
            // If we got items but they were all dupes, we're likely looping.
            const isLooping = (newItems.length > 0 && distinctNewItems.length === 0);

            // Should we look for more?
            let shouldLoadMore = false;

            if (reachedTotal || isLooping) {
                shouldLoadMore = false;
            } else {
                if (sectionId === 'artists') {
                    // Artist Logic: Use Next Cursor Presence + fetched count
                    // valid cursor + we actually got some items (limit reached or not? API can return fewer)
                    shouldLoadMore = (nextCursor !== null && newItems.length > 0);
                } else {
                    // Standard Offset Logic (Playlists/Albums)
                    // If total is known, we are not done. If total unknown, check if we got full page.
                    shouldLoadMore = (total === null && newItems.length >= limit) || (total !== null && allItems.length < total);
                }
            }

            this._contextData = {
                ...this._contextData,
                isLoading: false,
                name: title,
                items: allItems,
                offset: offset + newItems.length,
                total: total,
                hasMore: shouldLoadMore,
                _lastFetchCount: newItems.length,
                // Only keep cursor if we actually have more to load
                nextCursor: shouldLoadMore ? nextCursor : null
            };

            SpotifyContextView.cacheSet(this.pageId, this._contextData);
            this.requestUpdate();

        } catch (e) {
            console.error('Error loading section data:', e);
            this._contextData = { ...this._contextData, isLoading: false, hasMore: false };
            this.requestUpdate();
        }
    }

    async _loadSectionMore() {
        if (!this._contextData || this._contextData.isLoading || !this._contextData.hasMore) return;

        // simple debounce or lock
        this._contextData = { ...this._contextData, isLoading: true };
        this.requestUpdate();

        await this._loadSectionData(this._contextData.id, this._contextData.offset, this._contextData.nextCursor);
    }



    // renderTableRow moved to spotify-section-view.js
    async _fetchLastFmSimilarArtists(artistName) {
        // Access Last.fm key from config
        const apiKey = this.config?.external_providers?.lastfm?.api_key;
        if (!apiKey || !artistName) return [];

        try {
            const encodedArtist = encodeURIComponent(artistName);
            const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodedArtist}&api_key=${apiKey}&format=json&limit=10`;

            const response = await fetch(url);
            if (!response.ok) return [];

            const data = await response.json();
            if (data?.similarartists?.artist && Array.isArray(data.similarartists.artist)) {
                return data.similarartists.artist.map(a => ({ name: a.name }));
            }
        } catch (e) {
            console.warn("Last.fm fetch failed:", e);
        }
        return [];
    }

    async _hydrateSimilarArtists(artists) {
        // Take top 6 for "Fans Also Like"
        const targetArtists = artists.slice(0, 6);
        const hydrated = [];

        for (const artist of targetArtists) {
            try {
                // Search matching artist in Spotify to get Image & ID
                const res = await this.api.fetchSpotifyPlus('search_artists', {
                    criteria: artist.name,
                    limit: 1
                });

                if (res?.result?.items?.[0]) {
                    hydrated.push(res.result.items[0]);
                }
            } catch (e) {
                // Skip if search fails
            }
        }
        return hydrated;
    }

    updateHeaderState() {
        // Find the active view in shadowRoot
        const activeView = this.shadowRoot.querySelector('spotify-artist-view') ||
            this.shadowRoot.querySelector('spotify-playlist-view') ||
            this.shadowRoot.querySelector('spotify-context-list') ||
            this.shadowRoot.querySelector('spotify-section-view');

        if (activeView && typeof activeView.updateHeaderState === 'function') {
            activeView.updateHeaderState();
        }
    }

    render() {
        if (!this._contextData) {
            return html`<div class="scroll-content loading"><div class="loading-spinner"></div></div>`;
        }

        const type = this._contextData.type;

        if (type === 'playlist' || type === 'album' || type === 'likedsongs') {
            return html`
                <spotify-playlist-view 
                    .data=${this._contextData} 
                    .api=${this.api} 
                    .hass=${this.hass}
                    .config=${this.config}
                    .pinned=${this.pinned}
                    @load-more=${this._handleLoadMore}
                ></spotify-playlist-view>
            `;
        } else if (type === 'artist') {
            return html`
                <spotify-artist-view 
                    .data=${this._contextData} 
                    .api=${this.api} 
                    .hass=${this.hass}
                    .config=${this.config}
                    .pinned=${this.pinned}
                ></spotify-artist-view>
            `;
        } else if (type === 'section') {
            return html`
                <spotify-section-view
                    .data=${this._contextData}
                    .hass=${this.hass}
                    .api=${this.api}
                    @load-more=${this._loadSectionMore}
                ></spotify-section-view>
            `;
        } else if (type === 'artist-discography') {
            return html`
                <spotify-context-list 
                    .data=${this._contextData} 
                    .type=${'album'}
                    @load-more=${this._handleLoadMore}
                    @back=${(e) => { e.stopPropagation(); this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true })); }}
                    @navigate=${(e) => this.dispatchEvent(new CustomEvent('navigate', { detail: e.detail, bubbles: true, composed: true }))}
                ></spotify-context-list>
            `;
        } else if (type === 'collection-playlists') {
            return html`
                <spotify-context-list 
                    .data=${this._contextData} 
                    .type=${'playlist'}
                    .layout=${'grid'}
                    @load-more=${this._handleLoadMore}
                    @back=${(e) => { e.stopPropagation(); this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true })); }}
                    @navigate=${(e) => this.dispatchEvent(new CustomEvent('navigate', { detail: e.detail, bubbles: true, composed: true }))}
                ></spotify-context-list>
            `;
        }

        // Fallback or explicit other types
        return html`
            <spotify-playlist-view 
                .data=${this._contextData} 
                .api=${this.api} 
                .hass=${this.hass}
            ></spotify-playlist-view>
        `;
    }




}

customElements.define('spotify-context-view', SpotifyContextView);
