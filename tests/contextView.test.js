// The real <spotify-context-view> as a loader host: how loads, refreshes and
// the playlist pager interact on one page (page-loaders.test.js drives the
// loaders against a stand-in host). The element is never connected, so Lit
// never renders it; the methods under test run as the app would call them.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/lit-env.js';
import { stubApi, deferred, flush, playlistObj, playlistItem, range } from './pageLoaderStubs.js';
import { LOAD_FAILED } from '../src/components/controllers/page-loaders.js';

globalThis.customElements ??= { define() {}, get() {} };
const { SpotifyContextView } = await import('../src/components/spotify-context-view.js');

beforeEach(() => SpotifyContextView.clearAll());

function makeView(pageId, api) {
    const view = new SpotifyContextView();
    view.pageId = pageId;
    view.hass = {};
    view.api = api;
    return view;
}

/** getPlaylistItemsPage answers for a playlist of `total` tracks. */
const itemsPage = (total) => (id, offset, limit) => ({ total, offset, limit, items: range(Math.max(0, Math.min(limit, total - offset)), playlistItem, offset) });

test('a refresh while a load waits on its follow check: the old check landing cannot keep the page from its failed state', async () => {
    const reads = [deferred(), deferred()];
    const follow = deferred();
    let n = 0;
    const api = stubApi({
        'fetchSpotifyPlus:get_playlist': () => reads[n++].promise,
        checkUserFollowsPlaylist: () => follow.promise,
    });
    const view = makeView('playlist:p1', api);

    const first = view.loadPageData();
    reads[0].resolve({ result: playlistObj('p1'), user_profile: { id: 'me' } });
    await flush(); // shown; now waiting on the follow check
    assert.equal(view._contextData.followPending, true);

    const second = view.refresh(); // its get_playlist is in flight
    follow.resolve([true]);        // the first load's follow check lands first...
    await flush();
    reads[1].resolve(null);        // ...then the refresh's read fails
    await Promise.all([first, second]);
    await flush();

    assert.equal(view._contextData.isLoading, false);
    assert.equal(view._contextData.loadFailed, true);
    assert.equal(view._contextData.name, "Couldn't load this page");
    assert.equal('isFollowing' in view._contextData, false, 'nothing of the superseded load is merged in');
    assert.equal(SpotifyContextView.stateCache.has('playlist:p1'), false, 'no loading or failed page is cached');
});

test('a refresh whose follow check returns nothing: no edit rights from the previous answer', async () => {
    const answers = [[true], null];
    const api = stubApi({
        'fetchSpotifyPlus:get_playlist': { result: playlistObj('pc', { collaborative: true }), user_profile: { id: 'me' } },
        checkUserFollowsPlaylist: () => answers.shift(),
    });
    const view = makeView('playlist:pc', api);
    await view.loadPageData();
    assert.equal(view._contextData.canEditItems, true);
    assert.equal(view._contextData.isFollowing, true);

    await view.refresh();
    assert.equal(view._contextData.canEditItems, false);
    assert.equal('isFollowing' in view._contextData, false);
    assert.equal(view._contextData.followPending, false);
});

test('two instances of one half-loaded playlist: only the newest pages it', async () => {
    const gates = [];
    const api = stubApi({
        'fetchSpotifyPlus:get_playlist': { result: playlistObj('pbig', { total: 300 }), user_profile: { id: 'me' } },
        checkUserFollowsPlaylist: [false],
        getPlaylistItemsPage: (...a) => { const g = deferred(); gates.push({ args: a, g }); return g.promise; },
    });
    // The first instance loads and starts paging (offset 100 in flight).
    const a = makeView('playlist:pbig', api);
    await a.loadPageData();
    await flush();
    assert.deepEqual(gates.map(x => x.args[1]), [100]);

    // The router evicts it and later builds a new one for the same page: it
    // restores the cached half-loaded playlist and resumes the paging.
    const b = makeView('playlist:pbig', api);
    await b.loadPageData();
    assert.deepEqual(gates.map(x => x.args[1]), [100, 100]);

    // The evicted instance's page lands: it stops there, asking for no more.
    gates[0].g.resolve(itemsPage(300)('pbig', 100, 50));
    await flush();
    assert.deepEqual(gates.map(x => x.args[1]), [100, 100]);
    assert.equal(a._contextData.tracks.items.length, 100);

    // The new instance pages the rest, alone.
    for (let i = 1; i < gates.length; i++) {
        const [, offset, limit] = gates[i].args;
        gates[i].g.resolve(itemsPage(300)('pbig', offset, limit));
        await flush();
    }
    assert.deepEqual(gates.map(x => x.args[1]), [100, 100, 150, 200, 250]);
    assert.equal(b._contextData.tracks.items.length, 300);
    assert.equal(b._contextData.tracksComplete, true);
    assert.equal(SpotifyContextView.stateCache.get('playlist:pbig'), b._contextData);
});

test('clearAll (account switch) stops a running pager: it cannot put the old page back in the cache', async () => {
    const gate = deferred();
    const api = stubApi({
        'fetchSpotifyPlus:get_playlist': { result: playlistObj('pbig', { total: 300 }), user_profile: { id: 'me' } },
        checkUserFollowsPlaylist: [false],
        getPlaylistItemsPage: () => gate.promise,
    });
    const view = makeView('playlist:pbig', api);
    await view.loadPageData();
    await flush();
    SpotifyContextView.clearAll();
    gate.resolve(itemsPage(300)('pbig', 100, 50));
    await flush();
    assert.equal(SpotifyContextView.stateCache.has('playlist:pbig'), false);
    assert.equal(api.calls.filter(c => c[0] === 'getPlaylistItemsPage').length, 1);
});

test('Liked Songs, a section and a discography whose read fails: failed state, not cached, retried on return', async () => {
    const cases = [
        ['likedsongs', { getTrackFavorites: null, getCurrentUserId: 'u' },
            { getTrackFavorites: { result: { items: [playlistItem(1)], total: 1 } }, getCurrentUserId: 'u' }],
        ['section:favorites', { 'fetchSpotifyPlus:get_playlist_favorites': null },
            { 'fetchSpotifyPlus:get_playlist_favorites': { result: { items: [playlistObj('p1')], total: 1 } } }],
        ['artist-discography:ar1', { 'fetchSpotifyPlus:get_artist': null, 'fetchPaginated:get_artist_albums': { items: [], total: 0, offset: 50, failed: true } },
            { 'fetchSpotifyPlus:get_artist': null, 'fetchPaginated:get_artist_albums': { items: [{ id: 'al1' }], total: 1, offset: 50 } }],
    ];
    for (const [pageId, failing, working] of cases) {
        let answers = failing;
        const api = stubApi(new Proxy({}, {
            has: (_, key) => key in answers,
            get: (_, key) => answers[key],
        }));
        const view = makeView(pageId, api);
        await view.loadPageData();
        assert.equal(view._contextData.loadFailed, true, pageId);
        assert.equal(view._contextData.isLoading, false, pageId);
        assert.equal(view._contextData.name, LOAD_FAILED.name, pageId);
        assert.equal(SpotifyContextView.stateCache.has(pageId), false, `${pageId}: not cached`);

        // Not re-run on every hass tick (as loadPageData is called on them)...
        const calls = api.calls.length;
        await view.loadPageData();
        assert.equal(api.calls.length, calls, `${pageId}: no re-read until the page is shown again`);

        // ...but shown again (the app calls updateHeaderState on return), it retries.
        answers = working;
        view.updateHeaderState();
        for (let i = 0; i < 3; i++) await flush();
        assert.equal(view._contextData.loadFailed, undefined, pageId);
        assert.equal(view._contextData.isLoading, false, pageId);
        assert.equal(SpotifyContextView.stateCache.get(pageId), view._contextData, `${pageId}: the working page is cached`);
    }
});

test('the user id is a plain field: setting it does not ask for a render', async () => {
    const view = makeView('playlist:p1', stubApi({}));
    let requests = 0;
    view.requestUpdate = () => { requests++; };
    view._loadContext('playlist:p1').user.id = 'me';
    assert.equal(view._currentUserId, 'me');
    assert.equal(requests, 0);
    assert.equal('_currentUserId' in SpotifyContextView.properties, false);
    assert.equal('_isFollowing' in SpotifyContextView.properties, false);
});
