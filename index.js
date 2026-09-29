import { ConfigParser } from './config_parser.js';
import './spotify-browser-app.js';

/**
 * Placeholder card so dashboards using `type: custom:spotify-browser-card`
 * render a launch tile instead of a "card not found" error. The card's YAML
 * body doubles as the browser configuration (read by SpotifyExtension).
 *
 * It renders a themed tile (icon badge + title + label) modelled on HA's own
 * tile card: it uses `ha-card`/`ha-icon` and HA theme CSS variables so it
 * inherits the active Lovelace theme, and it implements `getGridOptions()` so
 * it resizes in sections view. Tapping it dispatches `spotify-browser-open`,
 * which the SpotifyExtension controller below turns into an overlay open.
 *
 * Appearance is configured under a `card:` block:
 *   card:
 *     title: Spotify Browser   # default
 *     label: launch            # default
 *     icon: mdi:spotify        # default
 *     color: green             # icon color: theme token or hex (default #1DB954)
 */
const CARD_DEFAULTS = { title: 'Spotify Browser', label: 'launch', icon: 'mdi:spotify', color: '#1DB954' };

// Resolve a user color value: literal CSS colors pass through, bare names map to
// HA theme color tokens (e.g. `green` -> var(--green-color, green)).
function resolveCardColor(color) {
    const c = String(color || '').trim();
    if (!c) return CARD_DEFAULTS.color;
    if (/^(#|rgb|hsl|var\()/i.test(c)) return c;
    return `var(--${c}-color, ${c})`;
}

class SpotifyBrowserCard extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    setConfig(config) {
        this._config = config || {};
        const card = (this._config.card && typeof this._config.card === 'object') ? this._config.card : {};
        this._card = {
            title: card.title != null ? String(card.title) : CARD_DEFAULTS.title,
            label: card.label != null ? String(card.label) : CARD_DEFAULTS.label,
            icon: card.icon || CARD_DEFAULTS.icon,
            color: resolveCardColor(card.color),
        };
        if (this.isConnected) this._render();
    }

    getCardSize() { return 1; }

    getGridOptions() { return { rows: 1, columns: 6, min_rows: 1, min_columns: 3 }; }

    connectedCallback() { this._render(); }

    _render() {
        const { title, label, icon, color } = this._card || CARD_DEFAULTS;
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; height: 100%; }
                ha-card {
                    height: 100%;
                    --tile-color: ${color};
                }
                .tile {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    height: 100%;
                    box-sizing: border-box;
                    padding: 10px;
                    cursor: pointer;
                    border-radius: var(--ha-card-border-radius, 12px);
                    outline: none;
                    -webkit-tap-highlight-color: transparent;
                }
                .tile:hover,
                .tile:focus-visible {
                    background: color-mix(in srgb, var(--primary-text-color, #212121) 6%, transparent);
                }
                .tile:active {
                    background: color-mix(in srgb, var(--primary-text-color, #212121) 12%, transparent);
                }
                .badge {
                    flex: 0 0 auto;
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--tile-color);
                    background: color-mix(in srgb, var(--tile-color) 20%, transparent);
                }
                .badge ha-icon {
                    --mdc-icon-size: 24px;
                    width: 24px;
                    height: 24px;
                }
                .text {
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                }
                .primary,
                .secondary {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .primary {
                    color: var(--primary-text-color, #212121);
                    font-size: 14px;
                    font-weight: 500;
                    line-height: 20px;
                }
                .secondary {
                    color: var(--secondary-text-color, #727272);
                    font-size: 12px;
                    font-weight: 400;
                    line-height: 16px;
                }
            </style>
            <ha-card>
                <div class="tile" role="button" tabindex="0">
                    <div class="badge"><ha-icon></ha-icon></div>
                    <div class="text">
                        <span class="primary"></span>
                        <span class="secondary"></span>
                    </div>
                </div>
            </ha-card>
        `;

        this.shadowRoot.querySelector('ha-icon').setAttribute('icon', icon);
        this.shadowRoot.querySelector('.primary').textContent = title;
        this.shadowRoot.querySelector('.secondary').textContent = label;

        const tile = this.shadowRoot.querySelector('.tile');
        const open = () => window.dispatchEvent(new CustomEvent('spotify-browser-open'));
        tile.addEventListener('click', open);
        tile.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
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

        // 2. Search the layout for a custom:spotify-browser-card. Walk views ->
        // sections -> cards recursively so it's found in sections, masonry and
        // grid views, and inside nested container cards (stack/grid/conditional).
        return this._findCard(lovelace.config.views) || null;
    }

    _findCard(node) {
        if (Array.isArray(node)) {
            for (const item of node) {
                const found = this._findCard(item);
                if (found) return found;
            }
            return null;
        }
        if (node && typeof node === 'object') {
            if (node.type === 'custom:spotify-browser-card') return node;
            for (const key of ['views', 'sections', 'cards', 'card']) {
                if (node[key]) {
                    const found = this._findCard(node[key]);
                    if (found) return found;
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
