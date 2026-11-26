import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigParser } from '../src/config_parser.js';

const parse = (home) => ConfigParser.parse({ entity: 'media_player.x', home }).home;

test('home.pinned: true enables pins with no config items', () => {
    const home = parse({ pinned: true });
    assert.deepEqual(home.pinned, { enabled: true, scope: 'shared', items: [] });
});

test('home.pinned defaults to disabled', () => {
    assert.deepEqual(parse({}).pinned, { enabled: false, scope: 'shared', items: [] });
});

test('home.pinned.items flattens every made_for_you entry shape into {id, type, ...}', () => {
    const home = parse({
        pinned: {
            items: [
                { likedsongs: true },
                { playlists_recommended: [{ id: 'dm1', title: 'Daily Mix 1' }] },
                { playlists: ['pl1', 'pl2'] },
                'pl3',
                { id: 'al1', title: 'Top Hits', type: 'album' },
            ],
        },
    });
    assert.equal(home.pinned.enabled, true);
    assert.deepEqual(home.pinned.items, [
        { id: 'dm1', type: 'playlist', title: 'Daily Mix 1', recommended: true },
        { id: 'pl1', type: 'playlist' },
        { id: 'pl2', type: 'playlist' },
        { id: 'pl3', type: 'playlist' },
        { id: 'al1', type: 'album', title: 'Top Hits' },
    ]);
});

test('home.pinned as a bare list is treated as items', () => {
    const home = parse({ pinned: ['pl1'] });
    assert.equal(home.pinned.enabled, true);
    assert.deepEqual(home.pinned.items, [{ id: 'pl1', type: 'playlist' }]);
});

test('legacy home.made_for_you folds into pinned.items and enables pins', () => {
    const home = parse({
        pinned: false,
        made_for_you: { content: ['pl1'], pills: true },
    });
    assert.equal(home.pinned.enabled, true);
    assert.deepEqual(home.pinned.items, [{ id: 'pl1', type: 'playlist' }]);
    assert.equal('made_for_you' in home, false);
});

test('legacy made_for_you items come after explicit pinned.items', () => {
    const home = parse({
        pinned: { items: ['a'] },
        made_for_you: ['b'],
    });
    assert.deepEqual(home.pinned.items.map(i => i.id), ['a', 'b']);
});

test('default sort has no made_for_you section', () => {
    assert.deepEqual(parse({}).sort, ['pinned', 'recent', 'favorites', 'artists', 'albums']);
});

test('sort token made_for_you is dropped, keeping the rest of the order', () => {
    const home = parse({ sort: ['recently_played', 'made_for_you', 'pinned'] });
    assert.deepEqual(home.sort, ['recent', 'pinned']);
});

test('home.pinned.scope defaults to shared and accepts account', () => {
    assert.equal(parse({ pinned: true }).pinned.scope, 'shared');
    assert.equal(parse({ pinned: { scope: 'account' } }).pinned.scope, 'account');
    assert.equal(parse({ pinned: { scope: 'bogus' } }).pinned.scope, 'shared');
});

test('accounts[].pinned is flattened like home.pinned.items', () => {
    const cfg = ConfigParser.parse({
        accounts: [
            { entity: 'media_player.a', name: 'A', pinned: ['pl1', { playlists_recommended: [{ id: 'dm', title: 'Daily Mix' }] }] },
            { entity: 'media_player.b', name: 'B' },
        ],
    });
    assert.deepEqual(cfg.accounts[0].pinned, [
        { id: 'pl1', type: 'playlist' },
        { id: 'dm', type: 'playlist', title: 'Daily Mix', recommended: true },
    ]);
    assert.deepEqual(cfg.accounts[1].pinned, []);
});

test('accounts[].pinned also accepts the {items: [...]} object form', () => {
    const cfg = ConfigParser.parse({ accounts: [{ entity: 'media_player.a', pinned: { items: ['pl1'] } }] });
    assert.deepEqual(cfg.accounts[0].pinned, [{ id: 'pl1', type: 'playlist' }]);
});

// The app reads config.browser.auto_close (spotify-browser-app.js _checkIdleClose).
test('browser.auto_close: seconds shorthand enables it, under browser only', () => {
    const cfg = ConfigParser.parse({ entity: 'media_player.x', browser: { auto_close: 300 } });
    assert.deepEqual(cfg.browser.auto_close, { enabled: true, timeout: 300 });
    assert.equal(cfg.auto_close, undefined);
});

test('browser.auto_close: 0 or omitted stays disabled', () => {
    const off = { enabled: false, timeout: 0 };
    assert.deepEqual(ConfigParser.parse({ entity: 'media_player.x' }).browser.auto_close, off);
    assert.deepEqual(ConfigParser.parse({ entity: 'media_player.x', browser: { auto_close: 0 } }).browser.auto_close, off);
});

// detectLite() reads navigator.deviceMemory / hardwareConcurrency. Node 21+
// exposes a real navigator (hardwareConcurrency = host cores), so stub it.
function withNavigator(nav, fn) {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
    try { return fn(); }
    finally {
        if (desc) Object.defineProperty(globalThis, 'navigator', desc);
        else delete globalThis.navigator;
    }
}
const WEAK = { deviceMemory: 2, hardwareConcurrency: 8 };
const WEAK_CORES = { hardwareConcurrency: 4 };
const STRONG = { deviceMemory: 8, hardwareConcurrency: 8 };
const parseAll = (extra = {}) => ConfigParser.parse({ entity: 'media_player.x', ...extra });

test('appearance.performance omitted runs lite auto-detection', () => {
    for (const cfg of [{}, { appearance: {} }, { appearance: true }]) {
        const weak = withNavigator(WEAK, () => parseAll(cfg).appearance);
        assert.deepEqual(weak.performance, { mode: 'auto', lite: true });
        assert.equal(weak.animations.blur, false, 'lite forces blur off');
        assert.deepEqual(withNavigator(WEAK_CORES, () => parseAll(cfg).appearance.performance), { mode: 'auto', lite: true });
        const strong = withNavigator(STRONG, () => parseAll(cfg).appearance);
        assert.deepEqual(strong.performance, { mode: 'auto', lite: false });
        assert.equal(strong.animations.blur, true);
        // navigator without the values (or no navigator at all) -> not lite
        assert.deepEqual(withNavigator({}, () => parseAll(cfg).appearance.performance), { mode: 'auto', lite: false });
        assert.deepEqual(withNavigator(undefined, () => parseAll(cfg).appearance.performance), { mode: 'auto', lite: false });
    }
});

test('appearance.performance: high / low ignore detection', () => {
    for (const nav of [WEAK, STRONG, {}]) {
        withNavigator(nav, () => {
            assert.deepEqual(parseAll({ appearance: { performance: 'high' } }).appearance.performance, { mode: 'high', lite: false });
            assert.deepEqual(parseAll({ appearance: { performance: 'low' } }).appearance.performance, { mode: 'low', lite: true });
            assert.deepEqual(parseAll({ appearance: { performance: { mode: 'high' } } }).appearance.performance, { mode: 'high', lite: false });
        });
    }
});

// Output of the parser before nested groups filled their own defaults
// (captured from the previous config_parser.js with navigator values absent).
const DEFAULTS_SNAPSHOT = {
    entity: 'media_player.x',
    accounts: [],
    browser: { hash: '#spotify-browser', auto_close: { enabled: false, timeout: 0 }, home_on_exit: { enabled: true, timeout: 0 }, cache_size: 10, debug: false },
    appearance: {
        performance: { mode: 'auto', lite: false },
        animations: { page_transition: 'fade', browser_open: 'fade', blur: true },
        desktop: {
            mode: 'default', width: '85vw', height: '85vh', fullscreen: false,
            margin_top: '24px', margin_bottom: '24px', margin_left: '24px', margin_right: '24px',
        },
    },
    home: { sort: ['pinned', 'recent', 'favorites', 'artists', 'albums'], pinned: { enabled: false, scope: 'shared', items: [] } },
    devices: { default: null, icons: [], volume: { fallback: 25, rules: [], rate_control: true, optimistic: true, step: 2 } },
    queue: { open_on_desktop: false, miniplayer: { enabled: true, shuffle: true, previous: true, next: true, like: true, volume: true, device: true } },
    sonos: { enabled: false, launch_mode: 'local', prefer_sonos: false, debug: false, device_map: [] },
    storage: { sensor: 'sensor.spotify_browser_data', event: 'spotify_browser_store_data', script: null },
    card: { title: 'Spotify Browser', label: 'launch', icon: 'mdi:spotify', color: '#1DB954' },
    integrations: { lastfm: { api_key: null } },
};

test('omitted config: every group matches the pre-change defaults', () => {
    assert.deepEqual(withNavigator({}, () => parseAll()), DEFAULTS_SNAPSHOT);
    assert.deepEqual(withNavigator(STRONG, () => parseAll()), DEFAULTS_SNAPSHOT);
    // On a weak device only the intended lite detection (and its blur-off) differs.
    const weak = withNavigator(WEAK, () => parseAll());
    assert.deepEqual(weak, {
        ...DEFAULTS_SNAPSHOT,
        appearance: {
            ...DEFAULTS_SNAPSHOT.appearance,
            performance: { mode: 'auto', lite: true },
            animations: { ...DEFAULTS_SNAPSHOT.appearance.animations, blur: false },
        },
    });
});

test('groups configured as {} or true keep nested defaults', () => {
    withNavigator({}, () => {
        for (const g of ['browser', 'appearance', 'home', 'devices', 'queue', 'integrations']) {
            assert.deepEqual(parseAll({ [g]: {} })[g], DEFAULTS_SNAPSHOT[g], `${g}: {}`);
            assert.deepEqual(parseAll({ [g]: true })[g], DEFAULTS_SNAPSHOT[g], `${g}: true`);
        }
    });
});

// --- appearance.desktop sizes (cssSize) ---

const desktop = (d) => withNavigator({}, () => parseAll({ appearance: { desktop: d } }).appearance.desktop);

test('appearance.desktop: numbers and numeric strings become px; other strings pass through', () => {
    assert.deepEqual(desktop({ width: 1000, height: '700', margin: '2rem', margin_top: 0 }), {
        mode: 'fixed', width: '1000px', height: '700px', fullscreen: false,
        margin_top: '0px', margin_bottom: '2rem', margin_left: '2rem', margin_right: '2rem',
    });
});

test('appearance.desktop: a blank or whitespace-only size keeps the default (was "px"), with a warning', (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    assert.deepEqual(desktop({ width: '', height: '   ', margin: '', margin_left: ' ', margin_top: '8' }),
        { ...DEFAULTS_SNAPSHOT.appearance.desktop, margin_top: '8px' },
        'blank sizes neither override the defaults nor imply the fixed mode');
    assert.deepEqual(desktop({ mode: 'fixed', width: '\t' }), { ...DEFAULTS_SNAPSHOT.appearance.desktop, mode: 'fixed' });
    // A blank global margin leaves the 24px cascade; a blank side takes the global one.
    assert.deepEqual(desktop({ margin: '10', margin_bottom: '' }), {
        ...DEFAULTS_SNAPSHOT.appearance.desktop,
        margin_top: '10px', margin_bottom: '10px', margin_left: '10px', margin_right: '10px',
    });
    const warned = warn.mock.calls.map(c => c.arguments[0]).join('\n');
    for (const key of ['width', 'height', 'margin', 'margin_left', 'margin_bottom']) {
        assert.match(warned, new RegExp(`"appearance\\.desktop\\.${key}" is empty`), key);
    }
});

test('appearance.desktop: sizes are trimmed before px is decided (was " 10 px") (B11)', () => {
    assert.deepEqual(desktop({ width: ' 10 ', height: ' 50% ', margin: ' 2rem ', margin_top: '\t8\n', margin_left: 'calc(100% - 4px)' }), {
        mode: 'fixed', width: '10px', height: '50%', fullscreen: false,
        margin_top: '8px', margin_bottom: '2rem', margin_left: 'calc(100% - 4px)', margin_right: '2rem',
    });
    // Unchanged: numbers, numeric strings, units, and non-strings.
    assert.deepEqual(desktop({ width: 0, height: '0', margin: 12.5, margin_right: '1e2' }), {
        mode: 'fixed', width: '0px', height: '0px', fullscreen: false,
        margin_top: '12.5px', margin_bottom: '12.5px', margin_left: '12.5px', margin_right: '1e2px',
    });
});
