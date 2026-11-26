
import { LitElement, html } from "../lit.js";
import { sharedStyles } from '../styles/shared-styles.js';
import { contextViewStyles } from '../styles/spotify-context-view.styles.js';
import { pageLoaders, pageInPlaylistTracks, loadMore, loadSectionMore, LOAD_FAILED, isCacheable } from './controllers/page-loaders.js';
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
        // The account's user id, kept for the loaders (ctx.user). Plain:
        // nothing renders from it.
        this._currentUserId = null;
        // Bumped by refresh(): a load started before it is superseded.
        this._loadGeneration = 0;
        // The load in flight, if any: { generation, options, promise }.
        this._pendingLoad = null;
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
        if (!cache) return;
        // A failed page, or one with a failed rail, is never cached: a late
        // commit after the failure (e.g. an artist rail answering after
        // get_artist failed) must not make the failure what the next visit
        // restores, and an entry cached before it (the artist, before its
        // albums rail failed) is dropped, so the next visit reads it again.
        if (isCacheable(this._contextData)) SpotifyContextView.cacheSet(pageId, this._contextData);
        else SpotifyContextView.invalidate(pageId);
    }

    /**
     * The `ctx` a loader in page-loaders.js works through (see there). A
     * load stays current while this view still shows `pageId` and no
     * refresh() has thrown its data away since it started; `isCurrent`
     * replaces that test (the playlist pager's token). A later loadPageData()
     * on the same page starts no second load beside one in flight (see
     * there). A refresh() supersedes the one in flight: landing on the
     * refreshed page, it would merge into its loading placeholder (and could
     * keep it from showing a failure).
     */
    _loadContext(pageId, isCurrent = null) {
        const host = this;
        const generation = this._loadGeneration;
        const current = isCurrent || (() => host.pageId === pageId && host._loadGeneration === generation);
        return {
            get api() { return host.api; },
            user: {
                get id() { return host._currentUserId; },
                set id(v) { host._currentUserId = v; },
            },
            current: () => (current() ? host._contextData : null),
            commit: (patch, options) => {
                if (!current()) return false;
                host._commit(patch, { ...options, pageId });
                return true;
            },
            claimPager: () => host._pagerContext(pageId),
        };
    }

    /**
     * Context for the playlist background pager. One pager per page id, across
     * every view instance (SpotifyContextView.pagerTokens): the newest claim
     * wins, so a page revisited mid-page-in, or rebuilt by the router while
     * the instance it evicted is still paging, pages it once. refresh() and
     * clearAll() stop it too.
     */
    _pagerContext(pageId) {
        const token = Symbol('playlist-pager');
        SpotifyContextView.pagerTokens.set(pageId, token);
        return this._loadContext(pageId, () => SpotifyContextView.pagerTokens.get(pageId) === token && this.pageId === pageId);
    }

    // Static cache for persistence across navigations (LRU, capped)
    static stateCache = new Map();
    static MAX_CACHE_ENTRIES = 30;

    // The token of the playlist pager running for each page id (see _pagerContext).
    static pagerTokens = new Map();

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

    /**
     * Drop everything — required on account switch (keys are account-blind).
     * Running pagers stop too: they would put the previous account's pages
     * back into the cache.
     */
    static clearAll() {
        this.stateCache.clear();
        this.pagerTokens.clear();
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
        SpotifyContextView.pagerTokens.delete(this.pageId);
        this._loadGeneration++;
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

        // 0. Nothing to start while this page's data is on its way or here.
        // updated() calls this on every relevant hass change, also while a
        // load is in flight (its placeholder, or the Liked Songs shell, says
        // isLoading) or a load more is (isLoading on loaded data): a load
        // started then would read the whole page again beside the one under
        // way. refresh() starts a new generation and empties the data, so it
        // does load; a failed page is retried that way (updateHeaderState).
        // isLoading data with no load in flight is a load more: every load
        // replaces its placeholder before it ends (see _runLoader).
        const pending = this._pendingLoad;
        if (pending && pending.generation === this._loadGeneration) {
            if (autoEdit) {
                // Still on the placeholder: the loader's first commit carries
                // the intent (merged in here, the placeholder would no longer
                // be the one the failure check below looks for).
                if (this._contextData?.isLoading) pending.options.autoEdit = true;
                else this._contextData = { ...this._contextData, autoEdit: true };
            }
            return pending.promise;
        }
        if (this._contextData && this._contextData.id === id && this._contextData.type === type) {
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
        const load = this._pendingLoad = { generation: this._loadGeneration, options: ctx.options, promise: null };
        load.promise = this._runLoader(type, ctx, placeholder).finally(() => {
            if (this._pendingLoad === load) this._pendingLoad = null;
        });
        return load.promise;
    }

    /**
     * Run the page type's loader on `ctx`, then judge the load (see
     * page-loaders.js): a placeholder nobody replaced becomes LOAD_FAILED.
     */
    async _runLoader(type, ctx, placeholder) {
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
        // of sitting on "Loading..." (which loadPageData would take for a
        // load more under way). Not cached; refresh() or returning to the
        // page (updateHeaderState) retries.
        if (this._contextData === placeholder) {
            this._contextData = { ...placeholder, ...LOAD_FAILED };
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
