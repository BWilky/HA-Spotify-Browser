import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SpotifyApi } from '../src/api.js';

const ENTITY = 'media_player.test';
const TTL = SpotifyApi.READ_CACHE_TTL_MS;

// A SpotifyPlus stand-in that records every websocket call. `respond(payload)`
// returns the service response (the part under `response`); throwing from it
// fails the call. By default it echoes a catalog object for the requested id.
function makeApi(respond = defaultRespond, entity = ENTITY) {
    const calls = [];
    const hass = {
        callWS: async (payload) => {
            calls.push(payload);
            return { response: respond(payload, calls.length) };
        }
    };
    return { api: new SpotifyApi(hass, entity), calls, hass };
}

function defaultRespond(payload) {
    const { entity_id, ...params } = payload.service_data;
    return { user_profile: { id: 'user-of-' + entity_id }, result: { service: payload.service, ...params, images: [{ url: 'art.jpg' }] } };
}

// Freeze the clock so TTLs can be stepped through without sleeping.
function freezeClock(t) {
    mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
    t.after(() => mock.timers.reset());
}

function fail(message = 'boom') {
    return () => { throw Object.assign(new Error(message), { code: 'unknown_error' }); };
}

test('the allow-list is exactly the immutable catalog reads', () => {
    assert.deepEqual([...SpotifyApi.CACHED_READ_SERVICES].sort(), ['get_album', 'get_artist', 'get_track']);
});

test('identical concurrent reads make one websocket call and every caller gets the result', async () => {
    const { api, calls } = makeApi();

    const [a, b, c] = await Promise.all([
        api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' }),
        api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' }),
        api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' }, true)
    ]);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].return_response, true);
    assert.deepEqual(calls[0].service_data, { entity_id: ENTITY, artist_id: 'a1' });
    assert.equal(a.result.artist_id, 'a1');
    assert.deepEqual(b, a);
    assert.deepEqual(c, a);
});

test('a second read within the TTL makes no call; after the TTL it does', async (t) => {
    freezeClock(t);
    const { api, calls } = makeApi();

    const first = await api.fetchSpotifyPlus('get_album', { album_id: 'al1' });
    mock.timers.tick(TTL - 1);
    const second = await api.fetchSpotifyPlus('get_album', { album_id: 'al1' });
    assert.equal(calls.length, 1);
    assert.deepEqual(second, first);

    mock.timers.tick(1);
    const third = await api.fetchSpotifyPlus('get_album', { album_id: 'al1' });
    assert.equal(calls.length, 2);
    assert.deepEqual(third, first);

    // The refetch starts a fresh TTL.
    mock.timers.tick(TTL - 1);
    await api.fetchSpotifyPlus('get_album', { album_id: 'al1' });
    assert.equal(calls.length, 2);
});

test('different params or a different service are separate entries; key order is not', async () => {
    const { api, calls } = makeApi();

    await api.fetchSpotifyPlus('get_artist', { artist_id: 'x1' });
    await api.fetchSpotifyPlus('get_artist', { artist_id: 'x2' });
    await api.fetchSpotifyPlus('get_album', { album_id: 'x1' });
    await api.fetchSpotifyPlus('get_track', { track_id: 'x1' });
    await api.fetchSpotifyPlus('get_track', { track_id: 'x1', market: 'CA' });
    assert.equal(calls.length, 5);

    await api.fetchSpotifyPlus('get_artist', { artist_id: 'x1' });
    await api.fetchSpotifyPlus('get_artist', { artist_id: 'x2' });
    await api.fetchSpotifyPlus('get_album', { album_id: 'x1' });
    await api.fetchSpotifyPlus('get_track', { track_id: 'x1' });
    const reordered = await api.fetchSpotifyPlus('get_track', { market: 'CA', track_id: 'x1' });
    assert.equal(calls.length, 5, 'every repeat is served from the cache');
    assert.equal(reordered.result.market, 'CA');
});

test('each caller gets its own copy, so changing one response cannot reach another', async () => {
    const { api, calls } = makeApi(() => ({ result: { id: 'al1', tracks: { items: [] }, images: [{ url: 'a.jpg' }] } }));

    const [a, b] = await Promise.all([
        api.fetchSpotifyPlus('get_album', { album_id: 'al1' }),
        api.fetchSpotifyPlus('get_album', { album_id: 'al1' })
    ]);
    assert.notEqual(a, b);

    // What the album page does when Spotify omits the track list.
    a.result.tracks.items = ['t1', 't2'];
    a.result.tracks.total = 2;
    a.result.images.push({ url: 'extra.jpg' });
    a.result.name = 'changed';

    const c = await api.fetchSpotifyPlus('get_album', { album_id: 'al1' });
    assert.equal(calls.length, 1);
    for (const untouched of [b, c]) {
        assert.deepEqual(untouched, { result: { id: 'al1', tracks: { items: [] }, images: [{ url: 'a.jpg' }] } });
    }
});

test('a failed read is not cached and does not poison later identical reads', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const { api, calls } = makeApi((payload, n) => {
        if (n === 1) throw new Error('rate limited');
        return defaultRespond(payload);
    });

    // Two callers share the failing request...
    const [a, b] = await Promise.all([
        api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' }),
        api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' })
    ]);
    assert.equal(a, null);
    assert.equal(b, null);
    assert.equal(calls.length, 1);
    assert.equal(warn.mock.callCount(), 2, 'each caller logs its own failure, as two uncached calls would');

    // ...and the very next one goes back to SpotifyPlus and succeeds.
    const c = await api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    assert.equal(calls.length, 2);
    assert.equal(c.result.artist_id, 'a1');

    await api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    assert.equal(calls.length, 2, 'the success is cached');
});

test('an empty response is not cached', async () => {
    const responses = [null, undefined];
    const calls = [];
    const hass = { callWS: async (payload) => { calls.push(payload); return responses.shift(); } };
    const api = new SpotifyApi(hass, ENTITY);

    assert.equal(await api.fetchSpotifyPlus('get_track', { track_id: 't1' }), null);
    assert.equal(await api.fetchSpotifyPlus('get_track', { track_id: 't1' }), undefined);
    assert.equal(calls.length, 2);
    assert.equal(api._readCache.size, 0);
});

test('throwOnError callers still get the throw; logError still decides who logs', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const boom = Object.assign(new Error('Validation error: nope'), { code: 'service_validation_error' });
    let failing = true;
    const { api, calls } = makeApi((payload) => {
        if (failing) throw boom;
        return defaultRespond(payload);
    });
    const errors = [];
    api.onError = (e) => errors.push(e);

    const results = await Promise.allSettled([
        api.fetchSpotifyPlus('get_album', { album_id: 'al1' }, true, true, true),   // throws
        api.fetchSpotifyPlus('get_album', { album_id: 'al1' }, true, false, false), // quiet null
        api.fetchSpotifyPlus('get_album', { album_id: 'al1' }, true, true, false)   // logged null
    ]);

    assert.equal(calls.length, 1);
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[0].reason, boom);
    assert.deepEqual(results.slice(1).map(r => r.value), [null, null]);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(warn.mock.calls[0].arguments[0], /Failed Call \[get_album\]/);
    assert.equal(errors.length, 0, 'a read failing validation never reaches the playback error callback');

    await assert.rejects(api.fetchSpotifyPlus('get_album', { album_id: 'al1' }, true, true, true), boom);
    assert.equal(calls.length, 2, 'the failure was not cached');

    failing = false;
    const ok = await api.fetchSpotifyPlus('get_album', { album_id: 'al1' }, true, true, true);
    assert.equal(ok.result.album_id, 'al1');
    assert.equal(calls.length, 3);
});

test('a caller that asked for no response is never served, and never fills, the cache', async () => {
    const { api, calls } = makeApi();

    assert.equal(await api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' }, false), true);
    assert.equal(calls.length, 1);
    assert.equal('return_response' in calls[0], false);
    assert.equal(api._readCache.size, 0);

    const read = await api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].return_response, true);
    assert.equal(read.result.artist_id, 'a1');

    assert.equal(await api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' }, false), true);
    assert.equal(calls.length, 3, 'no-response call goes to the network even with a cached read');
});

test('services off the allow-list are never cached', async () => {
    const { api, calls } = makeApi();
    const uncached = [
        ['get_playlist', { playlist_id: 'p1' }],
        ['get_playlist_items', { playlist_id: 'p1', offset: 0, limit: 50 }],
        ['get_playlist_cover_image', { playlist_id: 'p1' }],
        ['get_playlist_favorites', { limit: 12 }],
        ['get_album_favorites', { limit: 12 }],
        ['get_track_favorites', { limit: 50 }],
        ['get_artists_followed', { limit: 12 }],
        ['get_player_queue_info', {}],
        ['get_player_recent_tracks', { limit: 30 }],
        ['get_player_devices', {}],
        ['get_spotify_connect_devices', { refresh: false }],
        ['check_album_favorites', { ids: 'al1' }],
        ['check_artists_following', { ids: 'a1' }],
        ['check_track_favorites', { ids: 't1' }],
        ['search_all', { criteria: 'x' }],
        ['search_artists', { criteria: 'x' }],
        ['get_artist_albums', { artist_id: 'a1', limit: 10, offset: 0 }],
        ['get_album_tracks', { album_id: 'al1', limit: 50 }],
        ['get_artist_top_tracks', { artist_id: 'a1' }]
    ];

    for (const [service, params] of uncached) {
        const before = calls.length;
        const [a, b] = await Promise.all([
            api.fetchSpotifyPlus(service, params),
            api.fetchSpotifyPlus(service, params)
        ]);
        await api.fetchSpotifyPlus(service, params);
        assert.equal(calls.length - before, 3, `${service} must hit the network every time`);
        assert.equal(a.result.service, service);
        assert.equal(b.result.service, service);
    }
    assert.equal(api._readCache.size, 0);
});

test('the oldest entry is evicted once the cache is over its cap', async (t) => {
    const cap = SpotifyApi.READ_CACHE_MAX_ENTRIES;
    SpotifyApi.READ_CACHE_MAX_ENTRIES = 3;
    t.after(() => { SpotifyApi.READ_CACHE_MAX_ENTRIES = cap; });
    const { api, calls } = makeApi();

    for (const id of ['a1', 'a2', 'a3', 'a4']) await api.fetchSpotifyPlus('get_artist', { artist_id: id });
    assert.equal(calls.length, 4);
    assert.equal(api._readCache.size, 3);

    for (const id of ['a2', 'a3', 'a4']) await api.fetchSpotifyPlus('get_artist', { artist_id: id });
    assert.equal(calls.length, 4, 'the three newest are still cached');

    await api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    assert.equal(calls.length, 5, 'the oldest was evicted');
    assert.equal(api._readCache.size, 3);

    // Re-reading a1 made a2 the oldest.
    await api.fetchSpotifyPlus('get_artist', { artist_id: 'a2' });
    assert.equal(calls.length, 6);
});

test('the default cap holds', async () => {
    const { api, calls } = makeApi();
    const cap = SpotifyApi.READ_CACHE_MAX_ENTRIES;

    for (let i = 0; i <= cap; i++) await api.fetchSpotifyPlus('get_track', { track_id: 't' + i });
    assert.equal(api._readCache.size, cap);

    await api.fetchSpotifyPlus('get_track', { track_id: 't' + cap });
    assert.equal(calls.length, cap + 1, 'newest still cached');
    await api.fetchSpotifyPlus('get_track', { track_id: 't0' });
    assert.equal(calls.length, cap + 2, 'oldest evicted');
});

test('expired entries are dropped the next time the cache is used', async (t) => {
    freezeClock(t);
    const { api } = makeApi();

    for (const id of ['a1', 'a2', 'a3']) await api.fetchSpotifyPlus('get_artist', { artist_id: id });
    assert.equal(api._readCache.size, 3);

    mock.timers.tick(TTL);
    await api.fetchSpotifyPlus('get_album', { album_id: 'al1' });
    assert.equal(api._readCache.size, 1);
});

test('an entry expires on its own clock even when an older, slower one is still fresh', async (t) => {
    freezeClock(t);
    let releaseSlow;
    const calls = [];
    const hass = {
        callWS: (payload) => {
            calls.push(payload);
            const response = { response: defaultRespond(payload) };
            if (payload.service_data.artist_id !== 'slow' || releaseSlow) return Promise.resolve(response);
            return new Promise(resolve => { releaseSlow = () => resolve(response); });
        }
    };
    const api = new SpotifyApi(hass, ENTITY);

    // `slow` is requested first but lands a second after `fast`.
    const slow = api.fetchSpotifyPlus('get_artist', { artist_id: 'slow' });
    await api.fetchSpotifyPlus('get_artist', { artist_id: 'fast' });
    mock.timers.tick(1000);
    releaseSlow();
    await slow;
    assert.equal(calls.length, 2);

    mock.timers.tick(TTL - 1000);
    await api.fetchSpotifyPlus('get_artist', { artist_id: 'slow' });
    assert.equal(calls.length, 2, '`slow` landed later, so it is still fresh');
    await api.fetchSpotifyPlus('get_artist', { artist_id: 'fast' });
    assert.equal(calls.length, 3, '`fast` has expired');
});

test('clearReadCache and destroy() forget everything', async () => {
    const { api, calls } = makeApi();

    await api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    api.clearReadCache();
    await api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    assert.equal(calls.length, 2);

    await api.getArtistGenres('a2');
    await api.getTrackArt('t1');
    api.destroy();
    assert.equal(api._readCache.size, 0);
    assert.equal(api._artistGenreCache.size, 0);
    assert.equal(api._trackArtCache.size, 0);
});

test('a read in flight when the cache is cleared is not remembered', async () => {
    let release;
    const calls = [];
    const hass = {
        callWS: (payload) => {
            calls.push(payload);
            if (calls.length > 1) return Promise.resolve({ response: { result: { n: calls.length } } });
            return new Promise(resolve => { release = () => resolve({ response: { result: { n: 1 } } }); });
        }
    };
    const api = new SpotifyApi(hass, ENTITY);

    const early = api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    api.clearReadCache();
    const fresh = await api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    assert.equal(fresh.result.n, 2, 'a read after the clear does not join the older request');

    release();
    assert.equal((await early).result.n, 1, 'the older request still answers its own caller');
    const again = await api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    assert.equal(again.result.n, 2, 'and does not replace the newer cached response');
    assert.equal(calls.length, 2);
});

test('a stale request that fails late does not evict the newer cached response', async (t) => {
    t.mock.method(console, 'warn', () => {});
    let failEarly;
    const calls = [];
    const hass = {
        callWS: (payload) => {
            calls.push(payload);
            if (calls.length > 1) return Promise.resolve({ response: { result: { n: calls.length } } });
            return new Promise((_, reject) => { failEarly = () => reject(new Error('socket dropped')); });
        }
    };
    const api = new SpotifyApi(hass, ENTITY);

    const early = api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    api.clearReadCache();
    await api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    failEarly();
    assert.equal(await early, null);

    const again = await api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    assert.equal(again.result.n, 2);
    assert.equal(calls.length, 2);
});

test('a read that never settles stops being joined after READ_CACHE_PENDING_MS', async (t) => {
    freezeClock(t);
    const calls = [];
    const hass = {
        callWS: (payload) => {
            calls.push(payload);
            if (calls.length === 1) return new Promise(() => {}); // hangs forever
            return Promise.resolve({ response: { result: { ok: true } } });
        }
    };
    const api = new SpotifyApi(hass, ENTITY);

    api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    mock.timers.tick(SpotifyApi.READ_CACHE_PENDING_MS - 1);
    api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    assert.equal(calls.length, 1, 'still joining the pending request');

    mock.timers.tick(1);
    const retry = api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    assert.equal(calls.length, 2, 'a new request is issued instead of waiting on the stuck one');
    assert.deepEqual(await retry, { result: { ok: true } });
});

test('instances do not share a cache', async () => {
    const calls = [];
    const hass = { callWS: async (payload) => { calls.push(payload); return { response: defaultRespond(payload) }; } };
    const one = new SpotifyApi(hass, 'media_player.account_one');
    const two = new SpotifyApi(hass, 'media_player.account_two');

    const a = await one.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });
    const b = await two.fetchSpotifyPlus('get_artist', { artist_id: 'a1' });

    assert.equal(calls.length, 2);
    assert.equal(a.user_profile.id, 'user-of-media_player.account_one');
    assert.equal(b.user_profile.id, 'user-of-media_player.account_two');
});

// --- The former memo caches: getArtistGenres / getTrackArt -----------------

test('getArtistGenres returns the genres and remembers them for the session', async (t) => {
    freezeClock(t);
    const { api, calls } = makeApi(() => ({ result: { id: 'a1', genres: ['shoegaze', 'dream pop'] } }));

    assert.deepEqual(await api.getArtistGenres('a1'), ['shoegaze', 'dream pop']);
    assert.deepEqual(await api.getArtistGenres('a1'), ['shoegaze', 'dream pop']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].service, 'get_artist');
    assert.deepEqual(calls[0].service_data, { entity_id: ENTITY, artist_id: 'a1' });

    mock.timers.tick(TTL * 10);
    assert.deepEqual(await api.getArtistGenres('a1'), ['shoegaze', 'dream pop']);
    assert.equal(calls.length, 1, 'still remembered after the read cache has expired');
});

test('getArtistGenres accepts a response without a result wrapper and an artist with no genres', async (t) => {
    freezeClock(t);
    const bare = makeApi(() => ({ id: 'a1', genres: ['jazz'] }));
    assert.deepEqual(await bare.api.getArtistGenres('a1'), ['jazz']);

    const none = makeApi(() => ({ result: { id: 'a2', genres: [] } }));
    assert.deepEqual(await none.api.getArtistGenres('a2'), []);
    mock.timers.tick(TTL * 10);
    assert.deepEqual(await none.api.getArtistGenres('a2'), []);
    assert.equal(none.calls.length, 1, 'an empty genre list is an answer, not a failure');
});

test('getArtistGenres returns [] on failure but retries next time', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const { api, calls } = makeApi((payload, n) => {
        if (n === 1) throw new Error('boom');
        return { result: { genres: ['folk'] } };
    });

    assert.deepEqual(await api.getArtistGenres('a1'), []);
    assert.deepEqual(await api.getArtistGenres('a1'), ['folk']);
    assert.equal(calls.length, 2);
});

test('getArtistGenres shares its lookup with concurrent callers and other get_artist reads', async () => {
    const { api, calls } = makeApi(() => ({ result: { name: 'Band', genres: ['folk'] } }));

    const [g1, g2, artist] = await Promise.all([
        api.getArtistGenres('a1'),
        api.getArtistGenres('a1'),
        api.fetchSpotifyPlus('get_artist', { artist_id: 'a1' })
    ]);

    assert.equal(calls.length, 1);
    assert.deepEqual(g1, ['folk']);
    assert.deepEqual(g2, ['folk']);
    assert.equal(artist.result.name, 'Band');
});

test('getArtistGenres and getTrackArt make no call without an id or hass', async () => {
    const { api, calls } = makeApi();
    assert.deepEqual(await api.getArtistGenres(''), []);
    assert.equal(await api.getTrackArt(null), null);
    api.hass = null;
    assert.deepEqual(await api.getArtistGenres('a1'), []);
    assert.equal(await api.getTrackArt('t1'), null);
    assert.equal(calls.length, 0);
});

test('getTrackArt returns the album art URL and remembers it for the session', async (t) => {
    freezeClock(t);
    const { api, calls } = makeApi((payload) => ({
        result: { id: payload.service_data.track_id, album: { images: [{ url: 'big.jpg' }, { url: 'small.jpg' }] } }
    }));

    assert.equal(await api.getTrackArt('t1'), 'big.jpg');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].service, 'get_track');
    assert.deepEqual(calls[0].service_data, { entity_id: ENTITY, track_id: 't1' });

    mock.timers.tick(TTL * 10);
    assert.equal(await api.getTrackArt('t1'), 'big.jpg');
    assert.equal(calls.length, 1);
});

test('getTrackArt accepts a bare track and returns null for a track without art', async () => {
    const bare = makeApi(() => ({ album: { images: [{ url: 'bare.jpg' }] } }));
    assert.equal(await bare.api.getTrackArt('t1'), 'bare.jpg');

    const noArt = makeApi(() => ({ result: { id: 't2', album: { images: [] } } }));
    assert.equal(await noArt.api.getTrackArt('t2'), null);
    assert.equal(await noArt.api.getTrackArt('t2'), null);
    assert.equal(noArt.calls.length, 1);
});

test('getTrackArt returns null on failure but retries next time', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const { api, calls } = makeApi((payload, n) => {
        if (n === 1) throw new Error('boom');
        return { result: { album: { images: [{ url: 'late.jpg' }] } } };
    });

    assert.equal(await api.getTrackArt('t1'), null);
    assert.equal(await api.getTrackArt('t1'), 'late.jpg');
    assert.equal(calls.length, 2);
});

test('getTrackArt for a whole queue at once makes one call per distinct track', async () => {
    const { api, calls } = makeApi((payload) => ({
        result: { album: { images: [{ url: payload.service_data.track_id + '.jpg' }] } }
    }));

    const urls = await Promise.all(['t1', 't2', 't1', 't3', 't2'].map(id => api.getTrackArt(id)));

    assert.deepEqual(urls, ['t1.jpg', 't2.jpg', 't1.jpg', 't3.jpg', 't2.jpg']);
    assert.equal(calls.length, 3);
});

test('the session memos are capped, oldest first', async (t) => {
    freezeClock(t);
    const cap = SpotifyApi.DERIVED_MEMO_MAX_ENTRIES;
    SpotifyApi.DERIVED_MEMO_MAX_ENTRIES = 2;
    t.after(() => { SpotifyApi.DERIVED_MEMO_MAX_ENTRIES = cap; });
    const { api, calls } = makeApi((payload) => ({
        result: { album: { images: [{ url: payload.service_data.track_id + '.jpg' }] } }
    }));

    for (const id of ['t1', 't2', 't3']) await api.getTrackArt(id);
    assert.equal(api._trackArtCache.size, 2);

    // Past the read cache's TTL only the memo can still answer.
    mock.timers.tick(TTL);
    await api.getTrackArt('t3');
    await api.getTrackArt('t2');
    assert.equal(calls.length, 3);
    assert.equal(await api.getTrackArt('t1'), 't1.jpg');
    assert.equal(calls.length, 4, 'the oldest memo entry was evicted and is looked up again');
});
