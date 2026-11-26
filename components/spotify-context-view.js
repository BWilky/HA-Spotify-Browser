
import { LitElement, html } from "../lit.js";
import { sharedStyles } from '../styles/shared-styles.js';
import { contextViewStyles } from '../styles/spotify-context-view.styles.js';
import { pageLoaders, pageInPlaylistTracks, loadMore, loadSectionMore } from './controllers/page-loaders.js';
import { getPlayingTrackId, getCurrentTrackId, isContextPlaying } from '../utils.js';

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

    updated(changedProperties) {
        if (changedProperties.has('pageId') || changedProperties.has('hass') || changedProperties.has('api')) {
            if (this.pageId && this.hass && this.api) {
                this.loadPageData();
            }
        }
    }

    /** `load-more` from the playlist view (Liked Songs) and the discography list. */
    _handleLoadMore() {
        return loadMore(this._loadContext(this.pageId));
    }

    /** `load-more` from the section view. */
    _loadSectionMore() {
        return loadSectionMore(this._loadContext(this.pageId));
    }

    /**
     * The one place page data changes on behalf of a loader: merge `patch`
     * into _contextData (`replace`: make it the data) and write the static
     * cache under `pageId` (`cache: false`: show only). No patch: cache the
     * data as it stands.
     */
    _commit(patch, { replace = false, cache = true, pageId = this.pageId } = {}) {
        if (patch) this._contextData = replace ? patch : { ...this._contextData, ...patch };
        // A failed page is never cached: a late commit after the failure
        // (e.g. an artist rail answering after get_artist failed) must not
        // make the failure what the next visit restores.
        if (cache && !this._contextData?.loadFailed) SpotifyContextView.cacheSet(pageId, this._contextData);
    }

    /**
     * The `ctx` a loader in page-loaders.js works through (see there). A
     * load stays current while this view still shows `pageId`; `isCurrent`
     * narrows that (the playlist pager's token). A newer loadPageData() on
     * the same page does NOT supersede one in flight: both merge into the
     * same data, and whichever lands keeps the page out of its failed state.
     */
    _loadContext(pageId, isCurrent = () => this.pageId === pageId) {
        const host = this;
        return {
            get api() { return host.api; },
            user: {
                get id() { return host._currentUserId; },
                set id(v) { host._currentUserId = v; },
                get isFollowing() { return host._isFollowing; },
                set isFollowing(v) { host._isFollowing = v; },
            },
            current: () => (isCurrent() ? host._contextData : null),
            commit: (patch, options) => {
                if (!isCurrent()) return false;
                host._commit(patch, { ...options, pageId });
                return true;
            },
            claimPager: () => host._pagerContext(pageId),
        };
    }

    /**
     * Context for the playlist background pager. A token guards against
     * overlapping pagers when the user navigates away and back: the newest
     * pager wins, and refresh() clears the token so the old one stops.
     */
    _pagerContext(pageId) {
        const token = Symbol('playlist-pager');
        this._playlistPagerToken = token;
        return this._loadContext(pageId, () => this._playlistPagerToken === token && this.pageId === pageId);
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
            this._commit(patch);
            return;
        }
        SpotifyContextView.invalidate(this.pageId);
        this._playlistPagerToken = null;
        this._contextData = null;
        await this.loadPageData();
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
            if (autoEdit) { this._contextData = { ...this._contextData, autoEdit: true }; }
            return;
        }

        // 1. Check Static Cache first (persistence across navigations)
        if (SpotifyContextView.stateCache.has(this.pageId)) {
            this._contextData = SpotifyContextView.stateCache.get(this.pageId);
            if (autoEdit) this._contextData = { ...this._contextData, autoEdit: true };
            this.requestUpdate();
            // A playlist cached mid-page-in (user navigated away) resumes here.
            if (this._contextData?.type === 'playlist' && this._contextData.tracksComplete === false) {
                pageInPlaylistTracks(this._pagerContext(this.pageId));
            }
            return;
        }

        // Initial loading state
        const placeholder = this._contextData = {
            type, id, isLoading: true, name: 'Loading...', items: [], offset: 0, total: null, hasMore: true,
            images: [], tracks: null, albums: null, playlists: null, topTracks: null, similarArtists: null
        };

        const host = this;
        const ctx = Object.assign(this._loadContext(this.pageId), {
            type, id,
            options: {
                autoEdit,
                artistName: this.data?.name,
                get lastFmApiKey() { return host.config?.integrations?.lastfm?.api_key; },
            },
        });
        let background;
        try {
            if (Object.prototype.hasOwnProperty.call(pageLoaders, type)) {
                background = await pageLoaders[type](ctx);
            } else {
                // Unknown page type: don't leave the view stuck on "Loading..."
                console.warn('[ContextView] No loader for page type:', type);
                this._contextData = { ...this._contextData, isLoading: false, name: 'Page not found' };
            }
        } catch (e) {
            console.error("Failed to load context data", e);
        }

        // Every successful loader replaces the placeholder. If it is still
        // here, the read failed (a failed call returns null): say so instead
        // of sitting on "Loading..." — which also re-ran this load on every
        // player change. Not cached; refresh() or returning to the page
        // (updateHeaderState) retries.
        if (this._contextData === placeholder) {
            this._contextData = {
                ...placeholder, isLoading: false, hasMore: false, loadFailed: true,
                name: "Couldn't load this page"
            };
        }

        // Commits that may land at any moment start only now (see page-loaders.js).
        if (typeof background === 'function') background();
    }

    updateHeaderState() {
        // Shown again after a failed load: try once more.
        if (this._contextData?.loadFailed) {
            this.refresh();
            return;
        }

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
                    .config=${this.config}
                    .pinned=${this.pinned}
                    .playingTrackId=${this._playingTrackId}
                    .currentTrackId=${this._currentTrackId}
                    .isPlaying=${this._isPlaying}
                    .pinnedSensorState=${this._pinnedSensorState}
                    @load-more=${this._handleLoadMore}
                ></spotify-playlist-view>
            `;
        } else if (type === 'artist') {
            return html`
                <spotify-artist-view
                    .data=${this._contextData}
                    .api=${this.api}
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
                ></spotify-context-list>
            `;
        }

        // Fallback or explicit other types
        return html`
            <spotify-playlist-view
                .data=${this._contextData}
                .api=${this.api}
                .playingTrackId=${this._playingTrackId}
                .currentTrackId=${this._currentTrackId}
                .isPlaying=${this._isPlaying}
                .pinnedSensorState=${this._pinnedSensorState}
            ></spotify-playlist-view>
        `;
    }




}

customElements.define('spotify-context-view', SpotifyContextView);
