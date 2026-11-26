import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    pageLoaders, pageInPlaylistTracks, loadMore, loadSection, loadSectionMore, hydrateSimilarArtists
} from '../src/components/controllers/page-loaders.js';
import { SpotifyApi } from '../src/api.js';
import {
    stubApi, makeHost, deferred, flush, placeholder, range,
    artist, album, track, playlistItem, playlistObj
} from './pageLoaderStubs.js';

// Each loader is driven with a recording stub api and a host that implements
// the loader ctx the way spotify-context-view does. For every page type:
// (a) the exact api calls, (b) the commits and the final page data,
// (c) what a failed read leaves behind (spotify-context-view turns an
// untouched placeholder into its "Couldn't load this page" state),
// (d) that a superseded load stops committing.

const LASTFM_URL = (name) => `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(name)}&api_key=KEY&format=json&limit=10`;
const shape = (commits) => commits.map(c => ({ ...c, patch: c.patch && Object.keys(c.patch) }));

/** Swap globalThis.fetch for the duration of a test (Last.fm). */
function stubFetch(t, answer) {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => { calls.push(url); return answer(url); };
    t.after(() => { globalThis.fetch = original; });
    return calls;
}
const lastFmOk = (names) => async () => ({ ok: true, json: async () => ({ similarartists: { artist: names.map(name => ({ name })) } }) });

// ---------------------------------------------------------------- playlist --

/** Pages of a playlist with `total` tracks, as getPlaylistItemsPage returns them. */
const itemsPage = (total) => (id, offset, limit) => ({ total, offset, limit, items: range(Math.max(0, Math.min(limit, total - offset)), playlistItem, offset) });

test('playlist we do not own: get_playlist, follow check, then the rest pages in 50 at a time', async () => {
    const pl = playlistObj('pbig', { total: 500 });
    const api = stubApi({
        'fetchSpotifyPlus:get_playlist': { result: pl, user_profile: { id: 'me' } },
        checkUserFollowsPlaylist: [false],
        getPlaylistItemsPage: itemsPage(500),
    });
    const host = makeHost({ pageId: 'playlist:pbig', type: 'playlist', id: 'pbig', api });

    const background = await pageLoaders.playlist(host.ctx);
    assert.equal(background, undefined);
    await flush();

    // (a)
    assert.deepEqual(api.calls, [
        ['fetchSpotifyPlus', 'get_playlist', { playlist_id: 'pbig' }],
        ['checkUserFollowsPlaylist', 'pbig', 'me'],
        ...[100, 150, 200, 250, 300, 350, 400, 450].map(offset => ['getPlaylistItemsPage', 'pbig', offset, 50]),
    ]);

    // (b) shown uncached, follow state settled, then cached; the pager's pages follow.
    const first = {
        ...pl, type: 'playlist', isLoading: false, hasMore: false, isOwner: false, canEditItems: false,
        followPending: true, snapshotId: 'snap', tracksComplete: false
    };
    assert.deepEqual(host.commits.slice(0, 3), [
        { patch: first, options: { cache: false }, applied: true },
        { patch: { canEditItems: false, followPending: false, isFollowing: false }, options: { cache: false }, applied: true },
        { patch: undefined, options: {}, applied: true },
    ]);
    const pages = host.commits.slice(3);
    assert.deepEqual(pages.map(c => [Object.keys(c.patch), c.patch.tracks.items.length, c.patch.tracksComplete, c.options]), [
        [['tracks', 'tracksComplete'], 150, false, {}], [['tracks', 'tracksComplete'], 200, false, {}],
        [['tracks', 'tracksComplete'], 250, false, {}], [['tracks', 'tracksComplete'], 300, false, {}],
        [['tracks', 'tracksComplete'], 350, false, {}], [['tracks', 'tracksComplete'], 400, false, {}],
        [['tracks', 'tracksComplete'], 450, false, {}], [['tracks', 'tracksComplete'], 500, true, {}],
    ]);
    assert.deepEqual(host.data, {
        ...placeholder('playlist', 'pbig'), ...pl, type: 'playlist', isLoading: false, hasMore: false,
        isOwner: false, canEditItems: false, followPending: false, snapshotId: 'snap', tracksComplete: true,
        isFollowing: false, tracks: { total: 500, items: range(500, playlistItem) }
    });
    assert.equal(host.cached, host.data);
    assert.deepEqual(host.user, { id: 'me', isFollowing: false });
});

test('playlist we own: no follow check, nothing to page in, autoEdit rides along', async () => {
    const pl = playlistObj('pown', { total: 30, owner: 'me' });
    const api = stubApi({ 'fetchSpotifyPlus:get_playlist': { result: pl, user_profile: { id: 'me' } } });
    const host = makeHost({ pageId: 'playlist:pown', type: 'playlist', id: 'pown', api, options: { autoEdit: true } });

    await pageLoaders.playlist(host.ctx);
    await flush();

    assert.deepEqual(api.calls, [['fetchSpotifyPlus', 'get_playlist', { playlist_id: 'pown' }]]);
    assert.deepEqual(host.commits, [
        {
            patch: {
                ...pl, type: 'playlist', isLoading: false, hasMore: false, isOwner: true, canEditItems: true,
                followPending: false, snapshotId: 'snap', tracksComplete: true, autoEdit: true
            },
            options: { cache: false }, applied: true
        },
        { patch: undefined, options: {}, applied: true },
    ]);
    assert.equal(host.cached, host.data);
    assert.equal(host.data.hasMore, false);
});

test('playlist: the user id comes from the response, else getCurrentUserId, and is kept once known', async () => {
    const pl = playlistObj('p1', { owner: 'me' });
    const api = stubApi({ 'fetchSpotifyPlus:get_playlist': { result: pl }, getCurrentUserId: 'me' });
    const host = makeHost({ pageId: 'playlist:p1', type: 'playlist', id: 'p1', api });
    await pageLoaders.playlist(host.ctx);
    assert.deepEqual(api.calls.map(c => c[0]), ['fetchSpotifyPlus', 'getCurrentUserId']);
    assert.equal(host.user.id, 'me');
    assert.equal(host.data.isOwner, true);

    // Known already: neither the response's profile nor a lookup is consulted.
    const api2 = stubApi({ 'fetchSpotifyPlus:get_playlist': { result: pl, user_profile: { id: 'other' } } });
    const host2 = makeHost({ pageId: 'playlist:p1', type: 'playlist', id: 'p1', api: api2, user: { id: 'me', isFollowing: false } });
    await pageLoaders.playlist(host2.ctx);
    assert.equal(host2.user.id, 'me');
    assert.equal(host2.data.isOwner, true);
});

test('playlist followed and collaborative: isFollowing true and edit rights', async () => {
    const pl = playlistObj('pc', { collaborative: true });
    const api = stubApi({ 'fetchSpotifyPlus:get_playlist': { result: pl, user_profile: { id: 'me' } }, checkUserFollowsPlaylist: [true] });
    const host = makeHost({ pageId: 'playlist:pc', type: 'playlist', id: 'pc', api });
    await pageLoaders.playlist(host.ctx);

    assert.deepEqual(host.commits[1].patch, { canEditItems: true, followPending: false, isFollowing: true });
    assert.equal(host.user.isFollowing, true);
    assert.equal(host.data.canEditItems, true);
    assert.equal(host.data.followPending, false);
});

test('playlist follow check with no answer: no isFollowing, edit rights from the last known answer', async () => {
    const pl = playlistObj('pc', { collaborative: true });
    const api = stubApi({ 'fetchSpotifyPlus:get_playlist': { result: pl, user_profile: { id: 'me' } }, checkUserFollowsPlaylist: null });
    const host = makeHost({ pageId: 'playlist:pc', type: 'playlist', id: 'pc', api, user: { id: 'me', isFollowing: true } });
    await pageLoaders.playlist(host.ctx);

    assert.deepEqual(host.commits[1].patch, { canEditItems: true, followPending: false });
    assert.equal('isFollowing' in host.data, false);
});

test('playlist read fails: nothing is committed, so the placeholder stays for the host to mark failed', async () => {
    const api = stubApi({ 'fetchSpotifyPlus:get_playlist': null });
    const host = makeHost({ pageId: 'playlist:pfail', type: 'playlist', id: 'pfail', api });
    const before = host.data;

    const background = await pageLoaders.playlist(host.ctx);
    await flush();

    assert.equal(background, undefined);
    assert.deepEqual(api.calls, [['fetchSpotifyPlus', 'get_playlist', { playlist_id: 'pfail' }]]);
    assert.deepEqual(host.commits, []);
    assert.equal(host.data, before);
    assert.equal(host.cached, undefined);
});

test('playlist superseded while get_playlist is in flight: no commit, no follow check, no pager', async () => {
    const gate = deferred();
    const api = stubApi({ 'fetchSpotifyPlus:get_playlist': () => gate.promise });
    const host = makeHost({ pageId: 'playlist:p9', type: 'playlist', id: 'p9', api });
    const before = host.data;

    const loading = pageLoaders.playlist(host.ctx);
    host.supersede();
    gate.resolve({ result: playlistObj('p9', { total: 300 }), user_profile: { id: 'me' } });
    await loading;
    await flush();

    assert.deepEqual(api.calls.map(c => c[0]), ['fetchSpotifyPlus']);
    assert.equal(host.applied.length, 0);
    assert.equal(host.data, before);
});

test('playlist superseded during the follow check: the follow answer is not committed or cached', async () => {
    const gate = deferred();
    const api = stubApi({
        'fetchSpotifyPlus:get_playlist': { result: playlistObj('p9', { total: 300 }), user_profile: { id: 'me' } },
        checkUserFollowsPlaylist: () => gate.promise,
    });
    const host = makeHost({ pageId: 'playlist:p9', type: 'playlist', id: 'p9', api });

    const loading = pageLoaders.playlist(host.ctx);
    await flush();
    assert.equal(host.applied.length, 1);
    host.supersede();
    gate.resolve([true]);
    await loading;
    await flush();

    assert.equal(host.applied.length, 1);
    assert.equal(host.cached, undefined);
    assert.equal(api.calls.some(c => c[0] === 'getPlaylistItemsPage'), false);
});

// ------------------------------------------------------------------ pager --

test('pager: total overstated, Spotify stops returning pages: tracksComplete is still set', async () => {
    const api = stubApi({ getPlaylistItemsPage: itemsPage(160) });
    const pl = playlistObj('ps', { total: 230 });
    const host = makeHost({ pageId: 'playlist:ps', type: 'playlist', id: 'ps', api, data: { ...pl, tracksComplete: false } });

    await pageInPlaylistTracks(host.ctx.claimPager());

    assert.deepEqual(api.calls, [
        ['getPlaylistItemsPage', 'ps', 100, 50], ['getPlaylistItemsPage', 'ps', 150, 50], ['getPlaylistItemsPage', 'ps', 160, 50],
    ]);
    assert.deepEqual(host.commits.map(c => [c.patch.tracks?.items.length, c.patch.tracksComplete]), [[150, false], [160, false], [undefined, true]]);
    assert.equal(host.cached, host.data);
});

test('pager: a newer pager supersedes the older one, which stops cold', async () => {
    const gates = [];
    const api = stubApi({ getPlaylistItemsPage: () => { const g = deferred(); gates.push(g); return g.promise; } });
    const pl = playlistObj('pb', { total: 300 });
    const host = makeHost({ pageId: 'playlist:pb', type: 'playlist', id: 'pb', api, data: { ...pl, tracksComplete: false } });

    const older = pageInPlaylistTracks(host.ctx.claimPager());
    const newer = pageInPlaylistTracks(host.ctx.claimPager());
    assert.equal(gates.length, 2);
    gates[0].resolve(itemsPage(300)('pb', 100, 50));
    await older;
    assert.deepEqual(host.commits, [], 'the older pager commits nothing once superseded');
    assert.equal(gates.length, 2, 'and asks for no further page');

    gates[1].resolve(itemsPage(300)('pb', 100, 50));
    await flush();
    assert.equal(host.applied.length, 1);
    assert.equal(host.data.tracks.items.length, 150);
    assert.equal(gates.length, 3);
    host.supersede();
    gates[2].resolve(itemsPage(300)('pb', 150, 50));
    await newer;
    assert.equal(host.applied.length, 1, 'refresh()/navigation stops it too');
});

test('pager: stops when the page on screen is another playlist', async () => {
    const gate = deferred();
    const api = stubApi({ getPlaylistItemsPage: () => gate.promise });
    const host = makeHost({ pageId: 'playlist:pa', type: 'playlist', id: 'pa', api, data: { ...playlistObj('pa', { total: 300 }), tracksComplete: false } });
    const paging = pageInPlaylistTracks(host.ctx.claimPager());
    host.data = { ...host.data, id: 'other' };
    gate.resolve(itemsPage(300)('pa', 100, 50));
    await paging;
    assert.deepEqual(host.commits, []);
});

// ------------------------------------------------------------------ album --

test('album: get_album, committed whole with hasMore false', async () => {
    const al = { ...album(1), tracks: { total: 2, items: [track(1), track(2)] } };
    const api = stubApi({ 'fetchSpotifyPlus:get_album': { result: al } });
    const host = makeHost({ pageId: 'album:al1', type: 'album', id: 'al1', api });

    await pageLoaders.album(host.ctx);

    assert.deepEqual(api.calls, [['fetchSpotifyPlus', 'get_album', { album_id: 'al1' }]]);
    assert.deepEqual(host.commits, [{ patch: { ...al, type: 'album', isLoading: false, hasMore: false }, options: {}, applied: true }]);
    assert.deepEqual(host.data, { ...placeholder('album', 'al1'), ...al, isLoading: false, hasMore: false });
    assert.equal(host.cached, host.data);
});

test('album without inline tracks: get_album_tracks fills them in', async () => {
    const api = stubApi({
        'fetchSpotifyPlus:get_album': { result: { ...album(1), tracks: { total: 0, items: [] } } },
        'fetchSpotifyPlus:get_album_tracks': { result: { items: [track(1)], total: 1 } },
    });
    const host = makeHost({ pageId: 'album:al1', type: 'album', id: 'al1', api });
    await pageLoaders.album(host.ctx);

    assert.deepEqual(api.calls, [
        ['fetchSpotifyPlus', 'get_album', { album_id: 'al1' }],
        ['fetchSpotifyPlus', 'get_album_tracks', { album_id: 'al1', limit: 50 }],
    ]);
    assert.deepEqual(host.data.tracks, { total: 1, items: [track(1)] });
});

test('album read fails: nothing committed (placeholder left for the host)', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    const api = stubApi({ 'fetchSpotifyPlus:get_album': null });
    const host = makeHost({ pageId: 'album:al1', type: 'album', id: 'al1', api });
    const before = host.data;
    await pageLoaders.album(host.ctx);
    assert.deepEqual(host.commits, []);
    assert.equal(host.data, before);
    assert.deepEqual(errors.mock.calls[0].arguments, ['[ContextView] Album Load Failed:', null]);
});

test('album superseded: the commit is refused', async () => {
    const gate = deferred();
    const api = stubApi({ 'fetchSpotifyPlus:get_album': () => gate.promise });
    const host = makeHost({ pageId: 'album:al1', type: 'album', id: 'al1', api });
    const loading = pageLoaders.album(host.ctx);
    host.supersede();
    gate.resolve({ result: { ...album(1), tracks: { items: [track(1)] } } });
    await loading;
    assert.equal(host.applied.length, 0);
});

// ----------------------------------------------------------------- artist --

function artistStub({ top = range(14, track), lastFm = false } = {}) {
    const d = { artist: deferred(), albums: deferred(), top: deferred(), playlists: deferred() };
    const api = stubApi({
        'fetchSpotifyPlus:get_artist': () => d.artist.promise,
        'fetchPaginated:get_artist_albums': () => d.albums.promise,
        'fetchSpotifyPlus:get_artist_top_tracks': () => d.top.promise,
        'fetchPaginated:search_tracks': { items: range(10, track, 200), total: 30, offset: 10 },
        searchPlaylists: () => d.playlists.promise,
        'fetchSpotifyPlus:search_artists': (params) => ({ result: { items: [{ ...artist(50), name: params.criteria }] } }),
    });
    return { api, d, top };
}

test('artist: all reads go out together; the artist, then each rail, commits as it lands', async (t) => {
    const fetches = stubFetch(t, lastFmOk(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']));
    const { api, d } = artistStub();
    const host = makeHost({ pageId: 'artist:ar1', type: 'artist', id: 'ar1', api, options: { lastFmApiKey: 'KEY' } });

    const loading = pageLoaders.artist(host.ctx);
    // (a) before anything answers
    assert.deepEqual(api.calls, [
        ['fetchSpotifyPlus', 'get_artist', { artist_id: 'ar1' }],
        ['fetchPaginated', 'get_artist_albums', { artist_id: 'ar1', include_groups: 'album,single' }, 10],
        ['fetchSpotifyPlus', 'get_artist_top_tracks', { artist_id: 'ar1' }],
    ]);

    d.artist.resolve({ result: artist(1) });
    assert.equal(await loading, undefined, 'rails are wired straight away once the artist is shown');
    await flush();
    assert.deepEqual(api.calls.slice(3, 4), [['searchPlaylists', 'Artist 1', 10]]);
    assert.deepEqual(fetches, [LASTFM_URL('Artist 1')]);
    // Hydration: six lookups, all in flight together, in Last.fm's order.
    assert.deepEqual(api.calls.slice(4), ['S0', 'S1', 'S2', 'S3', 'S4', 'S5'].map(n => ['fetchSpotifyPlus', 'search_artists', { criteria: n, limit: 1 }]));

    d.top.resolve({ result: range(14, track) });
    await flush();
    d.albums.resolve({ items: range(10, album), total: 23, offset: 10 });
    await flush();
    d.playlists.resolve({ result: { items: [{ id: 'p1' }] } });
    await flush();

    // (b) core first, then rails in the order they landed (similar artists
    // were already hydrated by the first flush).
    assert.deepEqual(host.commits.map(c => [Object.keys(c.patch).includes('name') ? 'artist' : Object.keys(c.patch)[0], c.options]), [
        ['artist', {}], ['similarArtists', {}], ['topTracks', {}], ['albums', {}], ['playlists', {}],
    ]);
    assert.deepEqual(host.commits[0].patch, { ...artist(1), isLoading: false });
    assert.deepEqual(host.data, {
        ...placeholder('artist', 'ar1'), ...artist(1), isLoading: false,
        similarArtists: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5'].map(n => ({ ...artist(50), name: n })),
        topTracks: range(12, track), albums: range(10, album), playlists: [{ id: 'p1' }],
    });
    assert.equal(host.cached, host.data);
});

test('artist: no Last.fm key: no fetch, similar artists [] right after the artist', async (t) => {
    const fetches = stubFetch(t, lastFmOk(['S0']));
    const { api, d } = artistStub();
    const host = makeHost({ pageId: 'artist:ar1', type: 'artist', id: 'ar1', api, options: {} });
    const loading = pageLoaders.artist(host.ctx);
    d.artist.resolve({ result: artist(1) });
    await loading;
    await flush();
    assert.deepEqual(fetches, []);
    assert.deepEqual(host.commits.map(c => Object.keys(c.patch)[0] === 'similarArtists' ? c.patch : 'x'), ['x', { similarArtists: [] }]);
});

test('artist: no top tracks: falls back to a 10-track search for the artist', async () => {
    const { api, d } = artistStub();
    const host = makeHost({ pageId: 'artist:ar1', type: 'artist', id: 'ar1', api, options: {} });
    const loading = pageLoaders.artist(host.ctx);
    d.top.resolve({ result: [] });
    d.artist.resolve({ result: artist(1) });
    await loading;
    await flush();
    assert.deepEqual(api.calls.find(c => c[1] === 'search_tracks'), ['fetchPaginated', 'search_tracks', { criteria: 'artist:"Artist 1"' }, 10]);
    assert.deepEqual(host.data.topTracks, range(10, track, 200));
});

test('artist: hydration lookups run concurrently and keep Last.fm order, dropping misses', async () => {
    const gates = new Map();
    const api = stubApi({ 'fetchSpotifyPlus:search_artists': (p) => { const g = deferred(); gates.set(p.criteria, g); return g.promise; } });
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(name => ({ name }));
    const result = hydrateSimilarArtists(api, names);
    assert.deepEqual([...gates.keys()], ['A', 'B', 'C', 'D', 'E', 'F'], 'six lookups in flight before any answers');
    for (const n of ['F', 'E', 'D', 'C', 'B']) gates.get(n).resolve({ result: { items: n === 'C' ? [] : [{ id: n }] } });
    gates.get('A').reject(new Error('down'));
    assert.deepEqual(await result, [{ id: 'B' }, { id: 'D' }, { id: 'E' }, { id: 'F' }]);
});

test('artist read fails: nothing committed before the host judges the load; the rails land afterwards', async () => {
    const { api, d } = artistStub();
    const host = makeHost({ pageId: 'artist:ar1', type: 'artist', id: 'ar1', api, options: {} });
    const before = host.data;

    const loading = pageLoaders.artist(host.ctx);
    // The rails answer first; the artist read then fails.
    d.albums.resolve({ items: range(10, album), total: 23, offset: 10 });
    d.top.resolve({ result: range(14, track) });
    await flush();
    d.artist.resolve(null);
    const background = await loading;
    await flush();

    // (c) the placeholder is untouched, so the host shows "Couldn't load this page".
    assert.equal(typeof background, 'function');
    assert.deepEqual(host.commits, []);
    assert.equal(host.data, before);

    // The host calls it after marking the failure; the rails then merge in.
    background();
    await flush();
    assert.deepEqual(host.commits.map(c => c.patch), [
        { albums: range(10, album) }, { topTracks: range(12, track) }, { similarArtists: [] }, { playlists: [] },
    ]);
    assert.equal(api.calls.some(c => c[0] === 'searchPlaylists'), false, 'no name, no playlist search');
});

test('artist superseded before the artist lands: no commits and no rails, even once they answer', async () => {
    const { api, d } = artistStub();
    const host = makeHost({ pageId: 'artist:ar1', type: 'artist', id: 'ar1', api, options: {} });
    const loading = pageLoaders.artist(host.ctx);
    host.supersede();
    d.artist.resolve({ result: artist(1) });
    d.albums.resolve({ items: [], total: 0, offset: 10 });
    d.top.resolve({ result: [] });
    assert.equal(await loading, undefined);
    await flush();
    assert.equal(host.applied.length, 0);
    assert.equal(api.calls.some(c => c[0] === 'searchPlaylists'), false);
});

test('artist superseded after the artist landed: later rails are refused', async () => {
    const { api, d } = artistStub();
    const host = makeHost({ pageId: 'artist:ar1', type: 'artist', id: 'ar1', api, options: {} });
    const loading = pageLoaders.artist(host.ctx);
    d.artist.resolve({ result: artist(1) });
    await loading;
    await flush();
    const applied = host.applied.length;
    host.supersede();
    d.albums.resolve({ items: range(3, album), total: 3, offset: 10 });
    d.top.resolve({ result: range(3, track) });
    d.playlists.resolve({ result: { items: [] } });
    await flush();
    assert.equal(host.applied.length, applied);
    assert.equal(host.data.albums, null);
});

// ---------------------------------------------------- artist discography --

const discographyApi = (extra = {}) => stubApi({
    'fetchPaginated:get_artist_albums': (params, n) => {
        const offset = params.offset || 0;
        return { items: range(Math.max(0, Math.min(n, 120 - offset)), album, offset), total: 120, offset: offset + n };
    },
    ...extra,
});

test('discography: replaces the placeholder with the first 50 releases, then loads more 50 at a time', async () => {
    const api = discographyApi();
    const host = makeHost({ pageId: 'artist-discography:ar1', type: 'artist-discography', id: 'ar1', api, options: { artistName: 'Artist 1' } });

    await pageLoaders['artist-discography'](host.ctx);
    const page1 = {
        id: 'ar1', type: 'artist-discography', name: 'Artist 1 Discography',
        items: range(50, album), total: 120, offset: 50, hasMore: true, isLoading: false
    };
    assert.deepEqual(host.commits, [{ patch: page1, options: { replace: true }, applied: true }]);
    assert.deepEqual(host.data, page1);
    assert.equal(host.cached, host.data);

    await loadMore(host.ctx);
    await loadMore(host.ctx);
    await loadMore(host.ctx); // nothing left: no call

    assert.deepEqual(api.calls, [
        ['fetchPaginated', 'get_artist_albums', { artist_id: 'ar1', include_groups: 'album,single,compilation' }, 50],
        ['fetchPaginated', 'get_artist_albums', { artist_id: 'ar1', include_groups: 'album,single,compilation', offset: 50 }, 50],
        ['fetchPaginated', 'get_artist_albums', { artist_id: 'ar1', include_groups: 'album,single,compilation', offset: 100 }, 50],
    ]);
    assert.deepEqual(shape(host.commits.slice(1)), [
        { patch: ['isLoading'], options: { cache: false }, applied: true },
        { patch: ['items', 'total', 'offset', 'hasMore', 'isLoading'], options: {}, applied: true },
        { patch: ['isLoading'], options: { cache: false }, applied: true },
        { patch: ['items', 'total', 'offset', 'hasMore', 'isLoading'], options: {}, applied: true },
    ]);
    assert.deepEqual(host.data, { ...page1, items: range(120, album), offset: 120, hasMore: false });
    assert.equal(host.cached, host.data);
});

test('discography without a name: get_artist first ("Artist" if that fails too)', async () => {
    const api = discographyApi({ 'fetchSpotifyPlus:get_artist': { result: artist(3) } });
    const host = makeHost({ pageId: 'artist-discography:ar3', type: 'artist-discography', id: 'ar3', api, options: {} });
    await pageLoaders['artist-discography'](host.ctx);
    assert.deepEqual(api.calls[0], ['fetchSpotifyPlus', 'get_artist', { artist_id: 'ar3' }]);
    assert.equal(host.data.name, 'Artist 3 Discography');

    const api2 = discographyApi({ 'fetchSpotifyPlus:get_artist': null });
    const host2 = makeHost({ pageId: 'artist-discography:ar3', type: 'artist-discography', id: 'ar3', api: api2, options: {} });
    await pageLoaders['artist-discography'](host2.ctx);
    assert.equal(host2.data.name, 'Artist Discography');
});

test('discography reads fail: an empty discography is committed (fetchPaginated never returns null)', async () => {
    const api = stubApi({ 'fetchSpotifyPlus:get_artist': null, 'fetchPaginated:get_artist_albums': { items: [], total: 0, offset: 50 } });
    const host = makeHost({ pageId: 'artist-discography:ar3', type: 'artist-discography', id: 'ar3', api, options: {} });
    await pageLoaders['artist-discography'](host.ctx);
    assert.deepEqual(host.data, { id: 'ar3', type: 'artist-discography', name: 'Artist Discography', items: [], total: 0, offset: 0, hasMore: false, isLoading: false });
});

test('discography load more: an empty page ends paging uncached; a throw only clears isLoading', async (t) => {
    t.mock.method(console, 'error', () => {});
    let mode = 'ok';
    const api = discographyApi();
    const original = api.fetchPaginated;
    api.fetchPaginated = (...a) => mode === 'ok' ? original(...a) : mode === 'empty' ? Promise.resolve({ items: [], total: 0, offset: 0 }) : Promise.reject(new Error('boom'));
    const host = makeHost({ pageId: 'artist-discography:ar1', type: 'artist-discography', id: 'ar1', api, options: { artistName: 'N' } });
    await pageLoaders['artist-discography'](host.ctx);
    const cached = host.cached;

    mode = 'throw';
    await loadMore(host.ctx);
    assert.deepEqual(host.commits.at(-1), { patch: { isLoading: false }, options: { cache: false }, applied: true });
    assert.equal(host.data.hasMore, true);

    mode = 'empty';
    await loadMore(host.ctx);
    assert.deepEqual(host.commits.at(-1), { patch: { isLoading: false, hasMore: false }, options: { cache: false }, applied: true });
    assert.equal(host.cached, cached, 'neither outcome is cached');
});

test('discography superseded: the first page is not committed', async () => {
    const gate = deferred();
    const api = stubApi({ 'fetchPaginated:get_artist_albums': () => gate.promise });
    const host = makeHost({ pageId: 'artist-discography:ar1', type: 'artist-discography', id: 'ar1', api, options: { artistName: 'N' } });
    const loading = pageLoaders['artist-discography'](host.ctx);
    host.supersede();
    gate.resolve({ items: [album(1)], total: 1, offset: 50 });
    await loading;
    assert.equal(host.applied.length, 0);
});

// ------------------------------------------------------------ liked songs --

const likedApi = (total, extra = {}) => stubApi({
    getTrackFavorites: ({ limit, offset }) => ({ result: { items: range(Math.max(0, Math.min(limit, total - offset)), playlistItem, offset), total } }),
    getCurrentUserId: 'uid9',
    ...extra,
});

test('liked songs: replaces the placeholder (uncached), then commits the first 50 with the playable URI', async () => {
    const api = likedApi(120);
    const host = makeHost({ pageId: 'likedsongs', type: 'likedsongs', id: 'me', api });
    await pageLoaders.likedsongs(host.ctx);

    assert.deepEqual(api.calls, [
        ['getTrackFavorites', { limit: 50, offset: 0, sort_result: false }],
        ['getCurrentUserId'],
    ]);
    const shell = {
        type: 'likedsongs', id: 'me', isLoading: true, name: 'Liked Songs',
        images: [{ url: 'https://t.scdn.co/images/3099b3803ad9496896c43f22fe9be8c4.png' }], tracks: null
    };
    const page = { tracks: { items: range(50, playlistItem), total: 120 }, total: 120, offset: 50, hasMore: true, isLoading: false, uri: 'spotify:user:uid9:collection' };
    assert.deepEqual(host.commits, [
        { patch: shell, options: { replace: true, cache: false }, applied: true },
        { patch: page, options: {}, applied: true },
    ]);
    assert.deepEqual(host.data, { ...shell, ...page });
    assert.equal(host.cached, host.data);

    // Load more appends to tracks.items, which the playlist view renders.
    await loadMore(host.ctx);
    await loadMore(host.ctx);
    await loadMore(host.ctx);
    assert.deepEqual(api.calls.slice(2), [
        ['getTrackFavorites', { limit: 50, offset: 50, sort_result: false }],
        ['getTrackFavorites', { limit: 50, offset: 100, sort_result: false }],
    ]);
    assert.deepEqual(host.data.tracks, { items: range(120, playlistItem), total: 120 });
    assert.equal(host.data.offset, 120);
    assert.equal(host.data.hasMore, false);
    assert.equal(host.cached, host.data);
});

test('liked songs without a user id: the `me` collection URI', async () => {
    const host = makeHost({ pageId: 'likedsongs', type: 'likedsongs', id: 'me', api: likedApi(3, { getCurrentUserId: null }) });
    await pageLoaders.likedsongs(host.ctx);
    assert.equal(host.data.uri, 'spotify:user:me:collection');
});

test('liked songs read fails (null): an empty, cached list, not the failed state', async () => {
    const api = stubApi({ getTrackFavorites: null, getCurrentUserId: 'uid9' });
    const host = makeHost({ pageId: 'likedsongs', type: 'likedsongs', id: 'me', api });
    const before = host.data;
    await pageLoaders.likedsongs(host.ctx);
    assert.notEqual(host.data, before);
    assert.deepEqual(host.data.tracks, { items: [], total: 0 });
    assert.equal(host.data.isLoading, false);
    assert.equal(host.cached, host.data);
});

test('liked songs read throws: logged, loading cleared, nothing cached', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    const api = stubApi({ getTrackFavorites: () => Promise.reject(new Error('kaboom')) });
    const host = makeHost({ pageId: 'likedsongs', type: 'likedsongs', id: 'me', api });
    await pageLoaders.likedsongs(host.ctx);
    assert.deepEqual(host.commits.at(-1), { patch: { isLoading: false, hasMore: false }, options: { cache: false }, applied: true });
    assert.equal(host.cached, undefined);
    assert.equal(errors.mock.calls[0].arguments[0], '[ContextView] Liked Songs load failed:');
});

test('liked songs superseded: the list is not committed', async () => {
    const gate = deferred();
    const api = stubApi({ getTrackFavorites: () => gate.promise, getCurrentUserId: 'uid9' });
    const host = makeHost({ pageId: 'likedsongs', type: 'likedsongs', id: 'me', api });
    const loading = pageLoaders.likedsongs(host.ctx);
    host.supersede();
    gate.resolve({ result: { items: [playlistItem(1)], total: 1 } });
    await loading;
    assert.equal(host.applied.length, 1, 'only the shell, committed before');
    assert.equal(host.cached, undefined);
});

test('liked songs load more superseded: nothing appended', async () => {
    const gate = deferred();
    const api = likedApi(120);
    const host = makeHost({ pageId: 'likedsongs', type: 'likedsongs', id: 'me', api });
    await pageLoaders.likedsongs(host.ctx);
    api.getTrackFavorites = () => gate.promise;
    const more = loadMore(host.ctx);
    host.supersede();
    gate.resolve({ result: { items: [playlistItem(99)], total: 120 } });
    await more;
    assert.equal(host.data.tracks.items.length, 50);
});

// ---------------------------------------------------------------- section --

test('section favorites: one page of 50, then load more appends the next', async () => {
    const api = stubApi({
        'fetchSpotifyPlus:get_playlist_favorites': (p) => ({ result: { items: range(Math.max(0, Math.min(p.limit, 70 - p.offset)), (i) => playlistObj(`p${i}`), p.offset), total: 70 } }),
    });
    const host = makeHost({ pageId: 'section:favorites', type: 'section', id: 'favorites', api });
    await pageLoaders.section(host.ctx);

    assert.deepEqual(api.calls, [['fetchSpotifyPlus', 'get_playlist_favorites', { limit: 50, offset: 0, sort_result: false }]]);
    assert.deepEqual(host.commits, [{
        patch: {
            isLoading: false, name: 'Your Favorite Playlists', items: range(50, (i) => playlistObj(`p${i}`)),
            offset: 50, total: 70, hasMore: true, _lastFetchCount: 50, nextCursor: null
        },
        options: {}, applied: true
    }]);

    await loadSectionMore(host.ctx);
    assert.deepEqual(api.calls[1], ['fetchSpotifyPlus', 'get_playlist_favorites', { limit: 50, offset: 50, sort_result: false }]);
    assert.deepEqual(shape(host.commits.slice(1)), [
        { patch: ['isLoading'], options: { cache: false }, applied: true },
        { patch: ['isLoading', 'name', 'items', 'offset', 'total', 'hasMore', '_lastFetchCount', 'nextCursor'], options: {}, applied: true },
    ]);
    assert.equal(host.data.items.length, 70);
    assert.equal(host.data.hasMore, false);
    assert.equal(host.cached, host.data);
});

test('section artists: pages of 15 by cursor (the last artist id)', async () => {
    const all = range(33, artist, 1);
    const api = stubApi({
        'fetchSpotifyPlus:get_artists_followed': (p) => {
            const start = p.after ? all.findIndex(a => a.id === p.after) + 1 : 0;
            return { result: { artists: { items: all.slice(start, start + p.limit), total: all.length } } };
        },
    });
    const host = makeHost({ pageId: 'section:artists', type: 'section', id: 'artists', api });
    await pageLoaders.section(host.ctx);
    await loadSectionMore(host.ctx);
    await loadSectionMore(host.ctx);
    await loadSectionMore(host.ctx);

    assert.deepEqual(api.calls, [
        ['fetchSpotifyPlus', 'get_artists_followed', { limit: 15, sort_result: false }],
        ['fetchSpotifyPlus', 'get_artists_followed', { limit: 15, sort_result: false, after: 'ar15' }],
        ['fetchSpotifyPlus', 'get_artists_followed', { limit: 15, sort_result: false, after: 'ar30' }],
    ]);
    assert.equal(host.data.name, 'Followed Artists');
    assert.deepEqual(host.data.items, all);
    assert.equal(host.data.hasMore, false);
    assert.equal(host.data.nextCursor, null);
});

test('section recent: one page, collapsed to unique albums', async () => {
    const api = stubApi({ 'fetchSpotifyPlus:get_player_recent_tracks': { result: { items: [{ track: track(1) }, { track: track(14) }, { track: track(2) }] } } });
    const host = makeHost({ pageId: 'section:recent', type: 'section', id: 'recent', api });
    await pageLoaders.section(host.ctx);
    assert.deepEqual(api.calls, [['fetchSpotifyPlus', 'get_player_recent_tracks', { limit: 50 }]]);
    assert.deepEqual(host.data.items.map(i => i.id), ['al1', 'al2']);
    assert.equal(host.data.total, 2);
    assert.equal(host.data.hasMore, false);
});

test('section albums: saved-album wrappers unwrapped', async () => {
    const api = stubApi({ 'fetchSpotifyPlus:get_album_favorites': { result: { items: [{ album: album(1) }, {}, { album: album(2) }], total: 3 } } });
    const host = makeHost({ pageId: 'section:albums', type: 'section', id: 'albums', api });
    await pageLoaders.section(host.ctx);
    assert.deepEqual(api.calls, [['fetchSpotifyPlus', 'get_album_favorites', { limit: 50, offset: 0 }]]);
    assert.deepEqual(host.data.items, [album(1), album(2)]);
});

test('section read fails (null): an empty section is committed, not the failed state', async () => {
    const api = stubApi({ 'fetchSpotifyPlus:get_playlist_favorites': null });
    const host = makeHost({ pageId: 'section:favorites', type: 'section', id: 'favorites', api });
    await pageLoaders.section(host.ctx);
    assert.deepEqual(host.commits, [{
        patch: { isLoading: false, name: 'Your Favorite Playlists', items: [], offset: 0, total: null, hasMore: false, _lastFetchCount: 0, nextCursor: null },
        options: {}, applied: true
    }]);
});

test('section read throws: logged, loading cleared uncached', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    const api = stubApi({ 'fetchSpotifyPlus:get_playlist_favorites': () => Promise.reject(new Error('nope')) });
    const host = makeHost({ pageId: 'section:favorites', type: 'section', id: 'favorites', api });
    await loadSection(host.ctx, 'favorites', 0);
    assert.deepEqual(host.commits, [{ patch: { isLoading: false, hasMore: false }, options: { cache: false }, applied: true }]);
    assert.equal(errors.mock.calls[0].arguments[0], 'Error loading section data:');
});

test('section superseded: the page is not committed', async () => {
    const gate = deferred();
    const api = stubApi({ 'fetchSpotifyPlus:get_playlist_favorites': () => gate.promise });
    const host = makeHost({ pageId: 'section:favorites', type: 'section', id: 'favorites', api });
    const loading = pageLoaders.section(host.ctx);
    host.supersede();
    gate.resolve({ result: { items: [playlistObj('p1')], total: 1 } });
    await loading;
    assert.equal(host.applied.length, 0);
});

test('load more does nothing while loading, without more, or once superseded', async () => {
    const api = stubApi({});
    for (const data of [{ type: 'likedsongs', isLoading: true, hasMore: true }, { type: 'likedsongs', hasMore: false }]) {
        const host = makeHost({ pageId: 'likedsongs', api, data });
        await loadMore(host.ctx);
        await loadSectionMore(host.ctx);
        assert.deepEqual(host.commits, []);
    }
    const host = makeHost({ pageId: 'likedsongs', api, data: { type: 'likedsongs', hasMore: true } });
    host.supersede();
    await loadMore(host.ctx);
    assert.equal(host.applied.length, 0);
    assert.deepEqual(api.calls, []);
});

// ------------------------------------------- SpotifyPlus calls per page open --

/** The real SpotifyApi on a fake hass, counting SpotifyPlus services as the browser harness does. */
function realApi(respond) {
    const services = [];
    const hass = {
        callWS: async ({ service, service_data }) => {
            services.push(service);
            await new Promise(r => setTimeout(r, 1));
            return { response: respond(service, service_data) };
        },
    };
    return { api: new SpotifyApi(hass, 'media_player.test'), services };
}
const countBy = (list) => list.reduce((o, s) => ({ ...o, [s]: (o[s] || 0) + 1 }), {});
/** Wait until no SpotifyPlus call has gone out for a while. */
async function settle(services) {
    let seen = -1;
    while (seen !== services.length) { seen = services.length; await new Promise(r => setTimeout(r, 30)); }
}

test('500-track playlist page open: get_playlist x1, check_playlist_followers x1, get_playlist_items x8', async () => {
    const { api, services } = realApi((service, d) => {
        if (service === 'get_playlist') return { result: playlistObj('pbig', { total: 500 }), user_profile: { id: 'me' } };
        if (service === 'check_playlist_followers') return { result: [false] };
        if (service === 'get_playlist_items') return { result: itemsPage(500)(d.playlist_id, d.offset, d.limit) };
        throw new Error('unexpected ' + service);
    });
    const host = makeHost({ pageId: 'playlist:pbig', type: 'playlist', id: 'pbig', api });
    await pageLoaders.playlist(host.ctx);
    await settle(services);
    assert.deepEqual(countBy(services), { get_playlist: 1, check_playlist_followers: 1, get_playlist_items: 8 });
    assert.equal(host.data.tracks.items.length, 500);
    assert.equal(host.data.tracksComplete, true);
});

test('artist page open: get_artist, get_artist_albums, get_artist_top_tracks, search_playlists x1 each', async () => {
    const { api, services } = realApi((service, d) => {
        if (service === 'get_artist') return { result: artist(1) };
        if (service === 'get_artist_albums') return { result: { items: range(d.limit, album, d.offset), total: 23 } };
        if (service === 'get_artist_top_tracks') return { result: range(10, track) };
        if (service === 'search_playlists') return { result: { items: range(Math.min(d.limit, 11 - d.offset), (i) => playlistObj(`p${i}`), d.offset), total: 11 } };
        throw new Error('unexpected ' + service);
    });
    const host = makeHost({ pageId: 'artist:ar1', type: 'artist', id: 'ar1', api, options: {} });
    await pageLoaders.artist(host.ctx);
    await settle(services);
    assert.deepEqual(countBy(services), { get_artist: 1, get_artist_albums: 1, get_artist_top_tracks: 1, search_playlists: 1 });
    assert.equal(host.data.albums.length, 10);
});
