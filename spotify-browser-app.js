import { LitElement, html } from "./lit.js";

import { SpotifyApi } from './api.js';
import { parseDeviceItems, normalizeDevice, fireHaptic } from './utils.js';
import { sharedStyles } from './styles/shared-styles.js';
import { Router } from './router.js';
import './components/spotify-header.js';
import './components/players/sidebar/index.js';
import './components/players/now-playing-mobile.js';
import './components/players/connect-panel.js';
import './components/players/queue-panel.js';
import './components/players/account-panel.js';
import './components/spotify-home.js';
import './components/spotify-search.js';
import './components/spotify-context-view.js';
import './components/views/spotify-library.js';
import './components/spotify-popups.js';
import './components/spotify-reorder-dialog.js';
import { PinnedItemsManager } from './components/controllers/pinned-items-manager.js';
import { DeviceManager } from './components/devices/device-manager.js';
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
            _entered: { type: Boolean, state: true }, // drives the `open` class for enter transitions
            _currentPageId: { type: String },
            _currentPageData: { type: Object },
            _searchVisible: { type: Boolean },
            _menuVisible: { type: Boolean },
            _queueVisible: { type: Boolean },
            _devicePopupVisible: { type: Boolean },
            _accountSheetVisible: { type: Boolean, state: true },
            _currentProfileImg: { type: String, state: true },
            _trackPopupVisible: { type: Boolean },
            _trackPopupData: { type: Object },
            _devices: { type: Array },
            _currentSearchQuery: { type: String },
            _isDesktop: { type: Boolean, state: true },
            _reorderVisible: { type: Boolean, state: true },
            _pinnedItems: { type: Array, state: true },
            _deviceManagerVisible: { type: Boolean, state: true },
            _showRevealButton: { type: Boolean, state: true },
            _playerState: { type: Object, state: true },
            _nowPlayingVisible: { type: Boolean, state: true },
            _connectPanelVisible: { type: Boolean, state: true },
            _connectLoading: { type: Boolean, state: true },
            _mobileQueueVisible: { type: Boolean, state: true },
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
        this._entered = false;
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
        this._accountSheetVisible = false;
        this._currentProfileImg = '';
        this._trackPopupVisible = false;
        this._trackPopupData = null;
        this._devices = [];
        this._reorderVisible = false;
        this._pinnedItems = [];
        this._deviceManagerVisible = false;
        this._showRevealButton = false;
        this._queueInitDone = false;
        this._playerState = null;
        this._nowPlayingVisible = false;
        this._pendingNowPlaying = false;
        this._pendingNowPlayingTimer = null;
        this._connectPanelVisible = false;
        this._connectLoading = false;
        this._mobileQueueVisible = false;
        this._onPlayerStateChange = this._onPlayerStateChange.bind(this);
        this._onDragStart = this._onDragStart.bind(this);
        this._onDragMove = this._onDragMove.bind(this);
        this._onDragEnd = this._onDragEnd.bind(this);



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
        const handleRez = (e) => {
            this._isDesktop = e.matches;
            if (this._isDesktop) {
                this._stopMiniPlayerProgressTimer();
            } else if (this._playerState?.isPlaying) {
                this._startMiniPlayerProgressTimer();
            }
        };
        try {
            mediaQuery.addEventListener('change', handleRez);
        } catch (e) {
            // Safari older fallback
            mediaQuery.addListener(handleRez);
        }
        this._isDesktop = mediaQuery.matches;

        // Re-capture the full (pre-keyboard) height on rotation, a real layout
        // change. Plain resizes are the keyboard — handled by _updateAppHeight,
        // which keeps the panel full-height so the keyboard overlays it.
        this._onOrientation = () => setTimeout(() => this._captureAppHeight(), 250);
        window.addEventListener('orientationchange', this._onOrientation);

        // The keyboard shrinks the viewport (visualViewport and/or innerHeight).
        // Re-evaluate the panel sizing on every such change so it stays pinned
        // to the full height with the keyboard drawn over the bottom.
        this._onViewportResize = () => this._updateAppHeight();
        window.visualViewport?.addEventListener('resize', this._onViewportResize);
        window.addEventListener('resize', this._onViewportResize);

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

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this.playerController) {
            this.playerController.removeEventListener('state-changed', this._onPlayerStateChange);
        }
        this._stopMiniPlayerProgressTimer();
        if (this._onOrientation) window.removeEventListener('orientationchange', this._onOrientation);
        if (this._onViewportResize) {
            window.visualViewport?.removeEventListener('resize', this._onViewportResize);
            window.removeEventListener('resize', this._onViewportResize);
        }
        this._restoreViewport();
    }

    /**
     * Force the page viewport to overlay the on-screen keyboard rather than
     * resize for it. Some tablet/kiosk browsers default to `resizes-content`,
     * which shrinks the layout viewport (and thus our floating window) when the
     * keyboard appears. We override `interactive-widget` on the page's viewport
     * meta while open, preserving the original directive to restore on close.
     */
    _applyKeyboardOverlayViewport() {
        const meta = document.querySelector('meta[name="viewport"]');
        if (!meta) return;
        if (this._origViewport == null) this._origViewport = meta.getAttribute('content') || '';
        const base = this._origViewport
            .replace(/,?\s*interactive-widget\s*=\s*[^,]*/i, '')
            .replace(/^\s*,|,\s*$/g, '')
            .trim();
        meta.setAttribute('content', `${base}, interactive-widget=overlays-content`);
    }

    /** Restore the viewport meta to whatever Home Assistant had before we opened. */
    _restoreViewport() {
        if (this._origViewport == null) return;
        const meta = document.querySelector('meta[name="viewport"]');
        if (meta) meta.setAttribute('content', this._origViewport);
        this._origViewport = null;
    }

    /**
     * Record the full (pre-keyboard) viewport height and re-apply the panel
     * sizing. Called at open time (keyboard not yet shown) and on rotation.
     */
    _captureAppHeight() {
        const h = Math.round(window.innerHeight);
        if (h) this._fullVH = h;
        this._updateAppHeight();
    }

    /**
     * Keep the panel pinned to its full pre-keyboard height so the on-screen
     * keyboard overlays it rather than reflowing/shrinking it.
     *
     * The keyboard shrinks `innerHeight` in webviews that resize their content
     * (the Home Assistant Android app, kiosk browsers). When we detect that
     * shrink we lock the panel to the captured full height and, on the desktop
     * floating-window layout, anchor it to the top (via `kb-open`) so the search
     * field stays visible and the keyboard simply covers the lower edge.
     */
    _updateAppHeight() {
        if (!this._isOpen) return;
        const full = this._fullVH || Math.round(window.innerHeight);
        const wrapper = this.shadowRoot?.querySelector('.browser-wrapper');

        if (!this._isDesktop) {
            // Mobile is a full-screen sheet — always lock to full height.
            this.style.setProperty('--spf-app-height', full + 'px');
            return;
        }

        // Desktop / tablet floating window. Only intervene while the keyboard is
        // actually up; otherwise let the CSS (85vh) track live window resizes.
        const kbOpen = Math.round(window.innerHeight) < full - 120;
        if (kbOpen) {
            this.style.setProperty('--spf-app-height', full + 'px');
            wrapper?.classList.add('kb-open');
        } else {
            this.style.removeProperty('--spf-app-height');
            wrapper?.classList.remove('kb-open');
        }
    }

    updated(changedProperties) {
        // Lazy init: API and managers are created as soon as hass/config allow
        this._initApi();
        this._ensureManagers();

        if (changedProperties.has('hass') && this.hass) {
            if (this.api) this.api.updateHass(this.hass);
            if (this.storageManager) this.storageManager.updateHass(this.hass);
            if (this.deviceManager) this.deviceManager.updateHass(this.hass);
            if (this.pinnedManager) this.pinnedManager.updateHass(this.hass);
            if (this.playerController) this.playerController.updateHass(this.hass);
            if (this.router) this.router.updateDependencies({ hass: this.hass });
        }

        if (changedProperties.has('api') && this.api) {
            if (this.router) this.router.updateDependencies({ api: this.api });
            this._loadProfileImage();
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
                // Make the on-screen keyboard overlay the page instead of
                // resizing the viewport (which shrinks our floating window).
                this._applyKeyboardOverlayViewport();

                // Lock the panel height to the full viewport BEFORE any keyboard
                // appears, so focusing the search field lets the on-screen
                // keyboard overlay the panel instead of resizing it. (Fallback
                // for browsers without interactive-widget support.)
                this._captureAppHeight();

                // Enter transition: the wrapper is mounted in its closed state
                // (translateY(100%)), then `open` is added on the next frame so
                // the CSS transition actually interpolates the slide-up.
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    if (this._isOpen) this._entered = true;
                }));

                // Ensure Router has the CURRENT container (re-acquired as DOM is recreated on open)
                const container = this.shadowRoot.querySelector('.page-container');
                if (this.router && container) {
                    this.router.container = container;
                }

                // OPENING: reset to home per the parsed home_on_exit config
                // ({ enabled, timeout } — timeout keeps the last page for N seconds)
                const hoe = this.config.home_on_exit || { enabled: true, timeout: 0 };
                let shouldReset = hoe.enabled !== false;

                if (shouldReset && hoe.timeout > 0 && this._lastCloseTime) {
                    const secondsSinceClose = (Date.now() - this._lastCloseTime) / 1000;
                    if (secondsSinceClose < hoe.timeout) shouldReset = false;
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
                this._entered = false; // reset so the next open replays the enter transition
                this._lastCloseTime = Date.now();
                this._searchVisible = false; // Auto-close search on exit too
                this._nowPlayingVisible = false; // dismiss the now-playing surface
                this._pendingNowPlaying = false;
                clearTimeout(this._pendingNowPlayingTimer);
                this._restoreViewport(); // hand the keyboard/viewport behavior back to HA
                this.style.removeProperty('--spf-app-height');
                this.shadowRoot?.querySelector('.browser-wrapper')?.classList.remove('kb-open');
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

    open(opts = {}) {
        this._isOpen = true;

        // Deep-link: slide straight up to the mobile Now Playing surface, which
        // sits over the home page — dismissing it reveals Spotify home. Desktop
        // shows now-playing in a persistent sidebar, so this is mobile-only.
        if (opts.nowPlaying && !this._isDesktop) {
            this._pendingNowPlaying = true;
            this._maybeShowPendingNowPlaying();
            // On a cold open, playback state may not have arrived yet. Give it a
            // moment; if nothing is playing, drop the request rather than popping
            // an empty view (or popping it later once playback starts).
            clearTimeout(this._pendingNowPlayingTimer);
            this._pendingNowPlayingTimer = setTimeout(() => {
                this._pendingNowPlaying = false;
            }, 2500);
        }
    }

    /** Honour a pending "open to Now Playing" request once playback state exists. */
    _maybeShowPendingNowPlaying() {
        if (!this._pendingNowPlaying || !this._playerState?.track) return;
        this._pendingNowPlaying = false;
        clearTimeout(this._pendingNowPlayingTimer);
        // Defer the visible flip two frames so the surface mounts in its closed
        // (translateY(100%)) state first and the slide-up transition runs.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            this._nowPlayingVisible = true;
        }));
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
            <div class="backdrop ${this._entered ? 'open' : ''}" @click=${() => this._animateClose()}></div>
            <div class="browser-wrapper ${this._entered ? 'open' : ''} ${this._queueVisible ? 'queue-open' : ''} anim-${this.config.animations?.browser_open || 'fade'} ${!this.config.animations?.blur ? 'no-blur' : ''}"
                style="${desktopWrapperStyle}"
                @show-toast=${this._handleShowToast}
                @show-alert=${this._handleShowAlert}
                @open-reorder=${this._handleOpenReorder}
                @pinned-changed=${this._handlePinnedChanged}
            >
                ${!this._isDesktop && (this._currentPageId === 'search' || this._currentPageId === 'library') ? '' : html`
                <spotify-header
                    .minimal=${!this._isDesktop}
                    @pointerdown=${!this._isDesktop ? this._onDragStart : null}
                    .backButtonVisible=${this.router && this.router.history.length > 0}
                    .searchVisible=${this._currentPageId === 'search' || this._searchVisible}
                    .menuVisible=${this._menuVisible}
                    .transparent=${this._headerAlpha < 1}
                    .scrollAlpha=${this._headerAlpha}
                    .centerTitle=${this._headerTitle}
                    .titleOpacity=${this._headerTitleOpacity}
                    .searchQuery=${this._currentSearchQuery || ''}
                    .avatarVisible=${this._currentPageId === 'home'}
                    .avatarUrl=${this._resolveAvatar()}
                    .avatarSwitchable=${(this.config.spotify_accounts || []).length > 1}
                    @avatar-click=${this._handleAvatarClick}
                    @back-click=${() => this.router.goBack()}
                    @logo-click=${() => { this.router.resetToHome(); this._menuVisible = false; }}
                    @search-toggle-click=${() => { this._handleSearchToggleClick(); this._menuVisible = false; }}
                    @search-input=${this._handleSearchInput}
                    @search-keydown=${this._handleSearchKeydown}
                    @queue-click=${() => { this._queueVisible = !this._queueVisible; this._menuVisible = false; }}
                    @menu-click=${this._handleMenuClick}
                    @close-click=${() => this._isOpen = false}
                    @collapse-click=${() => this._animateClose()}
                    @close-menu=${() => this._menuVisible = false}
                    @menu-item-click=${this._handleMenuItemClick}
                >
                </spotify-header>
                `}

                <div class="page-container ${this._currentPageId && (this._currentPageId === 'likedsongs' || this._currentPageId.startsWith('artist:') || this._currentPageId.startsWith('album:') || this._currentPageId.startsWith('playlist:')) ? 'has-hero' : ''}">
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
                    .track=${this._trackPopupData}
                    .config=${this.config}
                    .deviceVisible=${this._devicePopupVisible}
                    .trackVisible=${this._trackPopupVisible}
                    .canManageDevices=${!!this.deviceManager}
                    .showRevealButton=${this._showRevealButton}
                    .blur=${this.config.animations?.blur !== false}
                    @close-popups=${() => {
                this._devicePopupVisible = false;
                this._trackPopupVisible = false;
            }}
                    @device-selected=${this._handleDeviceSelected}
                    @reveal-all-devices=${this._handleRevealAllDevices}
                    @toggle-hidden-devices=${this._handleToggleHiddenDevices}
                    @refresh-devices=${this._handleRefreshDevices}
                    @track-action=${this._handleTrackAction}
                    @open-manager=${() => {
                this._devicePopupVisible = false;
                this._deviceManagerVisible = true;
            }}
                ></spotify-popups>

                <spotify-account-panel
                    .visible=${this._accountSheetVisible}
                    .accounts=${this.config.spotify_accounts || []}
                    .activeEntity=${this.config.entity}
                    .currentImage=${this._currentProfileImg}
                    @close=${() => { this._accountSheetVisible = false; }}
                    @account-selected=${this._handleAccountSelected}
                ></spotify-account-panel>

                ${!this._isDesktop && this._playerState && this._playerState.track ? html`
                    <div class="mobile-mini-player" @click=${this._handleMiniPlayerClick}>
                        <div class="mini-player-art" style="${this._playerState.track?.album?.images?.[0]?.url ? `background-image: url('${this._playerState.track.album.images[0].url}')` : ''}"></div>
                        <div class="mini-player-info">
                            <div class="mini-player-title">
                                ${this._playerState.track?.name || 'Unknown Track'}
                                ${this._playerState.track?.artists?.length ? html`<span class="mini-player-sep"> • </span><span class="mini-player-artist-inline">${this._playerState.track.artists.map(a => a.name).join(', ')}</span>` : ''}
                            </div>
                            ${this._playerState.activeDevice ? html`
                                <div class="mini-player-device-line">
                                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>
                                    <span>${this._playerState.activeDevice}</span>
                                </div>
                            ` : ''}
                        </div>
                        <button class="mini-player-device-btn ${this._playerState.activeDevice ? 'connected' : ''}" @click=${this._handleMiniDeviceClick} aria-label="Connect to a device">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="6" y="2" width="12" height="20" rx="2.5"/>
                                <circle cx="12" cy="6.5" r="1.2" fill="currentColor" stroke="none"/>
                                <circle cx="12" cy="14.5" r="3.2"/>
                            </svg>
                        </button>
                        <button class="mini-player-play-btn" @click=${this._handleMiniPlayerPlayPause}>
                            <svg viewBox="0 0 24 24">
                                <path fill="currentColor" d="${this._playerState.isPlaying ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z'}"/>
                            </svg>
                        </button>
                        <div class="mini-player-progress">
                            <div class="mini-player-progress-bar" id="mini-player-progress-bar"></div>
                        </div>
                    </div>
                ` : ''}

                ${!this._isDesktop ? html`
                    <spotify-now-playing-mobile
                        .visible=${this._nowPlayingVisible}
                        .hass=${this.hass}
                        .config=${this.config}
                        .api=${this.api}
                        .playerController=${this.playerController}
                        .state=${this._playerState}
                        @close=${() => this._nowPlayingVisible = false}
                        @open-devices=${() => this._openConnectPanel()}
                        @open-queue=${() => this._openMobileQueue()}
                    ></spotify-now-playing-mobile>

                    <spotify-connect-panel
                        .visible=${this._connectPanelVisible}
                        .devices=${this._devices}
                        .state=${this._playerState}
                        .loading=${this._connectLoading}
                        @close=${() => this._connectPanelVisible = false}
                        @device-selected=${this._handleConnectDeviceSelected}
                        @volume-change=${(e) => this.api?.setVolume(e.detail)}
                        @open-manager=${() => { this._connectPanelVisible = false; this._deviceManagerVisible = true; }}
                    ></spotify-connect-panel>

                    <spotify-queue-panel
                        .visible=${this._mobileQueueVisible}
                        .hass=${this.hass}
                        .config=${this.config}
                        .state=${this._playerState}
                        .playerController=${this.playerController}
                        @close=${() => this._mobileQueueVisible = false}
                    ></spotify-queue-panel>
                ` : ''}

                ${!this._isDesktop ? html`
                    <div class="mobile-bottom-nav">
                        <div class="nav-tab ${this._currentPageId === 'home' ? 'active' : ''}" @click=${() => this._handleNavTabClick('home')}>
                            <svg viewBox="0 0 24 24">
                                <path fill="currentColor" d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
                            </svg>
                            <span>Home</span>
                        </div>
                        <div class="nav-tab ${this._currentPageId === 'search' ? 'active' : ''}" @click=${() => this._handleNavTabClick('search')}>
                            <svg viewBox="0 0 24 24">
                                <path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                            </svg>
                            <span>Search</span>
                        </div>
                        <div class="nav-tab ${this._currentPageId === 'library' ? 'active' : ''}" @click=${() => this._handleNavTabClick('library')}>
                            <svg viewBox="0 0 24 24">
                                <path fill="currentColor" d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0-2-.9-2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
                            </svg>
                            <span>Your Library</span>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    _handleSearchToggleClick() {
        this._searchVisible = !this._searchVisible;
        // Focus the input only on an explicit open, so the keyboard appears here
        // but stays down when search re-appears via back-navigation.
        if (this._searchVisible) {
            this.shadowRoot.querySelector('spotify-header')?.focusOnOpen();
        }
    }
    _handleSearchInput(e) {
        const query = e.detail;
        this._currentSearchQuery = query;
        if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);

        if (!query) return;

        this._searchDebounceTimer = setTimeout(() => {
            if (this._currentPageId === 'search') {
                // If already on search page, just update data
                // (the page lives in the router's container, not our shadow root)
                const searchPage = this.router?.pageCache.get('search');
                if (searchPage) {
                    searchPage.search(query);
                } else {
                    this.router.navigateTo('search', { query });
                }
            } else {
                this.router.navigateTo('search', { query });
            }
        }, 400);
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

    /** Create storage/pinned/device managers once their dependencies are ready. */
    _ensureManagers() {
        if (!this.hass) return;

        if (!this.storageManager) {
            this.storageManager = new StorageManager(this.hass, {
                sensor_entity: this.config?.storage?.sensor_entity || 'sensor.spotify_browser_data',
                event_type: this.config?.storage?.event_type || 'spotify_browser_store_data',
                write_script: this.config?.storage?.write_script || null
            });
            this._validateStorage();
        }

        if (!this.pinnedManager && this.config && (this.config.homescreen?.sticky || this.config.homescreen?.pinned_items_entity)) {
            try {
                const pinnedConfig = this.config.homescreen?.sticky || { helper: this.config.homescreen?.pinned_items_entity };
                this.pinnedManager = new PinnedItemsManager(this.hass, pinnedConfig, this.storageManager);
                if (this.router) this.router.updateDependencies({ pinned: this.pinnedManager });
            } catch (e) {
                console.error("[SpotifyBrowser] Failed to initialize PinnedItemsManager", e);
            }
        }

        if (!this.deviceManager && this.config && this.config.device_playback) {
            try {
                this.deviceManager = new DeviceManager(this.hass, this.config.device_playback, this.storageManager);
            } catch (e) {
                console.error("[SpotifyBrowser] Failed to initialize DeviceManager", e);
            }
        }
    }

    _validateStorage() {
        const status = this.storageManager.checkStatus();

        if (status === 'empty') {
            // No-op: an empty store needs no proactive write. getData() already
            // treats a missing attribute as null and saveData() merges into {} on
            // first real write. Firing resetStorage() here used to write an empty
            // {} over the websocket on every cold boot — and because the WebView
            // wrapper hard-reloads on every foreground return, that write landed
            // in the reconnect grace window, failed, and made HA surface its
            // "connection lost" toast + haptic. (Same window triggerScan() guards
            // against; see api.js.) Leaving it empty is harmless and silent.
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
                        onConfirm: () => this.storageManager.resetStorage()
                    },
                    bubbles: true,
                    composed: true
                }));
            }, 1000);
        }
    }

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

        // Listen to state changes
        this.playerController.addEventListener('state-changed', this._onPlayerStateChange);
        this._playerState = this.playerController.state;

        // Initial Sync
        if (this.hass) this.playerController.updateHass(this.hass);

        this.requestUpdate();
    }

    /** Attributes of the configured player entity (empty object if unavailable). */
    _playerAttributes() {
        return this.hass?.states[this.config?.entity]?.attributes || {};
    }

    /** Scan for devices and update picker state. Returns the device list. */
    async _scanDevices(options = {}) {
        if (this.deviceManager) {
            this._devices = await this.deviceManager.fetchMergedDevices(this.api, this._playerAttributes(), options);
            const settings = await this.deviceManager.getSettings();
            this._showRevealButton = !!(settings.hide_connect_devices && settings.see_all_devices);
        } else {
            const response = await this.api.fetchSpotifyPlus('get_spotify_connect_devices', { refresh: !!options.refresh });
            this._devices = parseDeviceItems(response).map(normalizeDevice);
        }
        this.requestUpdate();
        return this._devices;
    }

    async _openDevicePicker(options = {}) {
        this._deviceManagerVisible = false; // Ensure manager is closed
        this._devicePopupVisible = true; // Open Picker

        const popups = this.shadowRoot.getElementById('popups');
        if (popups && options.refresh) popups.showToast("Scanning for devices...");

        try {
            await this._scanDevices(options);
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
            // Immediate render from existing saved state while the scan runs
            if (this.deviceManager) {
                this.deviceManager.getMergedDevices([], this._playerAttributes()).then(devs => {
                    this._devices = devs;
                    this.requestUpdate();
                });
            }

            // Show Popup Immediately
            this._deviceManagerVisible = false;
            this._devicePopupVisible = true;
            this._pendingDeviceResolution = resolve;
            const popups = this.shadowRoot.getElementById('popups');
            if (popups) popups.showToast("Scanning for devices...");

            // Background sync
            this._scanDevices({ refresh: true }).catch(e => {
                console.error("[App] Device scan failed", e);
            });
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
                this._openDevicePicker({ refresh: true });
                break;
            case 'menu-accounts':
                this._accountSheetVisible = true;
                break;
            case 'menu-library':
                this.router.navigateTo('library');
                break;
        }
    }

    /** Switch the active Spotify account/entity and rebuild the API stack. */
    switchAccount(entity) {
        if (!entity || entity === this.config.entity) return;
        this.config = { ...this.config, entity };
        if (this.api) this.api.destroy();
        this.api = null;
        if (this.playerController) {
            this.playerController.removeEventListener('state-changed', this._onPlayerStateChange);
            this.playerController.destroy();
        }
        this.playerController = null;
        this._initApi();

        // Every cached page holds the previous account's data — rebuild from a
        // fresh home so the whole screen reflects the new account.
        if (this.router) {
            this.router.updateDependencies({ api: this.api, config: this.config });
            this.router.clearCache();
            this.router.navigateTo('home');
        }
    }

    _handleAccountSelected(e) {
        this.switchAccount(e.detail.entity);
        this._accountSheetVisible = false;
    }

    /** Avatar for the active account: configured image first, else the live profile pic. */
    _resolveAvatar() {
        const accounts = this.config?.spotify_accounts || [];
        const acc = accounts.find(a => a.entity === this.config?.entity);
        return acc?.image || this._currentProfileImg || '';
    }

    _handleAvatarClick() {
        if ((this.config.spotify_accounts || []).length > 1) {
            this._accountSheetVisible = true;
        }
    }

    /**
     * Live Spotify profile picture for the active account, used as the account
     * switcher's avatar when that account has no configured `image`. Fetched once
     * per entity; failures fall back to the default avatar icon.
     */
    async _loadProfileImage() {
        const entity = this.config?.entity;
        if (!this.api || !entity || this._profileImgFor === entity) return;
        this._profileImgFor = entity;
        this._currentProfileImg = '';
        try {
            const profile = await this.api.getCurrentUserProfile();
            const url = profile?.images?.[0]?.url;
            if (url && this.config?.entity === entity) this._currentProfileImg = url;
        } catch (_) { /* default icon */ }
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

    /**
     * A pin/unpin happened somewhere in the app (a context view, the reorder
     * dialog, etc.). Refresh the app-level snapshot and the home page's pinned
     * row immediately, rather than waiting for the sensor's event round-trip
     * (which the hass reactive path would eventually catch).
     */
    _handlePinnedChanged() {
        if (!this.pinnedManager) return;
        this.pinnedManager.getItems().then(items => { this._pinnedItems = items; });
        this._refreshHomePinned();
    }

    /** Re-fetch the cached home page's pinned section, if it exists. */
    _refreshHomePinned() {
        const home = this.router?.pageCache.get('home');
        if (home?.fetchSectionData) home.fetchSectionData('pinned');
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

        // reorder() sets the manager's optimistic cache synchronously, so refresh
        // the home now (instant) and again once the write resolves (confirmation).
        const op = this.pinnedManager.reorder(orderedItemsOrIds);
        this._refreshHomePinned();
        op.then(() => {
            this._refreshHomePinned();
        }).catch(e => {
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
            this._refreshHomePinned();
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
            this._refreshHomePinned();
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
            // Optimistic Delete (manager sets its optimistic cache synchronously).
            this._pinnedItems = (this._pinnedItems || []).filter(i => i.id !== id);

            const op = this.pinnedManager.remove(id);
            this._refreshHomePinned();
            op.then(res => {
                if (!res.success) {
                    const popups = this.shadowRoot.getElementById('popups');
                    if (popups) popups.showToast("Failed to remove item: " + (res.error || 'Unknown'));
                } else {
                    this._refreshHomePinned();
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

    _onPlayerStateChange(e) {
        this._playerState = e.detail;
        this._maybeShowPendingNowPlaying();
        if (this._playerState?.isPlaying && !this._isDesktop) {
            this._startMiniPlayerProgressTimer();
        } else {
            this._stopMiniPlayerProgressTimer();
        }
    }

    _startMiniPlayerProgressTimer() {
        this._stopMiniPlayerProgressTimer();
        this._miniPlayerProgressTimer = setInterval(() => this._updateMiniPlayerProgress(), 1000);
        this._updateMiniPlayerProgress();
    }

    _stopMiniPlayerProgressTimer() {
        if (this._miniPlayerProgressTimer) {
            clearInterval(this._miniPlayerProgressTimer);
            this._miniPlayerProgressTimer = null;
        }
    }

    _updateMiniPlayerProgress() {
        if (this._isDesktop || !this.hass || !this.config?.entity) return;
        const stateObj = this.hass.states[this.config.entity];
        if (!stateObj) return;

        const progressBar = this.shadowRoot.getElementById('mini-player-progress-bar');
        if (!progressBar) return;

        let position = 0;
        let duration = 1;

        if (stateObj.attributes.media_duration) {
            position = stateObj.attributes.media_position || 0;
            duration = stateObj.attributes.media_duration;

            if (stateObj.state === 'playing') {
                const lastUpdated = new Date(stateObj.last_updated).getTime();
                const now = new Date().getTime();
                position += (now - lastUpdated) / 1000;
            }
        } else if (this._playerState?.track?.duration_ms) {
            duration = this._playerState.track.duration_ms / 1000;
            position = (this._playerState.track.progress_ms || 0) / 1000;
        }

        if (position > duration) position = duration;
        const percent = (position / duration) * 100;
        progressBar.style.width = `${percent}%`;
    }

    _handleNavTabClick(pageId) {
        if (!this.router) return;
        // Tapping the tab you're already on does nothing.
        if (this._currentPageId === pageId) return;
        if (pageId === 'home') {
            this.router.resetToHome();
        } else {
            this.router.navigateTo(pageId);
        }
    }

    _handleMiniPlayerClick(e) {
        if (e.target.closest('.mini-player-play-btn') || e.target.closest('.mini-player-device-btn')) return;
        this._nowPlayingVisible = true;
    }

    _handleMiniDeviceClick(e) {
        e.stopPropagation();
        fireHaptic('light');
        this._openConnectPanel();
    }

    /** Open the mobile Queue sheet (over the now-playing view) and refresh data. */
    _openMobileQueue() {
        this._mobileQueueVisible = true;
        this.playerController?.refreshQueue();
        this.playerController?.refreshRecent();
    }

    /** Open the mobile Connect bottom sheet and (re)scan for devices. */
    async _openConnectPanel() {
        this._connectPanelVisible = true;
        this._connectLoading = !(this._devices && this._devices.length);
        try {
            await this._scanDevices({ refresh: true });
        } catch (e) {
            console.error('[App] Connect panel device scan failed', e);
        } finally {
            this._connectLoading = false;
        }
    }

    /** Transfer playback to the chosen device from the Connect sheet. */
    _handleConnectDeviceSelected(e) {
        const device = e.detail;
        // player_transfer_playback doesn't support return_response=true
        this.api?.fetchSpotifyPlus('player_transfer_playback', { device_id: device.id, play: true }, false);
        this._connectPanelVisible = false;
        const popups = this.shadowRoot.getElementById('popups');
        if (popups) popups.showToast(`Transferring playback to ${device.name}`);
    }

    /* --- Drag-to-close (mobile, iPhone-panel style) --- */
    _onDragStart(e) {
        if (this._isDesktop) return;
        this._dragWrapper = this.shadowRoot.querySelector('.browser-wrapper');
        if (!this._dragWrapper) return;
        this._dragStartY = e.clientY;
        this._dragDelta = 0;
        this._dragging = true;
        this._dragWrapper.style.transition = 'none';
        window.addEventListener('pointermove', this._onDragMove, { passive: false });
        window.addEventListener('pointerup', this._onDragEnd);
        window.addEventListener('pointercancel', this._onDragEnd);
    }

    _onDragMove(e) {
        if (!this._dragging || !this._dragWrapper) return;
        this._dragDelta = Math.max(0, e.clientY - this._dragStartY);
        this._dragWrapper.style.transform = `translateY(${this._dragDelta}px)`;
        const backdrop = this.shadowRoot.querySelector('.backdrop');
        if (backdrop) backdrop.style.opacity = String(Math.max(0, 1 - this._dragDelta / 500));
    }

    _onDragEnd() {
        if (!this._dragging) return;
        this._dragging = false;
        window.removeEventListener('pointermove', this._onDragMove);
        window.removeEventListener('pointerup', this._onDragEnd);
        window.removeEventListener('pointercancel', this._onDragEnd);

        const w = this._dragWrapper;
        const backdrop = this.shadowRoot.querySelector('.backdrop');
        if (!w) return;
        w.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';

        if (this._dragDelta > 140) {
            // Past threshold: slide the rest of the way down, then close
            w.style.transform = 'translateY(100%)';
            let done = false;
            const finish = () => {
                if (done) return; done = true;
                this._isOpen = false;
                w.style.transform = '';
                w.style.transition = '';
                if (backdrop) backdrop.style.opacity = '';
            };
            w.addEventListener('transitionend', finish, { once: true });
            setTimeout(finish, 360);
        } else {
            // Spring back
            w.style.transform = '';
            if (backdrop) backdrop.style.opacity = '';
            setTimeout(() => { if (w) w.style.transition = ''; }, 320);
        }
    }

    /* Slide the panel down then close (mobile iOS-panel dismiss). */
    _animateClose() {
        if (this._isDesktop) { this._isOpen = false; return; }
        const w = this.shadowRoot.querySelector('.browser-wrapper');
        const backdrop = this.shadowRoot.querySelector('.backdrop');
        if (!w) { this._isOpen = false; return; }

        w.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)';
        w.style.transform = 'translateY(100%)';
        if (backdrop) backdrop.style.opacity = '0';

        let done = false;
        const finish = () => {
            if (done) return; done = true;
            this._isOpen = false;
            w.style.transform = '';
            w.style.transition = '';
            if (backdrop) backdrop.style.opacity = '';
        };
        w.addEventListener('transitionend', finish, { once: true });
        setTimeout(finish, 420);
    }

    _handleMiniPlayerPlayPause(e) {
        e.stopPropagation();
        fireHaptic('medium');
        if (this.playerController) {
            this.playerController.pause();
        } else if (this.api) {
            const isPlaying = this._playerState?.isPlaying || false;
            this.api.togglePlayback(!isPlaying);
        }
    }
}

customElements.define('spotify-browser-app', SpotifyBrowserApp);
