export class Router extends EventTarget {
    constructor(host, container, config) {
        super();
        this.host = host; // The App component
        this.container = container; // The .page-container element
        this.config = config || {};

        this.history = [];
        this.currentPageId = null;
        this.currentPageData = null;

        this.pageCache = new Map();
        this.maxCacheSize = this.config.cache_size || 10; // Matches ConfigParser default

        // Dependencies needed for page creation
        this.hass = null;
        this.api = null;
        this.pinned = null;
    }

    updateDependencies({ hass, api, config, pinned }) {
        if (hass) {
            this.hass = hass;
            this.pageCache.forEach(page => page.hass = hass);
        }
        if (api) {
            this.api = api;
            this.pageCache.forEach(page => page.api = api);
        }
        if (config) {
            this.config = config;
            this.maxCacheSize = this.config.cache_size || 10;
            this.pageCache.forEach(page => page.config = config);
        }
        if (pinned) {
            this.pinned = pinned;
            this.pageCache.forEach(page => page.pinned = pinned);
        }
    }

    navigateTo(pageId, data = null, direction = 'forward') {
        if (!this.container) return;


        // 1. Manage History
        if (direction === 'forward' && this.currentPageId) {
            this.history.push(this.currentPageId);
        }

        // 2. Get or Create Page
        let newPage = this.pageCache.get(pageId);
        if (!newPage) {
            newPage = this._createPage(pageId, data);
            this._addToCache(pageId, newPage);
        } else {
            // LRU: Move to end (newest)
            this.pageCache.delete(pageId);
            this.pageCache.set(pageId, newPage);
            // If reusing a component, update its data/config just in case
            if (newPage.requestUpdate) newPage.requestUpdate();
            // Update data on existing page if needed (implementation specific)
            if (pageId.startsWith('artist:') || pageId.startsWith('album:') || pageId.startsWith('playlist:')) {
                if (newPage.pageId !== pageId || (data && newPage.data !== data)) {
                    newPage.pageId = pageId;
                    newPage.data = data;
                }
            }
        }

        const oldPageId = this.currentPageId;
        const oldPage = this.pageCache.get(oldPageId);

        // 3. Handle Transitions
        const transitionType = this.config?.animations?.page_transition || 'fade';
        this._executeTransition(newPage, oldPage, transitionType, direction);

        // 4. Update State
        this.currentPageId = pageId;
        this.currentPageData = data;

        // 5. Notify App (for Header/Search updates)
        this.dispatchEvent(new CustomEvent('route-changed', {
            detail: {
                pageId,
                data,
                direction,
                isHeroPage: this.isHeroPage(pageId)
            }
        }));
    }

    goBack() {
        if (this.history.length === 0) return;
        const previousPageId = this.history.pop();
        this.navigateTo(previousPageId, null, 'back');
    }

    resetToHome() {
        if (this.currentPageId === 'home') return;
        this.history = [];
        this.navigateTo('home', null, 'back');
    }

    /**
     * Drop every cached page (removing it from the DOM) so the next navigation
     * builds fresh pages. Used on account switch, where all page data is stale.
     * Lit components clear their own timers via disconnectedCallback on removal.
     */
    clearCache() {
        this.pageCache.forEach(page => {
            if (page.parentNode) page.parentNode.removeChild(page);
        });
        this.pageCache.clear();
        this.history = [];
        this.currentPageId = null;
        this.currentPageData = null;
    }

    _addToCache(id, element) {
        if (this.pageCache.has(id)) return;
        this.pageCache.set(id, element);

        if (this.pageCache.size > this.maxCacheSize) {
            // FIFO/LRU Eviction
            let keyToRemove = this.pageCache.keys().next().value;

            // Protect Home from eviction if possible
            if (keyToRemove === 'home' && this.pageCache.size > 1) {
                const secondKey = Array.from(this.pageCache.keys())[1];
                if (secondKey) keyToRemove = secondKey;
            }

            const elementToRemove = this.pageCache.get(keyToRemove);

            // Critical: Remove from DOM
            if (elementToRemove && elementToRemove.parentNode) {
                elementToRemove.parentNode.removeChild(elementToRemove);
            }

            this.pageCache.delete(keyToRemove);
        }
    }

    _createPage(pageId, data) {
        if (pageId === 'home') {
            const home = document.createElement('spotify-home');
            home.classList.add('page', 'home-page');
            this._injectProps(home);
            home.addEventListener('navigate', (e) => this.navigateTo(e.detail.pageId, e.detail.data));
            return home;
        } else if (pageId === 'search') {
            const search = document.createElement('spotify-search');
            search.classList.add('page', 'search-page');
            this._injectProps(search);
            if (data && data.query) {
                search.search(data.query);
            }
            search.addEventListener('navigate', (e) => this.navigateTo(e.detail.pageId, e.detail.data));
            search.addEventListener('back', () => this.goBack());
            search.addEventListener('open-track-menu', (e) => {
                if (this.host && this.host._handleOpenTrackMenu) {
                    this.host._handleOpenTrackMenu(e);
                }
            });
            return search;
        } else if (pageId === 'library') {
            const lib = document.createElement('spotify-library');
            lib.classList.add('page', 'search-page');
            this._injectProps(lib);
            lib.addEventListener('navigate', (e) => this.navigateTo(e.detail.pageId, e.detail.data));
            return lib;
        } else if (pageId) {
            const contextView = document.createElement('spotify-context-view');
            contextView.classList.add('page', 'has-hero');
            this._injectProps(contextView);
            contextView.pageId = pageId;
            contextView.data = data;

            // Forward track menu events to the host (App)
            contextView.addEventListener('open-track-menu', (e) => {
                if (this.host && this.host._handleOpenTrackMenu) {
                    this.host._handleOpenTrackMenu(e);
                }
            });

            contextView.addEventListener('header-scroll', (e) => {
                this.dispatchEvent(new CustomEvent('header-scroll', { detail: e.detail }));
            });

            contextView.addEventListener('navigate', (e) => this.navigateTo(e.detail.pageId, e.detail.data));
            // In-page back buttons (section views, lists) dispatch 'back'
            contextView.addEventListener('back', () => this.goBack());
            return contextView;
        }

        const div = document.createElement('div');
        div.classList.add('page');
        div.innerHTML = 'Page not found';
        return div;
    }

    _injectProps(element) {
        element.hass = this.hass;
        element.api = this.api;
        element.config = this.config;
        element.pinned = this.pinned; // Inject Pinned Manager
    }

    _executeTransition(newPage, oldPage, type, direction) {
        if (!this.container) return;

        if (type === 'none') {
            if (newPage) newPage.classList.remove('page-hidden');
            if (oldPage && oldPage !== newPage) {
                oldPage.classList.add('page-hidden');
                // Ensure old page is removed if not cached? No, we rely on cache eviction.
            }
            if (!this.container.contains(newPage)) this.container.appendChild(newPage);
            return;
        }

        newPage.classList.remove('page-hidden');

        // Reset previous animation classes
        newPage.classList.remove('slide-in-right', 'slide-out-left', 'slide-in-left', 'slide-out-right', 'fade-in');
        if (oldPage) oldPage.classList.remove('slide-in-right', 'slide-out-left', 'slide-in-left', 'slide-out-right', 'fade-in');

        if (type === 'slide') {
            if (direction === 'forward') {
                if (oldPage) {
                    newPage.classList.add('slide-in-right');
                    oldPage.classList.add('slide-out-left');
                } else {
                    newPage.classList.add('fade-in');
                }
            } else if (direction === 'back') {
                newPage.classList.add('slide-in-left');
                if (oldPage) oldPage.classList.add('slide-out-right');
            } else {
                newPage.classList.add('fade-in');
            }
        } else if (type === 'fade') {
            newPage.classList.add('fade-in');
        }

        if (!this.container.contains(newPage)) {
            this.container.appendChild(newPage);
        }

        if (oldPage && oldPage !== newPage) {
            setTimeout(() => {
                oldPage.classList.remove('slide-out-left', 'slide-out-right');
                oldPage.classList.add('page-hidden');
            }, 300);
        }
    }

    /** Whether the page renders a hero header (transparent app header, hero layout). */
    isHeroPage(pageId) {
        if (!pageId) return false;
        return pageId === 'likedsongs' ||
            pageId.startsWith('artist:') ||
            pageId.startsWith('album:') ||
            pageId.startsWith('playlist:') ||
            pageId.startsWith('artist-discography:');
    }
}
