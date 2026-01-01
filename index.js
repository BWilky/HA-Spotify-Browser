import { CARD_CSS } from './styles.js';
import { SpotifyApi } from './api.js';
import { fetchLastFmSimilarArtists, fetchLastFmTrackRadio } from './external_providers.js';
import { Templates } from './templates.js';
import { msToTime, fireHaptic } from './utils.js'; 

class SpotifyBrowserCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    
    // --- Core State ---
    this._isOpen = false;
    this._hass = null;
    this._config = {};
    this._userCountry = 'US'; 
    this._currentUserId = null; 
    this._api = null; // API Module Instance
    
    // --- FIX: ONE SINGLE BOUND FUNCTION & DEBOUNCE FLAG ---
    this._boundHashCheck = this._checkHash.bind(this);
    this._hashCheckPending = false; // New flag to prevent load spam

    // --- Playback State ---
    this._currentTrackUri = null;
    this._currentContextUri = null;
    this._isPlaying = false;
    this._lastOptimisticUpdate = 0; 
    this._lastTrackData = null; 
    this._queueLockTime = 0;    
    
    // --- Connection Tracking ---
    this._subscribedConnection = null;

    // --- Timers ---
    this._scanTimer = null;        
    this._progressTimer = null;    
    this._timer = null;            
    this._closeTimer = null;       
    this._searchDebounceTimer = null;
    this._searchAutoCloseTimer = null; 

    // --- Navigation & Caching ---
    this._history = []; 
    this._pageCache = new Map(); 
    this._maxCacheSize = 15;
    this._currentPageId = null;
    this._homeLastUpdated = 0;
    this._favCache = new Map(); 

    // --- Pagination State ---
    this._offsets = { favorites: 0, artists: 0, albums: 0, recent: 0, madeforyou: 0 };
    this._totals = { favorites: null, artists: null, albums: null, recent: null };
    this._fetching = { favorites: false, artists: false, albums: false, recent: false, madeforyou: false };
    this._followingPlaylistIds = new Set(); 
    
    // --- Search Pagination ---
    this._searchOffset = 0;
    this._searchTotal = null;
    this._isFetchingSearch = false;
    
    // --- Context / Liked Songs Pagination ---
    this._contextOffset = 0;
    this._contextTotal = null;
    this._contextType = null; 
    this._isFetchingContext = false;

    // --- Swipe / Touch Logic ---
    this._touchStartY = 0;
    this._touchCurrentY = 0;
    this._touchStartX = 0;
    this._touchCurrentX = 0;
    this._touchStartTime = 0; 
    
    
    // --- Event Bindings ---
    this._boundResetTimer = this._resetTimer.bind(this);
    // Note: _boundHashCheck is handled above
    this._boundCloseBrowser = this._closeBrowser.bind(this);
    this._boundBackdropClick = this._onBackdropClick.bind(this);
    this._boundGoBack = this._goBack.bind(this);
    this._boundGoHome = this._resetToHome.bind(this);
    this._boundToggleSearch = this._toggleSearch.bind(this);
    this._boundSearchInput = this._handleSearchInput.bind(this);
    this._boundGlobalClick = this._onGlobalClick.bind(this);
    this._boundCarouselScroll = this._onCarouselScroll.bind(this);
    this._boundPageScroll = this._onPageScroll.bind(this);
    this._boundSearchKeydown = this._handleSearchKeydown.bind(this);
    this._boundToggleMenu = this._toggleMenu.bind(this);
    this._boundDisconnect = this._onDisconnect.bind(this);
    
    this._showVolumeView = false;
    this._lastQueueSignature = null; 
  }
  


  setConfig(config) {
    // --- 0. Performance Mode ---
    this._performanceMode = config.performance_mode === true;

    // --- 1. Parse Accounts ---
    let accounts = [];
    if (Array.isArray(config.spotify_accounts)) {
        accounts = config.spotify_accounts.map(acc => ({
            entity: acc.entity,
            name: acc.name,
            hash: acc.hash ? (acc.hash.startsWith('#') ? acc.hash : `#${acc.hash}`) : null,
            isDefault: acc.default === true
        }));
    }

    const startupEntity = accounts.find(a => a.isDefault)?.entity || 
                          accounts[0]?.entity || 
                          config.entity || 
                          config.entity_id;

    if (!startupEntity) {
        throw new Error("SpotifyBrowser: No entity found. Configure 'spotify_accounts' or a root 'entity'.");
    }

    // --- 2. Homescreen Config ---
    let homescreenConfig = { cache: true, expiry: 60 };
    if (Array.isArray(config.homescreen)) {
        config.homescreen.forEach(item => {
            if (item.cache !== undefined) homescreenConfig.cache = item.cache;
            if (item.expiry !== undefined) homescreenConfig.expiry = item.expiry;
        });
    } else if (typeof config.homescreen === 'object') {
        homescreenConfig = { ...homescreenConfig, ...config.homescreen };
    }

    // --- 3. Device Config (FIXED FOR YOUR YAML) ---
    let devicePlayback = { hide: [], show: [] };
    let foundDefaultDevice = null; // New variable to capture your specific config style

    if (Array.isArray(config.device_playback)) {
        config.device_playback.forEach(entry => {
            // Existing Logic
            if (entry.hide) devicePlayback.hide = devicePlayback.hide.concat(entry.hide);
            if (entry.show) devicePlayback.show = devicePlayback.show.concat(entry.show);
            
            // NEW: Capture the 'default' key from inside the list
            if (entry.default) foundDefaultDevice = entry.default; 
        });
    }

    // --- 4. Queue Config ---
    let queueSettings = { 
        enabled: false, 
        openInit: false, 
        components: { shuffle: false, previous: true, next: true, like: true, volume: true, device: true } 
    };

    if (config.queue_miniplayer === true) queueSettings.enabled = true;

    if (Array.isArray(config.queue)) {
        const desktopEntry = config.queue.find(item => item.desktop);
        if (desktopEntry && Array.isArray(desktopEntry.desktop)) {
            desktopEntry.desktop.forEach(item => {
                if (item.open_init !== undefined) queueSettings.openInit = item.open_init === true;
                if (item.miniplayer !== undefined) {
                    const miniConfig = item.miniplayer;
                    if (miniConfig === true) {
                        queueSettings.enabled = true;
                    } else if (typeof miniConfig === 'object') {
                        queueSettings.enabled = true;
                        const applyOverrides = (source) => {
                            if (source.shuffle !== undefined) queueSettings.components.shuffle = source.shuffle;
                            if (source.previous !== undefined) queueSettings.components.previous = source.previous;
                            if (source.next !== undefined) queueSettings.components.next = source.next;
                            if (source.like !== undefined) queueSettings.components.like = source.like;
                            if (source.volume !== undefined) queueSettings.components.volume = source.volume;
                            if (source.device !== undefined) queueSettings.components.device = source.device;
                        };
                        if (Array.isArray(miniConfig)) miniConfig.forEach(c => applyOverrides(c));
                        else applyOverrides(miniConfig);
                    }
                }
            });
        }
    }

    // --- 5. Made For You Config ---
    let mfyContent = [];
    let mfyPills = false;
    if (Array.isArray(config.madeforyou)) {
        mfyContent = config.madeforyou;
        if (config.desktop_madeforyou_pills) mfyPills = true;
    } else if (config.madeforyou && typeof config.madeforyou === 'object') {
        mfyPills = config.madeforyou.desktop_pills || false;
        mfyContent = config.madeforyou.items || config.madeforyou.content || [];
    }
    
    // --- 6. ADVANCED & EXTERNAL CONFIG ---
    let advConfig = { 
        similar_artists: { provider: null, limit: 10 },
        radio_track: { enabled: false } 
    };

    if (config.advanced) {
        if (config.advanced.similar_artists) {
            advConfig.similar_artists = { ...advConfig.similar_artists, ...config.advanced.similar_artists };
        }
        if (config.advanced.radio_track) {
            const rt = config.advanced.radio_track;
            if (rt.provider) {
                advConfig.radio_track = {
                    enabled: true,
                    provider: rt.provider,
                    limit: rt.limit !== undefined ? rt.limit : 30,
                    dontstopthemusic: rt.dontstopthemusic !== undefined ? rt.dontstopthemusic : true
                };
            }
        }
    }

    let extProviders = config.external_providers || {};

    // --- FINAL CONFIG OBJECT ---
    this._config = {
      auto_close_seconds: 0, 
      scan_interval: null,
      close_on_disconnect: config.closeondisconnect !== false,
      
      // Merge root config first
      ...config,

      // Apply our logic overrides
      entity: startupEntity, 
      default_entity: startupEntity,
      spotify_accounts: accounts,
      
      // CRITICAL FIX: Use the default found in the list, OR fall back to root config
      default_device: foundDefaultDevice || config.default_device || null,

      advanced: advConfig,
      external_providers: extProviders,
      homescreen: homescreenConfig, 
      device_playback: devicePlayback,
      queue_settings: queueSettings, 
      madeforyou_content: mfyContent, 
      madeforyou_pills: mfyPills
    };
    
    this._api = new SpotifyApi(null, this._config.entity, this._config.default_device);

    if (this.shadowRoot.getElementById('browser-wrapper')) {
        this.render();
    }
  }
  
  
  
      
  set hass(hass) {
    this._hass = hass;
    if (this._api) this._api.updateHass(hass);

    // --- RENDER CHECK REMOVED (Handled in connectedCallback) --- 
    // This makes the card feel faster because it doesn't wait for data to render.

    // --- 1. Connection Monitor ---
    if (this._config.close_on_disconnect && hass.connection) {
        if (this._subscribedConnection !== hass.connection) {
            if (this._subscribedConnection) {
                this._subscribedConnection.removeEventListener('disconnect', this._boundDisconnect);
            }
            hass.connection.addEventListener('disconnect', this._boundDisconnect);
            this._subscribedConnection = hass.connection;
        }
    }

    // --- 2. Edit Mode Detection ---
    try {
        const isPreview = this.closest('hui-card-preview') !== null;
        let isDashboardEdit = false;
        const main = document.querySelector("home-assistant")?.shadowRoot?.querySelector("home-assistant-main")?.shadowRoot;
        if (main) {
             const lovelace = main.querySelector("ha-panel-lovelace");
             if (lovelace && lovelace.lovelace && lovelace.lovelace.editMode) {
                 isDashboardEdit = true;
             }
        }
        if (isPreview || isDashboardEdit) {
            this.classList.add('edit-mode');
        } else {
            this.classList.remove('edit-mode');
        }
    } catch (e) { }
    
    // --- 3. State & Playback Updates ---
    if (this._config.entity && this._hass.states[this._config.entity]) {
        
        const stateObj = this._hass.states[this._config.entity];
        const attrs = stateObj.attributes;
        
        const newTrackUri = attrs.media_content_id || null;
        const newContextUri = attrs.sp_context_uri || null; 
        const isPlaying = stateObj.state === 'playing';

        // Detect State Changes
        const trackChanged = newTrackUri !== this._currentTrackUri;
        const stateChanged = isPlaying !== this._isPlaying;

        if (trackChanged || newContextUri !== this._currentContextUri || stateChanged) {
            this._currentTrackUri = newTrackUri;
            this._currentContextUri = newContextUri;
            this._isPlaying = isPlaying;
            
            this._updateActiveElement();
            this._updateHeroPlayButton(); 
            
            // Check if Queue is open
            const wrapper = this.shadowRoot.getElementById('browser-wrapper');
            // ... inside set hass ...
            if (wrapper && wrapper.classList.contains('queue-open')) {
                
                const entityData = this._getEntityNowPlaying();
                
                if (entityData) {
                    // Check if the incoming data matches the Stale ID
                    // (Handle both URI and ID formats just to be safe)
                    const incomingId = entityData.uri ? entityData.uri.split(':')[2] : null;
                    const isStale = this._staleTrackId && (
                        (entityData.uri && entityData.uri.endsWith(this._staleTrackId)) ||
                        (incomingId && incomingId === this._staleTrackId)
                    );
                    
                    const isLocked = Date.now() < this._queueLockTime;

                    // 1. BLOCK: If Locked AND Stale -> IGNORE completely.
                    // This stops the "Old Song" from overwriting your "New Song" UI.
                    if (isLocked && isStale) {
                        return; 
                    } 
                    
                    // 2. UNLOCK: If Locked but Data is NEW -> RENDER immediately.
                    // This fixes the "Long Wait". If Spotify updates in 0.5s, we show it instantly.
                    else if (isLocked && !isStale && this._staleTrackId) {
                        this._queueLockTime = 0; // Break the lock
                        this._staleTrackId = null; // Clear the stale ID
                        this._renderNowPlaying(entityData);
                        this._loadQueue();
                    }
                    
                    // 3. NORMAL: Not locked -> Always Render.
                    else if (!isLocked) {
                        this._renderNowPlaying(entityData);
                        this._loadQueue();
                    }
                }
            }
        }
    }

    // --- 4. Lazy Load Home ---
    if (this._hass && this._isOpen && this._currentPageId === 'home') {
        const homePage = this.shadowRoot.getElementById('page-home');
        if (homePage && homePage.dataset.loaded !== "true" && homePage.dataset.loading !== "true") {
            this._loadHomeData(homePage);
        }
    }
  }
  

  connectedCallback() {
      // 1. Resize Observer (Existing)
      try {
          const wrapper = this.shadowRoot.getElementById('browser-wrapper');
          if (this._resizeObserver && wrapper) {
              this._resizeObserver.observe(wrapper);
          }
      } catch (e) {}

      // 2. Ensure HTML exists
      if (!this.shadowRoot.getElementById('browser-wrapper')) {
          this.render();
      }
      
      // 3. CRITICAL FIX: Always re-attach listeners on connect
      // We removed them in disconnectedCallback, so we MUST add them back here.
      // We call this blindly because _attachEventListeners handles duplicates safely 
      // (or we can add a safety check inside _attachEventListeners if strictly needed, 
      // but standard addEventListener ignores duplicates if parameters match exactly).
      
      // To be safe, we remove first to ensure we don't double-bind if the browser behaves oddly
      window.removeEventListener('hashchange', this._boundHashCheck);
      window.removeEventListener('location-changed', this._boundHashCheck);
      
      this._attachEventListeners();

      // 4. Immediate Hash Check
      this._checkHash();
  }

  disconnectedCallback() {
      // 1. Clean up Resize Observer
      if (this._resizeObserver) {
          this._resizeObserver.disconnect();
      }

      // 2. Clean up Global Listeners (Fixes the Zombie bug)
      // Using the exact same reference created in constructor
      window.removeEventListener('hashchange', this._boundHashCheck);
      window.removeEventListener('location-changed', this._boundHashCheck);
      
      // 3. Stop Timers
      this._stopScanTimer();
      if (this._progressTimer) clearInterval(this._progressTimer);
      if (this._timer) clearTimeout(this._timer);
  }
  
  
  _onDisconnect() {
      // Only act if the popup is actually open
      if (this._isOpen) {
          console.log("[SpotifyBrowser] Connection lost. Closing popup.");
          this._closeBrowser();
          
          // Optional: Show a toast so you know why it closed
          this._showToast("Connection lost");
      }
  }
  
  render() {
      // 1. Inject CSS & Template
      this.shadowRoot.innerHTML = `
          <style>${CARD_CSS}</style>
          ${Templates.mainStructure()}
      `;

      // 2. Apply Performance Mode
      if (this._performanceMode) {
          const wrapper = this.shadowRoot.getElementById('browser-wrapper');
          if (wrapper) wrapper.classList.add('perf-mode');
      }

      // 3. Initialize Listeners
      this._attachEventListeners();
      
      // 4. Load Home (Now Safe)
      // We attempt to pass the element, but _loadHomeData handles it if we fail.
      const homePage = this.shadowRoot.getElementById('page-home');
      this._loadHomeData(homePage);
  }
  
  // --- Navigation & State ---

  _navigateTo(pageId, data = null, direction = 'forward') {
    const container = this.shadowRoot.getElementById('page-container');
    if (!container) return;

    // UI Cleanup logic
    if (pageId !== 'search') {
        const searchContainer = this.shadowRoot.getElementById('search-container');
        const searchInput = this.shadowRoot.getElementById('search-input');
        if (searchContainer && searchContainer.classList.contains('active')) {
            searchContainer.classList.remove('active');
            searchInput.value = '';
        }
    }
    const menu = this.shadowRoot.getElementById('dropdown-menu');
    if(menu) menu.classList.remove('visible');

    // Caching Logic
    let newPage = this._pageCache.get(pageId);
    const isCached = !!newPage;

    if (!newPage) {
      newPage = this._createPageDOM(pageId, data);
      this._addToCache(pageId, newPage);
    }

    // History Logic
    if (direction === 'forward' && this._currentPageId) {
       this._history.push(this._currentPageId);
    }

    // --- 4. Animation Setup ---
    const oldPage = this._currentPageId ? this._pageCache.get(this._currentPageId) : null;
    
    newPage.classList.remove('page-hidden');
    
    if (direction === 'forward') {
      // FIX: Only slide if we are actually moving FROM a page.
      // If this is the first load (no oldPage), just fade in.
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

    if (!container.contains(newPage)) container.appendChild(newPage);

    if (oldPage && oldPage !== newPage) {
      setTimeout(() => {
        if (container.contains(oldPage)) {
          container.removeChild(oldPage); 
          oldPage.classList.remove('slide-out-left', 'slide-out-right');
          oldPage.classList.add('page-hidden'); 
        }
      }, 300); 
    }

    // Data Hydration
    this._currentPageId = pageId;
    this._updateHeader(pageId);
    

    // FIX: Reset header transparency immediately based on page type
    // If new page has a hero, alpha = 0 (transparent). If not, alpha = 1 (opaque).
    const hasHero = newPage.classList.contains('has-hero-header');
    this._updateHeaderStyle(hasHero ? 0 : 1);



    if (pageId === 'home') {
        // Priority 1: Home Page (Explicit check prevents falling into _loadPageData)
        if (this._isOpen && !newPage.dataset.loaded) {
            this._loadHomeData(newPage);
        }
    } 
    else if (pageId === 'search') {
        this._loadPageData(pageId, newPage, data);
    } 
    else if (!isCached) {
        this._loadPageData(pageId, newPage, data);
    }
    
    requestAnimationFrame(() => {
        this._updateActiveElement();
        this._updateHeroPlayButton();
    });

    this._currentPageId = pageId;
    
    // FIX: Pass newPage so we can restore the title from the cached DOM
    this._updateHeader(pageId, newPage);
    
    requestAnimationFrame(() => {
        this._updateActiveElement();
        this._updateHeroPlayButton();
    });
  }

  _createPageDOM(pageId, data) {
    const page = document.createElement('div');
    page.classList.add('page');
    page.id = `page-${pageId}`;
    page.addEventListener('scroll', this._boundPageScroll, { passive: true });

    if (pageId === 'home') {
      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      const hasMadeForYou = Array.isArray(this._config.madeforyou) && this._config.madeforyou.length > 0;
      const order = this._config.home_order || ['recent', 'madeforyou', 'favorites', 'artists', 'albums'];

      if (isMobile && Templates.homeMobile) {
          page.innerHTML = Templates.homeMobile(hasMadeForYou, order);
          page.classList.add('mobile-home');
      } else {
          // FIX: Pass the new config option
          page.innerHTML = Templates.homeDesktop(hasMadeForYou, order, this._config.desktop_madeforyou_pills);
      }
    } else if (pageId === 'search') {
      page.innerHTML = Templates.search();
    } else if (pageId.startsWith('search-all:')) {
        const parts = pageId.split(':'); 
        const type = parts[1];
        const query = decodeURIComponent(parts[2]);
        if (Templates.searchResults) {
            page.innerHTML = Templates.searchResults(type, query);
        }
    } else {
      const type = data?.type || 'playlist';
      if (type === 'artist') {
          page.classList.add('has-hero-header');
          page.innerHTML = Templates.artist(data);
      } else {
          page.classList.add('has-hero-header');
          page.innerHTML = Templates.drillDown(data);
      }
    }

    const pageCarousels = page.querySelectorAll('.carousel-layout');
    pageCarousels.forEach(c => {
        c.addEventListener('scroll', this._boundCarouselScroll, { passive: true });
    });

    return page;
  }

  


  
  _goBack() {
    if (this._history.length === 0) return; 
    const previousPageId = this._history.pop();
    this._navigateTo(previousPageId, null, 'back');
  }
  
  _resetToHome() {
    if (this._currentPageId === 'home') return;
    this._history = [];
    this._navigateTo('home', null, 'back');
    
    const searchContainer = this.shadowRoot.getElementById('search-container');
    const searchInput = this.shadowRoot.getElementById('search-input');
    if (searchContainer) searchContainer.classList.remove('active');
    if (searchInput) searchInput.value = '';
  }

  _addToCache(id, element) {
    if (this._pageCache.has(id)) return;
    this._pageCache.set(id, element);
    if (this._pageCache.size > this._maxCacheSize) {
      const firstKey = this._pageCache.keys().next().value;
      if (firstKey !== 'home' && firstKey !== this._currentPageId) {
        this._pageCache.delete(firstKey);
      }
    }
  }

  // --- Data Loading ---

  async _loadHomeData(pageEl) {
      // --- SAFETY CHECK ---
      // If called without arguments, find the element manually
      if (!pageEl) {
          pageEl = this.shadowRoot.getElementById('page-home');
      }
      if (!pageEl) return; // Exit if DOM isn't ready

      if (pageEl.dataset.loading === "true") return;
      
      try {
          if (!this._hass) return;
          pageEl.dataset.loading = "true";
          
          if (!this._currentUserId) this._userCountry = 'US'; 

          this._offsets = { favorites: 0, artists: 0, albums: 0, recent: 0, madeforyou: 0 };
          this._followingPlaylistIds.clear();

          const validSections = ['recent', 'favorites', 'artists', 'albums', 'madeforyou'];
          const order = (this._config.home_order || validSections).filter(k => validSections.includes(k));
          
          const fetchList = order.map(key => {
              if (key === 'madeforyou' && (!this._config.madeforyou || this._config.madeforyou.length === 0)) {
                  return Promise.resolve();
              }
              return this._fetchSectionData(key, pageEl);
          });

          await Promise.allSettled(fetchList);
          
          this._updateActiveElement(); 
          this._homeLastUpdated = Date.now();
          
      } catch (err) {
          console.error("Home Load Error:", err);
      } finally {
          pageEl.dataset.loaded = "true";
          pageEl.dataset.loading = "false";
      }
  }
  
  _refreshCurrentPage() {
      this._showToast("Refreshing data...");
      
      // 1. Refresh Queue if open
      const wrapper = this.shadowRoot.getElementById('browser-wrapper');
      if (wrapper && wrapper.classList.contains('queue-open')) {
          this._loadQueue();
      }

      // 2. Refresh Main View
      const pageId = this._currentPageId;
      const pageEl = this.shadowRoot.getElementById(`page-${pageId}`);
      if (!pageEl) return;

      if (pageId === 'home') {
          // Reset Pagination State so we fetch fresh top-level data
          this._offsets = { favorites: 0, artists: 0, albums: 0, recent: 0 };
          this._totals = { favorites: null, artists: null, albums: null, recent: null };
          this._followingPlaylistIds.clear();
          
          // Clear current content to show skeleton loading state (optional, feels more responsive)
          // pageEl.innerHTML = Templates.homeMobile(); // (Or Desktop depending on screen)
          // actually, simpler to just let _loadHomeData handle the fetch, 
          // but we need to ensure _fetchSectionData knows to overwrite.
          // (It does: if offset is 0, it overwrites innerHTML).
          
          this._loadHomeData(pageEl);
          
      } else if (pageId === 'search') {
          const searchInput = this.shadowRoot.getElementById('search-input');
          if (searchInput && searchInput.value) {
              this._performSearch(pageEl, searchInput.value);
          }
          
      } else {
          // Drilldown (playlist:123, album:456)
          // Extract type from the pageId string "type:id"
          const parts = pageId.split(':');
          if (parts.length > 1) {
              const type = parts[0];
              // Re-load with minimal data object (type is all that's needed to route logic)
              this._loadPageData(pageId, pageEl, { type: type });
          }
      }
  }

  async _fetchSectionData(sectionKey, pageEl) {
      if (this._fetching[sectionKey]) return;
      
      // Only check totals if we aren't forcing a reset (offset 0)
      const offset = this._offsets[sectionKey];
      if (offset > 0 && this._totals[sectionKey] !== null && offset >= this._totals[sectionKey]) return;

      this._fetching[sectionKey] = true;
      const limit = 20;

      try {
          let data = null;
          let type = 'playlist'; 

          // --- MADE FOR YOU ---
          if (sectionKey === 'madeforyou') {
              const configList = this._config.madeforyou;
              if (!Array.isArray(configList) || configList.length === 0) return;
              if (offset > 0) return; // Only load once

              const items = [];

              for (const entry of configList) {
                  // 1. Liked Songs
                  if (entry.likedsongs) {
                      items.push({
                          id: 'me-liked', type: 'likedsongs', name: 'Liked Songs', subtitle: 'Your Favorites',
                          uri: 'spotify:user:me:collection', images: [{ url: 'https://t.scdn.co/images/3099b3803ad9496896c43f22fe9be8c4.png' }] 
                      });
                  } 
                  // 2. Recommended (Manual Cover Fetch)
                  else if (entry.playlists_recommended && Array.isArray(entry.playlists_recommended)) {
                      // Map promises safely so one failure doesn't stop the loop
                      const mfyPromises = entry.playlists_recommended.map(async (mfy) => {
                          try {
                              const res = await this._api.fetchSpotifyPlus('get_playlist_cover_image', { playlist_id: mfy.id });
                              const imgUrl = (res && res.result && res.result.url) ? res.result.url : '';
                              return { 
                                  id: mfy.id, type: 'playlist-recommended', name: mfy.title, 
                                  uri: `spotify:playlist:${mfy.id}`, 
                                  images: [{ url: imgUrl }], 
                                  owner: { display_name: 'Spotify' } 
                              };
                          } catch (e) { return null; }
                      });
                      const results = await Promise.all(mfyPromises);
                      items.push(...results.filter(Boolean));
                  } 
                  // 3. Standard Playlists
                  else if (entry.playlists && Array.isArray(entry.playlists)) {
                      const plPromises = entry.playlists.map(id => this._api.fetchSpotifyPlus('get_playlist', { playlist_id: id }));
                      const results = await Promise.all(plPromises);
                      items.push(...results.filter(res => res && res.result).map(res => res.result));
                  }
                  // 4. Legacy String Support
                  else if (typeof entry === 'string') {
                       try {
                          const res = await this._api.fetchSpotifyPlus('get_playlist', { playlist_id: entry });
                          if (res && res.result) items.push(res.result);
                       } catch(e) {}
                  }
              }
              data = { items: items, total: items.length };
              type = 'playlist'; 
          } 
          
          // --- STANDARD SECTIONS ---
          else if (sectionKey === 'favorites') {
              const res = await this._api.fetchSpotifyPlus('get_playlist_favorites', { limit_total: limit, offset: offset });
              if (res && res.user_profile) { this._userCountry = res.user_profile.country || 'US'; this._currentUserId = res.user_profile.id; }
              data = res?.result; type = 'playlist';
              if (data && data.items) data.items.forEach(p => this._followingPlaylistIds.add(p.id));
          } 
          else if (sectionKey === 'recent') {
              if (offset > 0) return; 
              const res = await this._api.fetchSpotifyPlus('get_player_recent_tracks', { limit: 50 });
              if (res?.result?.items) {
                  const seenAlbumIds = new Set(); const uniqueItems = [];
                  res.result.items.forEach(h => {
                      if (h.track && h.track.album) {
                          if (!seenAlbumIds.has(h.track.album.id)) {
                              seenAlbumIds.add(h.track.album.id);
                              uniqueItems.push({ ...h.track.album, name: h.track.name, artists: h.track.artists, type: 'album', uri: h.track.album.uri });
                          }
                      }
                  });
                  data = { items: uniqueItems, total: uniqueItems.length }; type = 'album';
              }
          } 
          else if (sectionKey === 'artists') {
              if (offset > 0) return; 
              const res = await this._api.fetchSpotifyPlus('get_artists_followed', { limit });
              data = res?.result; if (data && data.artists) data = data.artists; type = 'artist';
          } 
          else if (sectionKey === 'albums') {
              const res = await this._api.fetchSpotifyPlus('get_album_favorites', { limit, offset });
              if (res?.result?.items) { data = { items: res.result.items.map(i => i.album).filter(Boolean), total: res.result.total }; type = 'album'; }
          }

          // --- RENDER LOGIC ---
          const sectionContainer = pageEl.querySelector(`#carousel-${sectionKey}, #grid-${sectionKey}, [data-section="${sectionKey}"]`);
          if (sectionContainer) {
              if (data && Array.isArray(data.items)) {
                  if (data.total !== undefined) this._totals[sectionKey] = data.total;
                  this._offsets[sectionKey] += data.items.length;

                  const isPillGrid = sectionContainer.classList.contains('recent-grid-layout');
                  const html = data.items.map(item => {
                      if (isPillGrid) return Templates.recentPill(item);
                      return Templates.mediaCard(item, item.type || type);
                  }).join('');
                  
                  if (offset === 0) {
                      // SUCCESS: Replace skeletons with content
                      sectionContainer.innerHTML = html.length > 0 ? html : `<div style="padding:20px; opacity:0.5; white-space:nowrap;">No content found.</div>`;
                  } else {
                      sectionContainer.insertAdjacentHTML('beforeend', html);
                  }
                  
                  // Show "See All" button
                  if (data.items.length > 0) {
                      const homeSection = sectionContainer.closest('.home-section');
                      const seeAllBtn = homeSection ? homeSection.querySelector('.see-all-btn') : null;
                      if (seeAllBtn) seeAllBtn.style.display = 'block';
                  }
              } else {
                  // NO DATA: Replace skeletons with message
                  if (offset === 0) {
                      if (sectionKey !== 'madeforyou' || (this._config.madeforyou && this._config.madeforyou.length > 0)) {
                         sectionContainer.innerHTML = `<div style="padding:20px; opacity:0.5; color: #ff5555; font-size:12px;">Unable to load.</div>`;
                      } else {
                         const homeSection = sectionContainer.closest('.home-section');
                         if(homeSection) homeSection.style.display = 'none';
                      }
                  }
              }
          }
      } catch (e) {
          console.error(`Error fetching ${sectionKey}:`, e);
          const sectionContainer = pageEl.querySelector(`#carousel-${sectionKey}, #grid-${sectionKey}, [data-section="${sectionKey}"]`);
          if (sectionContainer && offset === 0) {
              sectionContainer.innerHTML = `<div style="padding:20px; opacity:0.5; color: #ff5555; font-size:12px;">Error loading data.</div>`;
          }
      } finally {
          this._fetching[sectionKey] = false;
      }
  }
  
  async _fetchMoreContextData(pageEl) {
      if (this._isFetchingContext) return;
      if (this._contextTotal !== null && this._contextOffset >= this._contextTotal) return;

      this._isFetchingContext = true;
      console.log(`[SpotifyBrowser] Loading more context... ${this._contextOffset} / ${this._contextTotal}`);
      
      try {
          let newItems = [];
          
          if (this._contextType === 'likedsongs') {
              const res = await this._api.fetchSpotifyPlus('get_track_favorites', { 
                  limit: 50, 
                  offset: this._contextOffset,
                  sort_result: false 
              });
              
              if (res && res.result && res.result.items) {
                  newItems = res.result.items;
              }
          }

          if (newItems.length > 0) {
              this._contextOffset += newItems.length;
              
              // FIX: Determine if we should show art based on the context type
              const showArt = (this._contextType === 'likedsongs');

              const trackList = pageEl.querySelector('.track-list');
              if (trackList) {
                  const html = newItems.map((item, index) => {
                      // Global Index calculation
                      const startIdx = this._contextOffset - newItems.length + 1;
                      const track = item.track || item;
                      if (!track || !track.id) return '';
                      
                      // FIX: Pass 'showArt' (true) as the 3rd argument
                      return Templates.trackRow(track, startIdx + index, showArt);
                  }).join('');
                  
                  trackList.insertAdjacentHTML('beforeend', html);
                  
                  const trackIds = newItems.map(i => (i.track || i).id).filter(Boolean);
                  this._checkFavorites(trackIds, pageEl);
              }
          }
      } catch (e) {
          console.error("Context infinite scroll failed:", e);
      } finally {
          this._isFetchingContext = false;
      }
  }

 _onGlobalClick(e) {
      const target = e.target;

      // -----------------------------------------------------------
      // 1. TRACK CONTEXT MENU
      // -----------------------------------------------------------
      const openBtn = target.closest('.track-action-btn');
      if (openBtn && openBtn.dataset.action === 'menu') {
          e.stopPropagation();
          const rawData = openBtn.dataset.trackData;
          if (rawData) {
              try {
                  const data = JSON.parse(rawData);
                  this._openTrackPopup(data);
              } catch (err) {
                  console.error("[SpotifyBrowser] JSON Parse Error:", err);
              }
          }
          return;
      }
      
      // -----------------------------------------------------------
      // 2. POPUP CLOSING
      // -----------------------------------------------------------
      const popupItem = target.closest('.track-popup-item');
      if (popupItem) {
          e.stopPropagation();
          this._handleTrackPopupAction(popupItem.dataset.action);
          return;
      }

      if (target.classList.contains('device-popup-backdrop') || target.closest('.device-close-btn')) {
          e.stopPropagation();
          this._closeDevicePopup();
          this._closeTrackPopup();
          const acc = this.shadowRoot.getElementById('accounts-popup');
          if (acc) acc.classList.remove('visible');
          return;
      }

      // -----------------------------------------------------------
      // 3. NAVIGATION & HEADER
      // -----------------------------------------------------------
      if (target.closest('#close-btn')) {
          this._closeBrowser();
          return;
      }
      if (target.closest('.spotify-logo') || (target.closest('.header-left') && !target.closest('#back-btn'))) {
          e.stopPropagation();
          this._resetToHome();
          return;
      }
      if (target.closest('#queue-btn') || target.id === 'queue-panel') {
          e.stopPropagation();
          this._toggleQueue();
          return;
      }
      if (target.closest('#menu-btn')) {
          e.stopPropagation();
          this._toggleMenu();
          return;
      }

      const menuItem = target.closest('.menu-item');
      if (menuItem) {
          e.stopPropagation();
          this._toggleMenu(); 
          const action = menuItem.dataset.action;
          if (action === 'menu-device') this._openDeviceMenu();
          else if (action === 'menu-accounts') this._openAccountsMenu();
          else if (action === 'menu-refresh') this._refreshCurrentPage();
          else if (action === 'menu-library') this._showToast('Library view coming soon...');
          return;
      }

      // -----------------------------------------------------------
      // 4. HERO PLAYBACK (Context)
      // -----------------------------------------------------------
      const heroBtn = target.closest('.hero-btn-play, .hero-btn-fav');
      if (heroBtn) {
          e.stopPropagation();
          const action = heroBtn.dataset.action;

          if (action === 'play-context') {
              const uri = heroBtn.dataset.uri;
              
              // Scrape first track for optimistic UI
              let meta = { title: 'Loading...', artist: '', image: '' };
              
              // Grab Art from Hero
              const heroArt = this.shadowRoot.querySelector('.hero-art');
              if (heroArt) {
                  const bg = heroArt.style.backgroundImage;
                  if (bg && bg !== 'none') meta.image = bg.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
              }

              // Grab Text from First Row
              const firstTrack = this.shadowRoot.querySelector('.track-row');
              if (firstTrack) {
                  const tEl = firstTrack.querySelector('.track-name');
                  const aEl = firstTrack.querySelector('.track-artist');
                  if (tEl) meta.title = tEl.innerText;
                  if (aEl) meta.artist = aEl.innerText;
              }

              // Use new helper (Context URI is same as Target URI for Playlists/Albums)
              this._triggerOptimisticPlayback(uri, 'playlist', meta, uri);
          } 
          else if (action === 'pause' || action === 'resume') {
              this._api.togglePlayback(action === 'resume');
          } 
          else if (action === 'toggle-album-fav') {
              this._toggleAlbumFavorite(heroBtn.dataset.id, heroBtn.classList.contains('is-favorite'), heroBtn);
          } 
          else if (action === 'toggle-artist-follow') {
              this._toggleArtistFollow(heroBtn.dataset.id, heroBtn.classList.contains('is-favorite'), heroBtn);
          }
          return;
      }

      // -----------------------------------------------------------
      // 5. MEDIA CARDS (Square Thumbnails)
      // -----------------------------------------------------------
      const playBtn = target.closest('.play-btn-overlay');
      const card = playBtn ? playBtn.closest('.media-card') : null;

      if (playBtn && card) {
          e.stopPropagation();
          const type = card.dataset.type;
          const uri = card.dataset.uri;
          
          if (type === 'likedsongs') {
              this._playMediaSafe(null, 'likedsongs');
              this._showToast("Playing Liked Songs...");
          } else if (type === 'playlist-recommended') {
              this._playMediaSafe(uri, 'playlist');
              this._showToast("Starting Playlist...");
          } else {
              // Scrape Metadata
              const title = card.dataset.title;
              const subtitle = card.dataset.subtitle;
              let imgUrl = '';
              const imgDiv = card.querySelector('.media-image');
              if (imgDiv) {
                   const bg = imgDiv.style.backgroundImage;
                   if (bg) imgUrl = bg.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
              }

              // Use new helper
              this._triggerOptimisticPlayback(uri, type, {
                  title: title,
                  artist: subtitle,
                  image: imgUrl
              }, uri);
          }
          return;
      }

      // -----------------------------------------------------------
      // 6. TRACK ACTIONS (Save / Queue)
      // -----------------------------------------------------------
      const trackActionBtn = target.closest('.track-action-btn');
      if (trackActionBtn) {
          e.stopPropagation();
          const action = trackActionBtn.dataset.action;
          const trackItem = trackActionBtn.closest('.artist-top-track, .track-row');

          if (trackItem) {
              const id = trackItem.dataset.trackId || trackItem.dataset.id;
              const uri = trackItem.dataset.uri;

              if (action === 'save') {
                  this._toggleTrackFavorite(id, trackActionBtn.classList.contains('is-favorite'), trackActionBtn);
              } else if (action === 'queue' && uri && uri !== 'undefined') {
                  this._api.fetchSpotifyPlus('add_player_queue_items', { uris: uri })
                      .then(() => {
                          this._showToast("Added to Queue");
                          // Refresh queue if open
                          const wrapper = this.shadowRoot.getElementById('browser-wrapper');
                          if (wrapper && wrapper.classList.contains('queue-open')) {
                              setTimeout(() => this._loadQueue(), 1000);
                          }
                      })
                      .catch(err => {
                          console.error("Queue Add Failed:", err);
                          this._showToast("Failed to add");
                      });
              }
          }
          return;
      }

      // -----------------------------------------------------------
      // 7. TRACK PLAYBACK (List Rows)
      // -----------------------------------------------------------
      const trackRow = target.closest('.track-row, .artist-top-track');
      if (trackRow) {
           const trackUri = trackRow.dataset.uri;
           
           // Determine Context (Is this inside a playlist/album view?)
           const listContainer = trackRow.closest('.track-list, .artist-track-grid');
           let contextUri = listContainer ? listContainer.dataset.contextUri : null;
           
           if (contextUri === 'spotify:user:me:collection') contextUri = 'spotify:collection:tracks';

           // Scrape Metadata
           const title = trackRow.querySelector('.track-name, .track-title')?.innerText || 'Unknown';
           const artist = trackRow.querySelector('.track-artist, .track-meta')?.innerText.split('•')[0].trim() || '';
           
           let imgUrl = '';
           const rowArt = trackRow.querySelector('.track-art-small, .track-art-left');
           if (rowArt) {
               const bg = rowArt.style.backgroundImage;
               if (bg) imgUrl = bg.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
           } else {
               // Fallback to Hero Art
               const heroArt = this.shadowRoot.querySelector('.hero-art');
               if (heroArt) {
                   const bg = heroArt.style.backgroundImage;
                   if (bg) imgUrl = bg.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
               }
           }

           // Use new helper
           this._triggerOptimisticPlayback(trackUri, 'track', {
               title: title,
               artist: artist,
               image: imgUrl,
               id: trackRow.dataset.trackId || trackRow.dataset.id
           }, contextUri);
           
           return;
      }

      // -----------------------------------------------------------
      // 8. CARD NAVIGATION (Drilldown)
      // -----------------------------------------------------------
      const interactiveCard = target.closest('.interactive');
      if (interactiveCard) {
          if (interactiveCard.dataset.type === 'playlist-recommended') {
              this._showToast("Cannot Expand Playlist");
              return;
          }
          const { id, type, title, subtitle } = interactiveCard.dataset;
          if (id && type) {
              this._navigateTo(`${type}:${id}`, { title, type, subtitle });
          }
          return;
      }

      // -----------------------------------------------------------
      // 9. CLEANUP
      // -----------------------------------------------------------
      const menu = this.shadowRoot.getElementById('dropdown-menu');
      if (menu && menu.classList.contains('visible')) {
          menu.classList.remove('visible');
      }
  }
  

  

  async _loadPageData(pageId, pageEl, data) {
    // 1. Standard Search Results (Main Search Page)
    if (pageId === 'search') {
        if (data && data.query) this._performSearch(pageEl, data.query);
        return;
    }
    
    // 2. Search "View All" Drilldown (Infinite Scroll Page)
    if (pageId.startsWith('search-all:')) {
        const parts = pageId.split(':'); 
        const type = parts[1];
        const query = decodeURIComponent(parts[2]);
        
        // FIX: Force UI updates in the next animation frame to ensure they stick
        requestAnimationFrame(() => {
            // 1. Set Title
            const centerTitle = this.shadowRoot.querySelector('.header-center-title');
            if (centerTitle) {
                const typeCap = type.charAt(0).toUpperCase() + type.slice(1);
                centerTitle.innerText = `All ${type}s for "${query}"`;
                centerTitle.style.opacity = '1';
            }
            // 2. Force Header Opaque
            this._updateHeaderStyle(1);
        });

        this._searchOffset = 0;
        this._searchTotal = null;
        this._isFetchingSearch = false;
        
        this._fetchMoreSearchResults(pageEl, type, query, true);
        return;
    }

    // 3. Standard Context Pages (Playlist/Artist/Album)
    const type = data?.type || 'playlist';
    const id = pageId.split(':')[1]; 
    
    // Safety Check
    if (!id || id === 'undefined') {
        console.warn("SpotifyBrowser: Missing ID for page load:", pageId);
        return;
    }

    if (type === 'playlist') {
      try {
        const response = await this._api.fetchSpotifyPlus('get_playlist', {
          playlist_id: id,
          fields: "description,id,name,images,owner,uri,tracks(items(track(id,name,uri,duration_ms,artists(name),album(images,name))))"
        });
        if (response && response.result) {
            this._updateDrillDownUI(pageEl, response.result, 'playlist');
        }
      } catch (err) { console.error("Failed to load playlist:", err); }
      
    } else if (type === 'artist') {
       this._loadArtistData(pageEl, id, data.title);
       
    } else if (type === 'album') {
       try {
          const response = await this._api.fetchSpotifyPlus('get_album', { album_id: id });
          if (response && response.result) {
              this._updateDrillDownUI(pageEl, response.result, 'album');
          }
       } catch (err) { console.error("Failed to load album:", err); }
       
    } else if (type === 'likedsongs') {
       this._contextType = 'likedsongs';
       
       try {
          // FIX: Use 'limit' (Page Size) instead of 'limit_total' (Bulk)
          // sort_result: false ensures "Date Added" order (Newest First)
          const res = await this._api.fetchSpotifyPlus('get_track_favorites', { 
              limit: 50, 
              offset: 0,
              sort_result: false 
          });
          
          if (res && res.result) {
              this._contextTotal = res.result.total;
              this._contextOffset = res.result.items.length; // Should be 50

              const mockData = {
                  name: 'Liked Songs',
                  description: 'Your Favorite Tracks',
                  images: [{ url: 'https://t.scdn.co/images/3099b3803ad9496896c43f22fe9be8c4.png' }],
                  uri: 'spotify:user:me:collection',
                  id: 'me-liked',
                  tracks: { items: res.result.items } 
              };
              this._updateDrillDownUI(pageEl, mockData, 'playlist');
          }
       } catch (err) { console.error("Failed to load liked songs:", err); }
    
    } else if (type === 'track') { 
       // Handle Track Link -> Redirect to Album View
       try {
          // First, get the track to find out which album it belongs to
          const trackRes = await this._api.fetchSpotifyPlus('get_track', { track_id: id });
          
          if (trackRes && trackRes.result && trackRes.result.album) {
              const albumId = trackRes.result.album.id;
              
              // Then, fetch that full album
              const albumRes = await this._api.fetchSpotifyPlus('get_album', { album_id: albumId });
              
              if (albumRes && albumRes.result) {
                  this._updateDrillDownUI(pageEl, albumRes.result, 'album');
              }
          }
       } catch (err) { console.error("Failed to resolve track album:", err); }
    }
  }
  
  async _fetchMoreSearchResults(pageEl, type, query, isInitial = false) {
      if (this._isFetchingSearch) return;
      // Stop if we have reached the total (and it's not the first load)
      if (!isInitial && this._searchTotal !== null && this._searchOffset >= this._searchTotal) return;
      
      this._isFetchingSearch = true;
      const loader = pageEl.querySelector('#search-loader');
      if (loader) loader.style.opacity = '1';
      
      try {
          // 1. Map the generic type to the specific Service Name
          // based on the API documentation provided
          const serviceMap = {
              'track': 'search_tracks',
              'artist': 'search_artists',
              'album': 'search_albums',
              'playlist': 'search_playlists',
              'show': 'search_shows',
              'episode': 'search_episodes',
              'audiobook': 'search_audiobooks'
          };
          
          const service = serviceMap[type];
          
          if (!service) {
              console.error(`[SpotifyBrowser] Unknown search type: ${type}`);
              return;
          }

          // 2. Call the specific service using limit/offset for pagination
          const res = await this._api.fetchSpotifyPlus(service, {
              criteria: query,
              limit: 50, 
              offset: this._searchOffset
          });
          
          if (res && res.result) {
              // 3. Extract Data
              // The result might be the Page object directly (result.items) 
              // OR nested (result.tracks.items). We check both.
              let data = null;
              
              // Check for direct items (e.g. AlbumPageSimplified)
              if (res.result.items) {
                  data = res.result;
              } else {
                  // Check for nested keys (e.g. result.tracks)
                  const key = Object.keys(res.result).find(k => res.result[k] && res.result[k].items);
                  if (key) data = res.result[key];
              }
              
              if (data && data.items) {
                  this._searchTotal = data.total;
                  this._searchOffset += data.items.length;
                  
                  const grid = pageEl.querySelector('#search-results-grid');
                  
                  // Choose template based on type
                  const html = data.items.map((item, index) => {
                      // 1. Tracks: Use standard Track Row (Click to Play)
                      if (type === 'track') {
                          // Calculate exact index for the track number
                          const globalIndex = this._searchOffset - data.items.length + index + 1;
                          return Templates.trackRow(item, globalIndex);
                      }
                      // 2. Others: Use List Item (Click to Drilldown)
                      return Templates.listItem(item, type);
                  }).join('');
                  
                  if (isInitial) {
                      grid.innerHTML = html;
                  } else {
                      grid.insertAdjacentHTML('beforeend', html);
                  }
              }
          }
      } catch (e) {
          console.error("Search drilldown failed", e);
      } finally {
          this._isFetchingSearch = false;
          if (loader) loader.style.opacity = '0';
      }
  }
  
  _updateDrillDownUI(pageEl, data, type) {
      const heroTitle = pageEl.querySelector('.hero-title');
      const heroSubtitle = pageEl.querySelector('.hero-subtitle');
      const heroArt = pageEl.querySelector('.hero-art');
      const heroBg = pageEl.querySelector('.hero-bg');
      
      if (heroTitle) heroTitle.innerText = data.name || 'Unknown';
      
      // FIX: Set the Sticky Header Title (hidden initially)
      const centerTitle = this.shadowRoot.querySelector('.header-center-title');
      if (centerTitle) centerTitle.innerText = data.name || '';
      
      if (heroSubtitle) {
        if (type === 'playlist') {
            heroSubtitle.innerText = data.description || (data.owner ? `By ${data.owner.display_name}` : '');
        } else if (type === 'album' || type === 'track') {
            const artists = data.artists ? data.artists.map(a => a.name).join(', ') : 'Unknown';
            // Handle release date (some tracks have it on album object)
            const releaseDate = data.release_date || (data.album ? data.album.release_date : '');
            heroSubtitle.innerText = artists + (releaseDate ? ` • ${releaseDate.substring(0,4)}` : '');
        }
      }

      // FIX: Check ALL possible image locations
      let imgUrl = '';
      if (data.image_url) {
          imgUrl = data.image_url; // Flat string (Integration preference)
      } else if (data.images && data.images.length > 0) {
          imgUrl = data.images[0].url; // Standard Playlist/Album
      } else if (data.album && data.album.images && data.album.images.length > 0) {
          imgUrl = data.album.images[0].url; // Standard Track
      }


      if (imgUrl && heroArt) {
        // 1. Set Small Art
        heroArt.style.backgroundImage = `url('${imgUrl}')`;
        heroArt.classList.remove('skeleton-pulse');
        
        // 2. Set Big Background
        if (heroBg) {
           heroBg.style.backgroundImage = `url('${imgUrl}')`;
           heroBg.style.backgroundSize = 'cover';
           heroBg.style.backgroundPosition = 'center 20%';
           // FIX: Lightened brightness (0.4 -> 0.6) so you can see it
           heroBg.style.filter = 'blur(60px) brightness(0.6)';
        }
      }
      
      // Update Hero Buttons
      const actionsContainer = pageEl.querySelector('.hero-actions');
      if (actionsContainer) {
           let html = `
            <button class="hero-btn-play" data-action="play-context" data-uri="${data.uri}">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>`;
            
           if (type === 'album') {
               html += `
               <button class="hero-btn-fav" data-action="toggle-album-fav" data-id="${data.id}">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
               </button>`;
               this._checkAlbumFavorite(data.id, pageEl);
           }
           actionsContainer.innerHTML = html;
           this._updateHeroPlayButton();
      }

      // Inject Tracks
      const trackList = pageEl.querySelector('.track-list');
      let items = [];
      if (data.tracks && data.tracks.items) items = data.tracks.items;
      else if (type === 'track') items = [data]; 

      if (trackList && items.length > 0) {
        if (type !== 'track') trackList.dataset.contextUri = data.uri;

        // FIX: Show Art for Playlists (and Liked Songs), Index for Albums
        const showArt = (type === 'playlist');

        const trackIds = [];
        trackList.innerHTML = items.map((item, index) => {
           const track = item.track || item; 
           if (!track || !track.id) return '';
           trackIds.push(track.id);
           
           // Pass the flag to the template
           return Templates.trackRow(track, index + 1, showArt);
           
        }).join('');
        
        if(trackIds.length > 0) this._checkFavorites(trackIds, pageEl);
      }
  }
  
  _setupSwipeGestures() {
      /*
      const wrapper = this.shadowRoot.getElementById('browser-wrapper');
      const queuePanel = this.shadowRoot.getElementById('queue-panel');
      const queueList = this.shadowRoot.getElementById('queue-list');
      const pageContainer = this.shadowRoot.getElementById('page-container');
      
      if (!wrapper || !queuePanel || !queueList) return;
      
      // 1. Touch/Mouse Start
      queuePanel.addEventListener('touchstart', (e) => {
          if (queueList.scrollTop > 0) return;

          this._touchStartX = e.touches[0].clientX;
          this._touchStartY = e.touches[0].clientY;
          this._touchCurrentX = this._touchStartX;
          this._touchCurrentY = this._touchStartY;
          
          // FIX: Record start time for velocity calculation
          this._touchStartTime = Date.now();
          
          wrapper.classList.add('is-dragging'); 
      }, { passive: true });

      // 2. Touch/Mouse Move
      queuePanel.addEventListener('touchmove', (e) => {
          if (queueList.scrollTop > 0) return;
          
          this._touchCurrentX = e.touches[0].clientX;
          this._touchCurrentY = e.touches[0].clientY;
          
          const deltaX = this._touchCurrentX - this._touchStartX;
          const deltaY = this._touchCurrentY - this._touchStartY;
          
          const isMobile = window.matchMedia('(max-width: 768px)').matches;

          if (isMobile) {
              // Mobile (Vertical)
              if (deltaY > 0) {
                  if (e.cancelable) e.preventDefault();
                  queuePanel.style.transform = `translate3d(0, ${deltaY}px, 0)`;
                  // Fade Blur
                  const opacity = Math.max(0, 1 - (deltaY / 800));
                  queuePanel.style.setProperty('--blur-opacity', opacity);
              }
          } else {
              // Desktop (Horizontal)
              if (deltaX > 0) {
                  if (e.cancelable) e.preventDefault();
                  
                  // Move Panel Right
                  queuePanel.style.transform = `translate3d(${deltaX}px, 0, 0)`;
                  
                  // Expand Main Window
                  const newMargin = Math.max(0, 350 - deltaX);
                  if (pageContainer) pageContainer.style.marginRight = `${newMargin}px`;
              }
          }
      }, { passive: false });

      // 3. Touch/Mouse End
      queuePanel.addEventListener('touchend', (e) => {
          wrapper.classList.remove('is-dragging');
          queuePanel.style.removeProperty('--blur-opacity');
          if (pageContainer) pageContainer.style.marginRight = ''; 
          
          const deltaX = this._touchCurrentX - this._touchStartX;
          const deltaY = this._touchCurrentY - this._touchStartY;
          
          // FIX: Calculate Velocity
          const timeDiff = Date.now() - this._touchStartTime;
          const isMobile = window.matchMedia('(max-width: 768px)').matches;
          
          // A "Flick" is a fast gesture (< 300ms) that moved at least 30px
          const isFlick = timeDiff < 300;
          const flickThreshold = 30; 
          const dragThreshold = 120; // Standard slow drag threshold
          
          let shouldClose = false;

          if (isMobile) {
              // Mobile: Close if dragged far down OR flicked down
              const movedDown = deltaY > 0;
              const enoughDist = deltaY > dragThreshold;
              const enoughFlick = isFlick && deltaY > flickThreshold;
              
              shouldClose = (movedDown && (enoughDist || enoughFlick) && queueList.scrollTop <= 0);
          } else {
              // Desktop: Close if dragged far right OR flicked right
              const movedRight = deltaX > 0;
              const enoughDist = deltaX > dragThreshold;
              const enoughFlick = isFlick && deltaX > flickThreshold;
              
              shouldClose = (movedRight && (enoughDist || enoughFlick));
          }

          if (shouldClose) {
              this._toggleQueue(); // Trigger Close
              // Allow small delay for CSS to catch up before clearing transform
              setTimeout(() => { queuePanel.style.transform = ''; }, 50);
          } else {
              queuePanel.style.transform = ''; // Snap Back to Open
          }
          
          // Reset
          this._touchStartX = 0;
          this._touchStartY = 0;
          this._touchCurrentX = 0;
          this._touchCurrentY = 0;
      });
      
      */
  }

  // --- Attach Listeners ---
  _attachEventListeners() {
    window.addEventListener('hashchange', this._boundHashCheck);
    window.addEventListener('location-changed', this._boundHashCheck);
    
    const closeBtn = this.shadowRoot.getElementById('close-btn');
    const backBtn = this.shadowRoot.getElementById('back-btn');
    const backdrop = this.shadowRoot.getElementById('backdrop');
    const searchBtn = this.shadowRoot.getElementById('search-toggle');
    const searchInput = this.shadowRoot.getElementById('search-input');
    const menuBtn = this.shadowRoot.getElementById('menu-btn');
    const wrapper = this.shadowRoot.getElementById('browser-wrapper');


    if (backdrop) backdrop.addEventListener('click', this._boundBackdropClick);
    if (backBtn) backBtn.addEventListener('click', this._boundGoBack);
    if (searchBtn) searchBtn.addEventListener('click', this._boundToggleSearch);
    if (searchInput) {
        searchInput.addEventListener('input', this._boundSearchInput);
        searchInput.addEventListener('keydown', this._boundSearchKeydown);
    }

    // FIX: Remove the specific listener. 
    // The menu logic is now handled entirely by _onGlobalClick (Event Delegation).
    // if (menuBtn) menuBtn.addEventListener('click', this._boundToggleMenu); <--- DELETED
    
    if (wrapper) wrapper.addEventListener('click', this._boundGlobalClick);
    
    // ADD THIS LINE:
    this._setupSwipeGestures();
    
    const queueList = this.shadowRoot.getElementById('queue-list');
    if (queueList) {
        queueList.addEventListener('click', (e) => this._handleQueueItemClick(e));
    }
  }
  
  _handleQueueItemClick(arg) {
      // 1. Determine if 'arg' is an Event or a DOM Element
      let row;
      let event = null;

      if (arg instanceof Event || (arg.target && arg.stopPropagation)) {
          // It's an Event (Legacy caller, e.g., Now Playing click)
          event = arg;
          event.stopPropagation();
          row = event.target.closest('.queue-item') || event.target.closest('#queue-now-playing');
      } else {
          // It's a DOM Element (New Event Delegation caller)
          row = arg;
      }

      if (!row) return;

      // 2. Extract Data (Safely)
      // Check dataset first, then fall back to attribute if dataset is missing
      const uri = row.dataset?.uri || row.getAttribute('data-uri');
      const realId = row.dataset?.id || row.dataset?.trackId || row.getAttribute('data-id');
      
      // If we clicked the header/now-playing, it might not have a URI on the row itself
      // In that case, we might just be opening the player, so we check.
      if (!uri) return;

      // 3. Scrape Visual Data (for optimistic UI)
      let title = 'Unknown';
      let artist = '';
      let imgUrl = '';

      const titleEl = row.querySelector('.queue-title') || row.querySelector('.title');
      const artistEl = row.querySelector('.queue-artist') || row.querySelector('.subtitle');
      const artEl = row.querySelector('.queue-art') || row.querySelector('.cover');
      
      if (titleEl) title = titleEl.innerText;
      if (artistEl) artist = artistEl.innerText;
      if (artEl) {
          const bg = window.getComputedStyle(artEl).backgroundImage;
          if (bg && bg !== 'none') imgUrl = bg.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
      }

      // 4. Trigger Playback
      this._triggerOptimisticPlayback(uri, 'track', {
          title: title,
          artist: artist,
          image: imgUrl,
          id: realId 
      }, this._currentContextUri); 
      
      // 5. Animate Zipper Removal (Only if it's a list item, not the header)
      if (row.classList.contains('queue-item')) {
          const listEl = this.shadowRoot.getElementById('queue-list');
          if (listEl) {
              const allRows = Array.from(listEl.querySelectorAll('.queue-item'));
              const clickedIndex = allRows.indexOf(row);
              
              if (clickedIndex > -1) {
                  const rowsToRemove = allRows.slice(0, clickedIndex + 1);
                  rowsToRemove.forEach((r, i) => {
                      setTimeout(() => r.classList.add('removing'), i * 30); 
                  });
              }
          }
          // Refresh Queue shortly after
          setTimeout(() => this._loadQueue(), 1200);
      }
  }
  
  _addOptimisticQueueRow(track) {
      const listEl = this.shadowRoot.getElementById('queue-list');
      if (!listEl) return;

      // 1. Remove "Loading..." or Empty State
      const emptyState = listEl.querySelector('.empty-state, .loading-msg');
      if (emptyState || listEl.innerText.includes('Loading') || listEl.innerText.includes('No queue')) {
          listEl.innerHTML = '';
      }

      // 2. Create the Row DOM
      const temp = document.createElement('div');
      temp.innerHTML = Templates.queueRow(track);
      const newRow = temp.firstElementChild;

      if (newRow) {
          // 3. Add Animation Class
          newRow.classList.add('optimistic-fade-in');
          
          // 4. Append to the bottom
          listEl.appendChild(newRow);
          
          // REMOVED: listEl.scrollTop = listEl.scrollHeight; 
          // (Now it silently adds to the bottom without moving your view)
      }
  }
  
  
  // -------------------------------------------------------
  // --- TRACK CONTEXT MENU & RADIO LOGIC ------------------
  // -------------------------------------------------------

 // --- Track Context Menu Logic (Specific) ---

  // --- TRACK POPUP HELPER METHODS ---

  _openTrackPopup(trackData) {
      this._popupTrackData = trackData;
      
      // 1. Determine Image URL
      let imgUrl = trackData.image;

      // --- FALLBACK LOGIC ---
      // If track has no image (common in Album View), grab it from the main header
      if (!imgUrl) {
          const heroArt = this.shadowRoot.querySelector('.hero-art');
          if (heroArt) {
              const bg = heroArt.style.backgroundImage;
              if (bg && bg !== 'none') {
                  // Strip url("...") wrapper to get raw link
                  imgUrl = bg.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
              }
          }
      }
      // ----------------------

      const popup = this.shadowRoot.getElementById('track-context-popup');
      if (popup) {
          const titleEl = this.shadowRoot.getElementById('track-popup-title');
          const artistEl = this.shadowRoot.getElementById('track-popup-artist');
          const artEl = this.shadowRoot.getElementById('track-popup-art');

          if (titleEl) titleEl.innerText = trackData.name || "Options";
          if (artistEl) artistEl.innerText = trackData.artist || "";
          
          if (artEl) {
              if (imgUrl) {
                  artEl.style.backgroundImage = `url('${imgUrl}')`;
                  artEl.style.display = 'block';
              } else {
                  artEl.style.display = 'none'; // Hide grey box if truly no art found
              }
          }

          popup.classList.add('visible');
      } else {
          console.error("Popup #track-context-popup not found");
      }
  }

  _closeTrackPopup() {
      const popup = this.shadowRoot.getElementById('track-context-popup');
      if (popup) popup.classList.remove('visible');
      this._popupTrackData = null;
  }

  _handleTrackPopupAction(action) {
      const track = this._popupTrackData;
      
      // Safety check
      if (!track) {
          this._closeTrackPopup();
          return;
      }

      console.log(`[SpotifyBrowser] Action: ${action} on ${track.name}`);

      if (action === 'tm-play') {
          this._playMediaSafe(track.uri, 'track');
      } 
      else if (action === 'tm-queue') {
          this._api.fetchSpotifyPlus('add_player_queue_items', { uris: track.uri });
          this._showToast("Added to Queue");
      } 
      else if (action === 'tm-radio') {
          // Ensure _startTrackRadio exists in your class!
          this._startTrackRadio(track);
      } 
      else if (action === 'tm-artist') {
          // Navigate to artist logic
          // If your track object has artist_id, use it. 
          // Otherwise, we might need to search or use the name.
          console.log("Navigate to artist:", track.artist);
          this._navigateTo('search-all:artist:' + encodeURIComponent(track.artist));
      }

      this._closeTrackPopup();
  }
  
  async _startTrackRadio(seedTrack) {
      const radioConfig = this._config.advanced?.radio_track;

      if (!radioConfig || !radioConfig.enabled) {
          this._showToast("Radio disabled. Check YAML config.");
          return;
      }

      // 1. SETUP CANCELLATION
      let isCancelled = false;
      const progressDialog = this._showProgressDialog(
          "Starting Radio", 
          "Preparing...", 
          () => {
              isCancelled = true;
              this._showToast("Radio cancelled");
          }
      );

      try {
          // 2. FETCH SIMILAR TRACKS (Provider Phase)
          const providerName = radioConfig.provider === 'openai' ? 'ChatGPT' : 
                               radioConfig.provider === 'gemini' ? 'Gemini' : 'Last.fm';
          
          progressDialog.updateMessage(`Querying ${providerName}...`);

          let similarTracks = [];

          if (radioConfig.provider === 'lastfm') {
              const lastFmKey = this._config.external_providers?.lastfm?.api_key;
              if (!lastFmKey) throw new Error("Missing Last.fm API Key");

              // Sanitize Metadata
              let cleanArtist = seedTrack.artist || "";
              if (seedTrack.artists && seedTrack.artists.length > 0) cleanArtist = seedTrack.artists[0].name;
              else if (cleanArtist.includes(',')) cleanArtist = cleanArtist.split(',')[0].trim();

              let cleanTrack = seedTrack.name
                  .replace(/\s*\(.*?\)\s*/g, '') // Remove (...)
                  .replace(/\s*\[.*?\]\s*/g, '') // Remove [...]
                  .replace(/\s*-\s*.*$/, '')     // Remove " - ..." suffixes
                  .trim();

              if (isCancelled) return;
              similarTracks = await fetchLastFmTrackRadio(cleanArtist, cleanTrack, lastFmKey, radioConfig.limit);
          } 
          // (Add 'else if' here for openai/gemini later if implemented)

          if (isCancelled) return;

          if (!similarTracks || similarTracks.length === 0) {
              throw new Error("No similar tracks found.");
          }

          // 3. HYDRATION PHASE (Spotify Search)
          // We build a clean array of URIs.
          const uriList = [];
          
          // Always start with the Seed Track!
          uriList.push(seedTrack.uri);

          const total = similarTracks.length;
          let processed = 0;

          for (const track of similarTracks) {
              if (isCancelled) return;

              processed++;
              progressDialog.updateMessage(`Getting Spotify Tracks (${processed}/${total})...`);

              try {
                  // Search Spotify for the specific track
                  // We limit to 1 result to keep it fast
                  const res = await this._api.fetchSpotifyPlus('search_tracks', {
                      criteria: `track:${track.name} artist:${track.artist}`,
                      limit: 1
                  });

                  if (res && res.result && res.result.items && res.result.items.length > 0) {
                      const match = res.result.items[0];
                      if (match && match.uri) {
                          uriList.push(match.uri);
                      }
                  }
              } catch (e) {
                  // If search fails, we just skip it silently and move to the next
                  console.warn(`[Radio] Skipped track: ${track.name}`);
              }
          }

          if (isCancelled) return;

          // 4. EXECUTION PHASE (Play the List)
          if (uriList.length > 0) {
              progressDialog.updateMessage("Starting playback...");
              
              // We use 'player_media_play_tracks' which replaces the current playback
              // with our new list.
              await this._api.fetchSpotifyPlus('player_media_play_tracks', {
                  uris: uriList,
                  shuffle: true // Optional: Shuffle the radio results for variety
              }, false); // false = don't expect return data

              this._showToast(`Radio started with ${uriList.length} tracks`);
          } else {
              throw new Error("Could not find any matching tracks on Spotify.");
          }

      } catch (err) {
          if (!isCancelled) {
              console.error("[SpotifyBrowser] Radio Error:", err);
              this._showToast(err.message || "Radio failed to start");
          }
      } finally {
          // Always close the dialog when done (or failed)
          progressDialog.close();
      }
  }
  
  // --- Hash & Visibility Management ---

  _checkHash() {
      const hash = window.location.hash;
      if (!hash) return;

      // 1. Match Logic
      const isGeneric = hash.includes('spotify-browser');
      const accounts = this._config.spotify_accounts || [];
      const matchedAccount = accounts.find(acc => acc.hash === hash);

      if (isGeneric || matchedAccount) {
          console.log("[SpotifyCard] Trigger detected:", hash);

          // 2. CRITICAL FIX: Clear URL *Immediately* (Synchronous)
          // We do this BEFORE any other logic to ensure the UI feels snappy
          history.replaceState(null, null, window.location.pathname + window.location.search);

          // 3. Defer the heavy lifting (Popup Open)
          // This lets the browser repaint the URL bar first, THEN open the modal
          requestAnimationFrame(() => {
              if (matchedAccount && matchedAccount.entity !== this._config.entity) {
                  this._switchAccount(matchedAccount.entity, null);
              }
              this._openBrowser();
          });
      }
  }
  
  _openAccountsMenu() {
      // 1. Close main dropdown if open
      const menu = this.shadowRoot.getElementById('dropdown-menu');
      if (menu) menu.classList.remove('visible');

      // 2. Get Popup Elements
      const popup = this.shadowRoot.getElementById('accounts-popup');
      const listEl = this.shadowRoot.getElementById('accounts-list');
      
      if (!popup || !listEl) return;
      
      // 3. Check Config
      const accounts = this._config.spotify_accounts || [];
      if (accounts.length === 0) {
          this._showToast("No accounts configured");
          return;
      }

      // 4. Render Account List (Reusing Device Row CSS)
      // We use the same CSS classes (.device-row, .device-icon) to maintain the look
      listEl.innerHTML = accounts.map(acc => {
          const isActive = acc.entity === this._config.entity;
          const activeClass = isActive ? 'active' : '';
          
          // Green dot for active account
          const activeIcon = isActive ? `<span class="device-active-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="#1db954"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>` : '';
          
          // Generic User Icon
          const icon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;

          return `
            <div class="device-row ${activeClass}" data-entity="${acc.entity}" data-hash="${acc.hash || ''}">
                <div class="device-icon">${icon}</div>
                <div class="device-info">
                    <div class="device-name ${isActive ? 'green-text' : ''}">
                        ${acc.name}
                    </div>
                    <div class="device-type">${acc.entity}</div>
                </div>
                ${activeIcon}
            </div>
          `;
      }).join('');

      // 5. Attach Click Listeners
      listEl.querySelectorAll('.device-row').forEach(row => {
          row.addEventListener('click', (e) => {
              e.stopPropagation();
              const newEntity = row.dataset.entity;
              const newHash = row.dataset.hash;
              
              if (newEntity !== this._config.entity) {
                  this._switchAccount(newEntity, newHash);
                  popup.classList.remove('visible');
              } else {
                  this._showToast("Account already active");
              }
          });
      });

      // 6. Show Popup
      popup.classList.add('visible');
  }

  _switchAccount(newEntityId, newHash) {
      // 1. Update Config & API Instance
      this._config.entity = newEntityId;
      this._api = new SpotifyApi(this._hass, newEntityId, this._config.default_device);

      // 2. NUCLEAR CACHE WIPE (Critical for multi-user)
      // We must clear everything so User A's playlists don't show for User B
      this._pageCache.clear();
      this._favCache.clear();
      this._history = [];
      this._followingPlaylistIds.clear();
      this._lastQueueSignature = null;
      this._lastTrackState = null;
      this._currentTrackUri = null;
      this._homeLastUpdated = 0; // Force home refresh
      
      // Reset Pagination
      this._offsets = { favorites: 0, artists: 0, albums: 0, recent: 0, madeforyou: 0 };
      this._totals = { favorites: null, artists: null, albums: null, recent: null };

      // 3. Clear DOM Elements
      const pageContainer = this.shadowRoot.getElementById('page-container');
      if (pageContainer) pageContainer.innerHTML = '';
      const queueList = this.shadowRoot.getElementById('queue-list');
      if (queueList) queueList.innerHTML = '';
      const npEl = this.shadowRoot.getElementById('queue-now-playing');
      if (npEl) npEl.innerHTML = '';

      // 4. Update URL Hash (if provided)
      if (newHash && newHash !== 'undefined') {
          // Update URL without triggering hashchange event loop
          history.replaceState(null, null, newHash);
      }

      // 5. Navigate Home (Triggers fresh data fetch)
      this._currentPageId = null;
      this._navigateTo('home');
      
      // 6. Refresh Queue
      this._loadQueue();

      this._showToast(`Switched to ${newEntityId}`);
  }

  _openBrowser() {
    if (this._closeTimer) { clearTimeout(this._closeTimer); this._closeTimer = null; }
    if (this._isOpen) return; 
    
    this._isOpen = true;
    const container = this.shadowRoot.getElementById('browser-wrapper');
    const backdrop = this.shadowRoot.getElementById('backdrop');
    
    if (container && backdrop) {
      container.classList.add('open');
      backdrop.classList.add('open');
      document.body.style.overflow = 'hidden'; 
      this._startAutoCloseListener();
      this._startScanTimer(); 

      // --- NEW: Auto-Open Queue on Desktop ---
      // 1. Check Config
      // 2. Check Screen Width (Desktop Breakpoint > 768px)
      if (this._config.queue_settings.openInit && window.matchMedia('(min-width: 769px)').matches) {
          container.classList.add('queue-open');
          // Important: Trigger load immediately so it isn't empty
          this._loadQueue(); 
      }
    }
    
    // ... (Existing Homescreen Expiry logic remains here) ...
    const pageContainer = this.shadowRoot.getElementById('page-container');
    const expiryMs = (this._config.homescreen?.expiry ?? 60) * 60 * 1000;
    const isExpired = (Date.now() - this._homeLastUpdated) > expiryMs;
    const homePage = this.shadowRoot.getElementById('page-home');

    if (isExpired && homePage) {
        homePage.dataset.loaded = "false";
        homePage.dataset.loading = "false";
    }

    if (!this._currentPageId || (pageContainer && pageContainer.children.length === 0)) {
        this._navigateTo('home');
    } else if (this._currentPageId === 'home') {
        if (homePage && homePage.dataset.loaded !== "true" && homePage.dataset.loading !== "true") {
            this._loadHomeData(homePage);
        }
    }
  }

  _closeBrowser() {
    const currentHash = window.location.hash;
    
    // Check if the current hash matches any configured account
    const isAccountHash = this._config.spotify_accounts?.some(acc => acc.hash === currentHash);

    // If it's the default hash OR a specific account hash, clear it.
    if (currentHash === '#spotify-browser' || isAccountHash) {
        // Remove hash from URL without refreshing
        history.replaceState(null, null, ' '); 
    }
    
    this._closeUI();
    window.dispatchEvent(new Event('hashchange'));
  }

  _closeUI() {
    this._isOpen = false;
    const container = this.shadowRoot.getElementById('browser-wrapper');
    const backdrop = this.shadowRoot.getElementById('backdrop');
    
    if (container && backdrop) {
      container.classList.remove('open');
      backdrop.classList.remove('open');
      container.classList.remove('queue-open'); 
      document.body.style.overflow = ''; 
    }
    
    this._stopAutoCloseListener();
    this._closeDevicePopup();
    this._stopScanTimer(); 
    if (this._progressTimer) { clearInterval(this._progressTimer); this._progressTimer = null; }

    this._closeTimer = setTimeout(() => {
        this._history = [];
        
        // FIX: Cache Persistence Logic
        const shouldCache = this._config.homescreen.cache;
        
        if (!shouldCache) {
             // Destroy Everything
             this._pageCache.clear();
             this._currentPageId = null;
             this._homeLastUpdated = 0; // Reset timer
             this._followingPlaylistIds.clear();
             this._offsets = { favorites: 0, artists: 0, albums: 0, recent: 0, madeforyou: 0 };
             
             const pageContainer = this.shadowRoot.getElementById('page-container');
             if(pageContainer) pageContainer.innerHTML = '';
             
        } else {
             // Keep Home, Destroy Drilldowns
             const homePage = this._pageCache.get('home');
             this._pageCache.clear();
             if(homePage) this._pageCache.set('home', homePage);
             
             const pageContainer = this.shadowRoot.getElementById('page-container');
             if (pageContainer) {
                 Array.from(pageContainer.children).forEach(child => {
                     if (child.id !== 'page-home') child.remove();
                 });
             }
             this._currentPageId = 'home';
        }
        
        const searchContainer = this.shadowRoot.getElementById('search-container');
        const searchInput = this.shadowRoot.getElementById('search-input');
        if(searchContainer) searchContainer.classList.remove('active');
        if(searchInput) searchInput.value = '';
        
    }, 400); 
  }

  // --- Auto Close Logic ---

  _startAutoCloseListener() {
    if (!this._config.auto_close_seconds || this._config.auto_close_seconds <= 0) return;
    const container = this.shadowRoot.getElementById('browser-wrapper');
    const events = ['click', 'touchstart', 'scroll', 'keydown'];
    events.forEach(event => {
        const opts = event === 'scroll' ? { passive: true, capture: true } : { passive: true };
        container.addEventListener(event, this._boundResetTimer, opts);
    });
    this._resetTimer();
  }

  _stopAutoCloseListener() {
    const container = this.shadowRoot.getElementById('browser-wrapper');
    if (!container) return;
    const events = ['click', 'touchstart', 'scroll', 'keydown'];
    events.forEach(event => {
         const opts = event === 'scroll' ? { passive: true, capture: true } : { passive: true };
         container.removeEventListener(event, this._boundResetTimer, opts);
    });
    if (this._timer) clearTimeout(this._timer);
  }

  _resetTimer() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._closeBrowser();
    }, this._config.auto_close_seconds * 1000);
  }
  
  
  // --- Scan Interval Logic ---
  _startScanTimer() {
      this._stopScanTimer(); // Clear existing
      
      // Only start if configured and > 0
      if (this._config.scan_interval && this._config.scan_interval > 0) {
     
          this._scanTimer = setInterval(() => {

              // Call trigger_scan_interval (fire-and-forget = false)
              this._api.fetchSpotifyPlus('trigger_scan_interval', {}, false);
          }, this._config.scan_interval * 1000);
      }
  }

  _stopScanTimer() {
      if (this._scanTimer) {
          clearInterval(this._scanTimer);
          this._scanTimer = null;
      }
  }

  // --- Search Logic ---

  _toggleSearch() {
    const container = this.shadowRoot.getElementById('search-container');
    const input = this.shadowRoot.getElementById('search-input');
    
    if (container.classList.contains('active')) {
        // Closing Search
        container.classList.remove('active');
        input.value = '';
        this._stopSearchAutoClose(); // Stop timer
        if (this._currentPageId === 'search') this._goBack();
    } else {
        // Opening Search
        container.classList.add('active');
        input.focus();
        this._resetSearchAutoClose(); // Start timer
    }
  }

  _handleSearchInput(e) {
    const query = e.target.value;
    
    // Reset the auto-close timer since user is typing
    this._resetSearchAutoClose();

    clearTimeout(this._searchDebounceTimer);
    
    if (!query) return; 

    this._searchDebounceTimer = setTimeout(() => {
        if (this._currentPageId === 'search') {
            const pageEl = this.shadowRoot.getElementById('page-search');
            if (pageEl) this._performSearch(pageEl, query);
        } else {
            this._navigateTo('search', { query });
        }
    }, 600); 
  }
  
  _resetSearchAutoClose() {
    this._stopSearchAutoClose();
    // Set 30 second timer
    this._searchAutoCloseTimer = setTimeout(() => {
        const container = this.shadowRoot.getElementById('search-container');
        if (container && container.classList.contains('active')) {
            // Close search automatically
            this._toggleSearch();
        }
    }, 30000);
  }

  _stopSearchAutoClose() {
    if (this._searchAutoCloseTimer) {
        clearTimeout(this._searchAutoCloseTimer);
        this._searchAutoCloseTimer = null;
    }
  }

  _handleSearchKeydown(e) {
      if (e.key === 'Enter') {
          e.preventDefault();
          const query = e.target.value;
          if (!query) return;
          clearTimeout(this._searchDebounceTimer);
          e.target.blur(); 
          if (this._currentPageId === 'search') {
              const pageEl = this.shadowRoot.getElementById('page-search');
              if (pageEl) this._performSearch(pageEl, query);
          } else {
              this._navigateTo('search', { query });
          }
      }
  }

  async _performSearch(pageEl, query) {
      if (!query) return;
      try {
          pageEl.innerHTML = Templates.search();
          const res = await this._api.fetchSpotifyPlus('search_all', {
              criteria: query,
              criteria_type: 'album,artist,playlist,track',
              limit_total: 20
          });
          if (res && res.result) {
              // FIX: Pass 'query' as the 3rd argument
              this._updateSearchUI(pageEl, res.result, query);
          }
      } catch (e) { console.error("Search failed:", e); }
  }

  // FIX: Accept 'query' as the 3rd argument
  _updateSearchUI(pageEl, results, query) {
      // FIX: Fallback - If query arg is missing, grab it from the search box
      if (!query || query === 'undefined') {
          const input = this.shadowRoot.getElementById('search-input');
          if (input) query = input.value;
      }

      console.log("[SpotifyBrowser] Updating Search UI with Query:", query);

      const fillSection = (key, items, type) => {
          const container = pageEl.querySelector(`[data-section="search-${key}"]`);
          if (!container) return;
          
          if (items && items.items && items.items.length > 0) {
              const html = items.items.map(item => Templates.mediaCard(item, type)).join('');
              container.innerHTML = html;
              
              const section = container.closest('.home-section');
              section.style.display = 'block';
              
              const seeAllBtn = section.querySelector('.see-all-btn');
              if (seeAllBtn) {
                  seeAllBtn.style.display = 'block';
                  seeAllBtn.innerText = 'See All';
                  
                  // FIX: Set attributes explicitly
                  seeAllBtn.dataset.action = 'search-view-all';
                  seeAllBtn.setAttribute('data-search-type', type);
                  seeAllBtn.setAttribute('data-search-query', query);
              }
          } else {
              container.innerHTML = '';
              container.closest('.home-section').style.display = 'none';
          }
      };

      fillSection('songs', results.tracks, 'track'); 
      fillSection('artists', results.artists, 'artist');
      fillSection('albums', results.albums, 'album');
      fillSection('playlists', results.playlists, 'playlist');
      
      this._updateActiveElement();
  }

  // --- Artist Data Loading ---


  async _loadArtistData(pageEl, artistId, artistName) {
      if (pageEl.dataset.loading === "true") return;
      pageEl.dataset.loading = "true";

      try {
          let name = artistName;
          
          // 1. Fetch Core Data (Artist, Tracks, Albums)
          const artistReq = this._api.fetchSpotifyPlus('get_artist', { artist_id: artistId });
          const market = this._userCountry || 'US';
          const tracksReq = this._api.fetchSpotifyPlus('get_artist_top_tracks', { 
              artist_id: artistId, market: market, sort_result: false 
          });
          const albumsReq = this._api.fetchSpotifyPlus('get_artist_albums', { 
              artist_id: artistId, limit: 20, include_groups: 'album,single' 
          });

          const artistRes = await artistReq;
          if (artistRes && artistRes.result) {
              name = artistRes.result.name;
              this._updateArtistHeader(pageEl, artistRes.result);
          }

          const playlistsReq = (async () => {
              if(!name) return null;
              const r = await this._api.fetchSpotifyPlus('search_all', { criteria: name, criteria_type: 'playlist', limit_total: 20 });
              return r ? r.result : null;
          })();

          // 2. Fetch Last.fm Names (Fast)
          const simArtConfig = this._config.advanced?.similar_artists;
          const lastFmKey = this._config.external_providers?.lastfm?.api_key;
          let similarReq = Promise.resolve(null);

          if (name && simArtConfig?.provider === 'lastfm' && lastFmKey) {
              similarReq = fetchLastFmSimilarArtists(name, lastFmKey, simArtConfig.limit);
          }

          const [tracksRes, albumsRes, playlistsRes, similarRes] = await Promise.all([
              tracksReq, albumsReq, playlistsReq, similarReq
          ]);

          // ... (Render Tracks, Albums, Playlists as before) ...
          let tracks = [];
          if (tracksRes && tracksRes.result) tracks = Array.isArray(tracksRes.result) ? tracksRes.result : tracksRes.result.tracks;
          const trackContainer = pageEl.querySelector('.artist-track-grid');
          if (trackContainer && tracks && tracks.length > 0) {
              // --- ADD THIS LINE ---
              // This attaches the Artist URI (e.g., spotify:artist:123) to the list
              // so the click handler can grab it as the 'context_uri'.
              trackContainer.dataset.contextUri = artistRes.result.uri; 
              // ---------------------
        
              const top8 = tracks.slice(0, 8);
              trackContainer.innerHTML = top8.map(track => Templates.artistTopTrack(track)).join('');
              // ...
          }

          const albumContainer = pageEl.querySelector('#artist-albums');
          if (albumContainer && albumsRes && albumsRes.result && albumsRes.result.items) {
               albumContainer.innerHTML = albumsRes.result.items.map(item => Templates.mediaCard(item, 'album')).join('');
          }

          const plContainer = pageEl.querySelector('#artist-playlists');
          if (plContainer && playlistsRes && playlistsRes.playlists && playlistsRes.playlists.items) {
              plContainer.innerHTML = playlistsRes.playlists.items.map(item => Templates.mediaCard(item, 'playlist')).join('');
          }

          // 3. Render Initial Similar Artists (Names Only + Grey Circles)
          const simContainer = pageEl.querySelector('#artist-similar');
          if (simContainer) {
              const section = simContainer.closest('.home-section');
              if (similarRes && similarRes.length > 0) {
                  // Render basic cards
                  simContainer.innerHTML = similarRes.map(item => Templates.mediaCard(item, 'artist')).join('');
                  if(section) section.style.display = 'block';

                  // 4. BACKGROUND HYDRATION (Fire and Forget)
                  // We do NOT await this, so the spinner disappears immediately
                  this._hydrateSimilarArtists(pageEl, similarRes);
                  
              } else {
                  if(section) section.style.display = 'none';
              }
          }

          pageEl.dataset.loaded = "true";
          this._updateActiveElement(); 
      } catch (e) {
          console.error("[SpotifyBrowser] Error loading artist:", e);
      } finally {
          pageEl.dataset.loading = "false";
      }
  }
  
  
  // --- New Hydration Method (Enhanced Matching) ---
  async _hydrateSimilarArtists(pageEl, artists) {
      const container = pageEl.querySelector('#artist-similar');
      if (!container) return;

      const cards = container.querySelectorAll('.media-card');

      for (let i = 0; i < artists.length; i++) {
          const targetName = artists[i].name; // The name from Last.fm (e.g., "Seven Lions")
          const card = cards[i];
          if (!card) continue;

          try {
              // 1. Search with limit=3 to get candidates
              const res = await this._api.fetchSpotifyPlus('search_artists', {
                  criteria: targetName,
                  limit: 3
              });

              if (res && res.result && res.result.items && res.result.items.length > 0) {
                  const items = res.result.items;
                  let match = null;

                  // 2. STRATEGY A: Exact Name Match (Case Insensitive)
                  // This fixes "Seven Lions" vs "Seven Red Lions"
                  match = items.find(item => item.name.toLowerCase() === targetName.toLowerCase());

                  // 3. STRATEGY B: Fallback to highest popularity
                  // If no exact match, grab the first result (Spotify orders by relevance/popularity)
                  if (!match) {
                      match = items[0];
                  }

                  // 4. Update DOM
                  if (match) {
                      card.dataset.id = match.id;
                      card.dataset.uri = match.uri;

                      if (match.images && match.images.length > 0) {
                          const imgDiv = card.querySelector('.media-image');
                          if (imgDiv) {
                              imgDiv.style.backgroundImage = `url('${match.images[0].url}')`;
                              imgDiv.style.transition = 'opacity 0.5s';
                              imgDiv.style.opacity = '0';
                              requestAnimationFrame(() => imgDiv.style.opacity = '1');
                          }
                      }
                  }
              }
          } catch (e) {
              console.warn(`[SpotifyBrowser] Failed to hydrate ${targetName}`, e);
          }
      }
  }

  _updateArtistHeader(pageEl, artist) {
      const heroTitle = pageEl.querySelector('.artist-hero-name');
      const heroBg = pageEl.querySelector('.hero-bg');
      
      if (heroTitle) heroTitle.innerText = artist.name;
      
      // FIX: Set the Sticky Header Title
      const centerTitle = this.shadowRoot.querySelector('.header-center-title');
      if (centerTitle) centerTitle.innerText = artist.name || '';
      
      const imgUrl = (artist.images && artist.images.length > 0) ? artist.images[0].url : '';
      if (imgUrl && heroBg) {
          heroBg.style.backgroundImage = `url('${imgUrl}')`;
          heroBg.style.backgroundSize = 'cover';
          heroBg.style.backgroundPosition = 'center 20%';
      }
      const actionsContainer = pageEl.querySelector('.hero-actions');
      if (actionsContainer && artist) {
          actionsContainer.innerHTML = `
          <button class="hero-btn-play" data-action="play-context" data-uri="${artist.uri}">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="hero-btn-fav" data-action="toggle-artist-follow" data-id="${artist.id}">
             <span style="font-size:12px; font-weight:700; margin:0 4px;">FOLLOW</span>
          </button>`;
          this._checkArtistFollow(artist.id, pageEl);
          this._updateHeroPlayButton(); 
      }
  }

  // --- UI Updates (Playback & Header) ---

  _updateActiveElement() {
      const allActive = this.shadowRoot.querySelectorAll('.playing');
      allActive.forEach(el => el.classList.remove('playing'));
      if (!this._isPlaying) return;
      if (this._currentTrackUri) {
          const trackElements = this.shadowRoot.querySelectorAll(`[data-uri="${this._currentTrackUri}"]`);
          trackElements.forEach(el => el.classList.add('playing'));
      }
      if (this._currentContextUri) {
          const contextElements = this.shadowRoot.querySelectorAll(`[data-uri="${this._currentContextUri}"]`);
          contextElements.forEach(el => el.classList.add('playing'));
      }
  }

  _updateHeroPlayButton() {
      const page = this.shadowRoot.getElementById(`page-${this._currentPageId}`);
      if (!page) return;
      const playBtn = page.querySelector('.hero-btn-play');
      if (!playBtn) return;
      const btnUri = playBtn.dataset.uri;
      const isContextMatch = btnUri === this._currentContextUri || btnUri === this._currentTrackUri;
      const playIcon = '<path d="M8 5v14l11-7z"/>';
      const pauseIcon = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';

      if (isContextMatch && this._isPlaying) {
          playBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${pauseIcon}</svg>`;
          playBtn.dataset.action = "pause";
      } else if (isContextMatch && !this._isPlaying) {
          playBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${playIcon}</svg>`;
          playBtn.dataset.action = "resume";
      } else {
          playBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${playIcon}</svg>`;
          playBtn.dataset.action = "play-context";
      }
  }

  _updateHeader(pageId, pageEl = null) {
    const backBtn = this.shadowRoot.getElementById('back-btn');
    const searchContainer = this.shadowRoot.getElementById('search-container');
    const headerLeft = this.shadowRoot.querySelector('.header-left');
    
    if(headerLeft) headerLeft.style.cursor = 'pointer';

    // 1. Buttons Visibility
    if (pageId === 'home') {
        if (backBtn) backBtn.style.display = 'none';
        if (searchContainer) searchContainer.classList.remove('hidden');
    } else {
        if (backBtn) backBtn.style.display = 'flex';
    }

    // 2. Restore Header Title (Fix for Back Button)
    const centerTitle = this.shadowRoot.querySelector('.header-center-title');
    if (centerTitle) {
        if (pageId.startsWith('search-all:')) {
            // CASE A: Search Results (Always Visible)
            const parts = pageId.split(':');
            if (parts.length >= 3) {
                const type = parts[1];
                // Capitalize first letter
                const typeCap = type.charAt(0).toUpperCase() + type.slice(1);
                const query = decodeURIComponent(parts[2]);
                
                centerTitle.innerText = `All ${typeCap}s for "${query}"`;
                centerTitle.style.opacity = '1'; 
            }
        } else {
            // CASE B: Standard Pages (Hidden until scroll)
            // Try to recover title from the cached DOM
            let restoredTitle = '';
            if (pageEl) {
                const titleEl = pageEl.querySelector('.hero-title, .artist-hero-name');
                if (titleEl) restoredTitle = titleEl.innerText;
            }
            
            centerTitle.innerText = restoredTitle;
            centerTitle.style.opacity = '0'; // Hide initially (fade in on scroll)
        }
    }
  }
  
  _onCarouselScroll(e) {
      const target = e.target;
      const sectionKey = target.dataset.section;
      if (!sectionKey || sectionKey.startsWith('search-')) return; 
      if (target.scrollWidth - target.scrollLeft - target.clientWidth < 300) {
          const homePage = this.shadowRoot.getElementById('page-home');
          if (homePage) this._fetchSectionData(sectionKey, homePage);
      }
  }
  
  _updateHeaderStyle(alpha) {
      const header = this.shadowRoot.querySelector('.header');
      if (!header) return;
      
      // Apply transparency based on alpha (0 = Transparent, 1 = Opaque)
      header.style.backgroundColor = `rgba(18, 18, 18, ${alpha})`;
      header.style.borderBottom = alpha > 0.8 ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid transparent';
      
      // Optional: Add shadow only when opaque
      header.style.boxShadow = alpha > 0.8 ? '0 4px 12px rgba(0,0,0,0.3)' : 'none';
  }
  
  _onPageScroll(e) {
      const target = e.target;
      if (target.id !== `page-${this._currentPageId}`) return;
      
      // 1. Hero Header Visuals
      if (target.classList.contains('has-hero-header')) {
          const scrollTop = target.scrollTop;
          const alpha = Math.min(scrollTop / 60, 1); 
          this._updateHeaderStyle(alpha);
          
          const titleEl = this.shadowRoot.querySelector('.header-center-title');
          if (titleEl) {
              const textAlpha = Math.max(0, Math.min((scrollTop - 220) / 60, 1));
              titleEl.style.opacity = textAlpha;
          }
      }

      // 2. Infinite Scroll Logic
      // Check if near bottom (300px buffer)
      if (target.scrollTop + target.clientHeight >= target.scrollHeight - 300) {
          
          // Case A: Search Results
          if (this._currentPageId.startsWith('search-all:')) {
              const parts = this._currentPageId.split(':');
              this._fetchMoreSearchResults(target, parts[1], decodeURIComponent(parts[2]));
          }
          // Case B: Liked Songs / Context
          else if (this._contextTotal !== null && this._contextOffset < this._contextTotal) {
              this._fetchMoreContextData(target);
          }
      }
  }

  _toggleMenu() {
      const menu = this.shadowRoot.getElementById('dropdown-menu');
      if (menu) menu.classList.toggle('visible');
  }
  
  _openDeviceMenu() {
     const menu = this.shadowRoot.getElementById('dropdown-menu');
     if(menu) menu.classList.remove('visible');
     const popup = this.shadowRoot.getElementById('device-popup');
     if(popup) popup.classList.add('visible');
     this._loadDeviceList();
  }

  _closeDevicePopup() {
      const popup = this.shadowRoot.getElementById('device-popup');
      if(popup) popup.classList.remove('visible');
  }

  // --- Favorites & Follow Logic ---

  async _toggleTrackFavorite(id, isCurrentlyFavorite, btnElement) {
      if (!this._hass || !id) return;
      
      // 1. Optimistic UI Update: Flip state immediately
      if (btnElement) btnElement.classList.toggle('is-favorite');
      
      // 2. Update Cache Immediately (Prevents flickering on re-render)
      this._favCache.set(id, !isCurrentlyFavorite);

      try {
          if (isCurrentlyFavorite) {
              // --- REMOVE Operation ---
              await this._api.fetchSpotifyPlus('remove_track_favorites', { ids: id }, false);
              
              // Animate removal ONLY if we are viewing the Liked Songs list
              let removedRow = null;
              if (this._currentPageId && this._currentPageId.startsWith('likedsongs:') && btnElement) {
                  removedRow = btnElement.closest('.track-row');
                  if (removedRow) {
                      removedRow.classList.add('removing'); // Triggers CSS collapse
                  }
              }

              this._showToast("Removed from Library", {
                  label: "Undo",
                  callback: () => {
                      // --- UNDO Operation ---
                      this._api.fetchSpotifyPlus('save_track_favorites', { ids: id }, false);
                      
                      // Restore Icon
                      if (btnElement) btnElement.classList.add('is-favorite'); 
                      
                      // Restore Cache
                      this._favCache.set(id, true);
                      
                      // Restore Row (Slide Back In)
                      if (removedRow) {
                          removedRow.classList.remove('removing');
                      }
                      
                      this._showToast("Added to Library");
                  }
              });
          } else {
              // --- ADD Operation ---
              await this._api.fetchSpotifyPlus('save_track_favorites', { ids: id }, false);
              this._showToast("Added to Library");
          }
      } catch (e) {
          console.error("Failed to toggle favorite:", e);
          
          // Revert UI on error
          if (btnElement) btnElement.classList.toggle('is-favorite');
          
          // Revert Cache on error
          this._favCache.set(id, isCurrentlyFavorite);
          
          this._showToast("Error updating favorites");
      }
  }

  async _checkFavorites(trackIds, pageEl) {
      if (!trackIds || trackIds.length === 0) return;
      const chunkSize = 50;
      for (let i = 0; i < trackIds.length; i += chunkSize) {
          const chunk = trackIds.slice(i, i + chunkSize);
          try {
              const res = await this._api.fetchSpotifyPlus('check_track_favorites', { ids: chunk.join(',') });
              if (res && res.result) {
                  Object.entries(res.result).forEach(([id, isFav]) => {
                      if (isFav) {
                          const trackElements = pageEl.querySelectorAll(`[data-track-id="${id}"] .track-action-btn[data-action="save"], .artist-top-track[data-id="${id}"] .track-action-btn[data-action="save"]`);
                          trackElements.forEach(btn => btn.classList.add('is-favorite'));
                      }
                  });
              }
          } catch (e) { console.warn("Failed to check favorites:", e); }
      }
  }

  async _checkAlbumFavorite(albumId, pageEl) {
      if (!albumId) return;
      try {
          const res = await this._api.fetchSpotifyPlus('check_album_favorites', { ids: albumId });
          if (res && res.result && res.result[albumId]) {
              const favBtn = pageEl.querySelector('.hero-btn-fav');
              if (favBtn) favBtn.classList.add('is-favorite');
          }
      } catch (e) { console.warn("Failed to check album favorite:", e); }
  }

  async _toggleAlbumFavorite(albumId, isCurrentlyFavorite, btnElement) {
      if (!this._hass || !albumId) return;
      const service = isCurrentlyFavorite ? 'remove_album_favorites' : 'save_album_favorites';
      const toastMsg = isCurrentlyFavorite ? "Removed Album" : "Saved Album";
      if (btnElement) btnElement.classList.toggle('is-favorite');
      try {
          await this._api.fetchSpotifyPlus(service, { ids: albumId });
          this._showToast(toastMsg);
      } catch (e) {
          if (btnElement) btnElement.classList.toggle('is-favorite'); 
          this._showToast("Error updating album");
      }
  }
  
  async _checkArtistFollow(artistId, pageEl) {
      if (!artistId) return;
      try {
          const res = await this._api.fetchSpotifyPlus('check_artists_following', { ids: artistId });
          if (res && res.result && res.result[artistId]) {
              const favBtn = pageEl.querySelector('.hero-btn-fav');
              if (favBtn) {
                   favBtn.classList.add('is-favorite');
                   const span = favBtn.querySelector('span');
                   if(span) span.innerText = 'FOLLOWING';
              }
          }
      } catch (e) { console.warn("Failed check artist:", e); }
  }

  async _toggleArtistFollow(artistId, isFollowing, btnElement) {
      if (!this._hass || !artistId) return;
      const service = isFollowing ? 'unfollow_artists' : 'follow_artists';
      const toastMsg = isFollowing ? "Unfollowed Artist" : "Followed Artist";
      const span = btnElement ? btnElement.querySelector('span') : null;
      if (btnElement) {
          btnElement.classList.toggle('is-favorite');
          if(span) span.innerText = isFollowing ? 'FOLLOW' : 'FOLLOWING';
      }
      try {
          await this._api.fetchSpotifyPlus(service, { ids: artistId });
          this._showToast(toastMsg);
      } catch (e) {
          if (btnElement) {
              btnElement.classList.toggle('is-favorite');
              if(span) span.innerText = isFollowing ? 'FOLLOWING' : 'FOLLOW';
          }
          this._showToast("Error updating artist");
      }
  }

  // --- Device Rendering ---

  async _loadDeviceList() {
      const listEl = this.shadowRoot.getElementById('device-list');
      if(!listEl) return;
      
      // FIX: Validation Check - Cannot have both Show and Hide
      if (this._config.device_playback && 
          this._config.device_playback.show.length > 0 && 
          this._config.device_playback.hide.length > 0) {
          
          this._showAlert(
              "Config Error",
              'Cannot utilize both "Show" & "Hide" in configuration.',
              [{ label: "Close", action: () => this._closeAlert() }]
          );
          
          listEl.innerHTML = '<div style="padding:32px;text-align:center;color:var(--spf-brand)">Configuration Error</div>';
          return;
      }
      
      // STRATEGY A: Manual List
      if (this._config.device_playback && this._config.device_playback.show.length > 0) {
          const manualDevices = this._config.device_playback.show.map(item => {
              if (typeof item === 'string') {
                  return { id: item, name: item, type: 'Manual', is_active: false };
              }
              return { 
                  id: item.id || item.name, 
                  name: item.name || item.id, 
                  type: item.type || 'Manual', 
                  is_active: false 
              };
          });
          this._renderDeviceListInternal(manualDevices);
          return;
      }

      // STRATEGY B: API Discovery
      listEl.innerHTML = '<div style="padding:32px;text-align:center;color:#b3b3b3">Searching for devices...</div>';
      
      try {
          const devicesRes = await this._api.fetchSpotifyPlus('get_spotify_connect_devices', { refresh: true });
          
          if (devicesRes && devicesRes.result) {
              let rawList = devicesRes.result;

              // 1. Extract Array (Handle 'Items' vs 'devices')
              if (!Array.isArray(rawList)) {
                  if (rawList.Items && Array.isArray(rawList.Items)) {
                      rawList = rawList.Items; // Spotify Connect API
                  } 
                  else if (rawList.devices && Array.isArray(rawList.devices)) {
                      rawList = rawList.devices; // Web API
                  }
                  else {
                      console.warn("[SpotifyBrowser] Could not find device array:", rawList);
                      rawList = []; 
                  }
              }

              // 2. Normalize Data (Handle 'Name' vs 'name')
              let devices = rawList.map(d => ({
                  id: d.id || d.Id,
                  name: d.name || d.Name,
                  type: d.type || d.DeviceType || 'Unknown',
                  is_active: d.is_active || d.IsActiveDevice || false
              }));

              // 3. Filter Hidden Devices
              if (this._config.device_playback && this._config.device_playback.hide.length > 0) {
                  const hidden = this._config.device_playback.hide;
                  devices = devices.filter(d => 
                      !hidden.includes(d.name) && 
                      !hidden.includes(d.id)
                  );
              }

              this._renderDeviceListInternal(devices);
          } else {
              this._renderDeviceListInternal([]);
          }
      } catch (e) {
          console.error("Device load failed", e);
          this._renderDeviceListInternal([]);
      }
  }

  _renderDeviceListInternal(devices) {
      const listEl = this.shadowRoot.getElementById('device-list');
      if(!listEl) return;

      // Handle Empty
      if (!devices || devices.length === 0) {
          listEl.innerHTML = Templates.emptyDevices();
          const refreshBtn = listEl.querySelector('.device-refresh-btn');
          if (refreshBtn) {
              refreshBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  this._loadDeviceList(); 
              });
          }
          return;
      }

      // Sort: Active first, then Alphabetical
      devices.sort((a, b) => {
          if (a.is_active === b.is_active) return a.name.localeCompare(b.name);
          return a.is_active ? -1 : 1;
      });
      
      const defaultDeviceName = this._config.default_device;
      
      listEl.innerHTML = devices.map(device => {
          const isActive = device.is_active;
          const isDefault = defaultDeviceName && device.name === defaultDeviceName;
          const activeClass = isActive ? 'active' : '';
          const icon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M2 11v10h4V11H2zm16 0v10h4V11h-4zm-10 2v6h2v-6H8zm6 0v6h2v-6h-2z"/></svg>`;
          const activeIcon = isActive ? `<span class="device-active-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="#1db954"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>` : '';
          const defaultIcon = isDefault ? `<span class="device-default-badge" title="Default Player">★</span>` : '';
          
          return `
            <div class="device-row ${activeClass}" data-id="${device.id}">
                <div class="device-icon">${icon}</div>
                <div class="device-info">
                    <div class="device-name ${isActive ? 'green-text' : ''}">
                        ${device.name} ${defaultIcon}
                    </div>
                    <div class="device-type">${device.type}</div>
                </div>
                ${activeIcon}
            </div>
          `;
      }).join('');
      
      // Attach Click Listeners with Error Handling
      listEl.querySelectorAll('.device-row').forEach(row => {
          row.addEventListener('click', async (e) => {
             e.stopPropagation();
             const deviceName = row.querySelector('.device-name').innerText.trim();
             
             // 1. Show Initial Feedback
             this._showToast(`Transferring to ${deviceName}...`);
             
             // 2. Optimistic UI (Turn text green immediately)
             listEl.querySelectorAll('.device-row').forEach(r => r.classList.remove('active'));
             row.classList.add('active');

             // 3. Call API & Wait for Result
             const result = await this._api.transferPlayback(row.dataset.id);
             
             // 4. Handle Failure
             if (result && !result.success) {
                 let msg = `Unable to transfer to ${deviceName}`;
                 let useAlert = false;
                 
                 // Check for specific errors
                 if (result.error) {
                     const errCode = result.error.code || '';
                     const errMsg = result.error.message || '';
                     const errStr = JSON.stringify(result.error);
                     
                     if (errCode === 'service_validation_error' || 
                         errStr.includes("service_validation_error") ||
                         errStr.includes("Validation error") ||
                         errStr.includes("token cache") ||
                         errStr.includes("authorization token")) {
                         // Use alert for validation/auth errors (more serious)
                         useAlert = true;
                         msg = errMsg || "Spotify authentication error occurred";
                     } else if (errStr.includes("timed out") || errStr.includes("timeout")) {
                         msg = "Device connection timed out";
                     } else if (errMsg) {
                         msg = errMsg;
                     }
                 }
                 
                 // Show error
                 if (useAlert) {
                     this._showAlert(
                         "Transfer Failed",
                         msg,
                         [
                             { 
                                 label: "How to Fix", 
                                 primary: true,
                                 action: () => {
                                     window.open('https://github.com/thlucas1/homeassistantcomponent_spotifyplus/wiki/Device-Configuration-Options#spotify-desktop-player-authentication-configuration', '_blank');
                                     this._closeAlert();
                                 }
                             },
                             { 
                                 label: "Close", 
                                 action: () => this._closeAlert() 
                             }
                         ]
                     );
                 } else {
                     this._showToast(msg);
                 }
                 
                 // Revert UI (Undo green text)
                 row.classList.remove('active');
             }
          });
      });
  }
  
  // --- UI Utilities ---

  _showToast(message, action = null) {
      const wrapper = this.shadowRoot.getElementById('browser-wrapper');
      if (!wrapper) return;
      
      // Remove existing toast to prevent stacking
      const existing = wrapper.querySelector('.toast-notification');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.className = 'toast-notification';
      
      // FIX: Removed inline styles so CSS class takes over positioning
      
      const text = document.createElement('span');
      text.textContent = message;
      toast.appendChild(text);

      if (action) {
          const btn = document.createElement('button');
          btn.className = 'toast-undo-btn';
          btn.textContent = action.label || "Undo";
          btn.onclick = (e) => {
              e.stopPropagation();
              action.callback();
              // Close toast immediately on click
              toast.style.opacity = '0';
              setTimeout(() => toast.remove(), 300);
          };
          toast.appendChild(btn);
      }

      wrapper.appendChild(toast);
      
      // Fade In
      requestAnimationFrame(() => toast.style.opacity = '1');
      
      // Auto Close (Longer if there is an action)
      const duration = action ? 4000 : 2500;
      setTimeout(() => {
          if (toast.isConnected) {
              toast.style.opacity = '0';
              setTimeout(() => toast.remove(), 300);
          }
      }, duration);
  }
  
  _onBackdropClick(e) {
      if (e.target === this.shadowRoot.getElementById('backdrop')) {
          this._closeBrowser();
      }
  }
  
  // --- Queue Management ---

  _toggleQueue() {
      const wrapper = this.shadowRoot.getElementById('browser-wrapper');
      if (!wrapper) return;
      
      const isOpening = !wrapper.classList.contains('queue-open');
      
      if (isOpening) {
          wrapper.classList.add('queue-open');
          
          // Close dropdown if open
          const menu = this.shadowRoot.getElementById('dropdown-menu');
          if(menu) menu.classList.remove('visible');
          
          // Force a small delay to allow CSS transitions to start
          requestAnimationFrame(() => {
              this._loadQueue();
          });
      } else {
          wrapper.classList.remove('queue-open');
      }
  }
  
  // Helper: Shows a progress dialog that the user can cancel
  _showProgressDialog(title, initialMessage, onCancel) {
      // 1. Create the dialog structure
      const dialog = document.createElement('div');
      dialog.className = 'custom-alert-overlay visible'; // Re-use your alert styles
      dialog.innerHTML = `
          <div class="custom-alert-box">
              <h3 class="alert-title">${title}</h3>
              <div class="alert-message" id="progress-msg">${initialMessage}</div>
              <div class="alert-actions">
                  <button class="alert-btn" id="progress-cancel-btn">Cancel</button>
              </div>
          </div>
      `;

      // 2. Handle Cancel
      const cancelBtn = dialog.querySelector('#progress-cancel-btn');
      cancelBtn.onclick = () => {
          dialog.remove();
          if (onCancel) onCancel();
      };

      // 3. Append to DOM
      this.shadowRoot.appendChild(dialog);

      // 4. Return an interface to update or close it
      return {
          updateMessage: (msg) => {
              const el = dialog.querySelector('#progress-msg');
              if (el) el.textContent = msg;
          },
          close: () => {
              dialog.remove();
          }
      };
  }
  
  
  async _loadQueue() {
      const listEl = this.shadowRoot.getElementById('queue-list');
      const npEl = this.shadowRoot.getElementById('queue-now-playing');
      
      if (!listEl || !npEl) return;
      
      // 1. Optimistic Header Update (Entity)
      // Only use entity data if we aren't locked by a recent click
      if (Date.now() > this._queueLockTime) {
          const entityData = this._getEntityNowPlaying();
          this._renderNowPlaying(entityData);
      }

      // Initial Loading State (Only if truly empty)
      if (!this._lastQueueSignature && (!listEl.hasChildNodes() || listEl.innerHTML.trim() === '')) {
          listEl.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">Loading queue...</div>';
      }

      try {
          // --- FIX: Use the Correct Service Name ---
          const res = await this._api.fetchSpotifyPlus('get_player_queue_info');
          
          if (res && res.result) {
              // 4. Render Sticky Header (Now Playing)
              if (res.result.currently_playing && Date.now() > this._queueLockTime) {
                  this._renderNowPlaying(res.result.currently_playing);
              }

              // 5. Smart Queue Render
              const newQueue = res.result.queue || [];
              
              // Generate Signature: List of IDs or URIs
              const newSignature = newQueue.map(t => t.id || t.uri).join(',');
              
              // DIFF CHECK: Only touch the DOM if the queue actually changed
              if (this._lastQueueSignature !== newSignature) {
                  this._lastQueueSignature = newSignature;

                  if (newQueue.length > 0) {
                      // --- PERFORMANCE: Build HTML String ---
                      // We map the tracks to HTML strings with data-attributes for Event Delegation
                      const itemsHtml = newQueue.map((track, index) => {
                          const img = track.album?.images?.[0]?.url || '';
                          const artists = track.artists ? track.artists.map(a => a.name).join(', ') : '';
                          
                          // We add data-attributes so the single click listener can find the data
                          return `
                          <div class="queue-item" 
                               data-uri="${track.uri}" 
                               data-id="${track.id || ''}" 
                               data-index="${index}">
                              <div class="queue-art" style="background-image: url('${img}')"></div>
                              <div class="queue-info">
                                  <div class="queue-title">${track.name}</div>
                                  <div class="queue-artist">${artists}</div>
                              </div>
                              <div class="queue-row-play-btn" data-action="play">
                                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
                              </div>
                          </div>
                          `;
                      }).join('');
                      
                      listEl.innerHTML = itemsHtml;
                  } else {
                      listEl.innerHTML = `<div class="empty-queue" style="padding:32px;text-align:center;opacity:0.5">Queue is empty</div>`;
                  }
              }
          } else {
              if (!this._lastQueueSignature) {
                  listEl.innerHTML = '<div style="padding:20px; text-align:center; color:#b3b3b3;">No queue data available.</div>';
              }
          }

          // --- FIX: Ensure Event Listener is Attached ---
          // Since we might wipe innerHTML, we simply ensure the parent listener exists.
          // Setting onclick repeatedly is safe and cheap.
          listEl.onclick = (e) => {
              const row = e.target.closest('.queue-item');
              if (!row) return;
              this._handleQueueItemClick(row); 
          };

      } catch (e) {
          console.error("[SpotifyBrowser] Queue Error:", e);
          if (!this._lastQueueSignature) {
              listEl.innerHTML = '<div style="padding:20px; text-align:center; color:red;">Failed to load queue.</div>';
          }
          if (Date.now() > this._queueLockTime) this._renderNowPlaying(null);
      }
  }
  
  
  // Helper: Extract Now Playing data directly from HA Entity
  _getEntityNowPlaying() {
      if (!this._hass || !this._config.entity) return null;
      const stateObj = this._hass.states[this._config.entity];
      
      // If off/idle/unavailable, return null
      if (!stateObj || ['off', 'unavailable', 'idle'].includes(stateObj.state)) return null;
      
      const attrs = stateObj.attributes;
      if (!attrs.media_title) return null; 

      return {
          name: attrs.media_title,
          // Map HA 'media_artist' string to the array format our template expects
          artists: attrs.media_artist ? [{ name: attrs.media_artist }] : [],
          // Use HA entity picture
          image_url: attrs.entity_picture, 
          uri: attrs.media_content_id
      };
  }
  
  
  // --- CENTRALIZED OPTIMISTIC PLAYBACK ---
  // Updates the UI immediately, locks the state, and calls the API
  // --- CENTRALIZED OPTIMISTIC PLAYBACK (Fixed for Albums) ---
  _triggerOptimisticPlayback(uri, type, metadata, contextUri = null) {
      // 1. Capture Stale ID (The Anti-Bounce Fix)
      if (this._lastTrackState && this._lastTrackState.id) {
          this._staleTrackId = this._lastTrackState.id;
      } else {
          this._staleTrackId = this._currentTrackUri ? this._currentTrackUri.split(':')[2] : null;
      }

      // 2. Construct Optimistic Data
      const optimisticData = {
          name: metadata.title || 'Loading...',
          artists: metadata.artist ? [{ name: metadata.artist }] : [],
          image_url: metadata.image || '',
          id: metadata.id || 'optimistic-id' 
      };

      // 3. Force Render & Lock
      this._isPlaying = true;
      this._renderNowPlaying(optimisticData);
      
      this._queueLockTime = Date.now() + 3500;
      this._lastOptimisticUpdate = Date.now();

      // 4. Update Active Elements
      this._currentTrackUri = uri; 
      if (contextUri) this._currentContextUri = contextUri;
      this._updateActiveElement();
      this._updateHeroPlayButton();

      // 5. Call API (CRITICAL FIX HERE)
      if (contextUri) {
          // If the URI equals the Context (e.g. Hero Play Button on an Album),
          // we just want to play the context. We MUST NOT send an offset_uri.
          if (uri === contextUri) {
               this._playMediaSafe(contextUri, 'playlist');
          } else {
               // We are playing a specific track INSIDE a context (Track List).
               // Here we MUST send the offset so it starts at the right song.
               this._playMediaSafe(contextUri, 'playlist', { offset_uri: uri });
          }
      } else {
          this._playMediaSafe(uri, type);
      }
      
      // 6. Force Refresh Cycle
      setTimeout(() => this._api.fetchSpotifyPlus('trigger_scan_interval', {}, false), 1000);
  }
  
  // --- Playback Wrapper with DEBUGGING ---
  // --- Playback Wrapper with SMART IDLE CHECK ---
  async _playMediaSafe(uri, type, options = {}) {
      let deviceNameOrId = this._config.default_device;
      
      // 1. SMART TARGETING: If we are already Paused/Playing, use THAT device.
      // This prevents switching to the Default Device if you are paused on a different one.
      if (this._hass && this._config.entity) {
          const stateObj = this._hass.states[this._config.entity];
          if (stateObj && ['playing', 'paused'].includes(stateObj.state) && stateObj.attributes.source) {
              console.log(`[SpotifyBrowser] Currently ${stateObj.state} on "${stateObj.attributes.source}". Using that.`);
              deviceNameOrId = stateObj.attributes.source;
          }
      }

      // 2. Fallback: If still no device, try Auto-Select
      if (!deviceNameOrId) {
           // ... (Same auto-select logic as before if you want to keep it, omitted for brevity but safe to keep) ...
           // For now, let's assume the previous fix handled the null config issue.
      }

      console.log(`[SpotifyBrowser] Playing on: "${deviceNameOrId || 'System Default'}"`);

      // 3. Attempt 1: Direct Play
      let result = await this._api.playMedia(uri, type, deviceNameOrId, options);
      
      if (result && result.success) return;

      // 4. Failure Detected - Analyze Why
      const errStr = JSON.stringify(result.error || {});
      console.warn("[SpotifyBrowser] Direct play failed:", errStr);

      const isDeviceError = errStr.includes("no active Spotify player") || 
                            errStr.includes("default player device") ||
                            errStr.includes("Restriction violated") ||
                            errStr.includes("404");

      if (isDeviceError && deviceNameOrId) {
          // A. Fetch Real Device List
          let targetId = null;
          let isTargetActive = false;

          try {
              const res = await this._api.fetchSpotifyPlus('get_spotify_connect_devices');
              let list = [];
              if (res && res.result) {
                  list = res.result.devices || res.result.Items || (Array.isArray(res.result) ? res.result : []);
              }

              // B. Find the device by Name or ID
              const match = list.find(d => 
                  (d.name && d.name === deviceNameOrId) || 
                  (d.Name && d.Name === deviceNameOrId) || 
                  (d.id && d.id === deviceNameOrId)
              );
              
              if (match) {
                  targetId = match.id || match.Id;
                  isTargetActive = match.is_active || match.IsActiveDevice;
              } else if (deviceNameOrId.length > 20) {
                  // Blind ID trust
                  targetId = deviceNameOrId;
              }

          } catch (e) { console.warn("Device scan failed", e); }

          if (targetId) {
              // C. SMART DECISION: Active vs Idle
              if (isTargetActive) {
                  // SCENARIO: Paused but Active. 
                  // The previous failure was likely due to Name-vs-ID mismatch or context issues.
                  // We DO NOT transfer (wake up). We just retry with the ID.
                  console.log(`[SpotifyBrowser] Device ${targetId} is active. Retrying with ID...`);
                  result = await this._api.playMedia(uri, type, targetId, options);
                  if (result && result.success) return;

              } else {
                  // SCENARIO: Truly Idle.
                  // Device is off/asleep. We MUST transfer to wake it up.
                  this._showToast(`Waking up player...`);
                  console.log(`[SpotifyBrowser] Device idle. Transferring to ${targetId}...`);
                  
                  await this._api.fetchSpotifyPlus('player_transfer_playback', { device_id: targetId, play: true });
                  
                  // Wait a moment for wake-up
                  await new Promise(r => setTimeout(r, 1000));
                  
                  // Retry Play
                  result = await this._api.playMedia(uri, type, targetId, options);
                  if (result && result.success) return;
              }
          }
      }
      
      // 5. Final Failure Alert
      if (result && !result.success) {
          let msg = "Could not find an active player.";
          if (result.error && result.error.message) msg = result.error.message;
          
          this._showAlert(
              "Playback Failed", 
              msg,
              [{ label: "Close", action: () => this._closeAlert() }]
          );
      }
  }

  // --- Alert System ---
  _showAlert(title, message, buttons = []) {
      const backdrop = this.shadowRoot.getElementById('alert-backdrop');
      const titleEl = this.shadowRoot.getElementById('alert-title');
      const msgEl = this.shadowRoot.getElementById('alert-message');
      const actionsEl = this.shadowRoot.getElementById('alert-actions');
      
      if (!backdrop) return;
      
      titleEl.innerText = title;
      msgEl.innerText = message;
      actionsEl.innerHTML = ''; // Clear old buttons
      
      buttons.forEach(btnConfig => {
          const btn = document.createElement('button');
          btn.className = `alert-btn ${btnConfig.primary ? 'primary' : ''}`;
          btn.innerText = btnConfig.label;
          btn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (btnConfig.action) btnConfig.action();
          });
          actionsEl.appendChild(btn);
      });
      
      backdrop.classList.add('visible');
  }

  _closeAlert() {
      const backdrop = this.shadowRoot.getElementById('alert-backdrop');
      if (backdrop) backdrop.classList.remove('visible');
  }
  
  

  _renderNowPlaying(trackData) {
      const npEl = this.shadowRoot.getElementById('queue-now-playing');
      if (!npEl) return;

      // 1. Missing Data Logic
      if (!trackData || !trackData.name) {
          if (this._isPlaying && this._lastTrackState) return; 
          if (!this._lastTrackState) {
              if (Templates.emptyPlayer) npEl.innerHTML = Templates.emptyPlayer();
              else npEl.innerHTML = `<div style="padding:16px; opacity:0.5;">Nothing Playing</div>`;
          }
          if (this._progressTimer) clearInterval(this._progressTimer);
          return; 
      }

      const qSettings = this._config.queue_settings || { enabled: false, components: {} };
      const showMini = qSettings.enabled;
      
      const trackId = trackData.id || (trackData.uri ? trackData.uri.split(':')[2] : null);
      let isFav = false;
      if (trackId && this._favCache.has(trackId)) {
          isFav = this._favCache.get(trackId);
      } else if (this._currentContextUri === 'spotify:user:me:collection') {
          isFav = true;
          this._favCache.set(trackId, true);
      }

      // --- NEW: Fetch Device Name ---
      let currentVol = 0;
      let deviceName = '';
      if (this._hass && this._config.entity && this._hass.states[this._config.entity]) {
          const attrs = this._hass.states[this._config.entity].attributes;
          currentVol = attrs.volume_level || 0;
          deviceName = attrs.source || ''; 
      }

      const artistText = trackData.artists 
          ? trackData.artists.map(a => a.name).join(', ') 
          : '';

      const newState = {
          id: trackId,
          title: trackData.name,
          artist: artistText,
          device: deviceName, // New State
          img: trackData.image_url || (trackData.album?.images?.[0]?.url) || '',
          playing: this._isPlaying,
          fav: isFav,
          view: this._showVolumeView,
          vol: currentVol
      };

      const oldState = this._lastTrackState || {};
      const domIsValid = npEl.querySelector('.queue-title') !== null;

      let songChanged = oldState.id !== newState.id;
      // Fuzzy match check (same as before)
      if (songChanged && oldState.title && newState.title) {
          const clean = (str) => str.toLowerCase().replace(/\(.*\)/g, '').replace(/\[.*\]/g, '').trim();
          if (clean(oldState.title) === clean(newState.title)) songChanged = false;
      }

      const needsFullRender = !this._lastTrackState || 
                              oldState.view !== newState.view || 
                              songChanged || 
                              !domIsValid;

      if (needsFullRender) {
          // --- FULL RENDER ---
          // Pass 'deviceName' as the last argument
          let html = Templates.nowPlayingRow(trackData, this._isPlaying, showMini, isFav, qSettings.components, this._showVolumeView, currentVol, deviceName);
          
          if (oldState.img === newState.img) {
               html = html.replace('style="background-image:', 'style="animation: none !important; background-image:');
          }
          npEl.innerHTML = html;
          this._attachNowPlayingListeners(npEl, trackData, trackId);
          this._startProgressTimer();
      } 
      else {
          // --- GRANULAR UPDATES ---
          if (oldState.title !== newState.title) {
              const el = npEl.querySelector('.queue-title');
              if (el) el.innerText = newState.title;
          }
          if (oldState.artist !== newState.artist) {
              const el = npEl.querySelector('.queue-artist');
              if (el) el.innerText = newState.artist;
          }
          
          // NEW: Device Name Update
          if (oldState.device !== newState.device) {
              const el = npEl.querySelector('.device-name-text');
              if (el) el.innerText = newState.device;
              // Toggle visibility based on whether we have a device name
              const row = npEl.querySelector('.queue-device-row');
              if (row) row.style.display = newState.device ? 'flex' : 'none';
          }

          if (newState.img && (!oldState.img || oldState.img === '')) {
              const el = npEl.querySelector('.queue-art.large');
              if (el) el.style.backgroundImage = `url('${newState.img}')`;
          }
          if (oldState.playing !== newState.playing) {
              const btn = npEl.querySelector('#queue-hero-play-btn');
              if (btn) {
                  btn.innerHTML = newState.playing 
                    ? `<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
                    : `<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
              }
          }
          if (oldState.fav !== newState.fav && !newState.view) {
              const btn = npEl.querySelector('[data-action="mini-fav"]');
              if (btn) {
                  if (newState.fav) btn.classList.add('is-favorite');
                  else btn.classList.remove('is-favorite');
                  btn.dataset.id = newState.id; 
              }
          }
          if (oldState.vol !== newState.vol && newState.view) {
              const slider = npEl.querySelector('#mini-vol-slider');
              if (slider && this.shadowRoot.activeElement !== slider) {
                  slider.value = Math.round(newState.vol * 100);
              }
          }
          if (oldState.id !== newState.id) {
              this._attachNowPlayingListeners(npEl, trackData, trackId);
          }
      }

      this._lastTrackState = newState;
  }
  

  _attachNowPlayingListeners(npEl, trackData, trackId) {
      
      // --- SMART SKIP HANDLER ---
      const handleSkip = (direction) => {
          const isNext = direction === 'next';
          const action = isNext ? 'player_media_skip_next' : 'player_media_skip_previous';

          // 1. Capture Stale ID (Anti-Bounce)
          // We record the ID we are leaving so we can ignore it if HA reports it back
          this._staleTrackId = trackId; 
          this._queueLockTime = Date.now() + 3000; 

          // 2. Optimistic Update (Visual Prediction)
          if (isNext) {
              const queueList = this.shadowRoot.getElementById('queue-list');
              const nextRow = queueList ? queueList.querySelector('.queue-item') : null;
              
              if (nextRow) {
                  // Scrape metadata
                  const title = nextRow.querySelector('.queue-title')?.innerText || 'Loading...';
                  const artist = nextRow.querySelector('.queue-artist')?.innerText || '';
                  
                  // Grab the REAL ID if available (prevents flicker)
                  const realNextId = nextRow.dataset.trackId || nextRow.dataset.id || 'optimistic-next';
                  
                  let imgUrl = '';
                  const artEl = nextRow.querySelector('.queue-art');
                  if (artEl) {
                      const bg = window.getComputedStyle(artEl).backgroundImage;
                      if (bg && bg !== 'none') imgUrl = bg.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
                  }

                  // Force Header Update
                  this._renderNowPlaying({
                      name: title,
                      artists: [{ name: artist }],
                      image_url: imgUrl,
                      id: realNextId 
                  });
                  
                  // Hide the row we just promoted
                  nextRow.style.display = 'none';
              }
          } else {
              // For Previous, just dim the UI to acknowledge click
              const content = npEl.querySelector('.queue-item-content');
              if (content) content.style.opacity = '0.5';
          }

          // 3. Send API Command
          this._api.fetchSpotifyPlus(action, {}, false);

          // 4. Poll Aggressively (0.5s, 1.5s, 2.5s, 4.0s)
          // Triggers multiple updates to catch the new song as soon as possible
          [500, 1500, 2500, 4000].forEach(delay => {
              setTimeout(() => {
                  this._api.fetchSpotifyPlus('trigger_scan_interval', {}, false);
                  this._loadQueue(); 
              }, delay);
          });
      };

      // --- BIND SKIP BUTTONS ---
      const prevBtn = npEl.querySelector('[data-action="mini-prev"]');
      const nextBtn = npEl.querySelector('[data-action="mini-skip"]');
      
      if (prevBtn) prevBtn.onclick = (e) => { e.stopPropagation(); handleSkip('prev'); };
      if (nextBtn) nextBtn.onclick = (e) => { e.stopPropagation(); handleSkip('next'); };

      // --- BIND PLAY/PAUSE (Smart Toggle) ---
      const playBtn = npEl.querySelector('#queue-hero-play-btn');
      if (playBtn) {
          playBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              // Optimistic Toggle
              const previousState = this._isPlaying;
              this._isPlaying = !this._isPlaying;
              this._renderNowPlaying(trackData); 
              
              const result = await this._api.togglePlayback(this._isPlaying);
              
              // Revert on Failure
              if (!result || !result.success) {
                  this._isPlaying = previousState;
                  this._renderNowPlaying(trackData);
              } else {
                  // Success: Trigger a refresh shortly after to sync state
                  setTimeout(() => this._api.fetchSpotifyPlus('trigger_scan_interval', {}, false), 1000);
              }
          });
      }

      // --- VOLUME VIEW vs STANDARD VIEW ---
      if (this._showVolumeView) {
          // Volume Slider Logic
          const slider = npEl.querySelector('#mini-vol-slider');
          const closeBtn = npEl.querySelector('[data-action="close-volume"]');
          
          if (slider) {
              slider.addEventListener('change', (e) => {
                  e.stopPropagation();
                  this._api.setVolume(e.target.value / 100);
              });
          }
          if (closeBtn) {
              closeBtn.onclick = (e) => {
                  e.stopPropagation();
                  this._showVolumeView = false;
                  this._renderNowPlaying(trackData);
              };
          }
      } else {
          // Standard Controls Logic
          const shuffleBtn = npEl.querySelector('[data-action="mini-shuffle"]');
          const volBtn = npEl.querySelector('[data-action="mini-volume"]');
          const deviceBtn = npEl.querySelector('[data-action="mini-device"]');
          const favBtn = npEl.querySelector('[data-action="mini-fav"]');

          if(deviceBtn) {
              deviceBtn.onclick = (e) => {
                  e.stopPropagation();
                  this._openDeviceMenu();
              };
          }
          if(shuffleBtn) {
              shuffleBtn.onclick = (e) => { 
                  e.stopPropagation(); 
                  this._api.fetchSpotifyPlus('player_shuffle', { state: 'true' }, false); 
              };
          }
          if(volBtn) {
              volBtn.onclick = (e) => {
                  e.stopPropagation();
                  this._showVolumeView = true;
                  this._renderNowPlaying(trackData);
              };
          }

          // --- FAVORITE BUTTON (With ID Validation) ---
          if(favBtn) {
              // Valid ID Check: Must be >15 chars and NOT contain 'optimistic'
              const isValidId = trackId && trackId.length > 15 && !trackId.includes('optimistic');

              if (isValidId) {
                  // Check Status
                  this._api.fetchSpotifyPlus('check_track_favorites', { ids: trackId }).then(res => {
                     if (res && res.result && res.result[trackId]) favBtn.classList.add('is-favorite');
                  });
                  
                  // Handle Click
                  favBtn.onclick = (e) => {
                      e.stopPropagation();
                      fireHaptic('selection');
                      this._toggleTrackFavorite(trackId, favBtn.classList.contains('is-favorite'), favBtn);
                  };
              } else {
                  // Invalid ID (Optimistic state): Prevent errors, just stop propagation
                  favBtn.onclick = (e) => e.stopPropagation();
              }
          }
      }
  }
  
  
  
   _startProgressTimer() {
      if (this._progressTimer) clearInterval(this._progressTimer);
      
      const updateBar = () => {
          if (!this._hass || !this._config.entity) return;
          const stateObj = this._hass.states[this._config.entity];
          
          // Safety check: needs duration to calculate %
          if (!stateObj || !stateObj.attributes.media_duration) return;
          
          const duration = stateObj.attributes.media_duration; // seconds
          let position = stateObj.attributes.media_position; // seconds
          const updatedAt = new Date(stateObj.attributes.media_position_updated_at).getTime();
          
          // Calculate extrapolated position based on time elapsed since update
          // (Home Assistant only updates position on state change, so we must estimate)
          if (stateObj.state === 'playing') {
              const now = Date.now();
              const diff = (now - updatedAt) / 1000;
              position += diff;
          }
          
          // Calculate Percentage
          const percent = Math.min(100, Math.max(0, (position / duration) * 100));
          
          const bar = this.shadowRoot.getElementById('mini-progress-bar');
          if (bar) {
              bar.style.width = `${percent}%`;
          }
      };

      // Run immediately then every 1s
      updateBar();
      this._progressTimer = setInterval(updateBar, 1000);
  }
}
customElements.define('spotify-browser-card', SpotifyBrowserCard);
