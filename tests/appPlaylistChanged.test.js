import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definedElement } from './helpers/elements.js';
import '../src/spotify-browser-app.js';
import { SpotifyContextView } from '../src/components/spotify-context-view.js';

// The app root's side of the playlist actions: what a `playlist-changed`
// does (B14: follow / unfollow only update the library list) and the
// reorder dialog's add-by-URI pin (D2: the eviction toast). A bare app
// instance (not rendered) with a stub router, library and pinned manager.

const App = definedElement('spotify-browser-app');

function makeApp({ currentPageId = 'home', history = ['home'] } = {}) {
    const log = [];
    const library = { playlistChanged: (d) => log.push(['library.playlistChanged', d]) };
    const playlistPage = { refresh: (patch) => log.push(['page.refresh', patch]) };
    const home = { pinned: {}, fetchSectionData: (s) => log.push(['home.fetchSectionData', s]) };
    const app = Object.create(App.prototype);
    app.router = {
        currentPageId,
        history,
        pageCache: new Map([['library', library], ['playlist:p1', playlistPage], ['home', home]]),
        goBack: () => log.push(['router.goBack']),
        resetToHome: () => log.push(['router.resetToHome']),
        dropPage: (id) => log.push(['router.dropPage', id]),
    };
    app.pinnedManager = {
        remove: async (id) => { log.push(['pinned.remove', id]); return { success: true }; },
        getItems: async () => [],
    };
    app._toast = (message) => { log.push(['toast', message]); return true; };
    app._alert = (opts) => { log.push(['alert', opts.title, opts.message]); return true; };
    return { app, log };
}

const changed = (detail) => ({ detail });

test('follow and unfollow only update the library list: no cache drop, no page refresh, no navigation, no unpin', async () => {
    for (const action of ['follow', 'unfollow']) {
        const { app, log } = makeApp({ currentPageId: 'playlist:p1', history: ['home', 'library'] });
        SpotifyContextView.cacheSet('playlist:p1', { id: 'p1', type: 'playlist' });
        const detail = { playlistId: 'p1', action };
        await app._handlePlaylistChanged(changed(detail));
        assert.deepEqual(log, [['library.playlistChanged', detail]], action);
        assert.equal(SpotifyContextView.stateCache.has('playlist:p1'), true, 'the playlist page stays cached');
        SpotifyContextView.invalidate('playlist:p1');
    }
});

test('follow / unfollow with no library page yet: nothing happens', async () => {
    const { app, log } = makeApp();
    app.router.pageCache.delete('library');
    await app._handlePlaylistChanged(changed({ playlistId: 'p1', action: 'unfollow' }));
    assert.deepEqual(log, []);
});

test('delete is unchanged: leaves the page, drops it, unpins it, then the library and Home\'s pins update', async () => {
    const { app, log } = makeApp({ currentPageId: 'playlist:p1', history: ['home', 'library'] });
    SpotifyContextView.cacheSet('playlist:p1', { id: 'p1', type: 'playlist' });
    const detail = { playlistId: 'p1', action: 'delete' };
    await app._handlePlaylistChanged(changed(detail));
    assert.equal(SpotifyContextView.stateCache.has('playlist:p1'), false);
    assert.deepEqual(log, [
        ['router.goBack'],
        ['router.dropPage', 'playlist:p1'],
        ['pinned.remove', 'p1'],
        ['home.fetchSectionData', 'pinned'],   // _handlePinnedChanged
        ['library.playlistChanged', detail],
        ['home.fetchSectionData', 'pinned'],
    ]);
});

test('an edit patch goes to the cached page and to the library (which patches its rows)', async () => {
    const { app, log } = makeApp();
    SpotifyContextView.cacheSet('playlist:p1', { id: 'p1', type: 'playlist' });
    const detail = { playlistId: 'p1', action: 'edit', patch: { public: false, collaborative: false } };
    await app._handlePlaylistChanged(changed(detail));
    assert.equal(SpotifyContextView.stateCache.has('playlist:p1'), false);
    assert.deepEqual(log, [['page.refresh', detail.patch], ['library.playlistChanged', detail]]);
});

test('items and create reach the library too; create refreshes Home\'s pins', async () => {
    const { app, log } = makeApp();
    await app._handlePlaylistChanged(changed({ playlistId: 'p1', action: 'items' }));
    await app._handlePlaylistChanged(changed({ playlistId: 'p9', action: 'create' }));
    assert.deepEqual(log, [
        ['page.refresh', null], ['library.playlistChanged', { playlistId: 'p1', action: 'items' }],
        ['library.playlistChanged', { playlistId: 'p9', action: 'create' }], ['home.fetchSectionData', 'pinned'],
    ]);
});

test('no playlist id: nothing happens', async () => {
    const { app, log } = makeApp();
    await app._handlePlaylistChanged(changed({ action: 'follow' }));
    await app._handlePlaylistChanged({});
    assert.deepEqual(log, []);
});

test('add by URI on a full list (D2): pinned, then "Removed <name> to make room"', async () => {
    const { app, log } = makeApp();
    app.api = {};
    app.pinnedManager.addByUri = async (api, uri) => {
        log.push(['pinned.addByUri', uri]);
        return { success: true, evicted: { id: 'old', name: 'Old Mix', title: 'Old Mix' } };
    };
    await app._handleAddCustomUri({ detail: 'spotify:album:al1' });
    assert.deepEqual(log.filter(l => l[0] !== 'home.fetchSectionData'), [
        ['toast', 'Fetching item details...'],
        ['pinned.addByUri', 'spotify:album:al1'],
        ['toast', 'Item pinned successfully'],
        ['toast', 'Removed Old Mix to make room'],
    ]);
});

test('add by URI with room to spare: no eviction toast; a failure is an alert', async () => {
    const { app, log } = makeApp();
    app.api = {};
    app.pinnedManager.addByUri = async () => ({ success: true });
    await app._handleAddCustomUri({ detail: 'spotify:album:al1' });
    assert.deepEqual(log.filter(l => l[0] === 'toast'), [['toast', 'Fetching item details...'], ['toast', 'Item pinned successfully']]);

    const failed = makeApp();
    failed.app.api = {};
    failed.app.pinnedManager.addByUri = async () => ({ success: false, error: 'Already pinned' });
    const realError = console.error;
    console.error = () => {};
    try {
        await failed.app._handleAddCustomUri({ detail: 'spotify:album:al1' });
    } finally {
        console.error = realError;
    }
    assert.deepEqual(failed.log, [['toast', 'Fetching item details...'], ['alert', 'Failed to add item', 'Already pinned']]);
});
