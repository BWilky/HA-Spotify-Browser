import { ConfigParser } from './config_parser.js';
import './spotify-browser-app.js?v=2.2.68';



const INFO_BADGE = `
  color: white; 
  background: #3652aeff; 
  font-weight: bold; 
  padding: 2px 6px; 
  border-radius: 4px;
`;

// console.info("%c SPOTIFY-BROWSER %c v2.2.18 Loaded ", INFO_BADGE, "color: #1DB954; font-weight: bold;");

class SpotifyExtension {
    constructor() {
        this.app = null; // Renamed from ui to app
        this.config = null; // Store config globally for hash checking
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
            // console.log("[SpotifyBrowser] Ready (v2.2.22 - DEBUG VIEW).");

            // --- 5. INITIAL HASH CHECK (The Fix) ---
            // Check immediately in case the page loaded with the hash
            this._checkHash();

        } catch (e) {
            console.error("[SpotifyBrowser] Init Failed:", e);
            return;
        }

        // 6. Start State Loop
        this._startHassLoop();

        // 7. Event Listeners
        window.addEventListener('spotify-browser-open', () => this._open());

        // Listen for URL Hash changes (Browser Back/Forward or Manual URL entry)
        window.addEventListener('hashchange', this._boundCheckHash);

        // Listen for HA internal navigation (which sometimes modifies URL)
        window.addEventListener('location-changed', this._boundCheckHash);
    }

    _checkHash() {
        if (!this.initialized || !this.config) return;

        const hash = window.location.hash;
        if (!hash) return;

        // 1. Check Generic Trigger (Uses the default or custom string from config)
        // We look for inclusion, e.g. '#spotify-browser' or '#my-custom-hash'
        const isGeneric = hash.includes(this.config.custom_hash);

        // 2. Check Account Specific Triggers
        const accounts = this.config.spotify_accounts || [];
        const matchedAccount = accounts.find(acc => acc.hash === hash);

        if (isGeneric || matchedAccount) {
            // A. Clear Hash
            history.replaceState(null, null, window.location.pathname + window.location.search);

            // B. Switch Account if specific hash matched
            // If it was just the generic hash, we stay on the current/default account
            if (matchedAccount && this.app) {
                if (matchedAccount.entity !== this.app.config.entity) {
                    // Implement _switchAccount in your Lit component or update config
                    // this.app.config = { ...this.app.config, entity: matchedAccount.entity };
                }
            } else if (isGeneric && this.app) {
                // Optional: Ensure we are on the default entity if opening via generic hash?
                // Currently, we just leave it as-is (last used or default). 
                // If you want to force default account on generic open, uncomment below:
            }

            // C. Open
            this._open();
        }
    }

    _open() {
        if (!this.initialized || !this.app) return;
        // Trigger the Lit component's open state
        this.app.open();
    }

    async _findLovelaceConfig() {
        // Find the spotify_browser configuration in the lovelace configuration.
        // It can be at the root of the lovelace config, or within a card.
        const lovelace = document.querySelector("home-assistant")
            ?.shadowRoot.querySelector("home-assistant-main")
            ?.shadowRoot.querySelector("ha-panel-lovelace")?.lovelace;

        if (!lovelace) {
            await new Promise(r => setTimeout(r, 200));
            return this._findLovelaceConfig();
        }

        // 1. Check root config for spotify_browser
        if (lovelace.config.spotify_browser) {
            return lovelace.config.spotify_browser;
        }

        // 2. Check views for a custom:spotify-browser-card
        if (lovelace.config.views) {
            for (const view of lovelace.config.views) {
                if (view.cards) {
                    for (const card of view.cards) {
                        if (card.type === 'custom:spotify-browser-card') {
                            return card;
                        }
                        if (card.cards) {
                            for (const subCard of card.cards) {
                                if (subCard.type === 'custom:spotify-browser-card') {
                                    return subCard;
                                }
                            }
                        }
                    }
                }
            }
        }

        return null;
    }

    _startHassLoop() {
        // (Same as before)
        setInterval(() => {
            const ha = document.querySelector("home-assistant");
            if (ha && ha.hass) {
                if (ha.hass !== this.hass) {
                    this.hass = ha.hass;
                    if (this.app) this.app.hass = this.hass;
                }
            }
        }, 200);
    }
}

new SpotifyExtension();