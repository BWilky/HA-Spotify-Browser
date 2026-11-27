import { LitElement, html } from "./lit.js";

import { SpotifyApi, classifyPlaybackError } from './api.js';
import { parseDeviceItems, normalizeDevice, fireHaptic, setDebug, debugLog, pickImage, IMG_THUMB } from './utils.js';
import { sharedStyles } from './styles/shared-styles.js';
import { shellStyles } from './spotify-browser-app.styles.js';
import { Router } from './router.js';
import './components/spotify-header.js';
import './components/players/sidebar/index.js';
import './components/players/mini-player.js';
import './components/players/now-playing-mobile.js';
import './components/players/connect-panel.js';
import './components/players/queue-panel.js';
import './components/players/account-panel.js';
import './components/spotify-home.js';
import './components/spotify-search.js';
import { SpotifyContextView } from './components/spotify-context-view.js';
import './components/views/spotify-library.js';
import './components/spotify-popups.js';
import './components/spotify-reorder-dialog.js';
import './components/popups/spotify-playlist-picker.js';
import './components/popups/spotify-playlist-create-sheet.js';
import './components/popups/spotify-context-menu.js';
import { PinnedItemsManager } from './components/controllers/pinned-items-manager.js';
import { evictedPinMessage } from './components/playlist-actions.js';
import { DeviceManager } from './components/devices/device-manager.js';
import { SonosBridge } from './components/devices/sonos-bridge.js';
import { StorageManager } from './components/controllers/storage-manager.js';
import { PlayerController } from './components/controllers/player-controller.js';
import { DragDismissController, slideOut } from './components/controllers/drag-dismiss-controller.js';
import { ensureAppFonts } from './styles/fonts.js';

import './components/devices/index.js'; // Registers Custom Elements

// Shared "no items" value for the context menu: a fresh [] per render is a new
// reference every time, which re-rendered the menu on every root render.
const NO_MENU_ITEMS = Object.freeze([]);

// The mobile panel's transition when a drag-to-close is let go (spring back
// or slide the rest of the way down).
const PANEL_DRAG_RELEASE_TRANSITION = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';

class SpotifyBrowserApp extends LitElement {
    static get properties() {
        return {
            hass: { type: Object },
            config: { type: Object },
            api: { type: Object },
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
            _ctxMenuVisible: { type: Boolean, state: true },
            _ctxMenuHeader: { type: Object, state: true },
            _ctxMenuItems: { type: Array, state: true },
            _ctxMenuAnchor: { type: Object, state: true },
            _playlistPickerVisible: { type: Boolean, state: true },
            _playlistPickerTrack: { type: Object, state: true },
            _playlistDialogVisible: { type: Boolean, state: true },
            _playlistDialogProps: { type: Object, state: true },
            _devices: { type: Array },
            _currentSearchQuery: { type: String },
            _isDesktop: { type: Boolean, state: true },
            _reorderVisible: { type: Boolean, state: true },
            _pinnedItems: { type: Array, state: true },
            _deviceManagerVisible: { type: Boolean, state: true },
            _showRevealButton: { type: Boolean, state: true },
            _nowPlayingVisible: { type: Boolean, state: true },
            _connectPanelVisible: { type: Boolean, state: true },
            _connectLoading: { type: Boolean, state: true },
            _mobileQueueVisible: { type: Boolean, state: true },
            _editSessionOnScreen: { type: Boolean, state: true }, // the page on screen is a playlist in edit mode
        };
    }

    static get styles() {
        // shellStyles after sharedStyles: see spotify-browser-app.styles.js.
        return [sharedStyles, shellStyles];
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
        this._lastActivityTime = 0;  // wall-clock stamp of last trusted user input (auto_close)
        this._idleCheckTimer = null; // auto_close watchdog interval
        this._currentPageId = 'home';
        this._currentPageData = null;
        this._searchVisible = false;
        this._menuVisible = false;
        this._queueVisible = false;
        this._devicePopupVisible = false;
        this._accountSheetVisible = false;
        this._currentProfileImg = '';
        this._ctxMenuVisible = false;
        this._ctxMenuHeader = null;   // {image, name, subtitle} for the context menu header
        this._ctxMenuItems = null;    // [{id, label, icon, danger?}]
        this._ctxMenuAnchor = null;   // trigger's viewport rect (desktop popover anchor)
        this._menuTrack = null;       // track payload for the standard track-menu actions
        this._menuContext = null;     // {surface, playlistId, canEditItems, ...} for the open menu
        this._menuOnAction = null;    // callback for menus owned by a view (playlist header)
        this._playlistPickerVisible = false;
        this._playlistPickerTrack = null;
        this._playlistDialogVisible = false;
        this._playlistDialogProps = null;
        this._devices = [];
        this._reorderVisible = false;
        this._pinnedItems = [];
        this._deviceManagerVisible = false;
        this._showRevealButton = false;
        this._queueInitDone = false;
        this._nowPlayingVisible = false;
        this._pendingNowPlaying = false;
        this._pendingNowPlayingTimer = null;
        this._trackWaitOn = null; // PlayerController the now-playing deep link is waiting on
        this._maybeShowPendingNowPlaying = this._maybeShowPendingNowPlaying.bind(this);
        this._connectPanelVisible = false;
        this._connectLoading = false;
        this._mobileQueueVisible = false;
        this._editSessionOnScreen = false;
        // Mobile drag-to-close (iPhone-panel style): drag the header down past
        // 140px and the panel slides the rest of the way and closes;
        // otherwise it springs back.
        this._panelDrag = new DragDismissController(this, {
            canStart: () => !this._isDesktop,
            getPanel: () => this.shadowRoot.querySelector('.browser-wrapper'),
            getBackdrop: () => this.shadowRoot.querySelector('.backdrop'),
            threshold: 140,
            fadeDistance: 500,
            releaseTransition: PANEL_DRAG_RELEASE_TRANSITION,
            onDismiss: ({ panel, backdrop }) => slideOut(panel, backdrop, {
                transition: PANEL_DRAG_RELEASE_TRANSITION,
                fadeBackdrop: false,
                settleMs: 360,
                onSettled: () => { this._isOpen = false; },
            }),
            onSnapBack: ({ panel }) => {
                setTimeout(() => { if (panel) panel.style.transition = ''; }, 320);
            },
        });



        // Header state
        this._headerAlpha = 1;
        this._headerTitle = '';
        this._headerTitleOpacity = 0;


        // Initial check, will be updated in firstUpdated/resize
        this._isDesktop = window.matchMedia('(min-width: 769px)').matches;
    }

    /**
     * `hass` is replaced on every Home Assistant state change (about once a
     * second during playback). A hass-only change never renders the root:
     * nothing in the root template reads hass (the surfaces that show player
     * state subscribe to the PlayerController; pages get hass from the router;
     * see _propagateHass for the one child that is handed it). What a new hass
     * has to reach is fanned out from here instead, without a render.
     */
    shouldUpdate(changedProperties) {
        if (changedProperties.has('hass')) {
            const oldHass = changedProperties.get('hass');

            // Pointer swaps, on EVERY change: the services read entities the
            // gate below never looks at.
            this._syncServiceHass();

            // The first hass always renders: updated() creates the api and the
            // managers from it (and does the first fan-out).
            if (!oldHass || !this.hass) return true;

            // The real work, only when an entity we follow changed.
            if (this._hassChangeMatters(oldHass, this.hass)) this._propagateHass();

            // Checked AFTER the fan-out on purpose: a reactive property set on
            // the root while it ran is in this same map and gets its render.
            if (changedProperties.size === 1) return false;
        }

        return true;
    }

    /**
     * Whether a hass change touches an entity the app follows: the player
     * entity, the Sonos speakers, or the storage sensor. Everything else in
     * Home Assistant changing is none of our business.
     */
    _hassChangeMatters(oldHass, newHass) {
        // 1. The player entity.
        if (this.config && this.config.entity) {
            if (oldHass.states[this.config.entity] !== newHass.states[this.config.entity]) return true;
        }

        // 1b. The Sonos speakers. Local Sonos playback never engages Spotify
        // Connect, so the SpotifyPlus entity above sits idle while the
        // speaker's own media_player carries every track/play/volume change.
        const sonos = this.config?.sonos;
        if (sonos?.enabled) {
            // The speaker driving playback now: the bridge's remembered
            // target, which is what playerController.playbackEntityId()
            // resolves to. Not that resolver itself: it can scan every
            // media_player (name auto-detect) and rewrites the bridge's
            // memory — too much for a per-tick gate.
            const target = this.sonosBridge?.targetEntity;
            if (target && oldHass.states[target] !== newHass.states[target]) return true;

            // Mapped speakers: one starting to play is how the bridge
            // adopts a target (prefer_sonos, recovery after a reload).
            for (const entry of sonos.device_map || []) {
                if (entry.entity && oldHass.states[entry.entity] !== newHass.states[entry.entity]) return true;
            }
        }

        // 2. The storage sensor — the actual backend for pinned items and
        // per-device settings, so pin/device edits from another browser reach
        // the home page and the device manager.
        const storageSensor = this.config?.storage?.sensor;
        if (storageSensor && oldHass.states[storageSensor] !== newHass.states[storageSensor]) return true;

        return false;
    }

    /**
     * Hand the current hass to the services whose updateHass/setHass is a plain
     * pointer swap. Called from shouldUpdate on every hass change, including
     * the ones _hassChangeMatters dismisses.
     */
    _syncServiceHass() {
        if (!this.hass) return;
        if (this.api) this.api.updateHass(this.hass);
        if (this.storageManager) this.storageManager.updateHass(this.hass);
        if (this.deviceManager) this.deviceManager.updateHass(this.hass);
        if (this.sonosBridge) this.sonosBridge.setHass(this.hass);
        if (this.pinnedManager) this.pinnedManager.updateHass(this.hass);
    }

    /**
     * Fan the current hass out to what does real work with it — for the hass
     * changes that matter (from shouldUpdate) and for the first hass (from
     * updated()), never by way of a root render:
     *  - PlayerController derives and announces the player state; every
     *    surface showing it subscribes and re-renders itself. It keeps
     *    deriving while closed (inactive: no fetching), so the now-playing
     *    deep link has a track to show.
     *  - the router hands hass to the page on screen. Pages need it only
     *    while open; the open branch of updated() catches the router up.
     *  - the device manager sheet re-reads its saved devices when the storage
     *    entity changes, and only looks while open (its template binding
     *    supplies the current hass on any root render, e.g. the one opening it).
     */
    _propagateHass() {
        if (!this.hass) return;
        if (this.playerController) this.playerController.updateHass(this.hass);
        if (this.router && this._isOpen) this.router.updateDependencies({ hass: this.hass });
        if (this._deviceManagerVisible) {
            const manager = this.shadowRoot?.querySelector('spotify-popup-devicemanager');
            if (manager) manager.hass = this.hass;
        }
    }

    firstUpdated(changedProperties) {
        // Register Circular Std at document level (@font-face is ignored in shadow roots).
        ensureAppFonts();

        // Initialize Router
        const container = this.shadowRoot.querySelector('.page-container');
        this.router = new Router(container, this.config);



        // Desktop Media Query Listener (stored on `this` for disconnect cleanup)
        this._mediaQuery = window.matchMedia('(min-width: 769px)');
        this._onMediaQueryChange = (e) => {
            this._isDesktop = e.matches;
        };
        try {
            this._mediaQuery.addEventListener('change', this._onMediaQueryChange);
        } catch (e) {
            // Safari older fallback
            this._mediaQuery.addListener(this._onMediaQueryChange);
        }
        this._isDesktop = this._mediaQuery.matches;

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

        // Foreground/background lifecycle: rescan on return (desktop keeps the
        // popup open across tab switches), close the mobile sheet on background.
        this._windowBlurredAt = 0;
        this._onAppVisibility = () => {
            if (document.hidden) this._handleAppBackgrounded();
            else this._handleAppForegrounded();
        };
        this._onPageHide = () => this._handleAppBackgrounded();
        this._onWindowBlur = () => { this._windowBlurredAt = Date.now(); };
        this._onWindowFocus = () => {
            // focus fires spuriously (iframe cards, browser chrome round-trips);
            // only treat it as a "return" after a real absence (>5s blurred), and
            // let visibilitychange own the hidden -> visible case.
            if (document.hidden) return;
            if (!this._windowBlurredAt || Date.now() - this._windowBlurredAt < 5000) return;
            this._windowBlurredAt = 0;
            this._handleAppForegrounded();
        };
        document.addEventListener('visibilitychange', this._onAppVisibility);
        window.addEventListener('pagehide', this._onPageHide);
        window.addEventListener('blur', this._onWindowBlur);
        window.addEventListener('focus', this._onWindowFocus);

        // Idle auto-close: stamp the last user interaction. Plain field write —
        // never triggers a re-render. Capture beats a component's
        // stopPropagation; passive keeps scrolling smooth; isTrusted rejects
        // programmatic dispatches. pointermove is deliberately excluded
        // (desktop hover noise; pointerdown/wheel/touchmove cover real use).
        this._onUserActivity = (e) => {
            if (e.isTrusted) this._lastActivityTime = Date.now();
        };
        for (const type of ['pointerdown', 'keydown', 'wheel', 'touchmove']) {
            this.addEventListener(type, this._onUserActivity, { capture: true, passive: true });
        }

        this.router.addEventListener('route-changed', (e) => {
            const { pageId, data, isHeroPage, direction } = e.detail;

            // Update Header State based on Page Type
            // Instead of blind reset, check if the page is already cached and can report state
            this._setHeaderScroll(isHeroPage ? 0 : 1, '', 0);

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
            // The header steps aside only for the page that is being edited:
            // leaving it brings the header back, returning hides it again.
            this._syncEditSessionOnScreen();
            this.requestUpdate();
        });

        // A playlist edit session started or ended on some page (forwarded by Router).
        this.router.addEventListener('edit-session-changed', () => this._syncEditSessionOnScreen());

        // Listen for scroll updates from context views (forwarded by Router)
        this.router.addEventListener('header-scroll', (e) => {
            const { alpha, title, textAlpha } = e.detail;
            if (alpha === this._headerAlpha && title === this._headerTitle
                && textAlpha === this._headerTitleOpacity) return;
            // This fires per scroll frame on hero pages, and only the header
            // reads these values — no root render for it.
            this._setHeaderScroll(alpha, title, textAlpha);
        });

        // Initialize API if ready
        this._initApi();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._stopAwaitingTrack();
        if (this._onOrientation) window.removeEventListener('orientationchange', this._onOrientation);
        if (this._onViewportResize) {
            window.visualViewport?.removeEventListener('resize', this._onViewportResize);
            window.removeEventListener('resize', this._onViewportResize);
        }
        if (this._mediaQuery && this._onMediaQueryChange) {
            try {
                this._mediaQuery.removeEventListener('change', this._onMediaQueryChange);
            } catch (e) {
                // Safari older fallback
                this._mediaQuery.removeListener(this._onMediaQueryChange);
            }
        }
        if (this._onAppVisibility) document.removeEventListener('visibilitychange', this._onAppVisibility);
        if (this._onPageHide) window.removeEventListener('pagehide', this._onPageHide);
        if (this._onWindowBlur) window.removeEventListener('blur', this._onWindowBlur);
        if (this._onWindowFocus) window.removeEventListener('focus', this._onWindowFocus);
        if (this._onUserActivity) {
            for (const type of ['pointerdown', 'keydown', 'wheel', 'touchmove']) {
                this.removeEventListener(type, this._onUserActivity, { capture: true });
            }
        }
        this._stopIdleWatch();
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

        // The first hass is the only one that gets here by rendering (see
        // shouldUpdate); later ones are fanned out without a root render.
        if (changedProperties.has('hass') && this.hass && !changedProperties.get('hass')) {
            this._propagateHass();
        }

        if (changedProperties.has('api') && this.api) {
            if (this.router) this.router.updateDependencies({ api: this.api });
            this._loadProfileImage();
        }

        if (changedProperties.has('_isDesktop')) this._syncNeighborArtSize();

        if (changedProperties.has('config') && this.config) {
            setDebug(this.config.browser.debug === true);
            if (this.router) this.router.updateDependencies({ config: this.config });

            // Queue Init Logic
            if (!this._queueInitDone && this._isDesktop) {
                if (this.config.queue.open_on_desktop) {
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

                // The router was not fed hass while closed; give it the
                // current one before any page is shown or created.
                if (this.router) this.router.updateDependencies({ hass: this.hass });

                // OPENING: reset to home per the parsed home_on_exit config
                // ({ enabled, timeout } — timeout keeps the last page for N seconds)
                const hoe = this.config.browser.home_on_exit;
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

                // Fresh data on every (re)open: scan once the socket/grace allows,
                // then re-read queue/recents (the queue can change while the track doesn't).
                // The controller fetched nothing while closed; let it again first.
                this.playerController?.setActive(true);
                this._refreshAfterReturn();

                // The storage-corruption prompt is raised at boot, usually
                // while closed (no popups element to host it) — show it now.
                this._showStorageCorruptPrompt();

                // Idle auto-close: fresh activity baseline (a stale stamp from
                // the last session must not instantly re-close us), then start
                // the watchdog.
                this._lastActivityTime = Date.now();
                this._startIdleWatch();

            } else {
                // CLOSING
                this._entered = false; // reset so the next open replays the enter transition
                this._lastCloseTime = Date.now();
                this._closeAllPopups(); // ANY close dismisses every popup/sheet
                this._stopIdleWatch();
                // Nothing is on screen: stop the controller's fetching (queue,
                // recents, liked state, art).
                this.playerController?.setActive(false);
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
                }, 30000); // 30 seconds
            }
        }
    }

    open(opts = {}) {
        this._isOpen = true;

        // Deep-link: slide straight up to the mobile Now Playing surface, which
        // sits over the home page — dismissing it reveals Spotify home. Desktop
        // has no full-screen Now Playing; its now-playing surface is the queue
        // sidebar, so open that instead (closing resets it per open_on_desktop).
        if (opts.nowPlaying && this._isDesktop) {
            this._queueVisible = true;
        } else if (opts.nowPlaying) {
            this._pendingNowPlaying = true;
            // On a cold open, playback state may not have arrived yet. Give it a
            // moment; if nothing is playing, drop the request rather than popping
            // an empty view (or popping it later once playback starts).
            clearTimeout(this._pendingNowPlayingTimer);
            this._pendingNowPlayingTimer = setTimeout(() => {
                this._pendingNowPlaying = false;
                this._stopAwaitingTrack();
            }, 2500);
            this._maybeShowPendingNowPlaying();
        }
    }

    /**
     * Honour a pending "open to Now Playing" request once playback state
     * exists. With no track yet (cold open) it waits, one-shot, for the first
     * player state that has one; the grace timer in open() ends the wait.
     */
    _maybeShowPendingNowPlaying() {
        if (!this._pendingNowPlaying) {
            this._stopAwaitingTrack(); // the request was dropped (grace over, or closed)
            return;
        }
        if (!this.playerController?.state?.track) {
            this._awaitFirstTrack();
            return;
        }
        this._pendingNowPlaying = false;
        clearTimeout(this._pendingNowPlayingTimer);
        this._stopAwaitingTrack();
        // Defer the visible flip two frames so the surface mounts in its closed
        // (translateY(100%)) state first and the slide-up transition runs.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            this._nowPlayingVisible = true;
        }));
    }

    /** Re-check the pending deep link on each player state until it resolves. */
    _awaitFirstTrack() {
        const pc = this.playerController;
        // No controller yet: _initApi() re-checks once it has created one.
        if (!pc || this._trackWaitOn === pc) return;
        this._stopAwaitingTrack();
        this._trackWaitOn = pc;
        pc.addEventListener('state-changed', this._maybeShowPendingNowPlaying);
    }

    _stopAwaitingTrack() {
        this._trackWaitOn?.removeEventListener('state-changed', this._maybeShowPendingNowPlaying);
        this._trackWaitOn = null;
    }

    /**
     * The scroll-driven <spotify-header> properties. The one place they are
     * computed: render() binds them, and _setHeaderScroll sets them on the
     * element directly between renders.
     */
    _headerScrollProps() {
        return {
            transparent: this._headerAlpha < 1,
            scrollAlpha: this._headerAlpha,
            centerTitle: this._headerTitle,
            titleOpacity: this._headerTitleOpacity,
        };
    }

    /**
     * Set the scroll-driven header state and apply it to <spotify-header>
     * directly, without a root render. EVERY write to these fields goes
     * through here: Lit skips a binding whose value equals the one it last
     * committed, so a root render alone would not undo a value that was set
     * on the element behind its back.
     */
    _setHeaderScroll(alpha, title, textAlpha) {
        this._headerAlpha = alpha;
        this._headerTitle = title;
        this._headerTitleOpacity = textAlpha;
        const header = this.shadowRoot.querySelector('spotify-header');
        if (header) Object.assign(header, this._headerScrollProps());
    }

    render() {
        if (!this.config || !this.hass || !this._isOpen) {
            return html``;
        }

        // Dynamic Desktop Styles
        let desktopWrapperStyle = '';
        if (this._isDesktop) {
            const ds = this.config.appearance.desktop;
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

        const headerScroll = this._headerScrollProps();
        // Pages that bring their own top bar get no app header: mobile search
        // and library, and — on every layout — a playlist while it is being
        // edited (the editor's Cancel / title / Save bar is the chrome then;
        // the header's buttons would sit on top of it).
        const pageOwnsTopBar = this._editSessionOnScreen
            || (!this._isDesktop && (this._currentPageId === 'search' || this._currentPageId === 'library'));

        return html`
            <div class="backdrop ${this._entered ? 'open' : ''}" @click=${() => this._animateClose()}></div>
            <div class="browser-wrapper ${this._entered ? 'open' : ''} ${this._queueVisible ? 'queue-open' : ''} anim-${this.config.appearance.animations.browser_open} ${!this.config.appearance.animations.blur ? 'no-blur' : ''}"
                style="${desktopWrapperStyle}"
                @show-toast=${this._handleShowToast}
                @show-alert=${this._handleShowAlert}
                @open-reorder=${this._handleOpenReorder}
                @pinned-changed=${this._handlePinnedChanged}
                @open-track-menu=${this._handleOpenTrackMenu}
                @open-context-menu=${this._handleOpenContextMenu}
                @open-playlist-dialog=${this._handleOpenPlaylistDialog}
                @playlist-changed=${this._handlePlaylistChanged}
            >
                ${pageOwnsTopBar ? '' : html`
                <spotify-header
                    .minimal=${!this._isDesktop}
                    @pointerdown=${!this._isDesktop ? this._panelDrag.start : null}
                    .backButtonVisible=${this.router && this.router.history.length > 0}
                    .searchVisible=${this._currentPageId === 'search' || this._searchVisible}
                    .menuVisible=${this._menuVisible}
                    .transparent=${headerScroll.transparent}
                    .scrollAlpha=${headerScroll.scrollAlpha}
                    .centerTitle=${headerScroll.centerTitle}
                    .titleOpacity=${headerScroll.titleOpacity}
                    .searchQuery=${this._currentSearchQuery || ''}
                    .avatarVisible=${this._currentPageId === 'home'}
                    .avatarUrl=${this._resolveAvatar()}
                    .avatarSwitchable=${this.config.accounts.length > 1}
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

                <div class="page-container ${this.router?.isHeroPage(this._currentPageId) ? 'has-hero' : ''}">
                </div>

                <spotify-sidebar-player
                    .api=${this.api}
                    .config=${this.config}
                    .visible=${this._queueVisible}
                    .deviceManager=${this.deviceManager}
                    .playerController=${this.playerController}
                    @navigate=${this._handleNavigate}
                    @device-selected=${(e) => this._transferTo(e.detail)}
                    @open-manager=${() => {
                        // The manager replaces the sidebar queue and the picker.
                        this._queueVisible = false;
                        this._devicePopupVisible = false;
                        this._deviceManagerVisible = true;
                    }}
                ></spotify-sidebar-player>

                <spotify-reorder-dialog
                    .visible=${this._reorderVisible}
                    .items=${this._pinnedItems || []}
                    .allowBlur=${this.config.appearance.animations.blur}
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
                this._releasePendingDevicePick();
            }}
                ></spotify-popup-devicemanager>

                <!-- Device picker: stacked between the alert and the toasts of
                     spotify-popups (see components/spotify-popups.styles.js). -->
                <spotify-popup-devices
                    style="--spf-sheet-z: 229500;"
                    .devices=${this._devices}
                    .config=${this.config}
                    .readonly=${!this.deviceManager}
                    .showRevealButton=${this._showRevealButton}
                    .visible=${this._devicePopupVisible}
                    @close-popups=${() => {
                this._devicePopupVisible = false;
                this._releasePendingDevicePick();
            }}
                    @device-selected=${this._handleDeviceSelected}
                    @toggle-hidden-devices=${this._handleToggleHiddenDevices}
                    @refresh-devices=${this._handleRefreshDevices}
                    @open-manager=${() => {
                this._devicePopupVisible = false;
                this._deviceManagerVisible = true;
            }}
                ></spotify-popup-devices>

                <spotify-popups
                    id="popups"
                    .blur=${this.config.appearance.animations.blur}
                ></spotify-popups>

                <spotify-context-menu
                    .visible=${this._ctxMenuVisible}
                    .header=${this._ctxMenuHeader}
                    .items=${this._ctxMenuItems || NO_MENU_ITEMS}
                    .anchor=${this._ctxMenuAnchor}
                    @action=${this._handleMenuAction}
                    @close=${() => { this._ctxMenuVisible = false; }}
                ></spotify-context-menu>

                <spotify-playlist-picker
                    .visible=${this._playlistPickerVisible}
                    .api=${this.api}
                    .track=${this._playlistPickerTrack}
                    @close=${() => { this._playlistPickerVisible = false; }}
                    @open-playlist-dialog=${(e) => { e.stopPropagation(); this._playlistPickerVisible = false; this._handleOpenPlaylistDialog(e); }}
                ></spotify-playlist-picker>

                <spotify-playlist-create-sheet
                    .visible=${this._playlistDialogVisible}
                    .api=${this.api}
                    .dialogProps=${this._playlistDialogProps}
                    @close=${() => { this._playlistDialogVisible = false; }}
                    @playlist-created=${this._handlePlaylistCreated}
                ></spotify-playlist-create-sheet>

                <spotify-account-panel
                    .visible=${this._accountSheetVisible}
                    .accounts=${this.config.accounts}
                    .activeEntity=${this.config.entity}
                    .currentImage=${this._currentProfileImg}
                    @close=${() => { this._accountSheetVisible = false; }}
                    @account-selected=${this._handleAccountSelected}
                ></spotify-account-panel>

                <spotify-mini-player
                    .playerController=${this.playerController}
                    .config=${this.config}
                    .active=${this._isOpen && !this._isDesktop}
                    @open-now-playing=${() => { this._nowPlayingVisible = true; }}
                    @open-devices=${() => this._openConnectPanel()}
                ></spotify-mini-player>

                ${!this._isDesktop ? html`
                    <spotify-now-playing-mobile
                        .visible=${this._nowPlayingVisible}
                        .config=${this.config}
                        .api=${this.api}
                        .playerController=${this.playerController}
                        @close=${() => this._nowPlayingVisible = false}
                        @open-devices=${() => this._openConnectPanel()}
                        @open-queue=${() => this._openMobileQueue()}
                    ></spotify-now-playing-mobile>

                    <spotify-connect-panel
                        .visible=${this._connectPanelVisible}
                        .devices=${this._devices}
                        .playerController=${this.playerController}
                        .loading=${this._connectLoading}
                        .volumeStep=${this.config.devices?.volume?.step ?? 2}
                        @close=${() => this._connectPanelVisible = false}
                        @device-selected=${(e) => { this._connectPanelVisible = false; this._transferTo(e.detail); }}
                        @volume-change=${(e) => this.api?.setVolume(e.detail)}
                        @open-manager=${() => { this._connectPanelVisible = false; this._deviceManagerVisible = true; }}
                    ></spotify-connect-panel>

                    <spotify-queue-panel
                        .visible=${this._mobileQueueVisible}
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
            // Parser guarantees storage defaults, so pass the group directly.
            this.storageManager = new StorageManager(this.hass, this.config?.storage);
            this._validateStorage();
        }

        if (!this.pinnedManager && this.config?.home?.pinned?.enabled) {
            try {
                this.pinnedManager = new PinnedItemsManager(this.hass, this.config, this.storageManager);
                if (this.router) this.router.updateDependencies({ pinned: this.pinnedManager });
            } catch (e) {
                console.error("[SpotifyBrowser] Failed to initialize PinnedItemsManager", e);
            }
        }

        if (!this.deviceManager && this.config) {
            try {
                this.deviceManager = new DeviceManager(this.hass, this.config.devices, this.storageManager);
                // _initApi() may already have run (updated() calls it first) —
                // wire the manager into the API from whichever side exists last.
                if (this.api) this.api.setDeviceManager(this.deviceManager);
            } catch (e) {
                console.error("[SpotifyBrowser] Failed to initialize DeviceManager", e);
            }
        }
    }

    _validateStorage() {
        const status = this.storageManager.checkStatus();

        // An 'empty' store needs no proactive write: getData() treats a missing
        // attribute as null and saveData() merges into {} on first real write.
        // Writing an empty {} here on cold boot used to land in the reconnect
        // grace window and surface HA's "connection lost" toast (see api.js).
        if (status === 'corrupted' && !this._storageCorruptPrompted) {
            this._storageCorruptPrompted = true;
            // The alert lives in <spotify-popups>, which only exists while the
            // overlay is open — and this normally runs at boot, with it closed
            // (where _alert() drops what it is given). Park the prompt; the
            // open branch of updated() shows it.
            this._storageCorruptPending = true;
            this._showStorageCorruptPrompt();
        }
    }

    /** Show the parked storage-corruption prompt once the overlay (and its popups) exists. */
    _showStorageCorruptPrompt() {
        if (!this._storageCorruptPending || !this._isOpen) return;
        if (!this._popupsEl()) return; // stays parked until there is somewhere to show it
        this._storageCorruptPending = false;
        // It may have waited a long time for the overlay to open — don't offer
        // a reset for a store that has been repaired (another browser) since.
        if (this.storageManager.checkStatus() !== 'corrupted') return;
        this._alert({
            title: 'Storage Error',
            message: 'Persistent storage data appears to be corrupted. Reset checks and saved items to defaults?',
            confirmText: 'Reset Data',
            cancelText: 'Ignore',
            onConfirm: () => this.storageManager.resetStorage()
        });
    }

    _initApi() {
        if (this.api || !this.hass || !this.config.entity) return;

        this.api = new SpotifyApi(
            this.hass,
            this.config.entity,
            this._handleDeviceResolution.bind(this),
            this.config.devices.volume,
            // Notification Callback
            (msg) => this._toast(msg),
            // Error Callback
            (err) => {
                // Known failures get a specific, actionable message. Only reopen
                // the picker when re-picking could actually help (not for the
                // Cast-token setup problem).
                const info = classifyPlaybackError(err);
                if (info) {
                    this._toast(info.message, info.duration);
                    if (info.reopenPicker) this._openDevicePicker();
                    return;
                }
                const errCode = err.code || '';
                const errMsg = err.message || '';
                if (errCode === 'service_validation_error' || errMsg.includes('Validation error')) {
                    this._toast("Device unavailable. Please select a player.");
                    this._openDevicePicker();
                } else {
                    this._toast(`Error: ${errMsg}`);
                }
            }
        );

        // Sonos integration bridge (no-op unless config.sonos.enabled). Shared by
        // the API (offset_position routing) and the PlayerController (queue routing).
        this.sonosBridge = new SonosBridge(this.hass, this.config.sonos);
        this.sonosBridge.onDegraded = (msg) => this._toast(msg, 6000);
        this.api.setSonosBridge(this.sonosBridge);
        if (this.deviceManager) this.api.setDeviceManager(this.deviceManager);

        // Initialize Player Controller
        this.playerController = new PlayerController(this.api);
        this.playerController.updateConfig(this.config);
        this.playerController.setSonosBridge(this.sonosBridge);
        this._syncNeighborArtSize();
        // Fetch (queue, recents, liked state, art) only while the overlay is
        // open; the open/close branches of updated() flip this afterwards.
        this.playerController.setActive(this._isOpen);

        // Initial Sync. Nothing here mirrors the player state: every surface
        // that shows it subscribes to the controller itself.
        if (this.hass) this.playerController.updateHass(this.hass);
        // A now-playing deep link may be waiting for a controller with a track.
        this._maybeShowPendingNowPlaying();

        this._turnOnOffPlayers();

        this.requestUpdate();
    }

    /**
     * Tell the player controller which art size to warm for the next /
     * previous track: mobile's full-screen carousel (and the mini-player a
     * skip lands in) shows them large; on desktop they only appear as
     * thumbnails (sidebar queue rows and now-playing block).
     */
    _syncNeighborArtSize() {
        this.playerController?.setNeighborArtSize(this._isDesktop ? IMG_THUMB : 0);
    }

    /**
     * Turn on any configured SpotifyPlus players that are off. An off player
     * stops polling Spotify, so the card's data goes stale and playback
     * launches fail. Runs once per page load (called from _initApi, whose
     * body executes only once). Covers every configured account, not just the
     * active one. Skips 'unavailable' entities — turn_on can't help those.
     */
    _turnOnOffPlayers() {
        const entityIds = new Set(
            [this.config.entity, ...this.config.accounts.map(a => a.entity)]
                .filter(Boolean)
        );
        const offIds = [...entityIds].filter(id => this.hass.states[id]?.state === 'off');
        if (!offIds.length) return;

        this.hass.callService('media_player', 'turn_on', { entity_id: offIds })
            .catch(e => console.warn('[SpotifyBrowser] Failed to turn on player(s):', offIds, e));
    }

    /** Attributes of the configured player entity (empty object if unavailable). */
    _playerAttributes() {
        return this.hass?.states[this.config?.entity]?.attributes || {};
    }

    /**
     * Scan for devices and update picker state. Returns the device list.
     * options.refresh: scan now (opening a picker, the Refresh button);
     * without it DeviceManager may answer from its recent list.
     */
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

        if (options.refresh) this._toast("Scanning for devices...");

        try {
            await this._scanDevices(options);
        } catch (e) {
            console.error("[App] Failed to load devices for picker", e);
            this._toast("Failed to scan devices.");
        }
    }

    // --- DEVICE RESOLUTION LOGIC ---
    async _handleDeviceResolution() {
        // 1. Check Device Manager for Default
        if (this.deviceManager) {
            const devices = await this.deviceManager.getDevices();
            const defaultDev = devices.find(d => d.is_default);
            if (defaultDev) {
                debugLog("Using Default Device from Manager:", defaultDev.name);
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
            this._toast("Scanning for devices...");

            // Background sync
            this._scanDevices({ refresh: true }).catch(e => {
                console.error("[App] Device scan failed", e);
            });
        });
    }

    /** A device was picked in the desktop picker. */
    _handleDeviceSelected(e) {
        const device = e.detail;
        this._devicePopupVisible = false;
        this._deviceManagerVisible = false;

        if (this._pendingDeviceResolution) {
            // The api is waiting on this pick (a launch with no device): hand
            // it over instead of transferring.
            const resolve = this._pendingDeviceResolution;
            this._pendingDeviceResolution = null;
            resolve(device);
            this._toast(`Connecting to ${device.name}...`);
            return;
        }
        // This picker has always transferred to whatever was picked, the
        // device shown as active included — kept.
        this._transferTo(device, { evenIfActive: true });
    }

    /**
     * Release a device pick the api is still waiting on (picker dismissed,
     * overlay closed). Resolving with null means "no device, no pending
     * play": the api call neither hangs nor is answered by a later,
     * unrelated selection.
     */
    _releasePendingDevicePick() {
        const resolve = this._pendingDeviceResolution;
        if (!resolve) return;
        this._pendingDeviceResolution = null;
        resolve(null);
    }

    /** Same test the Connect sheet applies before it emits a selection. */
    _isActiveDevice(device) {
        return !!device.isActive || device.name === this.playerController?.state?.activeDevice;
    }

    /**
     * The one transfer flow, for every surface where the user picks a device
     * (desktop picker, mobile Connect sheet, desktop sidebar dropdown):
     * announce it, hold the displayed track while it settles, transfer, and
     * report a failure the api did not already report. api.transferPlayback
     * decides between a plain transfer and replaying a launch that just
     * failed elsewhere. Picking the device that is already active does
     * nothing — unless such a replay is pending, or `evenIfActive` is passed.
     */
    async _transferTo(device, { evenIfActive = false } = {}) {
        if (!device || !this.api) return;
        const replaying = this.api.hasPendingPlay();
        if (!evenIfActive && !replaying && this._isActiveDevice(device)) return;

        this._toast(replaying
            ? `Starting playback on ${device.name}...`
            : `Transferring playback to ${device.name}`);
        this.playerController?.beginTransferHold();
        const res = await this.api.transferPlayback(device);
        if (res && !res.success && !res.reported) this._toast(`Transfer to ${device.name} failed`);
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
            case 'menu-refresh':
                this._refreshCurrentPage();
                break;
        }
    }

    /**
     * "Refresh Data" (header menu): re-read the page on screen, then the
     * player. Pages are duck-typed, each with its own refresh path:
     *  - home: re-fetch each library section. Per section rather than
     *    refreshSections(), whose cooldown (meant for the automatic
     *    reopen/refocus path) would swallow an explicit refresh. Pinned
     *    follows its sensor and needs nothing.
     *  - library, search and context pages (playlist/album/artist/section/...):
     *    refresh().
     */
    _refreshCurrentPage() {
        this._toast("Refreshing...");
        // Taken first: the player's re-read below can then share the recents
        // read home's section refresh starts.
        const since = Date.now();

        // An explicit refresh must not be served from the api's short-lived
        // catalog cache (artist/album/track objects, the shared recents read).
        this.api?.clearReadCache();

        const pageId = this.router?.currentPageId;
        const page = this.router?.pageCache.get(pageId);
        if (pageId === 'home') {
            if (page?.fetchSectionData) {
                for (const key of this.config.home?.sort || []) {
                    if (key !== 'pinned') page.fetchSectionData(key, { replace: true });
                }
            }
        } else if (page?.refresh) {
            // refresh() rebuilds the page from scratch — never under an open
            // playlist edit session, which would silently drop unsaved changes.
            // Library: `true` also re-reads the albums/artists buckets.
            if (!this.router.isEditing(pageId)) page.refresh(pageId === 'library' ? true : undefined);
        }

        // Now-playing, queue and recents.
        this._refreshAfterReturn(since);
    }

    /** Switch the active Spotify account/entity and rebuild the API stack. */
    switchAccount(entity) {
        if (!entity || entity === this.config.entity) return;
        this.config = { ...this.config, entity };
        // Per-account pins (scope: account) and per-account config pins follow
        // the active entity. Must precede the home rebuild below.
        if (this.pinnedManager) {
            this.pinnedManager.updateConfig(this.config);
            this.pinnedManager.setAccount(entity);
        }
        if (this.api) this.api.destroy();
        this.api = null;
        // Device ids aren't meaningful across accounts — drop cached capabilities.
        if (this.deviceManager) this.deviceManager.clearVolumeCapabilities();
        if (this.playerController) this.playerController.destroy();
        this.playerController = null;
        this._initApi();

        // Every cached page holds the previous account's data — rebuild from a
        // fresh home so the whole screen reflects the new account.
        if (this.router) {
            this.router.updateDependencies({ api: this.api, config: this.config });
            this.router.clearCache();
            this.router.navigateTo('home');
        }
        // The context-view state cache is keyed by pageId only (account-blind);
        // stale entries would resurface the previous account's playlists.
        SpotifyContextView.clearAll();
        // Refresh the app-level pin snapshot (reorder dialog) for the new account.
        this._handlePinnedChanged();
    }

    _handleAccountSelected(e) {
        this.switchAccount(e.detail.entity);
        this._accountSheetVisible = false;
    }

    /** Avatar for the active account: configured image first, else the live profile pic. */
    _resolveAvatar() {
        const accounts = this.config?.accounts || [];
        const acc = accounts.find(a => a.entity === this.config?.entity);
        return acc?.image || this._currentProfileImg || '';
    }

    _handleAvatarClick() {
        if (this.config.accounts.length > 1) {
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
            const url = pickImage(profile?.images, IMG_THUMB); // 32px header / 48px account-sheet avatar
            if (url && this.config?.entity === entity) this._currentProfileImg = url;
        } catch (_) { /* default icon */ }
    }

    _handleMenuAction(e) {
        const action = e.detail;
        const track = this._menuTrack;
        const context = this._menuContext;
        const onAction = this._menuOnAction;
        this._ctxMenuVisible = false;

        // Menus opened by a view (playlist header ...) route back to their owner.
        if (onAction) {
            onAction(action);
            return;
        }

        switch (action) {
            case 'tm-queue':
                this.api.addToQueue(track.uri);
                break;
            case 'tm-artist':
                // Navigation target renders in the page behind the player
                // overlays — drop them so the artist page is actually visible.
                this._nowPlayingVisible = false;
                this._mobileQueueVisible = false;
                this._navigateToTrackArtist(track);
                break;
            case 'tm-add-playlist':
                this._playlistPickerTrack = track;
                this._playlistPickerVisible = true;
                break;
            case 'tm-remove-from-playlist':
                this._removeTrackFromPlaylist(track, context);
                break;
            case 'tm-goto-queue':
                if (this._isDesktop) this._queueVisible = true;
                else this._openMobileQueue();
                break;
            case 'tm-goto-context': {
                // sourceUri: spotify:playlist:<id> or spotify:album:<id>
                const parts = (context?.sourceUri || '').split(':');
                const kind = parts[parts.length - 2], id = parts[parts.length - 1];
                if ((kind === 'playlist' || kind === 'album') && id) {
                    this._nowPlayingVisible = false;
                    this._mobileQueueVisible = false;
                    this.router.navigateTo(`${kind}:${id}`);
                }
                break;
            }
        }
    }

    /**
     * Quick "Remove from this Playlist" from a track's row menu. Spotify's
     * remove-by-URI drops EVERY copy of a duplicated track, so when the row's
     * context reports more than one occurrence we confirm first.
     */
    async _removeTrackFromPlaylist(track, context) {
        const playlistId = context?.playlistId;
        if (!playlistId || !track?.uri || !this.api) return;

        const doRemove = async () => {
            const res = await this.api.removePlaylistItems(playlistId, [track.uri], context?.snapshotId);
            if (res.success) {
                this._toast(`Removed "${track.name}" from playlist`);
                this._handlePlaylistChanged({ detail: { playlistId, action: 'items' } });
            } else {
                this._toast("Couldn't remove track from playlist");
            }
        };

        if ((context.uriCount || 1) > 1) {
            this._alert({
                title: 'Remove all copies?',
                message: `"${track.name}" appears ${context.uriCount} times in this playlist. Spotify removes every copy at once.`,
                onConfirm: doRemove,
                confirmText: 'Remove All'
            });
            return;
        }
        doRemove();
    }

    /**
     * A playlist was mutated somewhere in the app. Bust the context-view cache
     * for that page, resync whatever is showing it, and update the library
     * list, which shows playlist names/artwork/counts. A follow or unfollow
     * (the playlist page's heart or menu, a library row) changes only what
     * the library lists: the playlist's page already shows its follow state.
     */
    async _handlePlaylistChanged(e) {
        const { playlistId, action, patch } = e.detail || {};
        if (!playlistId) return;
        const lib = this.router?.pageCache.get('library');
        if (action === 'follow' || action === 'unfollow') {
            lib?.playlistChanged?.(e.detail);
            return;
        }
        const pageId = `playlist:${playlistId}`;
        SpotifyContextView.invalidate(pageId);

        if (action === 'delete') {
            if (this.router?.currentPageId === pageId) {
                if (this.router.history.length > 0) this.router.goBack();
                else this.router.resetToHome();
            }
            this.router?.dropPage(pageId);
            // A deleted playlist must not linger as a home shortcut.
            try {
                await this.pinnedManager?.remove(playlistId);
                this._handlePinnedChanged();
            } catch (_) { /* not pinned */ }
        } else {
            // Both edit (name/description) and edit-mode saves can carry an
            // exact patch — apply it in place; anything else refetches.
            const view = this.router?.pageCache.get(pageId);
            if (view?.refresh) view.refresh(patch || null);
        }

        lib?.playlistChanged?.(e.detail);
        if (action === 'create' || action === 'delete') this._refreshHomePinned();
    }

    /** Open the create/edit playlist dialog. detail: {mode, playlist?, pendingTrackUri?} */
    _handleOpenPlaylistDialog(e) {
        this._playlistDialogProps = e.detail || { mode: 'create' };
        this._playlistDialogVisible = true;
    }

    /** A playlist was created via the details dialog: refresh lists + open it. */
    _handlePlaylistCreated(e) {
        const playlist = e.detail?.playlist;
        this._playlistDialogVisible = false;
        if (playlist?.id) {
            this._handlePlaylistChanged({ detail: { playlistId: playlist.id, action: 'create' } });
            this.router?.navigateTo(`playlist:${playlist.id}`, { title: playlist.name });
        }
    }

    /**
     * "Go to Artist" from the track menu. Menu payloads usually carry artist
     * names only (no ids), so resolve the primary name to a Spotify artist
     * via search; fall back to the search page if nothing matches.
     */
    async _navigateToTrackArtist(track) {
        const name = track?.artists?.[0]?.name || track?.artist?.split(',')[0]?.trim();
        if (!name) {
            this._toast("Artist not found");
            return;
        }
        try {
            const res = await this.api.fetchSpotifyPlus('search_artists', {
                criteria: name,
                limit: 1
            });
            const artist = res?.result?.items?.[0];
            if (artist?.id) {
                this.router.navigateTo(`artist:${artist.id}`, { title: artist.name });
                return;
            }
        } catch (_) { /* fall through to search */ }
        this.router.navigateTo('search', { query: name });
    }

    _handleOpenTrackMenu(e) {
        const detail = e.detail || {};
        fireHaptic('light');
        this._menuTrack = detail;
        this._menuContext = detail.context || null;
        this._menuOnAction = null;
        this._ctxMenuHeader = {
            image: detail.image,
            name: detail.name,
            subtitle: [detail.artist, detail.album].filter(Boolean).join(' • ')
        };
        this._ctxMenuItems = this._composeTrackMenuItems(detail.context);
        this._ctxMenuAnchor = detail.anchor || null;
        this._ctxMenuVisible = true;
    }

    /** Track-menu items, shaped by where the row lives (detail.context). */
    _composeTrackMenuItems(context) {
        const items = [
            { id: 'tm-queue', label: 'Add to Queue', icon: 'queue' },
            { id: 'tm-add-playlist', label: 'Add to Playlist', icon: 'playlist-add' },
            { id: 'tm-artist', label: 'Go to Artist', icon: 'artist' },
        ];
        if (context?.surface === 'playlist' && context.canEditItems) {
            items.push({ id: 'tm-remove-from-playlist', label: 'Remove from this Playlist', icon: 'minus-circle', danger: true });
        }
        // Playing-surface extras: jump to the queue / the source context.
        if (context?.surface === 'nowplaying') {
            items.push({ id: 'tm-goto-queue', label: 'Go to Queue', icon: 'queue-list' });
        }
        if (context?.surface === 'nowplaying' || context?.surface === 'queue') {
            const src = context.sourceUri || '';
            if (src.includes(':playlist:')) items.push({ id: 'tm-goto-context', label: 'Go to Playlist', icon: 'playlist' });
            else if (src.includes(':album:')) items.push({ id: 'tm-goto-context', label: 'Go to Album', icon: 'album' });
        }
        return items;
    }

    /**
     * Action menu owned by a view (playlist header, library rows ...). The
     * opener supplies the header, the items and an onAction callback that
     * receives the chosen item id — the app root only hosts the overlay.
     * detail: { header: {image, name, subtitle}, items: [...], onAction(id), anchor? }
     */
    _handleOpenContextMenu(e) {
        const { header, items, onAction, anchor } = e.detail || {};
        if (!header || !items || !items.length) return;
        fireHaptic('light');
        this._menuTrack = null;
        this._menuContext = null;
        this._menuOnAction = onAction || null;
        this._ctxMenuHeader = { image: header.image, name: header.name, subtitle: header.subtitle || header.artist, icon: header.icon };
        this._ctxMenuItems = items;
        this._ctxMenuAnchor = anchor || null;
        this._ctxMenuVisible = true;
    }

    /**
     * Playlist edit sessions vs the app header. While a playlist is in edit
     * mode its editor draws the page's top bar, so the app header is not
     * rendered for that page (see render()). The view announces every start
     * and end of a session, the router records which page it belongs to
     * (router.isEditing), and this derives "is the page ON SCREEN being
     * edited" on every session change and every route change. Derived, not
     * toggled, so no exit path can leave the header missing:
     *  - save / cancel / failed save / a reset by the view: the view reports it;
     *  - navigating away or Back: the route change re-derives (the session
     *    stays open on the cached page, unsaved edits intact, and the header
     *    steps aside again on return);
     *  - closing the overlay: every open re-establishes the route.
     */
    _syncEditSessionOnScreen() {
        const editing = !!this.router?.isEditing();
        // Entering: the header (and its dropdown) is about to go away.
        if (editing && !this._editSessionOnScreen) this._menuVisible = false;
        this._editSessionOnScreen = editing;
    }

    /* --- Toasts and alerts: the one channel ---
     * The bubbling `show-toast` / `show-alert` events from views, the api and
     * Sonos-bridge callbacks and the root's own messages all go through
     * _toast() / _alert(). Both render in <spotify-popups>, which exists only
     * while the overlay is open: raised while closed they are dropped (and
     * return false). The one message that must survive that, the
     * storage-corruption prompt, parks itself (_showStorageCorruptPrompt).
     */

    _popupsEl() {
        return this.shadowRoot?.getElementById('popups') || null;
    }

    /** Show a toast (default 3 s). Returns whether there was anywhere to show it. */
    _toast(message, duration) {
        const popups = this._popupsEl();
        if (!popups) return false;
        popups.showToast(message, duration);
        return true;
    }

    /**
     * Show the alert / confirm dialog. options: { title, message, onConfirm,
     * confirmText = 'OK', cancelText = 'Cancel' (null: no cancel button),
     * size = 'medium' }. Returns whether there was anywhere to show it.
     */
    _alert({ title, message, onConfirm, confirmText, cancelText, size } = {}) {
        const popups = this._popupsEl();
        if (!popups) return false;
        popups.showAlert(title, message, onConfirm, confirmText, cancelText, size);
        return true;
    }

    _handleShowToast(e) {
        this._toast(e.detail.message, e.detail.duration);
    }

    _handleShowAlert(e) {
        this._alert(e.detail);
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
        // With pinned disabled home has no manager, and fetching the section
        // would throw mid-way and leave it marked as fetching.
        if (home?.fetchSectionData && home.pinned) home.fetchSectionData('pinned');
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

        this._toast("Fetching item details...");

        const result = await this.pinnedManager.addByUri(this.api, uri);

        if (result.success) {
            this._toast("Item pinned successfully");
            // A full list made room by dropping its oldest pin: say which.
            const evicted = evictedPinMessage(result);
            if (evicted) this._toast(evicted);
            // Refresh items for the dialog
            this.pinnedManager.getItems().then(items => {
                this._pinnedItems = items;
            });
            this._refreshHomePinned();
        } else {
            console.error("Failed to add custom URI:", result.error);
            this._alert({
                title: "Failed to add item",
                message: result.error || "Unknown error (Check logs)",
                cancelText: null, // OK only
            });
        }
    }

    async _handleResetPinnedItems() {
        if (!this.pinnedManager) return;

        this._toast("Resetting pinned items...");

        const result = await this.pinnedManager.reset();

        if (result.success) {
            this._toast("Pinned items reset to default.");
            // Refresh
            this.pinnedManager.getItems().then(items => {
                this._pinnedItems = items;
            });
            this._refreshHomePinned();
        } else {
            console.error("Reset failed", result.error);
            this._toast("Reset failed: " + result.error);
        }
    }

    async _handleRefreshDevices() {
        this._openDevicePicker({ refresh: true });
    }

    async _handleToggleHiddenDevices(e) {
        // e.detail.visible is the new state
        this._openDevicePicker({ showHidden: e.detail.visible });
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
                    this._toast("Failed to remove item: " + (res.error || 'Unknown'));
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

    /**
     * Dismiss every popup/sheet/overlay surface. Called from the CLOSING branch
     * of updated() so ANY close path (close button, drag-dismiss, backdrop tap,
     * background auto-close, idle auto-close) reopens with a clean slate.
     * home_on_exit governs only the router page, never these surfaces.
     */
    _closeAllPopups() {
        this._searchVisible = false;
        this._menuVisible = false;
        this._devicePopupVisible = false;
        this._ctxMenuVisible = false;
        this._ctxMenuHeader = null;
        this._ctxMenuItems = null;
        this._ctxMenuAnchor = null;
        this._menuTrack = null;
        this._menuContext = null;
        this._menuOnAction = null;
        this._playlistPickerVisible = false;
        this._playlistPickerTrack = null;
        this._playlistDialogVisible = false;
        this._playlistDialogProps = null;
        this._accountSheetVisible = false;
        this._reorderVisible = false;
        this._deviceManagerVisible = false;
        this._nowPlayingVisible = false;
        this._connectPanelVisible = false;
        this._connectLoading = false;
        this._mobileQueueVisible = false;
        this._pendingNowPlaying = false;
        clearTimeout(this._pendingNowPlayingTimer);
        // Desktop queue sidebar is layout state, not a modal: restore it to its
        // configured initial state (the _queueInitDone once-guard would let a
        // plain `false` permanently defeat open_init after the first close).
        this._queueVisible = !!(this._isDesktop && this.config?.queue?.open_on_desktop);
        // A device-picker promise may be awaiting a selection — release it so
        // the api call it gates doesn't hang across the close.
        this._releasePendingDevicePick();
    }

    /* Slide the panel down then close (mobile iOS-panel dismiss). */
    _animateClose() {
        if (this._isDesktop) { this._isOpen = false; return; }
        const w = this.shadowRoot.querySelector('.browser-wrapper');
        const backdrop = this.shadowRoot.querySelector('.backdrop');
        if (!w) { this._isOpen = false; return; }
        slideOut(w, backdrop, {
            transition: 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
            settleMs: 420,
            onSettled: () => { this._isOpen = false; },
        });
    }

    /** Close the mobile sheet when the tab/app goes to background. */
    _handleAppBackgrounded() {
        if (this._isDesktop || !this._isOpen) return;
        // Direct close, NOT _animateClose(): transitions/timers are throttled
        // while hidden, and the user shouldn't see a re-animated dismiss on
        // return anyway. updated()'s close branch dismisses all popups/sheets
        // (via _closeAllPopups) and stamps _lastCloseTime, so home_on_exit.timeout
        // applies as if the user closed it manually.
        this._isOpen = false;
    }

    /** Start the idle auto-close watchdog (each tick no-ops when disabled). */
    _startIdleWatch() {
        this._stopIdleWatch();
        // Wall-clock comparison inside a short tick, NOT one long setTimeout:
        // the iOS webview freezes timers while backgrounded and desktop
        // browsers throttle hidden tabs; _handleAppForegrounded catches any
        // overshoot on resume.
        this._idleCheckTimer = setInterval(() => this._checkIdleClose(), 5000);
    }

    _stopIdleWatch() {
        if (this._idleCheckTimer) {
            clearInterval(this._idleCheckTimer);
            this._idleCheckTimer = null;
        }
    }

    /**
     * Close the overlay if the user has been idle past auto_close.timeout.
     * Returns true if it closed. Reuses the normal close paths so
     * _lastCloseTime is stamped and home_on_exit applies as if the user
     * closed it manually.
     */
    _checkIdleClose() {
        const ac = this.config?.browser?.auto_close;
        if (!this._isOpen || !ac?.enabled || !(ac.timeout > 0)) return false;
        if ((Date.now() - this._lastActivityTime) / 1000 < ac.timeout) return false;
        if (document.hidden) {
            this._isOpen = false;   // hidden: skip animation (timers throttled)
        } else {
            this._animateClose();   // visible: animated mobile dismiss / direct desktop close
        }
        return true;
    }

    /** Rescan when the tab/window regains attention while open. */
    _handleAppForegrounded() {
        if (!this._isOpen) return; // the reopen hook covers the closed case
        // Desktop keeps the overlay open while hidden and the watchdog gets
        // throttled there — apply an overdue idle close first, and skip the
        // refresh when it fires.
        if (this._checkIdleClose()) return;
        // Deferred a macrotask so api.js's own visibilitychange handler — which
        // refreshes the reconnect grace window (_resumedAt) — has run first,
        // regardless of listener registration order.
        setTimeout(() => this._refreshAfterReturn(), 0);
    }

    /**
     * Bring now-playing, queue, recents and home up to date (reopen, refocus,
     * Refresh Data). The queue and recents are re-read as of now: a read of
     * them that started from this moment on is as good as a new one, so
     * `since` lets these refreshes take the one home's "Recently Played" row
     * (first open) or the desktop sidebar (shown on open) already made, and
     * home take the player's.
     * @param {number} [since]  when the refresh was asked for (default: now)
     */
    async _refreshAfterReturn(since = Date.now()) {
        if (!this.api) return;
        await this.api.scanWhenReady();
        // Explicit re-reads: queue/recents live outside hass.states, and the
        // scan only auto-refreshes them when the track actually changed.
        this.playerController?.refreshQueue({ since });
        this.playerController?.refreshRecent({ since });
        // Home is cached across opens; refresh its library sections (throttled).
        this.router?.pageCache.get('home')?.refreshSections?.({ since });
    }
}

customElements.define('spotify-browser-app', SpotifyBrowserApp);
