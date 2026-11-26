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

// ------------------------------------------------ B9: hass ticks mid-load --

/** What Lit hands updated() on a hass change (the ones shouldUpdate lets through). */
const hassTick = (view, n = 1) => { for (let i = 0; i < n; i++) view.updated(new Map([['hass', {}]])); };
const countCalls = (api, method, service) => api.calls.filter(c => c[0] === method && (!service || c[1] === service)).length;

test('the first load starts as soon as pageId, hass and api are all there', async () => {
    const api = stubApi({ getTrackFavorites: { result: { items: [], total: 0 } }, getCurrentUserId: 'u' });
    const view = new SpotifyContextView();
    view.pageId = 'likedsongs';
    view.updated(new Map([['pageId', undefined]]));
    view.hass = {};
    view.updated(new Map([['hass', undefined]]));
    assert.equal(api.calls.length, 0, 'no api yet: nothing');
    view.api = api;
    view.updated(new Map([['api', undefined]]));
    assert.equal(countCalls(api, 'getTrackFavorites'), 1);
    assert.equal(view._contextData.name, 'Liked Songs');
});

test('Liked Songs: hass ticks while its first read is in flight start no second load (B9)', async () => {
    const read = deferred();
    const api = stubApi({ getTrackFavorites: () => read.promise, getCurrentUserId: 'u' });
    const view = makeView('likedsongs', api);
    view.updated(new Map([['pageId', undefined]]));
    await flush();
    assert.equal(view._contextData.isLoading, true, 'the shell is up');
    hassTick(view, 5);
    await flush();
    assert.equal(countCalls(api, 'getTrackFavorites'), 1);

    read.resolve({ result: { items: [playlistItem(1)], total: 1 } });
    await view.loadPageData(); // the load in flight
    assert.equal(view._contextData.isLoading, false);
    assert.equal(view._contextData.tracks.items.length, 1);
    assert.equal(SpotifyContextView.stateCache.get('likedsongs'), view._contextData);
    assert.equal(countCalls(api, 'getTrackFavorites'), 1);
    assert.equal(view._pendingLoad, null);
});

test('a page on its loading placeholder: hass ticks start no second load, and an edit intent arriving meanwhile is kept (B9)', async () => {
    const read = deferred();
    const api = stubApi({
        'fetchSpotifyPlus:get_playlist': () => read.promise,
        checkUserFollowsPlaylist: [false],
    });
    const view = makeView('playlist:p1', api);
    view.updated(new Map([['pageId', undefined]]));
    assert.equal(view._contextData.name, 'Loading...');
    hassTick(view, 3);
    view.data = { autoEdit: true }; // the library's "Edit Playlist" on this page while it loads
    hassTick(view);
    assert.equal(view.data.autoEdit, false, 'the intent is consumed');
    read.resolve({ result: playlistObj('p1'), user_profile: { id: 'me' } });
    await view.loadPageData();
    assert.equal(countCalls(api, 'fetchSpotifyPlus', 'get_playlist'), 1);
    assert.equal(view._contextData.autoEdit, true, 'carried by the load in flight');
    assert.equal(view._contextData.isLoading, false);
});

test('a page whose read fails while hass ticks: one read, then the failed state (retried on return, as before) (B9)', async () => {
    const read = deferred();
    const api = stubApi({ 'fetchSpotifyPlus:get_playlist': () => read.promise });
    const view = makeView('playlist:p1', api);
    view.updated(new Map([['pageId', undefined]]));
    hassTick(view, 3);
    read.resolve(null);
    await view.loadPageData();
    await flush();
    assert.equal(view._contextData.loadFailed, true);
    assert.equal(countCalls(api, 'fetchSpotifyPlus', 'get_playlist'), 1);
});

test('a refresh while the first load is in flight starts a new one; the old answer is dropped', async () => {
    const reads = [deferred(), deferred()];
    let n = 0;
    const api = stubApi({ getTrackFavorites: () => reads[n++].promise, getCurrentUserId: 'u' });
    const view = makeView('likedsongs', api);
    const first = view.loadPageData();
    await flush();
    const second = view.refresh();
    await flush();
    assert.equal(countCalls(api, 'getTrackFavorites'), 2);
    hassTick(view, 3);
    assert.equal(countCalls(api, 'getTrackFavorites'), 2, 'ticks start nothing beside the refresh');
    reads[0].resolve({ result: { items: [playlistItem(1)], total: 1 } });
    reads[1].resolve({ result: { items: [playlistItem(2), playlistItem(3)], total: 2 } });
    await Promise.all([first, second]);
    assert.deepEqual(view._contextData.tracks.items, [playlistItem(2), playlistItem(3)]);
});

test('hass ticks during a load more: no cache restore, no second load more, no duplicated tracks (B9)', async () => {
    const more = deferred();
    const api = stubApi({
        getTrackFavorites: ({ offset }) => (offset === 0
            ? { result: { items: range(50, playlistItem), total: 120 } }
            : more.promise),
        getCurrentUserId: 'u',
    });
    const view = makeView('likedsongs', api);
    await view.loadPageData();
    const loading = view._handleLoadMore();
    assert.equal(view._contextData.isLoading, true);
    hassTick(view, 3);
    assert.equal(view._contextData.isLoading, true, 'still loading more: the cached page (isLoading false) is not put back');
    await view._handleLoadMore(); // the view scrolls on: refused while one is under way
    assert.deepEqual(api.calls.filter(c => c[0] === 'getTrackFavorites').map(c => c[1].offset), [0, 50]);

    more.resolve({ result: { items: range(50, playlistItem, 50), total: 120 } });
    await loading;
    assert.deepEqual(view._contextData.tracks.items, range(100, playlistItem));
    assert.equal(view._contextData.offset, 100);
});

// ---------------------------------------- B13: a failed artist albums rail --

test('artist page whose albums rail fails: shown as failed, not cached (and an earlier entry dropped)', async () => {
    const albums = deferred();
    const api = stubApi({
        'fetchSpotifyPlus:get_artist': { result: { id: 'ar1', name: 'Artist 1', type: 'artist' } },
        'fetchPaginated:get_artist_albums': () => albums.promise,
        'fetchSpotifyPlus:get_artist_top_tracks': { result: [] },
        'fetchPaginated:search_tracks': { items: [], total: 0, offset: 10 },
        searchPlaylists: { result: { items: [] } },
    });
    const view = makeView('artist:ar1', api);
    await view.loadPageData();
    await flush();
    assert.ok(SpotifyContextView.stateCache.has('artist:ar1'), 'cached as the artist and rails land');

    albums.resolve({ items: [], total: 0, offset: 10, failed: true });
    await flush();
    assert.deepEqual(view._contextData.albums, []);
    assert.equal(view._contextData.albumsFailed, true);
    assert.equal(SpotifyContextView.stateCache.has('artist:ar1'), false);

    // A new instance of the page (the router evicted this one) reads it again.
    const again = makeView('artist:ar1', api);
    const before = countCalls(api, 'fetchSpotifyPlus', 'get_artist');
    await again.loadPageData();
    assert.equal(countCalls(api, 'fetchSpotifyPlus', 'get_artist'), before + 1);
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
