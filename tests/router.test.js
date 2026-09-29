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
