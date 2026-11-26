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
