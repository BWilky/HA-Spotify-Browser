import { CARD_CSS } from './styles.js';
import { SpotifyApi } from './api.js';
import { Templates } from './templates.js';
import { msToTime, fireHaptic } from './utils.js'; 

class SpotifyBrowserCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    
    // State
    this._isOpen = false;
    this._hass = null;
    this._config = {};
    this._userCountry = 'US'; 
    this._currentUserId = null; 
    this._api = null; // API Module Instance

    // Playback State
    this._currentTrackUri = null;
    this._currentContextUri = null;
    this._isPlaying = false;
    this._lastOptimisticUpdate = 0; 
    
    // Scan Interval Timer (NEW)
    this._scanTimer = null;

    // Navigation & Caching
    this._history = []; 
    this._pageCache = new Map(); 
    this._maxCacheSize = 15;
    this._currentPageId = null;
    this._homeLastUpdated = 0;

    // Pagination State Store
    this._offsets = { favorites: 0, artists: 0, albums: 0, recent: 0 };
    this._totals = { favorites: null, artists: null, albums: null, recent: null };
    this._fetching = { favorites: false, artists: false, albums: false, recent: false };
    this._followingPlaylistIds = new Set(); 
    
    // Pagination (Search)
    this._searchOffset = 0;
    this._searchTotal = null;
    this._isFetchingSearch = false;
    
    // FIX: Pagination (Context / Liked Songs)
    this._contextOffset = 0;
    this._contextTotal = null;
    this._contextType = null; // 'likedsongs', 'playlist', etc.
    this._isFetchingContext = false;

    // Search
    this._searchDebounceTimer = null;
    this._searchAutoCloseTimer = null; 

    // Auto Close
    this._timer = null;
    this._closeTimer = null; 
    
    // Swipe Logic
    this._touchStartY = 0;
    this._touchCurrentY = 0;
    this._touchStartX = 0;
    this._touchCurrentX = 0;
    this._touchStartTime = 0; // NEW
    
    // FIX: Add a lock timer to prevent stale API data from overwriting optimistic clicks
    this._queueLockTime = 0;
    
    
    // Pull-to-Refresh State
    this._ptrStartY = 0;
    this._ptrCurrentY = 0;
    this._isDraggingPtr = false;
    this._ptrLocked = false; // NEW: Track if we have already triggered the "ready" haptic
    
    // FIX: Cache favorite states to prevent UI flickering
    this._favCache = new Map();
    
    
    // Bindings
    this._boundResetTimer = this._resetTimer.bind(this);
    this._boundHashCheck = this._checkHash.bind(this);
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
  }
  
  // --- Lovelace Editor Configuration ---
  
 

  setConfig(config) {
    // Handle entity vs entity_id alias
    const targetEntity = config.entity || config.entity_id;

    if (!targetEntity) {
      throw new Error("You need to define a spotify 'entity' (e.g., media_player.spotifyplus_xyz)");
    }

    // Parse homescreen config
    let homescreenConfig = { cache: true, expiry: 60 };
    
    if (config.homescreen) {
        if (Array.isArray(config.homescreen)) {
            // Handle list format: - cache: true
            config.homescreen.forEach(item => {
                if (item.cache !== undefined) homescreenConfig.cache = item.cache;
                if (item.expiry !== undefined) homescreenConfig.expiry = item.expiry;
            });
        } else if (typeof config.homescreen === 'object') {
            // Handle object format: homescreen: { cache: true }
            homescreenConfig = { ...homescreenConfig, ...config.homescreen };
        }
    }

    this._config = {
      auto_close_seconds: 0,
      default_device: null, 
      madeforyou: [],
      scan_interval: null,
      queue_miniplayer: false,
      ...config,
      entity: targetEntity,
      homescreen: homescreenConfig,
      home_order: ['madeforyou', 'recent', 'favorites', 'artists', 'albums'], // Default Order
      desktop_madeforyou_pills: false // Default Off
    };
    
    this._api = new SpotifyApi(null, this._config.entity);
  }

  set hass(hass) {
    this._hass = hass;
    if (this._api) this._api.updateHass(hass);
    
    // --- FIX: Edit Mode Detection ---
    // We assume we are in edit mode if we are inside a 'hui-card-preview' (Config Panel)
    // OR if the main Lovelace panel has editMode=true.
    try {
        const isPreview = this.closest('hui-card-preview') !== null;
        
        // Deep check for dashboard edit mode
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
    } catch (e) {
        // Ignore errors during DOM traversal
    }
    
    // Only proceed if we have a valid entity state
    if (this._config.entity && this._hass.states[this._config.entity]) {
        // Check for optimistic updates (prevent jitter)
        if (Date.now() - this._lastOptimisticUpdate > 2000) {
            const stateObj = this._hass.states[this._config.entity];
            const attrs = stateObj.attributes;
            
            const newTrackUri = attrs.media_content_id || null;
            const newContextUri = attrs.sp_context_uri || null; 
            const isPlaying = stateObj.state === 'playing';

            // If state changed, update internal state and UI
            if (newTrackUri !== this._currentTrackUri || newContextUri !== this._currentContextUri || isPlaying !== this._isPlaying) {
                this._currentTrackUri = newTrackUri;
                this._currentContextUri = newContextUri;
                this._isPlaying = isPlaying;
                
                this._updateActiveElement();
                this._updateHeroPlayButton(); 
                
                // Check if Queue is open and needs update
                const wrapper = this.shadowRoot.getElementById('browser-wrapper');
                if (wrapper && wrapper.classList.contains('queue-open')) {
                    // 1. Instant Header Update
                    this._renderNowPlaying(this._getEntityNowPlaying());
                    
                    // 2. Smart Animation Logic
                    if (Date.now() > this._queueLockTime) {
                        const queueList = this.shadowRoot.getElementById('queue-list');
                        if (queueList) {
                            const allRows = Array.from(queueList.querySelectorAll('.queue-item'));
                            
                            // Search for new song in the list
                            const matchIndex = allRows.findIndex(row => {
                                const btn = row.querySelector('.queue-row-play-btn');
                                return btn && btn.dataset.uri === newTrackUri;
                            });

                            if (matchIndex > -1) {
                                // CASE A: "Next" (Found in list) -> Zipper Remove Upwards
                                const rowsToRemove = allRows.slice(0, matchIndex + 1);
                                rowsToRemove.forEach((r, i) => {
                                    setTimeout(() => r.classList.add('removing'), i * 30);
                                });
                            } else {
                                // CASE B: "Previous" / Jump (Not in list) -> Push Old Song Down
                                // If we have the data for the song that just finished, inject it at the top
                                if (this._lastTrackData && this._lastTrackData.uri !== newTrackUri) {
                                    const tempDiv = document.createElement('div');
                                    tempDiv.innerHTML = Templates.queueRow(this._lastTrackData);
                                    const newRow = tempDiv.firstElementChild;
                                    
                                    newRow.classList.add('adding-top');
                                    queueList.prepend(newRow);
                                    
                                    // Attach listener to new row immediately
                                    const playBtn = newRow.querySelector('.queue-row-play-btn');
                                    if (playBtn) {
                                        const uri = this._lastTrackData.uri;
                                        playBtn.addEventListener('click', (e) => {
                                            e.stopPropagation();
                                            this._playMediaSafe(uri, 'track', this._config.default_device);
                                        });
                                    }
                                }
                            }
                        }
                        
                        // 3. Background Refresh (Delayed to let animation finish)
                        setTimeout(() => this._loadQueue(), 800);
                    } else {
                        // Manual click (already animated), refresh immediately
                        this._loadQueue();
                    }
                }
            }
        }
    }

    // Lazy Load Home if open
    if (this._hass && this._isOpen && this._currentPageId === 'home') {
        const homePage = this.shadowRoot.getElementById('page-home');
        
        // FIX: Strict string check
        if (homePage && homePage.dataset.loaded !== "true" && homePage.dataset.loading !== "true") {
            this._loadHomeData(homePage);
        }
    }
  } // End of set hass
  

  connectedCallback() {
    // 1. Always Render first (Critical for Editor Preview)
    if (!this.shadowRoot.getElementById('browser-wrapper')) {
        this.render();
        this._attachEventListeners();
    }

    // 2. Initialize Page State if missing
    if (!this._currentPageId) {
        this._navigateTo('home');
    }

    // 3. Singleton Check (Prevent multiple popups)
    // If another instance is already active, we stop here.
    // This allows the Editor Preview to render (Step 1) but prevents it
    // from stealing global focus or hash events.
    if (window.SpotifyBrowserActiveInstance && window.SpotifyBrowserActiveInstance.isConnected && window.SpotifyBrowserActiveInstance !== this) {
        // console.log("SpotifyBrowser: Secondary instance detected (likely Editor). UI rendered, but logic disabled.");
        return; 
    }
    
    // 4. Register as the Main Active Instance
    window.SpotifyBrowserActiveInstance = this;
    this._checkHash();
  }

  disconnectedCallback() {
    if (window.SpotifyBrowserActiveInstance === this) {
        window.SpotifyBrowserActiveInstance = null;
    }
    window.removeEventListener('hashchange', this._boundHashCheck);
    window.removeEventListener('location-changed', this._boundHashCheck); 
    this._stopAutoCloseListener();
    this._stopSearchAutoClose(); // <--- ADD THIS LINE
    this._stopScanTimer();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>${CARD_CSS}</style>
      ${Templates.mainStructure()}
    `;
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

    this._attachPullToRefresh(page);
    return page;
  }

  
  _attachPullToRefresh(pageEl) {
      const ptrEl = pageEl.querySelector('.pull-to-refresh');
      const spinner = pageEl.querySelector('.ptr-spinner');
      const contentEl = pageEl.querySelector('.scroll-content');
      
      // FIX: Select EITHER .hero-banner (Playlist/Album) OR .artist-hero (Artist)
      const heroBanner = pageEl.querySelector('.hero-banner, .artist-hero');
      const hasHero = !!heroBanner;
      
      if (!ptrEl) return;

      // 1. Touch Start
      pageEl.addEventListener('touchstart', (e) => {
          if (pageEl.scrollTop === 0) {
              this._ptrStartY = e.touches[0].clientY;
              this._isDraggingPtr = true;
              this._ptrLocked = false; 
              
              // CRITICAL: Disable transitions for instant 1:1 drag physics
              if (contentEl) contentEl.style.transition = 'none';
              if (heroBanner) heroBanner.style.transition = 'none';
              ptrEl.style.transition = 'none';
          }
      }, { passive: true });

      // 2. Touch Move
      pageEl.addEventListener('touchmove', (e) => {
          if (!this._isDraggingPtr) return;
          
          const y = e.touches[0].clientY;
          const dist = y - this._ptrStartY;

          // Only drag if pulling DOWN and at top
          if (dist > 0 && pageEl.scrollTop <= 0) {
              if (e.cancelable && dist > 10) e.preventDefault(); 
              
              // Resistance Physics (0.4 friction)
              const move = Math.pow(dist, 0.85) * 0.6; 
              
              // --- BRANCHING LOGIC ---
              if (hasHero) {
                  // OPTION A: Hero Page -> Height Stretch
                  // Default is 300px. Add drag distance to it.
                  const newHeight = 300 + move;
                  heroBanner.style.height = `${newHeight}px`;
                  
                  // Move spinner down to keep it centered visually
                  ptrEl.style.transform = `translateY(${move * 0.4}px)`;
                  ptrEl.style.opacity = Math.min(1, move / 40);
                  
              } else {
                  // OPTION B: Standard Page -> Slide Content Down
                  if (contentEl) contentEl.style.transform = `translateY(${move}px)`;
                  ptrEl.style.opacity = Math.min(1, move / 40);
                  ptrEl.style.transform = `translateY(${move * 0.5}px)`;
              }

              // Rotate Spinner
              if(spinner) spinner.style.transform = `rotate(${move * 2}deg)`;
              
              // Haptic Feedback (Thump at 100px)
              if (dist > 100 && !this._ptrLocked) {
                  this._ptrLocked = true; 
                  fireHaptic('medium');   
                  if(spinner) spinner.style.color = '#fff'; 
              } else if (dist < 100 && this._ptrLocked) {
                  this._ptrLocked = false; 
                  if(spinner) spinner.style.color = ''; 
              }
              
          } else {
              // Cancel Drag
              this._isDraggingPtr = false;
              this._resetPullState(ptrEl, contentEl, heroBanner, spinner);
          }
      }, { passive: false });

      // 3. Touch End
      pageEl.addEventListener('touchend', (e) => {
          if (!this._isDraggingPtr) return;
          this._isDraggingPtr = false;
          this._ptrLocked = false;
          
          // Re-enable Transitions for the "Snap" effect
          if (contentEl) contentEl.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
          if (heroBanner) heroBanner.style.transition = 'height 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
          ptrEl.style.transition = 'opacity 0.3s, transform 0.3s';
          
          const y = e.changedTouches[0].clientY;
          const dist = y - this._ptrStartY;
          
          if (dist > 100) { 
              // --- TRIGGER REFRESH ---
              
              // 1. Add Class: Activates CSS "Hold" state (Height: 360px or Transform: 60px)
              pageEl.classList.add('is-refreshing');
              
              // 2. Clear Inline Styles: Let the CSS class take over
              // Since transition is re-enabled, this will smoothly snap from DragPos -> 360px
              if (hasHero) heroBanner.style.height = ''; 
              if (contentEl) contentEl.style.transform = ''; 
              ptrEl.style.transform = ''; 
              
              this._refreshCurrentPage();
              
              // 3. Finish (After Delay)
              setTimeout(() => {
                  pageEl.classList.remove('is-refreshing'); // Snaps back to 300px / 0px
                  this._resetPullState(ptrEl, contentEl, heroBanner, spinner);
              }, 1500);
          } else {
              // --- CANCEL ---
              // Snap back to 0 immediately
              this._resetPullState(ptrEl, contentEl, heroBanner, spinner);
          }
      });
  }

  // Helper
  _resetPullState(ptrEl, contentEl, heroBanner, spinner) {
      if (ptrEl) { ptrEl.style.opacity = ''; ptrEl.style.transform = ''; }
      if (contentEl) contentEl.style.transform = '';
      if (heroBanner) heroBanner.style.height = ''; 
      if (spinner) { spinner.style.transform = ''; spinner.style.color = ''; }
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
    if (pageEl.dataset.loading === "true") return;
    try {
      if (!this._hass) return;
      pageEl.dataset.loading = "true";
      
      if (!this._currentUserId) this._userCountry = 'US'; 

      // Reset offsets
      this._offsets = { favorites: 0, artists: 0, albums: 0, recent: 0, madeforyou: 0 };
      this._followingPlaylistIds.clear();

      // FIX: Dynamic Fetching based on Order
      // 1. Filter order list to only include valid sections
      const validSections = ['recent', 'favorites', 'artists', 'albums', 'madeforyou'];
      const order = (this._config.home_order || validSections).filter(k => validSections.includes(k));
      
      // 2. Build Fetch List
      const fetchList = order.map(key => {
          // Skip Made For You if empty
          if (key === 'madeforyou' && (!this._config.madeforyou || this._config.madeforyou.length === 0)) {
              return Promise.resolve();
          }
          return this._fetchSectionData(key, pageEl);
      });

      await Promise.allSettled(fetchList);
      
      this._updateActiveElement(); 
      this._homeLastUpdated = Date.now();
      
    } catch (err) {
      console.error("SpotifyBrowser: Error loading home data:", err);
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

  // --- Event Handling ---

  _onGlobalClick(e) {
      const target = e.target;
      
      // 1. HEADER CONTROLS (Menu & Queue) - Priority Handling
      const menuBtn = target.closest('#menu-btn');
      const queueBtn = target.closest('#queue-btn');
      
      if (queueBtn) {
          e.stopPropagation();
          this._toggleQueue();
          return;
      }

      // FIX: Close Queue if clicking the blurred background area
      // (The pseudo-element ::before registers as a click on the panel itself)
      if (target.id === 'queue-panel') {
          e.stopPropagation();
          this._toggleQueue(); // Close it
          return;
      }

      if (menuBtn) {
          e.stopPropagation();
          this._toggleMenu();
          return;
      }

      if (queueBtn) {
          e.stopPropagation();
          this._toggleQueue();
          return;
      }

      // 2. Check Menu Items
      const menuItem = target.closest('.menu-item');
      if (menuItem) {
          e.stopPropagation();
          this._toggleMenu(); // Close menu
          
          const action = menuItem.dataset.action;
          
          if (action === 'menu-device') {
              this._openDeviceMenu();
          } else if (action === 'menu-refresh') {
              // FIX: Call the new refresh logic
              this._refreshCurrentPage();
          } else if (action === 'menu-library') {
              this._showToast('Library view coming soon...');
          }
          return;
      }

      // 3. Hero Action Buttons (Play/Follow)
      const heroBtn = target.closest('.hero-btn-play, .hero-btn-fav');
      if (heroBtn) {
          e.stopPropagation();
          const action = heroBtn.dataset.action;
          if (action === 'play-context') {
              this._playMediaSafe(heroBtn.dataset.uri, 'playlist', this._config.default_device); 
          } else if (action === 'pause' || action === 'resume') {
              this._api.togglePlayback(action === 'resume');
          } else if (action === 'toggle-album-fav') {
              this._toggleAlbumFavorite(heroBtn.dataset.id, heroBtn.classList.contains('is-favorite'), heroBtn);
          } else if (action === 'toggle-artist-follow') {
              this._toggleArtistFollow(heroBtn.dataset.id, heroBtn.classList.contains('is-favorite'), heroBtn);
          }
          return;
      }

      // 4. Track Actions (Save/Queue)
      const actionBtn = target.closest('.track-action-btn');
      if (actionBtn) {
          e.stopPropagation();
          const action = actionBtn.dataset.action;
          const trackItem = actionBtn.closest('.artist-top-track, .track-row');
          if (trackItem) {
             const id = trackItem.dataset.trackId || trackItem.dataset.id;
             if (action === 'save') {
                 this._toggleTrackFavorite(id, actionBtn.classList.contains('is-favorite'), actionBtn);
             } else if (action === 'queue') {
                 const uri = trackItem.dataset.uri;
                 console.log("[SpotifyBrowser] Queue Add URI:", uri); // DEBUG LOG

                 if (uri && uri !== 'undefined') {
                     // Try sending as a string first (standard for YAML)
                     // Some integrations prefer a list: [uri], but start with string matching your YAML.
                     this._api.fetchSpotifyPlus('add_player_queue_items', { uris: uri }, false)
                        .then(() => {
                            this._showToast("Added to Queue");
                            
                            // Refresh queue if open
                            const wrapper = this.shadowRoot.getElementById('browser-wrapper');
                            if (wrapper && wrapper.classList.contains('queue-open')) {
                                setTimeout(() => this._loadQueue(), 1000); 
                            }
                        })
                        .catch(err => {
                            console.error("[SpotifyBrowser] Queue Add Failed:", err);
                            this._showToast("Failed to add");
                        });
                 } else {
                     console.warn("[SpotifyBrowser] No URI found on track element");
                     this._showToast("Error: No Track URI");
                 }
             }
          }
          return;
      }

      // 5. Section Controls (See All / Scroll)
      
      const sectionBtn = target.closest('[data-action="toggle-view"], [data-action="scroll-right"], [data-action="search-view-all"]');
      if (sectionBtn) {
          e.stopPropagation();
          const action = sectionBtn.dataset.action;
          
          if (action === 'search-view-all') {
              const type = sectionBtn.getAttribute('data-search-type');
              const query = sectionBtn.getAttribute('data-search-query');
              
              console.log(`[SpotifyBrowser] See All Clicked: Type=${type}, Query=${query}`);
              
              if (query && query !== 'undefined') {
                  this._navigateTo(`search-all:${type}:${encodeURIComponent(query)}`);
              }
              return;
          }
      
          const section = sectionBtn.closest('.home-section');
          if (!section) return;
          
          const carousel = section.querySelector('.carousel-layout, .grid-layout');
          
          if (action === 'scroll-right') {
               if (carousel) carousel.scrollBy({ left: 300, behavior: 'smooth' });
          } 
          else if (action === 'toggle-view') {
               const isGrid = carousel.classList.contains('grid-layout');
               const scrollBtn = section.querySelector('.scroll-btn');
               
               if (isGrid) {
                   carousel.classList.remove('grid-layout');
                   carousel.classList.add('carousel-layout');
                   sectionBtn.innerText = "See All";
                   if(scrollBtn) scrollBtn.style.display = 'flex';
               } else {
                   carousel.classList.remove('carousel-layout');
                   carousel.classList.add('grid-layout');
                   sectionBtn.innerText = "Collapse";
                   if(scrollBtn) scrollBtn.style.display = 'none';
                   
                   const sectionId = section.dataset.sectionId;
                   if (sectionId && !sectionId.startsWith('search')) {
                       const homePage = this.shadowRoot.getElementById('page-home');
                       if (homePage) this._fetchSectionData(sectionId, homePage);
                   }
               }
          }
          return;
      }

      // 6. Play Overlay (Thumbnail Click)
      const playBtn = target.closest('.play-btn-overlay');
      if (playBtn) {
          e.stopPropagation();
          const card = playBtn.closest('.media-card, .artist-top-track');
          
          if (card) {
              const type = card.dataset.type;
              const uri = card.dataset.uri;

              // Special Case: Liked Songs
              if (type === 'likedsongs') {
                  this._api.fetchSpotifyPlus('player_media_play_track_favorites', { 
                      device_id: '*', 
                      shuffle: true, 
                      delay: 0.5 
                  }, false);
                  this._showToast("Playing Liked Songs...");
              } 
              // FIX: Recommended Playlists must be played as Context
              else if (type === 'playlist-recommended') {
                  this._api.fetchSpotifyPlus('player_media_play_context', {
                      context_uri: uri
                  }, false);
                  this._showToast("Starting Playlist...");
              }
              // Standard Playback (Artist/Album/Track)
              else {
                  this._playMediaSafe(uri, type);
              }
          }
          return;
      }

      // 7. Track Row Click (Context Playback)
      const trackRow = target.closest('.track-row');
      if (trackRow) {
           const trackUri = trackRow.dataset.uri;
           const listContainer = trackRow.closest('.track-list');
           let contextUri = listContainer ? listContainer.dataset.contextUri : null;
           
           if (contextUri) {
               // FIX: Swap URI for Liked Songs playback
               // Spotify API requires 'spotify:collection:tracks' to play Favorites with an offset
               if (contextUri === 'spotify:user:me:collection') {
                   contextUri = 'spotify:collection:tracks';
               }

               this._api.fetchSpotifyPlus('player_media_play_context', { 
                   context_uri: contextUri, 
                   offset_uri: trackUri 
               }, false);
           } else {
               // Play single track
               this._api.playMedia(trackUri, 'track', this._config.default_device);
           }
           return;
      }

      // 7. Navigation & Cards (Click on Card Body)
      const card = target.closest('.interactive');
      if (card && !playBtn && !trackRow) {
          
          // FIX: Block Drilldown for Recommended Playlists
          // (These use a restricted API that doesn't allow fetching track lists)
          if (card.dataset.type === 'playlist-recommended') {
              this._showToast("Cannot Expand Playlist Due to Spotify API Limitation");
              return;
          }

          const id = card.dataset.id;
          const type = card.dataset.type;
          const title = card.dataset.title;
          const subtitle = card.dataset.subtitle;
          
          if (id && type) {
              this._navigateTo(`${type}:${id}`, { title, type, subtitle });
          }
      }
      
      // 8. Global Auto-Close Logic (Menus & Popups)
      const menu = this.shadowRoot.getElementById('dropdown-menu');
      
      // Close Menu if open and we didn't click the menu button (handled at top)
      if (menu && menu.classList.contains('visible')) {
          menu.classList.remove('visible');
      }
      
      // Close Device Popup
      if (target.closest('.device-close-btn') || target.classList.contains('device-popup-backdrop')) {
           this._closeDevicePopup();
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

      console.log(`[SpotifyBrowser] DrillDown Image found: ${imgUrl}`);

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

    if (closeBtn) closeBtn.addEventListener('click', this._boundCloseBrowser);
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
  
  _handleQueueItemClick(e) {
      // 1. Check if we clicked a Play Button
      const btn = e.target.closest('.queue-row-play-btn');
      if (!btn) return; 
      
      e.stopPropagation();
      const uri = btn.dataset.uri;
      if (!uri) return;

      // --- OPTIMISTIC UI UPDATE ---
      const row = btn.closest('.queue-item');
      
      if (row) {
          // 1. Scrape Data for Header
          const titleEl = row.querySelector('.queue-title');
          const artistEl = row.querySelector('.queue-artist');
          const artEl = row.querySelector('.queue-art');
          
          let imgUrl = '';
          if (artEl) {
              const bg = window.getComputedStyle(artEl).backgroundImage;
              if (bg && bg !== 'none') {
                  imgUrl = bg.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
              }
          }

          const optimisticTrack = {
              name: titleEl ? titleEl.innerText : 'Loading...',
              artists: artistEl ? [{ name: artistEl.innerText }] : [],
              image_url: imgUrl,
              uri: uri
          };
          
          this._isPlaying = true; 
          this._renderNowPlaying(optimisticTrack);
          
          // FIX: Lock the header for 3 seconds. 
          // This prevents the immediate API refresh from reverting the text.
          this._queueLockTime = Date.now() + 3000;
          this._lastOptimisticUpdate = Date.now(); 
          
          // 2. ANIMATE REMOVAL (The Slide Up Effect)
          const listEl = this.shadowRoot.getElementById('queue-list');
          if (listEl) {
              const allRows = Array.from(listEl.querySelectorAll('.queue-item'));
              const clickedIndex = allRows.indexOf(row);
              
              if (clickedIndex > -1) {
                  // Remove clicked row AND everything before it
                  const rowsToRemove = allRows.slice(0, clickedIndex + 1);
                  
                  rowsToRemove.forEach((r, i) => {
                      setTimeout(() => {
                          r.classList.add('removing');
                      }, i * 30); 
                  });
              }
          }
      }

      // --- API ACTIONS ---
      if (this._currentContextUri) {
          this._api.fetchSpotifyPlus('player_media_play_context', { 
              context_uri: this._currentContextUri,
              offset_uri: uri 
          }, false);
      } else {
          this._playMediaSafe(uri, 'track', this._config.default_device);
      }
      
      // 3. Trigger actual refresh (Wait for animation to finish)
      setTimeout(() => {
          this._loadQueue();
      }, 1200);
  }
  
  // --- Hash & Visibility Management ---

  _checkHash() {
    const hash = window.location.hash;
    if (hash === '#spotify-browser') {
      this._openBrowser();
    } else if (this._isOpen) {
      this._closeUI(); 
    }
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
    }
    
    const pageContainer = this.shadowRoot.getElementById('page-container');
    
    // FIX: Expire Logic for Home
    const expiryMs = (this._config.homescreen?.expiry ?? 60) * 60 * 1000;
    const isExpired = (Date.now() - this._homeLastUpdated) > expiryMs;
    
    const homePage = this.shadowRoot.getElementById('page-home');
    if (isExpired && homePage) {
        console.log("[SpotifyBrowser] Home cache expired. Forcing reload.");
        homePage.dataset.loaded = "false";
        homePage.dataset.loading = "false"; // Safety reset
    }

    if (!this._currentPageId || (pageContainer && pageContainer.children.length === 0)) {
        this._navigateTo('home');
    } else if (this._currentPageId === 'home') {
        // FIX: Check explicitly for !== "true" because !"false" evaluates to false in JS
        if (homePage && homePage.dataset.loaded !== "true" && homePage.dataset.loading !== "true") {
            this._loadHomeData(homePage);
        }
    }
  }

  _closeBrowser() {
    if (window.location.hash === '#spotify-browser') {
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
          console.log("[SpotifyBrowser] Stopped Scan Interval");
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

          const [tracksRes, albumsRes, playlistsRes] = await Promise.all([tracksReq, albumsReq, playlistsReq]);

          let tracks = [];
          if (tracksRes && tracksRes.result) tracks = Array.isArray(tracksRes.result) ? tracksRes.result : tracksRes.result.tracks;
          const trackContainer = pageEl.querySelector('.artist-track-grid');
          if (trackContainer && tracks && tracks.length > 0) {
              const top8 = tracks.slice(0, 8);
              trackContainer.innerHTML = top8.map(track => Templates.artistTopTrack(track)).join('');
              const trackIds = top8.map(t => t.id);
              this._checkFavorites(trackIds, pageEl);
          }

          const albumContainer = pageEl.querySelector('#artist-albums');
          if (albumContainer && albumsRes && albumsRes.result && albumsRes.result.items) {
               albumContainer.innerHTML = albumsRes.result.items.map(item => Templates.mediaCard(item, 'album')).join('');
          }

          const plContainer = pageEl.querySelector('#artist-playlists');
          if (plContainer && playlistsRes && playlistsRes.playlists && playlistsRes.playlists.items) {
              plContainer.innerHTML = playlistsRes.playlists.items.map(item => Templates.mediaCard(item, 'playlist')).join('');
          }

          pageEl.dataset.loaded = "true";
          this._updateActiveElement(); 
      } catch (e) {
          console.error("Error loading artist", e);
      } finally {
          pageEl.dataset.loading = "false";
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
      
      listEl.innerHTML = '<div style="padding:32px;text-align:center;color:#b3b3b3">Searching for devices...</div>';
      
      try {
          const devicesRes = await this._api.fetchSpotifyPlus('get_player_devices', { refresh: true });
          if (devicesRes && devicesRes.result) {
              this._renderDeviceListInternal(devicesRes.result);
          } else {
              // No result object -> Treat as empty
              this._renderDeviceListInternal([]);
          }
      } catch (e) {
          console.error("Device load failed", e);
          // Treat error as empty/retry state
          this._renderDeviceListInternal([]);
      }
  }

  _renderDeviceListInternal(devices) {
      const listEl = this.shadowRoot.getElementById('device-list');
      if(!listEl) return;

      // FIX: Handle Empty List
      if (!devices || devices.length === 0) {
          listEl.innerHTML = Templates.emptyDevices();
          
          // Bind Refresh Button
          const refreshBtn = listEl.querySelector('.device-refresh-btn');
          if (refreshBtn) {
              refreshBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  this._loadDeviceList(); // Reload
              });
          }
          return;
      }

      devices.sort((a, b) => {
          if (a.is_active === b.is_active) return a.name.localeCompare(b.name);
          return a.is_active ? -1 : 1;
      });
      
      const defaultDeviceName = this._config.default_device;
      
      listEl.innerHTML = devices.map(device => {
          const isActive = device.is_active;
          const isDefault = defaultDeviceName && device.name === defaultDeviceName;
          const activeClass = isActive ? 'active' : '';
          
          // Computer Icon vs Speaker Icon based on type? (Optional, generic for now)
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
      
      listEl.querySelectorAll('.device-row').forEach(row => {
          row.addEventListener('click', (e) => {
             e.stopPropagation();
             this._api.transferPlayback(row.dataset.id);
             this._showToast(`Transferring to ${row.querySelector('.device-name').innerText.trim()}...`);
             listEl.querySelectorAll('.device-row').forEach(r => r.classList.remove('active'));
             row.classList.add('active');
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

      if (!listEl.hasChildNodes() || listEl.innerHTML.includes('Loading')) {
          listEl.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">Loading queue...</div>';
      }

      try {
          const res = await this._api.fetchSpotifyPlus('get_player_queue_info');
          
          if (res && res.result) {
              // 4. Render Sticky Header (Now Playing)
              // FIX: Only overwrite header if we are NOT inside the lock window
              if (res.result.currently_playing && Date.now() > this._queueLockTime) {
                  this._renderNowPlaying(res.result.currently_playing);
              }

              // 5. Render Scrollable List (Next Up)
              if (res.result.queue && res.result.queue.length > 0) {
                  const itemsHtml = res.result.queue.map(track => Templates.queueRow(track)).join('');
                  listEl.innerHTML = itemsHtml;
                  // Note: Event Delegation handles clicks
              } else {
                  listEl.innerHTML = Templates.emptyQueue();
              }
          } else {
              listEl.innerHTML = '<div style="padding:20px; text-align:center; color:#b3b3b3;">No queue data available.</div>';
          }
      } catch (e) {
          console.error("[SpotifyBrowser] Queue Error:", e);
          listEl.innerHTML = '<div style="padding:20px; text-align:center; color:red;">Failed to load queue.</div>';
          // Ensure header isn't left blank on error (unless locked)
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
  
  
  
  
  // --- Playback Wrapper with Error Handling ---
  async _playMediaSafe(uri, type) {
      const result = await this._api.playMedia(uri, type, this._config.default_device);
      
      if (result && !result.success) {
          const errStr = JSON.stringify(result.error);
          
          // FIX: Add check for "was not found" to catch the specific error you just saw
          if (errStr.includes("no active Spotify player") || 
              errStr.includes("default player device was not configured") ||
              errStr.includes("was not found")) {
              
              this._showAlert(
                  "Device Unavailable", // Updated title to be more accurate
                  "Spotify cannot find an active player or your default device. Please select a device to start playback.",
                  [
                      { 
                          label: "Device Playback", 
                          primary: true,
                          action: () => {
                              this._closeAlert();
                              this._openDeviceMenu();
                          }
                      },
                      { 
                          label: "Close", 
                          action: () => this._closeAlert() 
                      }
                  ]
              );
          } else {
              // Generic Error for other issues
              // Try to extract a clean message if possible
              let msg = "Unknown error";
              if (result.error && result.error.message) msg = result.error.message;
              this._showToast("Playback failed: " + msg);
          }
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
  
  

  // Helper to render the Sticky Header content
  _renderNowPlaying(trackData) {
      const npEl = this.shadowRoot.getElementById('queue-now-playing');
      if (!npEl) return;

      if (!trackData || !trackData.name) {
          if (Templates.emptyPlayer) npEl.innerHTML = Templates.emptyPlayer();
          else npEl.innerHTML = `<div style="padding:16px; opacity:0.5;">Nothing Playing</div>`;
          if (this._progressTimer) clearInterval(this._progressTimer);
          return; 
      }

      const showMini = this._config.queue_miniplayer === true;
      // Robust ID extraction
      const trackId = trackData.id || (trackData.uri ? trackData.uri.split(':')[2] : null);
      
      // FIX: Determine Favorite State from Cache or Context
      let isFav = false;
      if (trackId) {
          if (this._favCache.has(trackId)) {
              // 1. Use Cached Value (Fastest)
              isFav = this._favCache.get(trackId);
          } else if (this._currentContextUri === 'spotify:user:me:collection' || this._currentContextUri === 'spotify:collection:tracks') {
              // 2. Context Inference (If playing Liked Songs, it MUST be liked)
              isFav = true;
              this._favCache.set(trackId, true);
          }
      }

      // Render with the correct state immediately (Stops the white flash)
      npEl.innerHTML = Templates.nowPlayingRow(trackData, this._isPlaying, showMini, isFav);

      const btn = npEl.querySelector('#queue-hero-play-btn');
      if (btn) {
          btn.addEventListener('click', (e) => {
              e.stopPropagation();
              this._api.togglePlayback(!this._isPlaying);
              this._isPlaying = !this._isPlaying;
              // Update icon only
              const icon = this._isPlaying 
                ? `<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
                : `<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
              btn.innerHTML = icon;
          });
      }
      
      if (showMini) {
          const prevBtn = npEl.querySelector('[data-action="mini-prev"]');
          const nextBtn = npEl.querySelector('[data-action="mini-skip"]');
          const favBtn = npEl.querySelector('[data-action="mini-fav"]');
          
          if(prevBtn) prevBtn.onclick = (e) => { e.stopPropagation(); this._api.fetchSpotifyPlus('player_media_skip_previous', {}, false); };
          if(nextBtn) nextBtn.onclick = (e) => { e.stopPropagation(); this._api.fetchSpotifyPlus('player_media_skip_next', {}, false); };
          
          if(favBtn && trackId) {
              // Background Verification (Updates cache/UI if API disagrees)
              this._api.fetchSpotifyPlus('check_track_favorites', { ids: trackId }).then(res => {
                  if (res && res.result) {
                      const apiState = res.result[trackId] || false;
                      this._favCache.set(trackId, apiState); // Sync Cache
                      
                      // Only update DOM if different (prevent unnecessary repaint)
                      const uiState = favBtn.classList.contains('is-favorite');
                      if (apiState !== uiState) {
                           if (apiState) favBtn.classList.add('is-favorite');
                           else favBtn.classList.remove('is-favorite');
                      }
                  }
              });

              favBtn.onclick = (e) => {
                  e.stopPropagation();
                  const isCurrentlyFav = favBtn.classList.contains('is-favorite');
                  this._toggleTrackFavorite(trackId, isCurrentlyFav, favBtn);
              };
          }
          this._startProgressTimer();
      }
  }

  _startProgressTimer() {
      if (this._progressTimer) clearInterval(this._progressTimer);
      
      const updateBar = () => {
          const stateObj = this._hass.states[this._config.entity];
          if (!stateObj || !stateObj.attributes.media_duration) return;
          
          const duration = stateObj.attributes.media_duration; // seconds
          let position = stateObj.attributes.media_position; // seconds
          const updatedAt = new Date(stateObj.attributes.media_position_updated_at).getTime();
          
          // Calculate extrapolated position based on time elapsed since update
          if (stateObj.state === 'playing') {
              const now = Date.now();
              const diff = (now - updatedAt) / 1000;
              position += diff;
          }
          
          // Calculate %
          const percent = Math.min(100, (position / duration) * 100);
          
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
