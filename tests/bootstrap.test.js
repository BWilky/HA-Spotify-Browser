import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/elements.js';
import '../src/spotify-browser-app.js';

// src/index.js, the page bootstrap: how hass reaches the app (from a
// spotify-browser-card's `hass` setter, else a fallback poll of
// <home-assistant>.hass), the late-card config follow-up, and the launch
// events and hashes. Each test evaluates a fresh copy of the module (its
// singleton starts at import) against a fake page: <home-assistant>, the
// Lovelace panel, window, a fake clock. The app is a stub recording what
// the extension does to it.

const ENTITY = 'media_player.spotify_a';
const hassN = (n) => ({ n, states: {} });
const flush = () => new Promise((r) => setImmediate(r));

/** setTimeout/setInterval on a clock that only moves in advance(). */
function fakeClock(t) {
    const saved = { setTimeout, setInterval, clearTimeout, clearInterval };
    const timers = new Map();
    let now = 0;
    let nextId = 1;
    globalThis.setTimeout = (fn, ms = 0) => { timers.set(nextId, { fn, at: now + ms }); return nextId++; };
    globalThis.setInterval = (fn, ms) => { timers.set(nextId, { fn, at: now + ms, every: ms }); return nextId++; };
    globalThis.clearTimeout = globalThis.clearInterval = (id) => { timers.delete(id); };
    t.after(() => Object.assign(globalThis, saved));
    return {
        /** Periods of the intervals running now. */
        intervals: () => [...timers.values()].filter((x) => x.every).map((x) => x.every),
        async advance(ms) {
            const end = now + ms;
            for (;;) {
                await flush();
                let due = null;
                for (const [id, x] of timers) if (x.at <= end && (!due || x.at < due[1].at)) due = [id, x];
                if (!due) break;
                const [id, x] = due;
                now = x.at;
                if (x.every) x.at += x.every; else timers.delete(id);
                x.fn();
            }
            now = end;
            await flush();
        },
    };
}

class FakeElement {
    constructor() { this.isConnected = false; }
    attachShadow() {
        const node = { setAttribute() {}, addEventListener() {}, textContent: '' };
        this.shadowRoot = { innerHTML: '', querySelector: () => node };
        return this.shadowRoot;
    }
}

/**
 * A fake page. `dashboard` is the Lovelace config of the dashboard open now
 * (null: no Lovelace panel). Returns handles to steer and inspect it.
 */
function fakePage(t, { dashboard, hash = '', hass = hassN(1) }) {
    const listeners = {};
    const page = {
        dashboard,
        ha: { hass, shadowRoot: null },
        apps: [],
        haQueries: 0,
        replaced: [],
        warnings: [],
        errors: [],
        listenerCount: (type) => (listeners[type] || []).length,
        dispatch: (type) => { for (const fn of listeners[type] || []) fn({ type }); },
    };
    const panel = { get lovelace() { return page.dashboard ? { config: page.dashboard } : undefined; } };
    const main = { shadowRoot: { querySelector: (s) => (s === 'ha-panel-lovelace' && page.dashboard !== null ? panel : null) } };
    page.ha.shadowRoot = { querySelector: (s) => (s === 'home-assistant-main' ? main : null) };

    const saved = {
        window: globalThis.window, document: globalThis.document, history: globalThis.history,
        CustomEvent: globalThis.CustomEvent, HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
        warn: console.warn, error: console.error,
    };
    globalThis.window = {
        location: { hash, pathname: '/lovelace/0', search: '' },
        addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
        dispatchEvent: (ev) => { page.dispatch(ev.type); return true; },
    };
    globalThis.history = {
        replaceState: (_s, _t, url) => { page.replaced.push(url); globalThis.window.location.hash = ''; },
    };
    globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
    globalThis.HTMLElement = FakeElement;
    const registry = new Map();
    globalThis.customElements = { define: (n, c) => registry.set(n, c), get: (n) => registry.get(n) };
    globalThis.document = {
        body: { appendChild: (el) => el },
        querySelector: (s) => {
            if (s !== 'home-assistant') return null;
            page.haQueries++;
            return page.ha;
        },
        createElement: (tag) => {
            assert.equal(tag, 'spotify-browser-app');
            const app = {
                config: null, hassSets: [], opens: [], switched: [],
                set hass(h) { this.hassSets.push(h); this._h = h; },
                get hass() { return this._h; },
                open(opts) { this.opens.push(opts); },
                switchAccount(entity) { this.switched.push(entity); },
            };
            page.apps.push(app);
            return app;
        },
    };
    console.warn = (...a) => page.warnings.push(a.join(' '));
    console.error = (...a) => page.errors.push(a.join(' '));
    t.after(() => {
        Object.assign(globalThis, {
            window: saved.window, document: saved.document, history: saved.history,
            CustomEvent: saved.CustomEvent, HTMLElement: saved.HTMLElement, customElements: saved.customElements,
        });
        console.warn = saved.warn;
        console.error = saved.error;
    });
    return page;
}

let loads = 0;
/** Evaluate a fresh src/index.js on the current fake page and let init() settle. */
async function boot(clock) {
    await import(`../src/index.js?boot=${++loads}`);
    await clock.advance(0);
}

function makeCard(config) {
    const Card = globalThis.customElements.get('spotify-browser-card');
    const card = new Card();
    card.setConfig(config);
    return card;
}
const connect = (card) => { card.isConnected = true; card.connectedCallback(); };
const disconnect = (card) => { card.isConnected = false; card.disconnectedCallback(); };

const withCard = (config) => ({ views: [{ sections: [{ cards: [{ type: 'tile' }, config] }] }] });
const CARD = { type: 'custom:spotify-browser-card', entity: ENTITY };

test('a connected card passes each hass on to the app; only the slow safety-net poll runs while it does', async (t) => {
    const clock = fakeClock(t);
    const page = fakePage(t, { dashboard: withCard(CARD) });
    await boot(clock);
    const card = makeCard(CARD);
    connect(card);
    await flush();

    assert.equal(page.apps.length, 1);
    const app = page.apps[0];
    assert.equal(app.config.entity, ENTITY);
    assert.deepEqual(app.hassSets.map((h) => h.n), [1]);
    // No hass from the card yet: the fallback is on.
    assert.deepEqual(clock.intervals(), [200]);

    const h2 = hassN(2);
    card.hass = h2;
    assert.equal(app.hass, h2, 'set synchronously, from the setter');
    assert.deepEqual(clock.intervals(), [2000], 'the fast poll stopped; the safety net runs');

    // Root hass moving on its own (Lovelace stopped updating the card) is
    // picked up by the safety net within 2 s, not by the fast poll.
    page.ha.hass = hassN(3);
    await clock.advance(1999);
    assert.equal(app.hass, h2);
    await clock.advance(1);
    assert.equal(app.hass.n, 3);

    // The same hass again (a second card, a re-set) is not assigned twice.
    const h4 = hassN(4);
    page.ha.hass = h4; // the card and the root carry the same object, as in HA
    card.hass = h4;
    card.hass = h4;
    assert.deepEqual(app.hassSets.map((h) => h.n), [1, 2, 3, 4]);

    // A detached card passes nothing on, even if Lovelace still sets its hass.
    disconnect(card);
    card.hass = hassN(5);
    assert.equal(app.hass, h4);
    assert.equal(card.hass.n, 5, 'the getter returns what was set');
});

test('the fast poll runs while no card passes hass on: 200 ms, slows to the safety net for a card, resumes after', async (t) => {
    const clock = fakeClock(t);
    const page = fakePage(t, { dashboard: { spotify_browser: { entity: ENTITY }, views: [] } });
    await boot(clock);
    const app = page.apps[0];
    assert.deepEqual(clock.intervals(), [200]);

    page.ha.hass = hassN(2);
    await clock.advance(199);
    assert.equal(app.hass.n, 1);
    await clock.advance(1);
    assert.equal(app.hass.n, 2);
    // Unchanged hass: nothing assigned.
    await clock.advance(3000);
    assert.deepEqual(app.hassSets.map((h) => h.n), [1, 2]);

    // Opening catches up at once instead of waiting for the next tick.
    page.ha.hass = hassN(3);
    page.dispatch('spotify-browser-open');
    assert.equal(app.hass.n, 3);
    assert.equal(app.opens.length, 1);

    // A card that is connected but has no hass yet: the poll goes on.
    const card = makeCard({ type: 'custom:spotify-browser-card', entity: 'media_player.other' });
    connect(card);
    assert.deepEqual(clock.intervals(), [200]);
    // Its first hass slows it to the safety net.
    page.ha.hass = hassN(4);
    card.hass = page.ha.hass;
    assert.deepEqual(clock.intervals(), [2000]);
    assert.equal(app.hass.n, 4);
    // A second forwarding card leaving changes nothing while one remains.
    const card2 = makeCard(CARD);
    connect(card2);
    card2.hass = app.hass;
    disconnect(card2);
    assert.deepEqual(clock.intervals(), [2000]);
    // The last one leaving brings the fast poll back.
    disconnect(card);
    assert.deepEqual(clock.intervals(), [200]);
    page.ha.hass = hassN(5);
    await clock.advance(200);
    assert.equal(app.hass.n, 5);

    // Still one app, and the config is the root key's (a card never replaces it).
    assert.equal(page.apps.length, 1);
    assert.equal(app.config.entity, ENTITY);
});

test('no poll and no listeners before there is a config; hass from a card is kept for the app', async (t) => {
    const clock = fakeClock(t);
    const page = fakePage(t, { dashboard: { views: [{ cards: [{ type: 'tile' }] }] } });
    await boot(clock);
    assert.equal(page.apps.length, 0);
    assert.equal(page.warnings.length, 1);
    assert.match(page.warnings[0], /No 'spotify_browser:' config found/);
    assert.deepEqual(clock.intervals(), []);
    for (const type of ['spotify-browser-open', 'spotify-browser-open-now-playing', 'hashchange', 'location-changed']) {
        assert.equal(page.listenerCount(type), 0, type);
    }
    // A card being typed in the card editor (not in the saved dashboard) does
    // not configure anything: the lookup reads the saved dashboard.
    const preview = makeCard({ type: 'custom:spotify-browser-card', entity: 'media_player.spo' });
    connect(preview);
    preview.hass = hassN(2);
    await flush();
    assert.equal(page.apps.length, 0);
    assert.deepEqual(clock.intervals(), []);
});

test('a card on a later dashboard sets the extension up when the first dashboard had no config', async (t) => {
    const clock = fakeClock(t);
    const page = fakePage(t, { dashboard: { views: [{ cards: [{ type: 'tile' }] }] } });
    await boot(clock);
    assert.equal(page.apps.length, 0);

    // In-app navigation to a dashboard with the card: Lovelace builds it.
    page.dashboard = withCard(CARD);
    page.ha.hass = hassN(7);
    const card = makeCard(CARD);
    const card2 = makeCard(CARD); // a second card on that view: one lookup, one app
    assert.equal(page.apps.length, 0, 'deferred out of setConfig');
    await flush();

    assert.equal(page.apps.length, 1);
    const app = page.apps[0];
    assert.equal(app.config.entity, ENTITY);
    assert.equal(app.hass.n, 7, 'the newest hass, not the one init() read');
    for (const type of ['spotify-browser-open', 'spotify-browser-open-now-playing', 'hashchange', 'location-changed']) {
        assert.equal(page.listenerCount(type), 1, type);
    }
    assert.deepEqual(clock.intervals(), [200]);

    // The tile now opens it.
    connect(card);
    page.ha.hass = hassN(8);
    card.hass = page.ha.hass;
    assert.deepEqual(clock.intervals(), [2000]);
    page.dispatch('spotify-browser-open');
    assert.equal(app.opens.length, 1);

    // More config calls (a re-render, another dashboard) change nothing.
    card2.setConfig(CARD);
    page.dashboard = withCard({ ...CARD, entity: 'media_player.other' });
    makeCard({ ...CARD, entity: 'media_player.other' });
    await flush();
    assert.equal(page.apps.length, 1);
    assert.equal(app.config.entity, ENTITY);
    for (const type of ['spotify-browser-open', 'hashchange']) assert.equal(page.listenerCount(type), 1, type);
});

test('the late lookup is the load-time one: the root key wins over the card', async (t) => {
    const clock = fakeClock(t);
    const page = fakePage(t, { dashboard: { views: [] } });
    await boot(clock);
    page.dashboard = { spotify_browser: { entity: 'media_player.root' }, ...withCard(CARD) };
    makeCard(CARD);
    await flush();
    assert.equal(page.apps.length, 1);
    assert.equal(page.apps[0].config.entity, 'media_player.root');
});

test('a config that fails to parse is reported once, and a later good one still sets up', async (t) => {
    const clock = fakeClock(t);
    const bad = { type: 'custom:spotify-browser-card' }; // no entity: ConfigParser throws
    const page = fakePage(t, { dashboard: withCard(bad) });
    await boot(clock);
    assert.equal(page.apps.length, 0);
    assert.equal(page.errors.length, 1);
    assert.match(page.errors[0], /Init Failed/);

    makeCard(bad);
    await flush();
    assert.equal(page.errors.length, 1, 'the same config is not parsed again');

    page.dashboard = withCard(CARD);
    makeCard(CARD);
    await flush();
    assert.equal(page.apps.length, 1);
    assert.equal(page.apps[0].config.entity, ENTITY);
    assert.equal(page.listenerCount('spotify-browser-open'), 1);
});

test('waits for Home Assistant and the Lovelace panel as before', async (t) => {
    const clock = fakeClock(t);
    const page = fakePage(t, { dashboard: null });
    const hass = page.ha.hass;
    page.ha.hass = undefined;
    await boot(clock);
    await clock.advance(1500);
    assert.equal(page.apps.length, 0);
    page.ha.hass = hass;
    await clock.advance(500);
    assert.equal(page.apps.length, 0, 'no Lovelace panel yet');
    page.dashboard = { spotify_browser: { entity: ENTITY } };
    await clock.advance(200);
    assert.equal(page.apps.length, 1);
});

test('hash triggers and launch events: registered once, behaving as before', async (t) => {
    const clock = fakeClock(t);
    const page = fakePage(t, {
        hash: '#spotify-browser',
        dashboard: {
            spotify_browser: {
                accounts: [{ entity: ENTITY, hash: 'user-a' }, { entity: 'media_player.spotify_b', hash: '#user-b' }],
            },
        },
    });
    await boot(clock);
    const app = page.apps[0];
    for (const type of ['spotify-browser-open', 'spotify-browser-open-now-playing', 'hashchange', 'location-changed']) {
        assert.equal(page.listenerCount(type), 1, type);
    }
    // The hash the page loaded with opens it once and is cleared.
    assert.deepEqual(app.opens, [undefined]);
    assert.deepEqual(page.replaced, ['/lovelace/0']);
    assert.equal(window.location.hash, '');

    window.location.hash = '#user-b-now-playing';
    page.dispatch('hashchange');
    assert.deepEqual(app.switched, ['media_player.spotify_b']);
    assert.deepEqual(app.opens.at(-1), { nowPlaying: true });

    // The current account's hash opens without switching.
    window.location.hash = '#user-a';
    page.dispatch('location-changed');
    assert.deepEqual(app.switched, ['media_player.spotify_b']);
    assert.equal(app.opens.length, 3);

    window.location.hash = '#something-else';
    page.dispatch('hashchange');
    assert.equal(app.opens.length, 3);

    page.dispatch('spotify-browser-open-now-playing');
    assert.deepEqual(app.opens.at(-1), { nowPlaying: true });
    page.dispatch('spotify-browser-open');
    assert.deepEqual(app.opens.at(-1), undefined);
    assert.equal(app.opens.length, 5);
});
