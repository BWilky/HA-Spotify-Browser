// SpotifyApi's library & catalog read methods (getSavedPlaylists, getArtist,
// ...): which SpotifyPlus call each makes, how it unwraps every response
// shape, what it answers on failure. Then a characterization of the call
// sites they replaced (S7 in docs/TODO.md): each site's old hand-unwrap,
// copied from before the change, against what the site now gets from the
// method, over the same responses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpotifyApi } from '../src/api.js';

const ENTITY = 'media_player.spotifyplus_test';
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** A real SpotifyApi over a Home Assistant stand-in: `respond(payload)` is the service response; throwing fails the call. */
function makeApi(respond) {
    const calls = [];
    const hass = {
        callWS: async (payload) => {
            calls.push(payload);
            return { response: respond(payload) };
        }
    };
    return { api: new SpotifyApi(hass, ENTITY), calls };
}

/** An api whose fetchSpotifyPlus answers `res` itself (any shape, null for a failed read). */
function answering(res) {
    const calls = [];
    const api = Object.assign(Object.create(SpotifyApi.prototype), {
        async fetchSpotifyPlus(service, params) { calls.push([service, params]); return clone(res); }
    });
    return { api, calls };
}

const quiet = (t) => t.mock.method(console, 'warn', () => {});

const artist = (i) => ({ id: `ar${i}`, name: `Artist ${i}`, images: [{ url: `ar${i}.jpg` }] });
const album = (i) => ({ id: `al${i}`, name: `Album ${i}`, artists: [artist(i)] });
const playlist = (i) => ({ id: `p${i}`, name: `Playlist ${i}`, owner: { id: 'me', display_name: 'Me' } });
const savedTrack = (i) => ({ added_at: '2024-01-01T00:00:00Z', track: { id: `t${i}`, name: `Track ${i}` } });

// ------------------------------------------------------------ the calls --

const READS = [
    ['getSavedPlaylists', [{ limit: 12, sort_result: false }], 'get_playlist_favorites', { limit: 12, sort_result: false }],
    ['getSavedAlbums', [{ limit: 50, offset: 50 }], 'get_album_favorites', { limit: 50, offset: 50 }],
    ['getSavedTracks', [{ limit: 50, offset: 0, sort_result: false }], 'get_track_favorites', { limit: 50, offset: 0, sort_result: false }],
    ['getFollowedArtists', [{ limit: 15, sort_result: false, after: 'ar15' }], 'get_artists_followed', { limit: 15, sort_result: false, after: 'ar15' }],
    ['getArtist', ['ar1'], 'get_artist', { artist_id: 'ar1' }],
    ['getAlbum', ['al1'], 'get_album', { album_id: 'al1' }],
    ['getTrack', ['t1'], 'get_track', { track_id: 't1' }],
    ['getPlaylist', ['p1'], 'get_playlist', { playlist_id: 'p1' }],
    ['getRecentTracks', [], 'get_player_recent_tracks', { limit: 30 }],
    ['getRecentTracks', [{ limit: 50 }], 'get_player_recent_tracks', { limit: 50 }],
    ['findArtist', ['Kygo'], 'search_artists', { criteria: 'Kygo', limit: 1 }],
];

for (const [method, args, service, params] of READS) {
    test(`${method}(${args.map(a => JSON.stringify(a)).join(', ')}) makes one ${service} call with exactly those params`, async () => {
        const { api, calls } = makeApi(() => ({ result: { items: [] } }));
        await api[method](...args);
        assert.deepEqual(calls, [{
            type: 'call_service', domain: 'spotifyplus', service,
            service_data: { entity_id: ENTITY, ...params }, return_response: true
        }]);
    });

    test(`${method}: a failed read is null (warned once, as fetchSpotifyPlus does)`, async (t) => {
        const warn = quiet(t);
        const { api } = makeApi(() => { throw Object.assign(new Error('down'), { code: 'unknown_error' }); });
        assert.equal(await api[method](...args), null);
        assert.equal(warn.mock.callCount(), 1);
    });

    test(`${method}: no hass, no call, null`, async () => {
        const api = new SpotifyApi(null, ENTITY);
        assert.equal(await api[method](...args), null);
    });
}

test('the reads take no params of their own: {} by default', async () => {
    for (const method of ['getSavedPlaylists', 'getSavedAlbums', 'getSavedTracks', 'getFollowedArtists']) {
        const { api, calls } = answering(null);
        await api[method]();
        assert.deepEqual(calls[0][1], {}, method);
    }
});

test('catalog reads still share the read cache; playlists do not', async () => {
    const { api, calls } = makeApi((p) => ({ result: { id: Object.values(p.service_data)[1] } }));
    await Promise.all([api.getArtist('a1'), api.getArtist('a1'), api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' })]);
    await api.getAlbum('al1'); await api.getAlbum('al1');
    await api.getTrack('t1'); await api.getTrack('t1');
    await api.getPlaylist('p1'); await api.getPlaylist('p1');
    assert.deepEqual(calls.map(c => c.service), ['get_artist', 'get_album', 'get_track', 'get_playlist', 'get_playlist']);
    const a = await api.getArtist('a1');
    a.name = 'mutated';
    assert.equal((await api.getArtist('a1')).name, undefined, 'each caller its own copy');
});

// ------------------------------------------------------------ the shapes --

test('list reads: { items, total } from result; total passed through as sent', async () => {
    for (const method of ['getSavedPlaylists', 'getSavedTracks']) {
        const items = method === 'getSavedTracks' ? [savedTrack(1)] : [playlist(1)];
        assert.deepEqual(await answering({ result: { items, total: 9, next: 'x' }, user_profile: {} }).api[method](), { items, total: 9 });
        assert.deepEqual(await answering({ result: { items: [] , total: 0 } }).api[method](), { items: [], total: 0 });
        assert.deepEqual(await answering({ result: { items } }).api[method](), { items, total: undefined });
    }
});

test('list reads: null when the response holds no items list', async () => {
    for (const res of [null, undefined, {}, { result: null }, { result: {} }, { result: { items: null } }, { result: { items: {} } }, { items: [playlist(1)] }]) {
        for (const method of ['getSavedPlaylists', 'getSavedAlbums', 'getSavedTracks', 'getFollowedArtists']) {
            assert.equal(await answering(res).api[method](), null, `${method} ${JSON.stringify(res)}`);
        }
    }
});

test('getSavedTracks keeps the { added_at, track } wrappers', async () => {
    const page = await answering({ result: { items: [savedTrack(1), savedTrack(2)], total: 2 } }).api.getSavedTracks();
    assert.deepEqual(page, { items: [savedTrack(1), savedTrack(2)], total: 2 });
});

test('getSavedAlbums: the albums out of their wrappers; a wrapper without one is dropped; total as sent', async () => {
    const res = { result: { items: [{ added_at: 'x', album: album(1) }, {}, { album: null }, null, { album: album(2) }], total: 5 } };
    assert.deepEqual(await answering(res).api.getSavedAlbums(), { items: [album(1), album(2)], total: 5 });
});

test('getFollowedArtists: flat page (SpotifyPlus) and nested page (Web API), with the cursor', async () => {
    const items = [artist(1), artist(2)];
    const { api } = answering({ result: { items, total: 40, cursors: { after: 'cur' } } });
    assert.deepEqual(await api.getFollowedArtists(), { items, total: 40, after: 'cur' });
    // No cursor: the last artist's id. Nothing at all: null.
    assert.deepEqual(await answering({ result: { items, total: 40 } }).api.getFollowedArtists(), { items, total: 40, after: 'ar2' });
    assert.deepEqual(await answering({ result: { items: [], cursors: { after: null } } }).api.getFollowedArtists(), { items: [], total: undefined, after: null });
    // Robust parsing: the Web API's own shape nests the page under `artists`.
    assert.deepEqual(await answering({ result: { artists: { items, total: 7, cursors: { after: 'n' } } } }).api.getFollowedArtists(), { items, total: 7, after: 'n' });
    assert.deepEqual(await answering({ result: { artists: { items } } }).api.getFollowedArtists(), { items, total: undefined, after: 'ar2' });
    // A nested `artists` without a list is not the page.
    assert.equal(await answering({ result: { artists: {} } }).api.getFollowedArtists(), null);
});

test('single-object reads: res.result, else null (a bare object is not taken for one)', async () => {
    for (const method of ['getArtist', 'getAlbum', 'getTrack', 'getPlaylist']) {
        assert.deepEqual(await answering({ result: artist(1), user_profile: { id: 'me' } }).api[method]('x'), artist(1));
        for (const res of [null, undefined, {}, { result: null }, { user_profile: { id: 'me' } }, artist(1)]) {
            assert.equal(await answering(res).api[method]('x'), null, `${method} ${JSON.stringify(res)}`);
        }
    }
});

test('getRecentTracks: a ListPage, shared or not; null when failed or no list', async () => {
    const items = [{ track: { id: 't1' }, played_at: 'x' }];
    for (const opts of [undefined, { limit: 50 }]) {
        assert.deepEqual(await answering({ result: { items, next: 'x' } }).api.getRecentTracks(opts), { items, total: undefined });
        for (const res of [null, {}, { result: {} }, { items }]) {
            assert.equal(await answering(res).api.getRecentTracks(opts), null, JSON.stringify(res));
        }
    }
});

test('getRecentTracks with another limit is never shared, and ignores `since`', async () => {
    const { api, calls } = answering({ result: { items: [] } });
    const since = Date.now();
    await api.getRecentTracks();
    await api.getRecentTracks({ since, limit: 50 });
    await api.getRecentTracks({ since });
    await api.getRecentTracks({ limit: 50 });
    assert.deepEqual(calls, [
        ['get_player_recent_tracks', { limit: 30 }],
        ['get_player_recent_tracks', { limit: 50 }],
        ['get_player_recent_tracks', { limit: 50 }],
    ], 'the `since` read of 30 joined the first; the reads of 50 joined nothing');
});

// ------------------------------------------- characterization of the sites --
//
// Each site: `old(res)`, its unwrap as it read before the change (verbatim
// but for the surrounding code), and `now(api)`, what it does now with the
// method. They must agree on every response below, except where `differs`
// names the response and what the site gets now (only shapes SpotifyPlus
// does not send: see the notes).

const itemsOf = (n, make) => Array.from({ length: n }, (_, k) => make(k + 1));
const LIST_SHAPES = {
    failed: null,
    page: { result: { items: itemsOf(3, playlist), total: 3 }, user_profile: { id: 'me' } },
    empty: { result: { items: [], total: 0 } },
    noTotal: { result: { items: itemsOf(2, playlist) } },
    nullResult: { result: null },
    noList: { result: {} },
};
const ALBUM_SHAPES = {
    failed: null,
    page: { result: { items: [{ album: album(1) }, {}, { album: album(2) }], total: 3 } },
    empty: { result: { items: [], total: 0 } },
    noTotal: { result: { items: [{ album: album(1) }] } },
    noList: { result: {} },
};
const FOLLOWED_SHAPES = {
    failed: null,
    flat: { result: { items: itemsOf(3, artist), total: 30, cursors: { after: 'ar3' } } },
    flatNoCursor: { result: { items: itemsOf(2, artist), total: 30 } },
    nested: { result: { artists: { items: itemsOf(2, artist), total: 2, cursors: { after: 'c' } } } },
    empty: { result: { items: [], total: 0 } },
    noList: { result: {} },
};
const TRACK_SHAPES = {
    failed: null,
    page: { result: { items: itemsOf(2, savedTrack), total: 120 } },
    noTotal: { result: { items: itemsOf(2, savedTrack) } },
    zeroTotal: { result: { items: [], total: 0 } },
    noList: { result: {} },
};
const RECENT_SHAPES = {
    failed: null,
    page: { result: { items: [{ track: { id: 't1', album: album(1) } }] } },
    empty: { result: { items: [] } },
    noList: { result: {} },
    direct: { items: [{ track: { id: 't9' } }] },
};
const OBJECT_SHAPES = {
    failed: null,
    object: { result: artist(1), user_profile: { id: 'me' } },
    nullResult: { result: null, user_profile: { id: 'me' } },
    bare: artist(2),
};

const SITES = [
    // spotify-home.js fetchSectionData
    {
        site: 'home favorites', shapes: LIST_SHAPES,
        old: (res) => { const data = res?.result; return data && Array.isArray(data.items) ? { items: data.items, total: data.total } : null; },
        now: async (api) => { const data = await api.getSavedPlaylists({}); return data ? { items: data.items, total: data.total } : null; },
    },
    {
        site: 'home albums', shapes: ALBUM_SHAPES,
        old: (res) => (res?.result?.items ? { items: res.result.items.map(i => i.album).filter(Boolean), total: res.result.total } : null),
        now: async (api) => api.getSavedAlbums({}),
    },
    {
        site: 'home artists', shapes: FOLLOWED_SHAPES,
        old: (res) => {
            let data = null;
            if (res?.result) { data = res.result; if (data.artists) data = data.artists; }
            return data && Array.isArray(data.items) ? { items: data.items, total: data.total } : null;
        },
        now: async (api) => { const data = await api.getFollowedArtists({}); return data ? { items: data.items, total: data.total } : null; },
    },
    {
        site: 'home recent', shapes: RECENT_SHAPES,
        old: (res) => (res?.result?.items ? res.result.items.slice(0, 20) : null),
        now: async (api) => { const page = await api.getRecentTracks({ since: null }); return page ? page.items.slice(0, 20) : null; },
    },
    // spotify-library.js _loadRecent and _fetchPage
    {
        site: 'library history', shapes: RECENT_SHAPES,
        old: (res) => res?.result?.items || [],
        now: async (api) => (await api.getRecentTracks({ limit: 50 }))?.items || [],
    },
    {
        site: 'library saved albums', shapes: ALBUM_SHAPES,
        old: (res) => (res?.result?.items || []).map(i => i.album).filter(Boolean),
        now: async (api) => (await api.getSavedAlbums({}))?.items || [],
    },
    {
        site: 'library saved playlists', shapes: LIST_SHAPES,
        old: (res) => res?.result?.items || [],
        now: async (api) => (await api.getSavedPlaylists({}))?.items || [],
    },
    {
        site: 'library followed artists (_loadRecent)', shapes: FOLLOWED_SHAPES,
        old: (res) => { let fd = res?.result; if (fd?.artists) fd = fd.artists; return fd?.items || []; },
        now: async (api) => (await api.getFollowedArtists({}))?.items || [],
    },
    {
        site: 'library artist page (_fetchPage)', shapes: FOLLOWED_SHAPES,
        old: (res) => {
            let d = res?.result;
            if (d?.artists) d = d.artists;
            const items = d?.items || [];
            return { items, after: d?.cursors?.after || items[items.length - 1]?.id || null };
        },
        now: async (api) => { const page = await api.getFollowedArtists({}); return { items: page?.items || [], after: page?.after || null }; },
    },
    {
        site: 'library playlist hydrate', shapes: OBJECT_SHAPES,
        old: (res) => res?.result || null,
        now: async (api) => api.getPlaylist('x'),
    },
    {
        site: 'library artist hydrate', shapes: OBJECT_SHAPES,
        old: (res) => res?.result?.images,
        now: async (api) => (await api.getArtist('x'))?.images,
    },
    // page-loaders.js
    {
        site: 'page album / artist / home-content pins', shapes: OBJECT_SHAPES,
        old: (res) => res?.result || null,
        now: async (api) => api.getAlbum('x'),
    },
    {
        site: 'page discography name', shapes: OBJECT_SHAPES,
        old: (res) => res?.result?.name || 'Artist',
        now: async (api) => (await api.getArtist('x'))?.name || 'Artist',
    },
    {
        site: 'page liked songs', shapes: TRACK_SHAPES,
        old: (res) => (Array.isArray(res?.result?.items) ? { items: res.result.items, total: res.result.total ?? res.result.items.length } : 'LOAD_FAILED'),
        now: async (api) => { const page = await api.getSavedTracks({}); return page ? { items: page.items, total: page.total ?? page.items.length } : 'LOAD_FAILED'; },
    },
    {
        site: 'page liked songs load more', shapes: TRACK_SHAPES,
        old: (res) => (Array.isArray(res?.result?.items) ? { items: res.result.items, total: res.result.total || 500 } : 'LOAD_MORE_FAILED'),
        now: async (api) => { const page = await api.getSavedTracks({}); return page ? { items: page.items, total: page.total || 500 } : 'LOAD_MORE_FAILED'; },
    },
    {
        site: 'section recent', shapes: RECENT_SHAPES,
        old: (res) => (res?.result?.items ? { read: true, items: res.result.items } : { read: false }),
        now: async (api) => { const page = await api.getRecentTracks({ limit: 50 }); return page ? { read: true, items: page.items } : { read: false }; },
    },
    {
        site: 'section favorites', shapes: LIST_SHAPES,
        old: (res) => (res?.result?.items ? { read: true, items: res.result.items, total: res.result.total } : { read: false }),
        now: async (api) => { const page = await api.getSavedPlaylists({}); return page ? { read: true, items: page.items, total: page.total } : { read: false }; },
    },
    {
        site: 'section albums', shapes: ALBUM_SHAPES,
        old: (res) => (res?.result?.items ? { read: true, items: res.result.items.map(i => i.album).filter(Boolean), total: res.result.total } : { read: false }),
        now: async (api) => { const page = await api.getSavedAlbums({}); return page ? { read: true, items: page.items, total: page.total } : { read: false }; },
    },
    {
        site: 'section artists', shapes: FOLLOWED_SHAPES,
        old: (res) => {
            let read = false, newItems = [], total = null, nextCursor = null;
            if (res?.result) {
                if (res.result.items) { read = true; newItems = res.result.items; total = res.result.total; }
                else if (res.result.artists && res.result.artists.items) { read = true; newItems = res.result.artists.items; total = res.result.artists.total; }
                if (newItems.length > 0) nextCursor = newItems[newItems.length - 1].id;
            }
            return { read, newItems, total, nextCursor };
        },
        now: async (api) => {
            let read = false, newItems = [], total = null, nextCursor = null;
            const page = await api.getFollowedArtists({});
            if (page) {
                read = true; newItems = page.items; total = page.total;
                if (newItems.length > 0) nextCursor = newItems[newItems.length - 1].id;
            }
            return { read, newItems, total, nextCursor };
        },
    },
    // pinned-items-manager.js addByUri
    {
        site: 'pinned addByUri', shapes: OBJECT_SHAPES,
        old: (res) => (res ? (res.result || res) : null),
        now: async (api) => api.getArtist('x'),
        // SpotifyPlus always wraps its answer; what this fallback took for
        // the object was the wrapper itself, saved as a pin with no title.
        differs: { nullResult: null, bare: null },
    },
    // player-controller.js refreshRecent
    {
        site: 'player recents', shapes: RECENT_SHAPES,
        old: (res) => (res ? (res.result?.items || res.items || []) : 'unchanged'),
        now: async (api) => { const page = await api.getRecentTracks({ since: null }); return page ? page.items : 'unchanged'; },
        // A response with no list kept the last list instead of clearing it,
        // and the "Direct" (unwrapped) shape SpotifyPlus never sends is no
        // longer read.
        differs: { noList: 'unchanged', direct: 'unchanged' },
    },
];

for (const { site, shapes, old, now, differs = {} } of SITES) {
    test(`site: ${site} gets what it got before`, async () => {
        for (const [shape, res] of Object.entries(shapes)) {
            const got = await now(answering(res).api);
            const want = shape in differs ? differs[shape] : old(clone(res));
            assert.deepEqual(got, want, `${site}: ${shape}`);
            if (shape in differs) assert.notDeepEqual(old(clone(res)), want, `${site}: ${shape} is a real difference`);
        }
    });
}

test('findArtist: the first search hit, else null (no match or a failed call)', async (t) => {
    assert.deepEqual(await answering({ result: { items: [artist(1), artist(2)] } }).api.findArtist('Artist'), artist(1));
    assert.equal(await answering({ result: { items: [] } }).api.findArtist('Nobody'), null);
    assert.equal(await answering(null).api.findArtist('Down'), null);
    t.mock.method(console, 'error', () => {});
    quiet(t);
    const { api } = makeApi(() => { throw new Error('down'); });
    assert.equal(await api.findArtist('Down'), null);
});
