
import { LitElement, html } from "../lit.js";
import { sharedStyles } from '../styles/shared-styles.js';
import { contextViewStyles } from '../styles/spotify-context-view.styles.js';
import { loadMadeForYouItems, dedupeRecentAlbums } from './controllers/home-content.js';
import { getPlayingTrackId, getCurrentTrackId, isContextPlaying, playlistSortParams } from '../utils.js';

// Import new sub-views
import './views/spotify-context-list.js';
import './views/spotify-playlist-view.js';
import './views/spotify-artist-view.js';
import './views/spotify-section-view.js';

export class SpotifyContextView extends LitElement {
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

    /*
     * HASS ticks arrive ~1/s while music plays. Children only consume a few
     * narrow values from hass (playing track id, play state, pinned sensor),
     * so derive those here and skip the whole subtree when none of them moved.
     * The raw `hass` object is still forwarded (children keep it as an
     * interaction-time reference and gate their own updates on it).
     */
    shouldUpdate(changedProperties) {
        // Keep the derived snapshot fresh for every render pass.
        const derivedChanged = this._deriveHassState();
        if (changedProperties.size === 1 && changedProperties.has('hass')) {
            // Ignore no-op ticks, but always let the very first hass through
            // (it may be what unblocks loadPageData()).
            if (changedProperties.get('hass') && !derivedChanged) return false;
        }
        return true;
    }

    /**
     * Snapshot the values children actually render from hass. Returns true
     * when any of them changed since the last snapshot.
     */
    _deriveHassState() {
        const entityId = this.api?.entityId || this.config?.entity;
        const playingTrackId = getPlayingTrackId(this.hass, entityId);
        const currentTrackId = getCurrentTrackId(this.hass, entityId);
        const isPlaying = isContextPlaying(this.hass, entityId, this._contextData?.uri);
        const pinnedSensorState = (this.pinned?.sensorEntity && this.hass)
            ? this.hass.states[this.pinned.sensorEntity]
            : undefined;

        const changed = playingTrackId !== this._playingTrackId
            || currentTrackId !== this._currentTrackId
            || isPlaying !== this._isPlaying
            || pinnedSensorState !== this._pinnedSensorState;

        this._playingTrackId = playingTrackId;
        this._currentTrackId = currentTrackId;
        this._isPlaying = isPlaying;
        this._pinnedSensorState = pinnedSensorState;
        return changed;
    }

    constructor() {
        super();
        this._contextData = null;
        this._isFollowing = false;
        this._currentUserId = null;
        // Derived-from-hass snapshot (plain fields; render binds them and
        // shouldUpdate keeps them fresh before every render pass).
        this._playingTrackId = null;
        this._currentTrackId = null;
        this._isPlaying = false;
        this._pinnedSensorState = undefined;
    }

    connectedCallback() {
        super.connectedCallback();
        // loadPageData is called by updated() when properties are set
    }

    updated(changedProperties) {
        if (changedProperties.has('pageId') || changedProperties.has('hass') || changedProperties.has('api')) {
            if (this.pageId && this.hass && this.api) {
                this.loadPageData();
            }
        }
    }

    async _handleLoadMore() {
        if (!this._contextData || this._contextData.isLoading || !this._contextData.hasMore) return;

        const type = this._contextData.type;
        const offset = this._contextData.offset || 0;
        const limit = 50;

        this._contextData = { ...this._contextData, isLoading: true };
        this.requestUpdate();

        try {
            let newItems = [];
            let total = this._contextData.total;

            if (type === 'likedsongs') {
                const res = await this.api.getTrackFavorites({ limit, offset, sort_result: false });
                newItems = res?.result?.items || [];
                total = res?.result?.total || total;

                // Liked Songs renders via spotify-playlist-view, which reads
                // _contextData.tracks.items (not .items). Append there.
                const existing = this._contextData.tracks?.items || [];
                const merged = newItems.length > 0 ? [...existing, ...newItems] : existing;
                this._contextData = {
                    ...this._contextData,
                    tracks: { items: merged, total },
                    total,
                    offset: offset + newItems.length,
                    hasMore: newItems.length > 0 && merged.length < total,
                    isLoading: false
                };
                SpotifyContextView.cacheSet(this.pageId, this._contextData);
                this.requestUpdate();
                return;
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

    /** Drop one page's cached state (call after any mutation of that page). */
    static invalidate(pageId) {
        this.stateCache.delete(pageId);
    }

    /** Drop everything — required on account switch (keys are account-blind). */
    static clearAll() {
        this.stateCache.clear();
    }

    /**
     * Re-sync the current page after a mutation. With a `patch` (cheap edits
     * like name/description) the data is updated in place; without one the
     * cache entry is dropped and the page refetched.
     */
    async refresh(patch = null) {
        if (!this.pageId) return;
        if (patch && this._contextData) {
            this._contextData = { ...this._contextData, ...patch };
            SpotifyContextView.cacheSet(this.pageId, this._contextData);
            this.requestUpdate();
            return;
        }
        SpotifyContextView.invalidate(this.pageId);
        this._playlistPagerToken = null;
        this._contextData = null;
        await this.loadPageData();
    }

    /**
     * Background-page the rest of a playlist's tracks (get_playlist only
     * inlines the first <=100). Appends page-by-page so the list grows while
     * you look at it; `tracksComplete` flips true at the end and gates edit
     * mode (reorder math needs the full list). A token guards against
     * overlapping pagers when the user navigates away and back.
     */
    async _loadRemainingPlaylistTracks(pageId) {
        const token = Symbol('playlist-pager');
        this._playlistPagerToken = token;

        const playlistId = this._contextData?.id;
        if (!playlistId || !this._contextData?.tracks?.items) return;

        const total = this._contextData.tracks.total || 0;
        let offset = this._contextData.tracks.items.length;

        while (offset < total) {
            const page = await this.api.getPlaylistItemsPage(playlistId, offset, 50);
            // Superseded by navigation, refresh() or a newer pager? Stop cold.
            if (this._playlistPagerToken !== token || this.pageId !== pageId) return;
            const current = this._contextData;
            if (!current?.tracks?.items || current.id !== playlistId) return;

            const items = page?.items || [];
            if (items.length === 0) break; // defensive: never spin on a bad page

            const tracks = { ...current.tracks, items: [...current.tracks.items, ...items] };
            offset = tracks.items.length;
            this._contextData = {
                ...current,
                tracks,
                tracksComplete: offset >= (tracks.total || total)
            };
            SpotifyContextView.cacheSet(pageId, this._contextData);
            this.requestUpdate();
        }

        // Total can overstate (deleted/unavailable items); don't leave the
        // flag stuck false when Spotify stops returning pages.
        if (this._playlistPagerToken === token && this.pageId === pageId
            && this._contextData?.id === playlistId && !this._contextData.tracksComplete) {
            this._contextData = { ...this._contextData, tracksComplete: true };
            SpotifyContextView.cacheSet(pageId, this._contextData);
            this.requestUpdate();
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

        // One-shot edit intent from the navigate payload (library row "Edit
        // Playlist"). Consumed here so a later revisit doesn't re-trigger it;
        // the flag rides on _contextData until the playlist view acts on it.
        const autoEdit = type === 'playlist' && !!this.data?.autoEdit;
        if (autoEdit) this.data.autoEdit = false;

        // 0. Prevent re-fetching if data is already loaded for this instance
        if (this._contextData && this._contextData.id === id && this._contextData.type === type && !this._contextData.isLoading) {
            if (autoEdit) { this._contextData = { ...this._contextData, autoEdit: true }; this.requestUpdate(); }
            return;
        }

        // 1. Check Static Cache first (persistence across navigations)
        if (SpotifyContextView.stateCache.has(this.pageId)) {
            this._contextData = SpotifyContextView.stateCache.get(this.pageId);
            if (autoEdit) this._contextData = { ...this._contextData, autoEdit: true };
            this.requestUpdate();
            // A playlist cached mid-page-in (user navigated away) resumes here.
            if (this._contextData?.type === 'playlist' && this._contextData.tracksComplete === false) {
                this._loadRemainingPlaylistTracks(this.pageId);
            }
            return;
        }

        // Initial loading state
        this._contextData = {
            type, id, isLoading: true, name: 'Loading...', items: [], offset: 0, total: null, hasMore: true,
            images: [], tracks: null, albums: null, playlists: null, topTracks: null, similarArtists: null
        };
        this.requestUpdate();

        try {
            if (type === 'section') {
                await this._loadSectionData(id, 0);
            } else if (type === 'playlist') {
                // No `fields` filter: the full object carries owner.id,
                // snapshotId, public/collaborative and a trustworthy
                // tracks.total — all needed for edit support. Only the first
                // page (<=100 tracks) comes inline; the rest pages in below.
                const response = await this.api.fetchSpotifyPlus('get_playlist', { playlist_id: id });
                if (response?.result) {
                    const result = response.result;

                    // Current account id: the response carries it for free.
                    if (!this._currentUserId) {
                        this._currentUserId = response.user_profile?.id
                            || (await this.api.getCurrentUserId())
                            || null;
                    }
                    const isOwner = !!this._currentUserId && result.owner?.id === this._currentUserId;
                    const totalTracks = result.tracks?.total ?? (result.tracks?.items?.length || 0);

                    this._contextData = {
                        ...this._contextData,
                        ...result,
                        type: 'playlist',
                        isLoading: false,
                        isOwner,
                        canEditItems: isOwner,
                        snapshotId: result.snapshotId || result.snapshot_id || null,
                        tracksComplete: (result.tracks?.items?.length || 0) >= totalTracks,
                        ...(autoEdit ? { autoEdit: true } : {})
                    };

                    // Follow state only matters for playlists we don't own
                    // (drives the heart button and collaborative edit rights).
                    if (!isOwner && this._currentUserId && this._contextData.id) {
                        try {
                            const follows = await this.api.checkUserFollowsPlaylist(this._contextData.id, this._currentUserId);
                            if (follows && Array.isArray(follows) && follows.length > 0) this._isFollowing = follows[0];
                        } catch (e) { }
                        this._contextData.canEditItems = !!this._contextData.collaborative && this._isFollowing;
                    }

                    // Update cache
                    SpotifyContextView.cacheSet(this.pageId, this._contextData);
                    this.requestUpdate();

                    if (!this._contextData.tracksComplete) {
                        this._loadRemainingPlaylistTracks(this.pageId);
                    }
                }
            } else if (type === 'artist') {
                // Artist pages load progressively: each promise updates state + cache as it resolves.
                const artistPromise = this.api.fetchSpotifyPlus('get_artist', { artist_id: id });
                const albumsPromise = this.api.fetchSpotifyPlus('get_artist_albums', { artist_id: id, limit: 12 });
                const topTracksPromise = (async () => {
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

                similarArtistsPromise.then(async (artists) => {
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
                const response = await this.api.fetchSpotifyPlus('get_album', { album_id: id });
                if (response?.result) {
                    let albumData = response.result;

                    // Check if tracks are missing or empty (API quirk)
                    if (!albumData.tracks || !albumData.tracks.items || albumData.tracks.items.length === 0) {
                        const tracksRes = await this.api.fetchSpotifyPlus('get_album_tracks', { album_id: id, limit: 50 });
                        if (tracksRes?.result?.items) {
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
                // Artist name comes from the nav payload (this.data), NOT
                // _contextData.name — that was just set to the 'Loading...'
                // placeholder above. Fall back to a fetch if it's missing.
                let artistName = this.data?.name;
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
                    const items = res?.result?.items || [];
                    const total = res?.result?.total ?? items.length;
                    // Use the real user id so the URI matches the playable context
                    // we start from a track row (and the hero "is playing" check).
                    // `me` is not a valid owner in a playable collection URI.
                    const userId = await this.api.getCurrentUserId();
                    this._contextData = {
                        ...this._contextData,
                        tracks: { items, total },
                        total,
                        offset: items.length,
                        hasMore: items.length < total,
                        isLoading: false,
                        uri: userId ? `spotify:user:${userId}:collection` : 'spotify:user:me:collection'
                    };
                    SpotifyContextView.cacheSet(this.pageId, this._contextData);
                } catch (e) {
                    console.error('[ContextView] Liked Songs load failed:', e);
                    this._contextData = { ...this._contextData, isLoading: false, hasMore: false };
                }
                this.requestUpdate();

            } else if (type === 'collection' && id === 'playlists') {
                this._contextData = {
                    type: 'collection-playlists',
                    id: 'library',
                    isLoading: true,
                    name: 'Your Library',
                    items: [], offset: 0, total: null, hasMore: true
                };
                this.requestUpdate();
                try {
                    const res = await this.api.getCurrentUserPlaylists({ limit: 50 });
                    const items = res?.result?.items || [];
                    const total = res?.result?.total ?? items.length;
                    this._contextData = {
                        ...this._contextData,
                        items,
                        total,
                        offset: items.length,
                        hasMore: items.length < total,
                        isLoading: false
                    };
                    SpotifyContextView.cacheSet(this.pageId, this._contextData);
                } catch (e) {
                    console.error('[ContextView] Library load failed:', e);
                    this._contextData = { ...this._contextData, isLoading: false, hasMore: false };
                }
                this.requestUpdate();
            } else {
                // Unknown page type: don't leave the view stuck on "Loading..."
                console.warn('[ContextView] No loader for page type:', type);
                this._contextData = { ...this._contextData, isLoading: false, name: 'Page not found' };
                this.requestUpdate();
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
                // The recent-tracks endpoint is cursor-based and capped (~50 items),
                // so this section loads a single page only.
                const res = await this.api.fetchSpotifyPlus('get_player_recent_tracks', { limit: limit });
                if (offset === 0 && res?.result?.items) {
                    newItems = dedupeRecentAlbums(res.result.items);
                    total = newItems.length;
                }
            } else if (sectionId === 'favorites') {
                title = 'Your Favorite Playlists';
                const res = await this.api.fetchSpotifyPlus('get_playlist_favorites', { limit, offset, ...playlistSortParams() });
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
                    }
                }
            } else if (sectionId === 'madeforyou') {
                title = 'Made For You';
                if (offset === 0) {
                    newItems = await loadMadeForYouItems(this.api, this.config);
                    total = newItems.length;
                }
            }

            // Update State
            const currentItems = (offset === 0) ? [] : (this._contextData.items || []);

            // Deduplicate logic
            const currentIds = new Set(currentItems.map(i => i.id));
            const distinctNewItems = newItems.filter(i => !currentIds.has(i.id));
            const allItems = [...currentItems, ...distinctNewItems];


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
        const apiKey = this.config?.integrations?.lastfm?.api_key;
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
                    .playingTrackId=${this._playingTrackId}
                    .currentTrackId=${this._currentTrackId}
                    .isPlaying=${this._isPlaying}
                    .pinnedSensorState=${this._pinnedSensorState}
                    @load-more=${this._handleLoadMore}
                    @navigate=${(e) => { e.stopPropagation(); this.dispatchEvent(new CustomEvent('navigate', { detail: e.detail, bubbles: true, composed: true })); }}
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
                    .playingTrackId=${this._playingTrackId}
                    .currentTrackId=${this._currentTrackId}
                    .isPlaying=${this._isPlaying}
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
                    @navigate=${(e) => { e.stopPropagation(); this.dispatchEvent(new CustomEvent('navigate', { detail: e.detail, bubbles: true, composed: true })); }}
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
                    @navigate=${(e) => { e.stopPropagation(); this.dispatchEvent(new CustomEvent('navigate', { detail: e.detail, bubbles: true, composed: true })); }}
                ></spotify-context-list>
            `;
        }

        // Fallback or explicit other types
        return html`
            <spotify-playlist-view
                .data=${this._contextData}
                .api=${this.api}
                .hass=${this.hass}
                .playingTrackId=${this._playingTrackId}
                .currentTrackId=${this._currentTrackId}
                .isPlaying=${this._isPlaying}
                .pinnedSensorState=${this._pinnedSensorState}
            ></spotify-playlist-view>
        `;
    }




}

customElements.define('spotify-context-view', SpotifyContextView);
