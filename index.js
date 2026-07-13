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
            background: #1DB954; color: #000; font-weight: 700; font-size: var(--spf-text-base, 13.5px);
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
        const isGeneric = baseHash.includes(this.config.browser.hash);

        // Account-specific triggers
        const accounts = this.config.accounts;
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

    async _findLovelaceConfig() {
        // Wait until the lovelace panel is available
        let lovelace = null;
        while (!lovelace) {
            lovelace = document.querySelector("home-assistant")
                ?.shadowRoot.querySelector("home-assistant-main")
                ?.shadowRoot.querySelector("ha-panel-lovelace")?.lovelace;
            if (!lovelace) await new Promise(r => setTimeout(r, 200));
        }

        // 1. Check root config for spotify_browser
        if (lovelace.config.spotify_browser) {
            return lovelace.config.spotify_browser;
        }

        // 2. Check views for a custom:spotify-browser-card (top level or one level nested)
        for (const view of lovelace.config.views || []) {
            for (const card of view.cards || []) {
                if (card.type === 'custom:spotify-browser-card') return card;
                for (const subCard of card.cards || []) {
                    if (subCard.type === 'custom:spotify-browser-card') return subCard;
                }
            }
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
