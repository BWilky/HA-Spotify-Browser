import { LitElement, html } from "./lit.js";

import { SpotifyApi } from './api.js';
import { sharedStyles } from './styles/shared-styles.js';
import { Router } from './router.js';
import './components/spotify-header.js';
import './components/players/sidebar/index.js';
import './components/spotify-home.js';
import './components/spotify-search.js';
import './components/spotify-context-view.js';
import './components/spotify-popups.js';
import './components/spotify-reorder-dialog.js';
import { PinnedItemsManager } from './components/controllers/pinned-items-manager.js';
import { DeviceManager } from './components/devices/helper.js';
import { StorageManager } from './components/controllers/storage-manager.js';
import { PlayerController } from './components/controllers/player-controller.js';

import './components/devices/index.js'; // Registers Custom Elements

class SpotifyBrowserApp extends LitElement {
    static get properties() {
        return {
            hass: { type: Object },
            config: { type: Object },
            api: { type: Object }, // Add api to properties
            _isOpen: { type: Boolean },
            _currentPageId: { type: String },
            _currentPageData: { type: Object },
            _searchVisible: { type: Boolean },
            _menuVisible: { type: Boolean },
            _queueVisible: { type: Boolean },
            _devicePopupVisible: { type: Boolean },
            _accountsPopupVisible: { type: Boolean },
            _trackPopupVisible: { type: Boolean },
            _trackPopupData: { type: Object },
            _devices: { type: Array },
            _currentSearchQuery: { type: String },
            _isDesktop: { type: Boolean, state: true },
            _reorderVisible: { type: Boolean, state: true },
            _pinnedItems: { type: Array, state: true },
            _deviceManagerVisible: { type: Boolean, state: true },
            _showRevealButton: { type: Boolean, state: true },
        };
    }

    static get styles() {
        return sharedStyles;
    }

    constructor() {
        super();
        // Router initialized in firstUpdated where container is available
        this.router = null;

        this._isOpen = false;
        this.hass = null;
        this.config = {};
        this.api = null;
        this.playerController = null; // Initialize later with API
        this._lastCloseTime = 0;
        this._currentPageId = 'home';
        this._currentPageData = null;
        this._searchVisible = false;
        this._menuVisible = false;
        this._queueVisible = false;
        this._devicePopupVisible = false;
        this._accountsPopupVisible = false;
        this._trackPopupVisible = false;
        this._trackPopupData = null;
        this._devices = [];
        this._reorderVisible = false;
        this._pinnedItems = [];
        this._deviceManagerVisible = false;
        this._showRevealButton = false;
        this._queueInitDone = false;



        // Header state
        this._headerAlpha = 1;
        this._headerTitle = '';
        this._headerTitleOpacity = 0;


        // Initial check, will be updated in firstUpdated/resize
        this._isDesktop = window.matchMedia('(min-width: 769px)').matches;
    }

    // Optimized shouldUpdate to prevent unnecessary re-renders from unrelated HASS updates
    shouldUpdate(changedProperties) {
        // If hass changed, check if it matters for us
        if (changedProperties.has('hass')) {
            const oldHass = changedProperties.get('hass');
            const newHass = this.hass;

            // If oldHass is missing, always update (first load)
            if (!oldHass || !newHass) return true;

            // 1. Check Player Entity Change
            if (this.config && this.config.entity) {
                const oldState = oldHass.states[this.config.entity];
                const newState = newHass.states[this.config.entity];
                if (oldState !== newState) return true;
            }

            // 2. Check Pinned Items Entity Change (if configured)
            if (this.config && this.config.homescreen) {
                let pinnedEntity = null;
                if (this.config.homescreen.pinned_items_entity) {
                    pinnedEntity = this.config.homescreen.pinned_items_entity;
                } else if (this.config.homescreen.sticky && this.config.homescreen.sticky.helper) {
                    pinnedEntity = this.config.homescreen.sticky.helper;
                }

                if (pinnedEntity) {
                    const oldPin = oldHass.states[pinnedEntity];
                    const newPin = newHass.states[pinnedEntity];
                    if (oldPin !== newPin) return true;
                }
            }

            // 3. Check Spotify Accounts Entity (if configured)
            // (Often used for account switching)
            if (this.config.spotify_accounts && this.config.spotify_accounts.accounts_sensor) {
                const sensor = this.config.spotify_accounts.accounts_sensor;
                if (oldHass.states[sensor] !== newHass.states[sensor]) return true;
            }

            // 4. Check Device Manager Entity
            if (this.config.device_manager) {
                const dmEntity = this.config.device_manager;
                if (oldHass.states[dmEntity] !== newHass.states[dmEntity]) return true;
            }

            // 5. Check for Connect Devices Scan (if using a scan interval or sensor)
            // If the user uses a specific sensor for devices list, check it here as well.

            // IF ONLY HASS CHANGED AND NO RELEVANT ENTITIES CHANGED, BLOCK UPDATE
            if (changedProperties.size === 1) {
                return false;
            }
        }

        return true;
    }

    firstUpdated(changedProperties) {
        // Initialize Router
        const container = this.shadowRoot.querySelector('.page-container');
        this.router = new Router(this, container, this.config);



        // Desktop Media Query Listener
        const mediaQuery = window.matchMedia('(min-width: 769px)');
        const handleRez = (e) => { this._isDesktop = e.matches; };
        try {
            mediaQuery.addEventListener('change', handleRez);
        } catch (e) {
            // Safari older fallback
            mediaQuery.addListener(handleRez);
        }
        this._isDesktop = mediaQuery.matches;
        this.router.addEventListener('route-changed', (e) => {
            const { pageId, data, isHeroPage, direction } = e.detail;

            // Update Header State based on Page Type
            // Instead of blind reset, check if the page is already cached and can report state
            this._headerAlpha = isHeroPage ? 0 : 1;
            this._headerTitle = '';
            this._headerTitleOpacity = 0;

            // Attempt to restore header state if we are navigating back to a cached view
            if (this.router && this.router.pageCache.has(pageId)) {
                const cachedPage = this.router.pageCache.get(pageId);
                // Allow a microtask for the view to be re-attached/visible effectively
                setTimeout(() => {
                    if (typeof cachedPage.updateHeaderState === 'function') {
                        cachedPage.updateHeaderState();
                    }
                }, 0);
            }

            // Close search if navigating away
            if (pageId !== 'search') {
                this._searchVisible = false;
            }

            this._currentPageId = pageId;
            this._currentPageData = data;
            this.requestUpdate();
        });

        // Listen for scroll updates from context views (forwarded by Router)
        this.router.addEventListener('header-scroll', (e) => {
            this._headerAlpha = e.detail.alpha;
            this._headerTitle = e.detail.title;
            this._headerTitleOpacity = e.detail.textAlpha;
            this.requestUpdate();
        });

        // Initialize API if ready
        this._initApi();
    }

    updated(changedProperties) {
        // Initialize API if missing and dependencies are ready
        this._initApi();

        // Initialize Storage Manager
        if (!this.storageManager && this.hass) {
            this.storageManager = new StorageManager(this.hass, {
                sensor_entity: 'sensor.spotify_browser_data',
                event_type: 'spotify_browser_store_data'
            });

            // Validate Storage Status
            const status = this.storageManager.checkStatus();

            if (status === 'empty') {
                // Silent Auto-Init for new users
                this.storageManager.resetStorage();
            } else if (status === 'corrupted' && !this._storageCorruptPrompted) {
                this._storageCorruptPrompted = true;
                // Defer alert slightly to ensure popups are ready
                setTimeout(() => {
                    this.dispatchEvent(new CustomEvent('show-alert', {
                        detail: {
                            id: 'storage-corruption',
                            title: 'Storage Error',
                            message: 'Persistent storage data appears to be corrupted. Reset checks and saved items to defaults?',
                            confirmText: 'Reset Data',
                            cancelText: 'Ignore',
                            onConfirm: () => {
                                console.log('[SpotifyBrowser] User confirmed storage reset.');
                                this.storageManager.resetStorage();
                            }
                        },
                        bubbles: true,
                        composed: true
                    }));
                }, 1000);
            }
        }

        // Update hass in managers if they exist
        if (this.storageManager) this.storageManager.updateHass(this.hass);
        if (this.pinnedManager) this.pinnedManager.updateHass(this.hass);
        if (this.deviceManager) this.deviceManager.updateHass(this.hass);
        if (this.playerController) this.playerController.updateHass(this.hass);


        // Initialize Pinned Items Manager if configured
        if (!this.pinnedManager && this.hass && this.config && (this.config.homescreen?.sticky || this.config.homescreen?.pinned_items_entity)) {
            try {
                const pinnedConfig = this.config.homescreen?.sticky || { helper: this.config.homescreen?.pinned_items_entity };
                // Pass Storage Manager
                this.pinnedManager = new PinnedItemsManager(this.hass, pinnedConfig, this.storageManager);
                if (this.router) this.router.updateDependencies({ pinned: this.pinnedManager });
            } catch (e) {
                console.error("[SpotifyBrowser] Failed to initialize PinnedItemsManager", e);
            }
        }

        // Initialize Device Manager if configured
        if (!this.deviceManager && this.hass && this.config && this.config.device_playback) {
            try {
                // Pass Storage Manager
                this.deviceManager = new DeviceManager(this.hass, this.config.device_playback, this.storageManager);
            } catch (e) {
                console.error("[SpotifyBrowser] Failed to initialize DeviceManager", e);
            }
        }


        if (changedProperties.has('hass') && this.hass) {
            if (this.api) {
                this.api.updateHass(this.hass);
            }
            // Update Managers
            if (this.deviceManager) this.deviceManager.updateHass(this.hass);
            if (this.pinnedManager) this.pinnedManager.updateHass(this.hass);
            if (this.playerController) this.playerController.updateHass(this.hass); // Sync Player
            if (this.router) this.router.updateDependencies({ hass: this.hass });
        }

        if (changedProperties.has('api') && this.api) {
            if (this.router) this.router.updateDependencies({ api: this.api });
        }

        if (changedProperties.has('config') && this.config) {
            if (this.router) this.router.updateDependencies({ config: this.config });

            // Queue Init Logic
            if (!this._queueInitDone && this.config.queue_settings && this._isDesktop) {
                if (this.config.queue_settings.openInit) {
                    this._queueVisible = true;
                }
                this._queueInitDone = true;
            }
        }

        // Open/Close Logic
        if (changedProperties.has('_isOpen')) {
            if (this._isOpen) {
                // Ensure Router has the CURRENT container (re-acquired as DOM is recreated on open)
                const container = this.shadowRoot.querySelector('.page-container');
                if (this.router && container) {
                    this.router.container = container;
                }

                // OPENING
                // Handle mixed casing/naming from various config versions
                const hoe = this.config.homeonexit !== undefined ? this.config.homeonexit :
                    (this.config.home_on_exit !== undefined ? this.config.home_on_exit : true);

                let shouldReset = true;

                if (hoe === false) {
                    shouldReset = false;
                } else if (typeof hoe === 'object' && hoe !== null) {
                    // Handle Timeout
                    // If timeout is explicitly defined
                    if (hoe.timeout !== undefined && this._lastCloseTime) {
                        const diff = (Date.now() - this._lastCloseTime) / 1000;
                        if (diff < hoe.timeout) {
                            shouldReset = false;
                        }
                    } else if (hoe.timeout === undefined) {
                        // If object but no timeout (e.g. empty object), treat as true/reset? 
                        // Or maybe it has other props. 
                        // Assume true unless proven otherwise.
                    }
                }

                if (shouldReset) {
                    this.router.resetToHome();
                }

                // Ensure current page is rendered/visible (especially if we didn't reset)
                if (this._currentPageId && this.router) {
                    this.router.navigateTo(this._currentPageId, this._currentPageData, 'none');
                }

            } else {
                // CLOSING
                this._lastCloseTime = Date.now();
                this._searchVisible = false; // Auto-close search on exit too
            }
        }

        // Manage Search Auto-Close Timer
        if (changedProperties.has('_searchVisible') || changedProperties.has('_currentPageId')) {
            // Clear existing timer
            if (this._searchCloseTimer) {
                clearTimeout(this._searchCloseTimer);
                this._searchCloseTimer = null;
            }

            // Start new timer if search is visible AND we are NOT on the search page
            if (this._searchVisible && this._currentPageId !== 'search') {
                this._searchCloseTimer = setTimeout(() => {
                    this._searchVisible = false;
                    // Force update if needed, though property change usually triggers it
                    // this.requestUpdate(); 
                }, 30000); // 30 seconds
            }
        }
    }

    open() {
        this._isOpen = true;
    }

    render() {
        if (!this.config || !this.hass || !this._isOpen) {
            return html``;
        }

        // Dynamic Desktop Styles
        let desktopWrapperStyle = '';
        if (this._isDesktop && this.config.desktop_style) {
            const ds = this.config.desktop_style;
            if (ds.fullscreen || ds.mode === 'fullscreen') {
                const mt = ds.margin_top || '0px';
                const mb = ds.margin_bottom || '0px';
                const ml = ds.margin_left || '0px';
                const mr = ds.margin_right || '0px';

                // Asymmetric Positioning Support
                // We must override the transform centering from CSS if margins are asymmetric
                // But for simplicity and consistency with animations, we keep centering 
                // and calculate Width/Height based on margins assuming they apply to the viewport edge.

                // Note: top/left are implicitly 50% from CSS.
                // If we want exact top/left margin, we might need to override top/left/transform.

                // Let's use strict positioning for this mode to ensure accuracy
                desktopWrapperStyle = `
                    position: fixed;
                    top: ${mt};
                    left: ${ml};
                    width: calc(100vw - ${ml} - ${mr});
                    height: calc(100vh - ${mt} - ${mb});
                    max-width: none;
                    max-height: none;
                    border-radius: ${(parseInt(mt) > 0 || parseInt(ml) > 0) ? '16px' : '0'};
                    transform: none !important; /* Override CSS centering transform */
                `;
            } else if (ds.mode === 'fixed') {
                desktopWrapperStyle = `
                    width: ${ds.width};
                    height: ${ds.height};
                    max-width: none;
                    max-height: none;
                `;
            }
        }



        return html`
            <div class="backdrop open" @click=${() => this._isOpen = false}></div>
            <div class="browser-wrapper open ${this._queueVisible ? 'queue-open' : ''} anim-${this.config.animations?.browser_open || 'fade'} ${!this.config.animations?.blur ? 'no-blur' : ''}"
                style="${desktopWrapperStyle}"
                @show-toast=${this._handleShowToast}
                @show-alert=${this._handleShowAlert}
                @open-reorder=${this._handleOpenReorder}
            >
                <spotify-header
                    .backButtonVisible=${this.router && this.router.history.length > 0}
                    .searchVisible=${this._currentPageId === 'search' || this._searchVisible}
                    .menuVisible=${this._menuVisible}
                    .transparent=${this._headerAlpha < 1}
                    .scrollAlpha=${this._headerAlpha}
                    .centerTitle=${this._headerTitle}
                    .titleOpacity=${this._headerTitleOpacity}
                    .searchQuery=${this._currentSearchQuery || ''}
                    @back-click=${() => this.router.goBack()}
                    @logo-click=${() => { this.router.resetToHome(); this._menuVisible = false; }}
                    @search-toggle-click=${() => { this._handleSearchToggleClick(); this._menuVisible = false; }}
                    @search-input=${this._handleSearchInput}
                    @search-keydown=${this._handleSearchKeydown}
                    @queue-click=${() => { this._queueVisible = !this._queueVisible; this._menuVisible = false; }}
                    @menu-click=${this._handleMenuClick}
                    @close-click=${() => this._isOpen = false}
                    @close-menu=${() => this._menuVisible = false}
                    @menu-item-click=${this._handleMenuItemClick}
                >
                </spotify-header>
                
                <div class="page-container ${this._currentPageId && (this._currentPageId.startsWith('artist:') || this._currentPageId.startsWith('album:') || this._currentPageId.startsWith('playlist:')) ? 'has-hero' : ''}">
                </div>

                <spotify-sidebar-player
                    .hass=${this.hass}
                    .api=${this.api}
                    .config=${this.config}
                    .visible=${this._queueVisible}
                    .deviceManager=${this.deviceManager}
                    .playerController=${this.playerController}
                    @navigate=${this._handleNavigate}
                    @close-queue=${() => this._queueVisible = false}
                    @open-manager=${() => {
                this._queueVisible = false; // Close queue when opening manager? Maybe.
                this._devicePopupVisible = false;
                this._deviceManagerVisible = true;
            }}
                ></spotify-sidebar-player>

                <spotify-reorder-dialog
                    .visible=${this._reorderVisible}
                    .items=${this._pinnedItems || []}
                    .userLibraryActive=${this._pinnedItems?.some(i => i.id === 'user-library')}
                    .allowBlur=${this.config?.settings?.performance?.blur !== false}
                    @close=${() => this._reorderVisible = false}
                    @reorder=${this._handleReorderSave}
                    @delete-item=${this._handleReorderDelete}
                    @add-custom-uri=${this._handleAddCustomUri}
                    @reset-pinned-items=${this._handleResetPinnedItems}
                ></spotify-reorder-dialog>

               <spotify-popup-devicemanager
                    .hass=${this.hass}
                    .deviceManager=${this.deviceManager}
                    .api=${this.api}
                    .visible=${this._deviceManagerVisible}
                    @close-dialog=${() => {
                this._deviceManagerVisible = false;
                if (this._pendingDeviceResolution) {
                    this._pendingDeviceResolution(null);
                    this._pendingDeviceResolution = null;
                }
            }}
                ></spotify-popup-devicemanager>

                <spotify-popups
                    id="popups"
                    .devices=${this._devices}
                    .accounts=${this.config.spotify_accounts}
                    .track=${this._trackPopupData}
                    .config=${this.config}
                    .deviceVisible=${this._devicePopupVisible}
                    .accountsVisible=${this._accountsPopupVisible}
                    .trackVisible=${this._trackPopupVisible}
                    .canManageDevices=${!!this.deviceManager}
                    .showRevealButton=${this._showRevealButton}
                    .blur=${this.config.animations?.blur !== false}
                    @close-popups=${() => {
                this._devicePopupVisible = false;
                this._accountsPopupVisible = false;
                this._trackPopupVisible = false;
            }}
                    @device-selected=${this._handleDeviceSelected}
                    @account-selected=${this._handleAccountSelected}
                    @reveal-all-devices=${this._handleRevealAllDevices}
                    @toggle-hidden-devices=${this._handleToggleHiddenDevices}
                    @refresh-devices=${this._handleRefreshDevices}
                    @track-action=${this._handleTrackAction}
                    @open-manager=${() => {
                this._devicePopupVisible = false;
                this._deviceManagerVisible = true;
            }}
                ></spotify-popups>
            </div>
        `;
    }

    _handleSearchToggleClick() { this._searchVisible = !this._searchVisible; }
    _handleSearchInput(e) {
        const query = e.detail;
        this._currentSearchQuery = query;
        if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);

        if (!query) return;

        this._searchDebounceTimer = setTimeout(() => {
            if (this._currentPageId === 'search') {
                // If already on search page, just update data
                const searchPage = this.shadowRoot.querySelector('spotify-search');
                if (searchPage) {
                    searchPage.search(query);
                } else {
                    // Fallback if component isn't ready
                    this.router.navigateTo('search', { query });
                }
            } else {
                this.router.navigateTo('search', { query });
            }
        }, 500);
    }

    _handleSearchKeydown(e) {
        if (e.detail.key === 'Enter') {
            const query = e.detail.value;
            if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);
            if (query) {
                this.router.navigateTo('search', { query });
            }
        }
    }
    _handleMenuClick() { this._menuVisible = !this._menuVisible; }

    _initApi() {
        if (this.api || !this.hass || !this.config.entity) return;

        this.api = new SpotifyApi(
            this.hass,
            this.config.entity,
            this._handleDeviceResolution.bind(this),
            this.config.volume,
            // Notification Callback
            (msg) => {
                const popups = this.shadowRoot.getElementById('popups');
                if (popups) popups.showToast(msg);
            },
            // Error Callback
            (err) => {
                const errCode = err.code || '';
                const errMsg = err.message || '';
                if (errCode === 'service_validation_error' || errMsg.includes('not found') || errMsg.includes('Validation error')) {
                    const popups = this.shadowRoot.getElementById('popups');
                    if (popups) popups.showToast("Device unavailable. Please select a player.");
                    this._openDevicePicker();
                } else {
                    const popups = this.shadowRoot.getElementById('popups');
                    if (popups) popups.showToast(`Error: ${errMsg}`);
                }
            }
        );

        // Initialize Player Controller
        this.playerController = new PlayerController(this.api);
        this.playerController.updateConfig(this.config);

        // Initial Sync
        if (this.hass) this.playerController.updateHass(this.hass);

        this.requestUpdate();
    }

    async _openDevicePicker(options = {}) {
        this._deviceManagerVisible = false; // Ensure manager is closed
        this._devicePopupVisible = true; // Open Picker

        // Show loading toast
        const popups = this.shadowRoot.getElementById('popups');
        if (popups && options.refresh) popups.showToast("Scanning for devices...");

        // Fetch Devices
        try {
            const response = await this.api.fetchSpotifyPlus('get_spotify_connect_devices', { refresh: !!options.refresh });
            let rawDevices = [];
            if (response && response.result && Array.isArray(response.result.Items)) {
                rawDevices = response.result.Items;
            } else if (response && Array.isArray(response.result)) {
                rawDevices = response.result;
            } else if (Array.isArray(response)) {
                rawDevices = response;
            }

            if (this.deviceManager) {
                const attributes = (this.hass && this.config.entity && this.hass.states[this.config.entity])
                    ? this.hass.states[this.config.entity].attributes
                    : {};

                // Allow bypassing hidden filter via options
                const mergeOptions = options.showHidden ? { showHidden: true } : {};
                this._devices = await this.deviceManager.getMergedDevices(rawDevices, attributes, mergeOptions);

                // Determine if we should show 'See All' button
                const settings = await this.deviceManager.getSettings();
                this._showRevealButton = !!(settings.hide_connect_devices && settings.see_all_devices);
            } else {
                // Unified format fallback
                this._devices = rawDevices.map(d => ({
                    id: d.id,
                    name: d.name,
                    type: d.type,
                    isActive: d.is_active,
                    isSaved: false
                }));
            }

            this.requestUpdate();

        } catch (e) {
            console.error("[App] Failed to load devices for picker", e);
            if (popups) popups.showToast("Failed to scan devices.");
        }
    }

    // --- DEVICE RESOLUTION LOGIC ---
    async _handleDeviceResolution() {
        // 1. Check Device Manager for Default
        if (this.deviceManager) {
            // await this.deviceManager.validateAndClean(); // Deprecated/Removed
            const devices = await this.deviceManager.getDevices();
            const defaultDev = devices.find(d => d.is_default);
            if (defaultDev) {
                console.log("[SpotifyBrowser] Using Default Device from Manager:", defaultDev.name);
                return defaultDev;
            }
        }

        // 2. Interactive Selection (Popup)
        return new Promise((resolve) => {
            console.log("[SpotifyBrowser] No default device. Requesting user selection...");

            const attributes = (this.hass && this.config.entity && this.hass.states[this.config.entity])
                ? this.hass.states[this.config.entity].attributes
                : {};

            // Immediate render from existing saved state while the scan runs
            if (this.deviceManager) {
                this.deviceManager.getMergedDevices([], attributes).then(devs => {
                    this._devices = devs;
                    this.requestUpdate();
                });
            }

            // Show Popup Immediately
            this._deviceManagerVisible = false;
            this._devicePopupVisible = true; // Use simple picker
            this._pendingDeviceResolution = resolve;
            const popups = this.shadowRoot.getElementById('popups');
            if (popups) popups.showToast("Scanning for devices...");


            // --- BACKGROUND SYNC ---
            this.api.fetchSpotifyPlus('get_spotify_connect_devices', { refresh: true }).then(async (response) => {
                let rawDevices = [];
                if (response && response.result && Array.isArray(response.result.Items)) {
                    rawDevices = response.result.Items;
                } else if (response && Array.isArray(response.result)) {
                    rawDevices = response.result;
                } else if (Array.isArray(response)) {
                    rawDevices = response;
                }

                // If no device manager, use raw mapping (basic fallback)
                if (!this.deviceManager) {
                    this._devices = rawDevices.map(d => ({
                        id: d.id || d.Id,
                        name: d.name || d.Name,
                        type: d.type || (d.DeviceInfo ? d.DeviceInfo.DeviceType : 'Speaker') || 'Speaker',
                        isActive: d.is_active || d.IsActive
                    }));
                    this.requestUpdate();
                    return;
                }

                // Use Standardized Merge
                const attributes = (this.hass && this.config.entity && this.hass.states[this.config.entity])
                    ? this.hass.states[this.config.entity].attributes
                    : {};

                this._devices = await this.deviceManager.getMergedDevices(rawDevices, attributes);

                // Check Reveal Button State
                const settings = await this.deviceManager.getSettings();
                this._showRevealButton = !!(settings.hide_connect_devices && settings.see_all_devices);

                this.requestUpdate();
            }); // End fetch


        });
    }

    _handleDeviceSelected(e) {
        if (this._pendingDeviceResolution) {
            // Resolve the pending promise (API is waiting)
            this._pendingDeviceResolution(e.detail);
            this._pendingDeviceResolution = null;
            this._deviceManagerVisible = false;
            this._devicePopupVisible = false; // Close picker

            const popups = this.shadowRoot.getElementById('popups');
            if (popups) popups.showToast(`Connecting to ${e.detail.name}...`);
        } else {
            // Standard Transfer (Active Playback)
            // expectResponse=false because player_transfer_playback doesn't support return_response=true
            this.api.fetchSpotifyPlus('player_transfer_playback', { device_id: e.detail.id, play: true }, false);
            this._devicePopupVisible = false;
            this._deviceManagerVisible = false;

            const popups = this.shadowRoot.getElementById('popups');
            if (popups) popups.showToast(`Transferring playback to ${e.detail.name}`);
        }
    }

    async _handleMenuItemClick(e) {
        this._menuVisible = false;
        if (!this.api) this._initApi();
        if (!this.api) return;
        switch (e.detail) {
            case 'menu-device':
                // Show immediately for perceived performance
                this._devicePopupVisible = true;

                // Fetch in background and update
                this.api.fetchSpotifyPlus('get_spotify_connect_devices', { refresh: true }).then(async (response) => {
                    let rawDevices = [];
                    if (response && response.result && Array.isArray(response.result.Items)) {
                        rawDevices = response.result.Items;
                    } else if (response && Array.isArray(response.result)) {
                        rawDevices = response.result;
                    } else if (Array.isArray(response)) {
                        rawDevices = response;
                    }

                    if (this.deviceManager) {
                        const attributes = (this.hass && this.config.entity && this.hass.states[this.config.entity])
                            ? this.hass.states[this.config.entity].attributes
                            : {};
                        this._devices = await this.deviceManager.getMergedDevices(rawDevices, attributes);

                        // Check Reveal Button State
                        const settings = await this.deviceManager.getSettings();
                        this._showRevealButton = !!(settings.hide_connect_devices && settings.see_all_devices);
                    } else {
                        this._devices = rawDevices.map(d => ({
                            id: d.id || d.Id,
                            name: d.name || d.Name,
                            type: d.type || (d.DeviceInfo ? d.DeviceInfo.DeviceType : 'Speaker') || 'Speaker',
                            isActive: d.is_active || d.IsActive,
                            isSaved: false
                        }));
                    }

                    this.requestUpdate();
                });
                break;
            case 'menu-accounts':
                this._accountsPopupVisible = true;
                break;
        }
    }

    /** Switch the active Spotify account/entity and rebuild the API stack. */
    switchAccount(entity) {
        if (!entity || entity === this.config.entity) return;
        this.config = { ...this.config, entity };
        this.api = null;
        if (this.playerController) this.playerController.destroy();
        this.playerController = null;
        this._initApi();
    }

    _handleAccountSelected(e) {
        this.switchAccount(e.detail.entity);
        this._accountsPopupVisible = false;
    }

    _handleTrackAction(e) {
        const action = e.detail;
        const track = this._trackPopupData;
        switch (action) {
            case 'tm-play':
                this.api.playMedia(track.uri, 'track');
                break;
            case 'tm-queue':
                this.api.fetchSpotifyPlus('add_player_queue_items', { uris: track.uri });
                break;
            // more actions here
        }
        this._trackPopupVisible = false;
    }

    _handleOpenTrackMenu(e) {
        this._trackPopupData = e.detail;
        this._trackPopupVisible = true;
    }

    _handleShowToast(e) {
        const popups = this.shadowRoot.getElementById('popups');
        if (popups) popups.showToast(e.detail.message, e.detail.duration);
    }

    _handleShowAlert(e) {
        const popups = this.shadowRoot.getElementById('popups');
        if (popups) {
            const { title, message, onConfirm, confirmText, cancelText, size } = e.detail;
            popups.showAlert(title, message, onConfirm, confirmText, cancelText, size);
        }
    }

    _handleOpenReorder() {
        if (!this.pinnedManager) return;
        // Snapshot current items for the dialog (bound via .items in render)
        this.pinnedManager.getItems().then(items => {
            this._pinnedItems = items;
            this._reorderVisible = true;
            this.requestUpdate();
        });
    }

    _handleReorderSave(e) {
        const orderedItemsOrIds = e.detail;
        if (!this.pinnedManager) return;

        // Optimistic local update so the dialog doesn't flicker
        if (Array.isArray(orderedItemsOrIds) && typeof orderedItemsOrIds[0] === 'object') {
            this._pinnedItems = orderedItemsOrIds;
            this.requestUpdate();
        }

        this.pinnedManager.reorder(orderedItemsOrIds).catch(e => {
            console.error("Reorder failed", e);
        });
    }

    async _handleAddCustomUri(e) {
        const uri = e.detail;
        if (!this.pinnedManager || !this.api) return;

        const popups = this.shadowRoot.getElementById('popups');
        if (popups) popups.showToast("Fetching item details...");

        const result = await this.pinnedManager.addByUri(this.api, uri);

        if (result.success) {
            if (popups) popups.showToast("Item pinned successfully");
            // Refresh items for the dialog
            this.pinnedManager.getItems().then(items => {
                this._pinnedItems = items;
            });
        } else {
            console.error("Failed to add custom URI:", result.error);
            if (popups) popups.showAlert("Failed to add item", result.error || "Unknown error (Check logs)", null, 'OK', null, 'medium');
        }
    }

    async _handleResetPinnedItems() {
        if (!this.pinnedManager) return;

        const popups = this.shadowRoot.getElementById('popups');
        if (popups) popups.showToast("Resetting pinned items...");

        const result = await this.pinnedManager.reset();

        if (result.success) {
            if (popups) popups.showToast("Pinned items reset to default.");
            // Refresh
            this.pinnedManager.getItems().then(items => {
                this._pinnedItems = items;
            });
        } else {
            console.error("Reset failed", result.error);
            if (popups) popups.showToast("Reset failed: " + result.error);
        }
    }

    async _handleRefreshDevices() {
        this._openDevicePicker({ refresh: true });
    }

    async _handleToggleHiddenDevices(e) {
        // e.detail.visible is the new state
        this._openDevicePicker({ showHidden: e.detail.visible });
    }

    async _handleRevealAllDevices() {
        // Legacy/Fallback
        this._openDevicePicker({ refresh: true, showHidden: true });
    }

    _handleReorderDelete(e) {
        const id = e.detail;

        if (this.pinnedManager) {
            // Optimistic Delete
            this._pinnedItems = (this._pinnedItems || []).filter(i => i.id !== id);

            this.pinnedManager.remove(id).then(res => {
                if (!res.success) {
                    const popups = this.shadowRoot.getElementById('popups');
                    if (popups) popups.showToast("Failed to remove item: " + (res.error || 'Unknown'));
                }
            }).catch(e => {
                console.error("Delete failed", e);
            });
        }
    }

    _handleNavigate(e) {
        if (this.router) {
            this.router.navigateTo(e.detail.pageId, e.detail.data);
        }
    }
}

customElements.define('spotify-browser-app', SpotifyBrowserApp);
