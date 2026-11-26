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
 *
 * The card also feeds the extension (both only while it is on the page):
 *   - hass: Lovelace sets `hass` on every card each time Home Assistant's
 *     state changes (the custom-card contract), and the card passes it on, so
 *     the app needs no polling while a card is shown.
 *   - config: a card that turns up after the extension found no config (the
 *     dashboard first loaded had none) asks it to look again; see
 *     SpotifyExtension.cardConfigured.
 */
const CARD_DEFAULTS = { title: 'Spotify Browser', label: 'launch', icon: 'mdi:spotify', color: '#1DB954' };

// How often the extension copies Home Assistant's hass into the app while no
// card on the page is passing it on (config at the dashboard root, no card on
// the view — the README's recommended setup). Kept at the old 200 ms so the
// app reacts as quickly as before; each tick is one querySelector and an
// identity compare.
const FALLBACK_HASS_POLL_MS = 200;
// While a card IS passing hass on, a slow safety-net poll still runs: if some
// Home Assistant version kept a card connected without updating its hass
// (hidden or conditional cards), the app would otherwise go stale. Bounds that
// at a couple of seconds; normally it finds the same object and does nothing.
const SAFETY_NET_POLL_MS = 2000;

// The SpotifyExtension singleton, created at the bottom of this module.
let extension = null;

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
        extension?.cardConfigured();
    }

    // Passed on only while connected: a card off the page (another view, a
    // hidden card) may stop getting updates, and the extension must then
    // fall back to polling. Connecting forwards nothing: the hass a card held
    // while detached can be old, and the next one Lovelace sets is current.
    set hass(hass) {
        this._hass = hass;
        if (this.isConnected) extension?.cardHass(this, hass);
    }

    get hass() { return this._hass; }

    getCardSize() { return 1; }

    getGridOptions() { return { rows: 1, columns: 6, min_rows: 1, min_columns: 3 }; }

    connectedCallback() { this._render(); }

    disconnectedCallback() { extension?.cardDisconnected(this); }

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

/**
 * Mounts one <spotify-browser-app> on the page once Home Assistant and a
 * config are there, keeps its `hass` current, and opens it from the launch
 * events and URL hashes.
 *
 * Where `hass` comes from:
 *   - A spotify-browser-card on the page passes on each `hass` Lovelace gives
 *     it (cardHass), with no delay; a slow SAFETY_NET_POLL_MS poll still
 *     runs in case Lovelace stops updating a card that stays connected.
 *   - Otherwise (config at the dashboard root and no card on the view, or the
 *     card is on another view) a FALLBACK_HASS_POLL_MS poll copies
 *     `<home-assistant>.hass`, the object every panel and card get theirs from.
 */
class SpotifyExtension {
    constructor() {
        this.app = null;
        this.config = null;
        this.initialized = false;
        this.hass = null;

        // Cards that are connected and have been handed a hass since they
        // connected: Lovelace keeps those current, so the poll is off while
        // there is one.
        this._forwardingCards = new Set();
        this._pollTimer = null;

        // True once init() has looked for a config. From then on, a card that
        // appears while there is still no app makes the extension look again.
        this._searched = false;
        this._recheckQueued = false;
        // The raw config _setup() last tried, so one that failed to parse is
        // not parsed (and reported) again for every card on its dashboard.
        this._lastTried = null;

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
        this._searched = true;
        if (!configRaw) {
            console.warn("[SpotifyBrowser] No 'spotify_browser:' config found in dashboard YAML.");
            return;
        }

        this._setup(configRaw);
    }

    /**
     * Steps 3–5 of init(): parse, mount the app, start the hass feed, listen.
     * Mounts at most one app; after a parse failure a different config may try again.
     */
    _setup(configRaw) {
        if (this.app) return;
        this._lastTried = configRaw;

        // The newest hass: init() may have waited for the panel since it read
        // it, and a late card can come long after.
        const ha = document.querySelector("home-assistant");
        if (ha && ha.hass) this.hass = ha.hass;

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

        // 4. Keep hass current (the poll only if no card is passing it on)
        this._updatePoll();

        // 5. Event Listeners
        window.addEventListener('spotify-browser-open', () => this._open());
        // Deep-link straight to the mobile Now Playing surface (over home).
        window.addEventListener('spotify-browser-open-now-playing', () => this._open(true));

        // Listen for URL Hash changes (Browser Back/Forward or Manual URL entry)
        window.addEventListener('hashchange', this._boundCheckHash);

        // Listen for HA internal navigation (which sometimes modifies URL)
        window.addEventListener('location-changed', this._boundCheckHash);
    }

    /** A connected card was handed `hass` by Lovelace. */
    cardHass(card, hass) {
        this._forwardingCards.add(card);
        this._updatePoll();
        this._setHass(hass);
    }

    /** A card left the page: if it was the last one passing hass on, poll again. */
    cardDisconnected(card) {
        if (this._forwardingCards.delete(card)) this._updatePoll();
    }

    /**
     * A card got its config. If init() found none (the dashboard open at load
     * had neither a `spotify_browser:` key nor a card), look again: the card
     * is on the dashboard open now. The lookup is init()'s own, on the current
     * dashboard, so the outcome is what a reload there would give (root key
     * first, then the first card in the layout), and a card being typed in the
     * card editor, not yet saved to the dashboard, cannot set the config.
     * Deferred to a microtask: Lovelace calls setConfig while it builds the
     * view, and mounting the app is no part of that.
     */
    cardConfigured() {
        if (!this._searched || this.app || this._recheckQueued) return;
        this._recheckQueued = true;
        queueMicrotask(() => {
            this._recheckQueued = false;
            if (this.app) return;
            let configRaw = null;
            try {
                const lovelace = this._currentLovelace();
                configRaw = lovelace ? this._configFrom(lovelace) : null;
            } catch (e) {
                console.error("[SpotifyBrowser] Config lookup failed:", e);
                return;
            }
            if (configRaw && configRaw !== this._lastTried) this._setup(configRaw);
        });
    }

    _setHass(hass) {
        if (!hass || hass === this.hass) return;
        this.hass = hass;
        if (this.app) this.app.hass = hass;
    }

    /** Copy `<home-assistant>.hass` into the app if it changed. */
    _pullHass() {
        const ha = document.querySelector("home-assistant");
        if (ha && ha.hass) this._setHass(ha.hass);
    }

    /**
     * Poll while there is an app: every FALLBACK_HASS_POLL_MS when no card
     * passes hass on, every SAFETY_NET_POLL_MS while one does.
     */
    _updatePoll() {
        const period = !this.initialized ? 0
            : this._forwardingCards.size === 0 ? FALLBACK_HASS_POLL_MS : SAFETY_NET_POLL_MS;
        if (period === this._pollPeriod) return;
        if (this._pollTimer) clearInterval(this._pollTimer);
        this._pollTimer = period ? setInterval(() => this._pullHass(), period) : null;
        this._pollPeriod = period;
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
        // On the poll, catch up now rather than up to a poll interval later.
        if (this._pollTimer) this._pullHass();
        this.app.open(nowPlaying ? { nowPlaying: true } : undefined);
    }

    /** The open Lovelace dashboard's `lovelace` object, or undefined if none is there (yet). */
    _currentLovelace() {
        return document.querySelector("home-assistant")
            ?.shadowRoot.querySelector("home-assistant-main")
            ?.shadowRoot.querySelector("ha-panel-lovelace")?.lovelace;
    }

    async _findLovelaceConfig() {
        // Wait until the lovelace panel is available
        let lovelace = null;
        while (!lovelace) {
            lovelace = this._currentLovelace();
            if (!lovelace) await new Promise(r => setTimeout(r, 200));
        }
        return this._configFrom(lovelace);
    }

    _configFrom(lovelace) {
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
}

extension = new SpotifyExtension();
