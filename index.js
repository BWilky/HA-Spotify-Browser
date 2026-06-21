import { ConfigParser } from './config_parser.js';
import './spotify-browser-app.js';

/**
 * Placeholder card so dashboards using `type: custom:spotify-browser-card`
 * render a launch button instead of a "card not found" error. The card's
 * YAML body doubles as the browser configuration (read by SpotifyExtension).
 */
class SpotifyBrowserCard extends HTMLElement {
    setConfig(config) { this._config = config; }
    getCardSize() { return 1; }

    connectedCallback() {
        if (this._rendered) return;
        this._rendered = true;
        const btn = document.createElement('button');
        btn.textContent = 'Open Spotify Browser';
        btn.style.cssText = `
            width: 100%; padding: 12px; border: none; border-radius: 12px;
            background: #1DB954; color: #000; font-weight: 700; font-size: 14px;
            cursor: pointer;
        `;
        btn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('spotify-browser-open')));
        this.appendChild(btn);
    }
}
if (!customElements.get('spotify-browser-card')) {
    customElements.define('spotify-browser-card', SpotifyBrowserCard);
}

class SpotifyExtension {
    constructor() {
        this.app = null;
        this.config = null;
        this.initialized = false;
        this.hass = null;

        // Bind methods to ensure 'this' context is preserved in event listeners
        this._boundCheckHash = this._checkHash.bind(this);

        this.init();
    }

    async init() {
        // 1. Wait for Home Assistant
        while (!document.querySelector("home-assistant")?.hass) {
            await new Promise(r => setTimeout(r, 500));
        }

        const mainEl = document.querySelector("home-assistant");
        this.hass = mainEl.hass;

        // 2. Find Config
        const configRaw = await this._findLovelaceConfig();
        if (!configRaw) {
            console.warn("[SpotifyBrowser] No 'spotify_browser:' config found in dashboard YAML.");
            return;
        }

        // 3. Initialize Component
        try {
            this.config = ConfigParser.parse(configRaw);

            // Create and mount the Lit app
            this.app = document.createElement('spotify-browser-app');
            this.app.config = this.config;
            this.app.hass = this.hass;
            document.body.appendChild(this.app);

            this.initialized = true;

            // Initial hash check in case the page loaded with the hash already set
            this._checkHash();

        } catch (e) {
            console.error("[SpotifyBrowser] Init Failed:", e);
            return;
        }

        // 4. Start State Loop
        this._startHassLoop();

        // 5. Event Listeners
        window.addEventListener('spotify-browser-open', () => this._open());
        // Deep-link straight to the mobile Now Playing surface (over home).
        window.addEventListener('spotify-browser-open-now-playing', () => this._open(true));

        // Listen for URL Hash changes (Browser Back/Forward or Manual URL entry)
        window.addEventListener('hashchange', this._boundCheckHash);

        // Listen for HA internal navigation (which sometimes modifies URL)
        window.addEventListener('location-changed', this._boundCheckHash);
    }

    _checkHash() {
        if (!this.initialized || !this.config) return;

        const hash = window.location.hash;
        if (!hash) return;

        // A `-now-playing` suffix on any trigger hash (e.g.
        // `#spotify-browser-now-playing`) opens straight to the mobile Now
        // Playing view; the base hash is matched as usual.
        const NP_SUFFIX = '-now-playing';
        const nowPlaying = hash.endsWith(NP_SUFFIX);
        const baseHash = nowPlaying ? hash.slice(0, -NP_SUFFIX.length) : hash;

        // Generic trigger (default or custom string from config)
        const isGeneric = baseHash.includes(this.config.custom_hash);

        // Account-specific triggers
        const accounts = this.config.spotify_accounts || [];
        const matchedAccount = accounts.find(acc => acc.hash === baseHash);

        if (isGeneric || matchedAccount) {
            // Clear the hash so refresh/back doesn't re-trigger
            history.replaceState(null, null, window.location.pathname + window.location.search);

            // Switch account if a specific hash matched
            if (matchedAccount && this.app && matchedAccount.entity !== this.app.config.entity) {
                this.app.switchAccount(matchedAccount.entity);
            }

            this._open(nowPlaying);
        }
    }

    _open(nowPlaying = false) {
        if (!this.initialized || !this.app) return;
        this.app.open(nowPlaying ? { nowPlaying: true } : undefined);
    }

    /**
     * Asynchronously polls the DOM to retrieve the Home Assistant Lovelace instance.
     * @returns {Promise<Object|null>} The Lovelace instance or null if not found within the timeout.
     */
    async _getLovelaceInstance() {
        let attempts = 0;
        const maxAttempts = 25; // 5 seconds limit (25 attempts * 200ms)

        while (attempts < maxAttempts) {
            const haMain = document.querySelector("home-assistant")
                ?.shadowRoot?.querySelector("home-assistant-main")
                ?.shadowRoot;

            const lovelacePanel = haMain?.querySelector("ha-panel-lovelace")
            
            if (lovelacePanel?.lovelace) {
                return lovelacePanel.lovelace;
            }

            attempts++;
            await new Promise(r => setTimeout(r, 200));
        }

        console.error("[SpotifyBrowser]: Failed to find the lovelace object in the DOM tree after 5 seconds.");
        return null;
    }

    /**
     * Recursively searches a list of dashboard items (cards, sections, stacks) for the target card type.
     * @param {Array} items - Array of dashboard configuration objects.
     * @returns {Object|null} The configuration of the target card if found, otherwise null.
     */
    _searchConfigTree(items) {
        if (!items || !Array.isArray(items)) return null;
        
        for (const item of items) {
            // Target found
            if (item.type === 'custom:spotify-browser-card') return item;
            
            // Traverse through Home Assistant's new Sections layout
            if (item.sections) {
                const found = this._searchConfigTree(item.sections);
                if (found) return found;
            }

            // Traverse deep into standard stacks and grids (vertical-stack, horizontal-stack, grid)
            if (item.cards) {
                const found = this._searchConfigTree(item.cards);
                if (found) return found;
            }
            
            // Edge case handling: some custom wrapper cards nested inside a single 'card' attribute
            if (item.card) {
                const found = this._searchConfigTree([item.card]);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * Main entry point to find and return the Spotify Browser card configuration.
     * @returns {Promise<Object|null>} The target card or root config object, otherwise null.
     */
    async _findLovelaceConfig() {
        const lovelace = await this._getLovelaceInstance();
        if (!lovelace) return null;

        // 1. Check root configuration fallback
        if (lovelace.config?.spotify_browser) {
            return lovelace.config.spotify_browser;
        }

        // 2. Scan views utilizing the recursive search helper
        for (const view of lovelace.config?.views || []) {
            const foundCard = this._searchConfigTree(view.cards) || this._searchConfigTree(view.sections);
            if (foundCard) return foundCard;
        }

        return null;
    }
    _startHassLoop() {
        setInterval(() => {
            const ha = document.querySelector("home-assistant");
            if (ha && ha.hass && ha.hass !== this.hass) {
                this.hass = ha.hass;
                if (this.app) this.app.hass = this.hass;
            }
        }, 200);
    }
}

new SpotifyExtension();
