import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../router.js';

// Build a router with a fake container and a no-op transition so navigateTo
// can run under plain node (no DOM). Pages are plain objects in the cache.
function makeRouter() {
    const router = new Router({}, {}, {});
    router._executeTransition = () => {};
    return router;
}

function fakeSearchPage() {
    return {
        searches: [],
        search(q) { this.searches.push(q); },
        requestUpdate() {},
    };
}

test('re-navigating to a cached search page applies the new query (#23)', () => {
    const router = makeRouter();
    const page = fakeSearchPage();
    router.pageCache.set('search', page);

    // Leave the search page, then search again from elsewhere.
    router.currentPageId = 'home';
    router.navigateTo('search', { query: 'B' });

    assert.deepEqual(page.searches, ['B']);
});

test('re-navigating to a cached search page without a query leaves it alone', () => {
    const router = makeRouter();
    const page = fakeSearchPage();
    router.pageCache.set('search', page);

    router.currentPageId = 'artist:1';
    router.navigateTo('search', null, 'back');

    assert.deepEqual(page.searches, []);
});

test('forward navigation to the page already shown does not grow history', () => {
    const router = makeRouter();
    router.pageCache.set('library', { requestUpdate() {} });
    router.currentPageId = 'library';

    router.navigateTo('library');

    assert.deepEqual(router.history, []);
    assert.equal(router.currentPageId, 'library');
});

test('Back after home -> search -> search (Enter) returns home', () => {
    const router = makeRouter();
    router.pageCache.set('home', { requestUpdate() {} });
    router.pageCache.set('search', fakeSearchPage());
    router.currentPageId = 'home';

    router.navigateTo('search', { query: 'a' });
    router.navigateTo('search', { query: 'ab' });
    assert.deepEqual(router.history, ['home']);

    router.goBack();
    assert.equal(router.currentPageId, 'home');
    assert.deepEqual(router.history, []);
});

test('same-page navigation with a new search query still applies the query', () => {
    const router = makeRouter();
    const page = fakeSearchPage();
    router.pageCache.set('search', page);
    router.currentPageId = 'search';

    let routeEvents = 0;
    router.addEventListener('route-changed', () => routeEvents++);
    router.navigateTo('search', { query: 'new' });

    assert.deepEqual(page.searches, ['new']);
    assert.equal(routeEvents, 1);
    assert.deepEqual(router.history, []);
});

// Minimal element stand-in with a real class list, for the transition code.
function fakeElement() {
    const el = new EventTarget();
    const classes = new Set();
    el.classList = {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        contains: (c) => classes.has(c),
    };
    el.classes = classes;
    el.requestUpdate = () => {};
    return el;
}

test('same-page navigation does not run an exit animation on or hide the page', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const children = new Set();
    const container = { contains: (el) => children.has(el), appendChild: (el) => children.add(el) };
    const router = new Router({}, container, { appearance: { animations: { page_transition: 'slide' } } });
    const page = fakeElement();
    router.pageCache.set('library', page);
    children.add(page);
    router.currentPageId = 'library';

    router.navigateTo('library');
    t.mock.timers.tick(400);

    assert.equal(page.classes.has('slide-out-left'), false);
    assert.equal(page.classes.has('page-hidden'), false);
});

test('header-scroll is relayed only from the page currently shown', (t) => {
    const prevDocument = globalThis.document;
    globalThis.document = { createElement: () => fakeElement() };
    t.after(() => { globalThis.document = prevDocument; });

    const router = makeRouter();
    router.container = {};
    const relayed = [];
    router.addEventListener('header-scroll', (e) => relayed.push(e.detail.title));

    router.navigateTo('artist:1');
    const artistPage = router.pageCache.get('artist:1');
    router.navigateTo('playlist:2');
    const playlistPage = router.pageCache.get('playlist:2');

    // The hidden cached artist page re-renders (track change) and reports state.
    artistPage.dispatchEvent(new CustomEvent('header-scroll', { detail: { alpha: 0, title: 'Artist', textAlpha: 0 } }));
    playlistPage.dispatchEvent(new CustomEvent('header-scroll', { detail: { alpha: 1, title: 'Playlist', textAlpha: 1 } }));

    assert.deepEqual(relayed, ['Playlist']);

    router.goBack();
    artistPage.dispatchEvent(new CustomEvent('header-scroll', { detail: { alpha: 0, title: 'Artist', textAlpha: 0 } }));
    assert.deepEqual(relayed, ['Playlist', 'Artist']);
});

// A cached page that records every hass it is handed.
function fakeHassPage() {
    return { seen: [], set hass(h) { this.seen.push(h); }, requestUpdate() {} };
}

test('hass goes only to the page on screen', () => {
    const router = makeRouter();
    const home = fakeHassPage();
    const playlist = fakeHassPage();
    router.pageCache.set('home', home);
    router.pageCache.set('playlist:1', playlist);
    router.currentPageId = 'playlist:1';

    const hass = { states: {} };
    router.updateDependencies({ hass });

    assert.deepEqual(playlist.seen, [hass]);
    assert.deepEqual(home.seen, []);
    assert.equal(router.hass, hass);
});

test('hass is stored even when no page is on screen yet', () => {
    const router = makeRouter();
    const hass = { states: {} };
    router.updateDependencies({ hass });
    assert.equal(router.hass, hass);
});

test('a cached page receives the latest hass when navigated back to', () => {
    const router = makeRouter();
    const home = fakeHassPage();
    const playlist = fakeHassPage();
    router.pageCache.set('home', home);
    router.pageCache.set('playlist:1', playlist);
    router.currentPageId = 'home';

    const first = { states: {} };
    router.updateDependencies({ hass: first });
    router.navigateTo('playlist:1');

    // Two ticks arrive while home is hidden behind the playlist.
    const second = { states: {} };
    const latest = { states: {} };
    router.updateDependencies({ hass: second });
    router.updateDependencies({ hass: latest });
    assert.deepEqual(home.seen, [first]);

    router.goBack();
    assert.deepEqual(home.seen, [first, latest]);

    // ...and from then on it is the one that follows hass again.
    const after = { states: {} };
    router.updateDependencies({ hass: after });
    assert.deepEqual(home.seen, [first, latest, after]);
    assert.deepEqual(playlist.seen, [first, second, latest]);
});

test('a newly created page is given the stored hass', (t) => {
    const prevDocument = globalThis.document;
    globalThis.document = { createElement: () => fakeElement() };
    t.after(() => { globalThis.document = prevDocument; });

    const router = makeRouter();
    const hass = { states: {} };
    router.updateDependencies({ hass });
    router.navigateTo('album:9');

    assert.equal(router.pageCache.get('album:9').hass, hass);
});

test('api, config and pinned still reach every cached page', () => {
    const router = makeRouter();
    const home = fakeHassPage();
    const playlist = fakeHassPage();
    router.pageCache.set('home', home);
    router.pageCache.set('playlist:1', playlist);
    router.currentPageId = 'playlist:1';

    const api = {}, config = { browser: {} }, pinned = {};
    router.updateDependencies({ api, config, pinned });

    for (const page of [home, playlist]) {
        assert.equal(page.api, api);
        assert.equal(page.config, config);
        assert.equal(page.pinned, pinned);
        assert.deepEqual(page.seen, []);
    }
});

/* --- Playlist edit sessions (the app header steps aside for the page being edited) --- */

function editEvent(active) {
    return new CustomEvent('edit-session-changed', { detail: { active, playlistId: '2' } });
}

test('an edit session is recorded for its page and relayed with the page id', (t) => {
    const prevDocument = globalThis.document;
    globalThis.document = { createElement: () => fakeElement() };
    t.after(() => { globalThis.document = prevDocument; });

    const router = makeRouter();
    router.container = {};
    const relayed = [];
    router.addEventListener('edit-session-changed', (e) => relayed.push([e.detail.pageId, e.detail.active]));

    router.navigateTo('playlist:2');
    const page = router.pageCache.get('playlist:2');
    assert.equal(router.isEditing(), false);

    page.dispatchEvent(editEvent(true));
    assert.equal(router.isEditing(), true);
    assert.equal(router.isEditing('playlist:2'), true);

    page.dispatchEvent(editEvent(false)); // save, cancel, failed save, reset
    assert.equal(router.isEditing(), false);
    assert.deepEqual(relayed, [['playlist:2', true], ['playlist:2', false]]);
});

test('isEditing follows the page on screen: away it is false, back it is true again', (t) => {
    const prevDocument = globalThis.document;
    globalThis.document = { createElement: () => fakeElement() };
    t.after(() => { globalThis.document = prevDocument; });

    const router = makeRouter();
    router.container = {};
    router.navigateTo('playlist:2');
    router.pageCache.get('playlist:2').dispatchEvent(editEvent(true));

    router.navigateTo('artist:1');
    assert.equal(router.isEditing(), false);           // the header returns on the new page
    assert.equal(router.isEditing('playlist:2'), true); // the session itself is still open

    router.goBack();
    assert.equal(router.isEditing(), true);
});

test('a session that ends while its page is off screen is not left behind', (t) => {
    const prevDocument = globalThis.document;
    globalThis.document = { createElement: () => fakeElement() };
    t.after(() => { globalThis.document = prevDocument; });

    const router = makeRouter();
    router.container = {};
    router.navigateTo('playlist:2');
    const page = router.pageCache.get('playlist:2');
    page.dispatchEvent(editEvent(true));
    router.navigateTo('home');

    page.dispatchEvent(editEvent(false)); // e.g. a save that finished after leaving
    router.goBack();
    assert.equal(router.isEditing(), false);
});

test('a page rebuilt under the same id does not inherit a dropped page\'s edit session', (t) => {
    const prevDocument = globalThis.document;
    globalThis.document = { createElement: () => fakeElement() };
    t.after(() => { globalThis.document = prevDocument; });

    const router = makeRouter();
    router.container = {};
    router.navigateTo('playlist:2');
    router.pageCache.get('playlist:2').dispatchEvent(editEvent(true));

    router.clearCache(); // account switch
    assert.equal(router.isEditing('playlist:2'), false);
    router.navigateTo('playlist:2');
    assert.equal(router.isEditing(), false);

    router.pageCache.get('playlist:2').dispatchEvent(editEvent(true));
    router.navigateTo('home');
    router.dropPage('playlist:2'); // the playlist was deleted
    router.navigateTo('playlist:2');
    assert.equal(router.isEditing(), false);
});
