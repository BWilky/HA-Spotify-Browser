import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpotifyApi } from '../src/api.js';

function makeItems(n, prefix = 'item') {
    return Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
}

// Simulates SpotifyPlus's real behavior: honors limit/offset against a fixed
// backing list and reports `total` as the full count regardless of page size.
function makeApi(available, calls) {
    const hass = {
        callWS: async (payload) => {
            const { limit, offset } = payload.service_data;
            calls.push({ service: payload.service, limit, offset });
            const page = available.slice(offset, offset + limit);
            return { response: { result: { items: page, total: available.length } } };
        }
    };
    return new SpotifyApi(hass, 'media_player.test');
}

test('fetchPaginated batches a request of 12 into 10 + 2 when 20 are available', async () => {
    const available = makeItems(20);
    const calls = [];
    const api = makeApi(available, calls);

    const { items, total, offset } = await api.fetchPaginated('get_artist_albums', { artist_id: 'a1' }, 12);

    assert.deepEqual(items, available.slice(0, 12));
    assert.equal(total, 20);
    assert.equal(offset, 12);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(c => c.limit), [10, 2]);
    assert.deepEqual(calls.map(c => c.offset), [0, 10]);
});

test('fetchPaginated stops early when fewer items are available than requested', async () => {
    const available = makeItems(5);
    const calls = [];
    const api = makeApi(available, calls);

    const { items, total } = await api.fetchPaginated('get_artist_albums', { artist_id: 'a1' }, 12);

    assert.deepEqual(items, available);
    assert.equal(total, 5);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].limit, 10);
});

test('fetchPaginated fetches 50 across 3 calls when 23 are available, stopping on the short final page', async () => {
    const available = makeItems(23);
    const calls = [];
    const api = makeApi(available, calls);

    const { items, total } = await api.fetchPaginated('get_artist_albums', { artist_id: 'a1' }, 50);

    assert.equal(items.length, 23);
    assert.equal(total, 23);
    assert.equal(calls.length, 3);
    // Each call still requests up to the per-service cap (10); it's the
    // returned page that comes back short (3 items) on the last call.
    assert.deepEqual(calls.map(c => c.limit), [10, 10, 10]);
});

test('fetchPaginated continues from a nonzero base offset (Load More)', async () => {
    const available = makeItems(30);
    const calls = [];
    const api = makeApi(available, calls);

    const { items, total, offset } = await api.fetchPaginated(
        'get_artist_albums',
        { artist_id: 'a1', offset: 20 },
        50
    );

    assert.deepEqual(items, available.slice(20, 30));
    assert.equal(total, 30);
    assert.equal(offset, 30);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].limit, 10);
    assert.equal(calls[0].offset, 20);
});

test('fetchPaginated never issues a call with limit above the per-service cap', async () => {
    const available = makeItems(50);
    const calls = [];
    const api = makeApi(available, calls);

    await api.fetchPaginated('search_playlists', { criteria: 'test' }, 50);

    assert.equal(calls.length, 5);
    assert.ok(calls.every(c => c.limit <= 10), 'no call should request more than 10 items');
});

test('searchPlaylists paginates internally and preserves its return shape', async () => {
    const available = makeItems(20, 'playlist');
    const calls = [];
    const api = makeApi(available, calls);

    const res = await api.searchPlaylists('some artist', 12);

    assert.deepEqual(res.result.items, available.slice(0, 12));
    assert.equal(res.result.total, 20);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(c => c.limit <= 10));
});

test('fetchPaginated resolves immediately with an empty array when the artist has zero results', async () => {
    // Real SpotifyPlus response for get_artist_albums on an artist whose only
    // releases are singles/EPs (excluded by the default include_groups=album
    // filter): { total: 0, items_count: 0, items: [], next: null }.
    const calls = [];
    const hass = {
        callWS: async (payload) => {
            const { limit, offset } = payload.service_data;
            calls.push({ limit, offset });
            return { response: { result: { items: [], total: 0 } } };
        }
    };
    const api = new SpotifyApi(hass, 'media_player.test');

    const { items, total } = await api.fetchPaginated('get_artist_albums', { artist_id: 'a1' }, 12);

    assert.deepEqual(items, []);
    assert.equal(total, 0);
    assert.equal(calls.length, 1);
});

test('fetchPaginated keeps going when a page is shorter than requested but total says more remain', async () => {
    // Mirrors a real SpotifyPlus search_playlists response: asked for limit=10,
    // only 8 items came back (server-side de-dup/filtering), but total=11 and
    // `next` pointed at offset=10 — so the real cursor advances by the
    // requested limit, not by how many items were actually returned.
    const pages = {
        0: { items: makeItems(8, 'p'), total: 11 },
        10: { items: makeItems(3, 'q'), total: 11 }
    };
    const calls = [];
    const hass = {
        callWS: async (payload) => {
            const { limit, offset } = payload.service_data;
            calls.push({ limit, offset });
            const page = pages[offset] || { items: [], total: 11 };
            return { response: { result: { items: page.items, total: page.total } } };
        }
    };
    const api = new SpotifyApi(hass, 'media_player.test');

    const { items, total } = await api.fetchPaginated('search_playlists', { criteria: 'test' }, 12);

    assert.equal(items.length, 11);
    assert.equal(total, 11);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(c => c.offset), [0, 10]);
});

// ---------------------------------------------------------------------------
// Concurrent later pages
// ---------------------------------------------------------------------------

// A SpotifyPlus stand-in whose calls stay pending until the test settles them,
// so it can see which calls are in flight together. `respond(limit, offset)`
// returns the `result` for a call; throwing from it fails that call.
function makeHeldApi(respond) {
    const calls = [];
    const stats = { inFlight: 0, maxInFlight: 0 };
    const hass = {
        callWS: (payload) => new Promise((resolve, reject) => {
            const { limit, offset } = payload.service_data;
            stats.inFlight++;
            stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
            calls.push({
                limit, offset, settled: false,
                settle() {
                    this.settled = true;
                    stats.inFlight--;
                    try { resolve({ response: { result: respond(limit, offset) } }); } catch (e) { reject(e); }
                }
            });
        })
    };
    const api = new SpotifyApi(hass, 'media_player.test');
    return { api, calls, stats };
}

// Let everything that is ready to run (promise continuations) run.
const flush = () => new Promise(resolve => setImmediate(resolve));

// Settle held calls one wave at a time until the fetch finishes.
async function settleAll(calls, promise, order = (pending) => pending) {
    let finished = false;
    promise.then(() => { finished = true; }, () => { finished = true; });
    await flush();
    while (!finished) {
        const pending = calls.filter(c => !c.settled);
        assert.ok(pending.length > 0, 'fetch is neither finished nor waiting on a call');
        order(pending).forEach(c => c.settle());
        await flush();
    }
    return promise;
}

function sliceOf(available) {
    return (limit, offset) => ({ items: available.slice(offset, offset + limit), total: available.length });
}

test('fetchPaginated sends the first page alone, then the remaining pages together', async () => {
    const available = makeItems(50);
    const { api, calls, stats } = makeHeldApi(sliceOf(available));

    const promise = api.fetchPaginated('get_artist_albums', { artist_id: 'a1' }, 50);
    await flush();
    assert.equal(calls.length, 1, 'only the first page is issued until it reports `total`');
    assert.deepEqual({ limit: calls[0].limit, offset: calls[0].offset }, { limit: 10, offset: 0 });

    calls[0].settle();
    await flush();
    assert.equal(calls.length, 5, 'pages 2..5 are all issued as soon as page 1 lands');
    assert.equal(stats.inFlight, 4, 'and none of them waits for another');
    assert.deepEqual(calls.map(c => c.offset), [0, 10, 20, 30, 40]);
    assert.deepEqual(calls.map(c => c.limit), [10, 10, 10, 10, 10]);

    calls.slice(1).forEach(c => c.settle());
    const { items, total, offset } = await promise;
    assert.deepEqual(items, available);
    assert.equal(total, 50);
    assert.equal(offset, 50);
});

test('fetchPaginated keeps offset order when later pages resolve first', async () => {
    const available = makeItems(50);
    const { api, calls } = makeHeldApi(sliceOf(available));

    const promise = api.fetchPaginated('get_artist_albums', { artist_id: 'a1' }, 50);
    const { items } = await settleAll(calls, promise, pending => [...pending].reverse());

    assert.deepEqual(items, available);
    assert.equal(calls.length, 5);
});

test('fetchPaginated never has more than MAX_PAGE_CONCURRENCY pages in flight', async () => {
    const available = makeItems(130);
    const { api, calls, stats } = makeHeldApi(sliceOf(available));

    const promise = api.fetchPaginated('get_artist_albums', { artist_id: 'a1' }, 130);
    const { items, offset } = await settleAll(calls, promise);

    assert.equal(SpotifyApi.MAX_PAGE_CONCURRENCY, 4);
    assert.equal(stats.maxInFlight, 4);
    assert.deepEqual(items, available);
    assert.equal(offset, 130);
    assert.equal(calls.length, 13);
    assert.deepEqual(calls.map(c => c.offset), Array.from({ length: 13 }, (_, i) => i * 10));
    assert.ok(calls.every(c => c.limit === 10));
});

test('fetchPaginated ends at an empty page even though the pages issued with it return items', async () => {
    // total says 100, but the page at offset 20 comes back empty. The pages at
    // 30 and 40 were issued alongside it and do return items; a page-at-a-time
    // loop would have stopped at 20 and never seen them, so they are dropped.
    const available = makeItems(100);
    const { api, calls } = makeHeldApi((limit, offset) => ({
        items: offset === 20 ? [] : available.slice(offset, offset + limit),
        total: available.length
    }));

    const promise = api.fetchPaginated('get_artist_albums', { artist_id: 'a1' }, 100);
    const { items, total, offset } = await settleAll(calls, promise);

    assert.deepEqual(items, available.slice(0, 20));
    assert.equal(total, 100);
    assert.equal(offset, 30, 'offset is just past the empty page, as with one page at a time');
    assert.deepEqual(calls.map(c => c.offset), [0, 10, 20, 30, 40], 'nothing is requested after the batch that hit the empty page');
});

test('fetchPaginated treats a failed page like an empty one', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const available = makeItems(50);
    const { api, calls } = makeHeldApi((limit, offset) => {
        if (offset === 30) throw new Error('boom');
        return { items: available.slice(offset, offset + limit), total: available.length };
    });

    const promise = api.fetchPaginated('get_artist_albums', { artist_id: 'a1' }, 50);
    const { items, total, offset } = await settleAll(calls, promise);

    assert.deepEqual(items, available.slice(0, 30));
    assert.equal(total, 50);
    assert.equal(offset, 40);
    assert.equal(calls.length, 5);
});

test('fetchPaginated stays one page at a time when the response carries no total', async () => {
    const available = makeItems(25);
    const { api, calls, stats } = makeHeldApi((limit, offset) => ({ items: available.slice(offset, offset + limit) }));

    const promise = api.fetchPaginated('get_artist_albums', { artist_id: 'a1' }, 50);
    const { items, total, offset } = await settleAll(calls, promise);

    assert.equal(stats.maxInFlight, 1);
    assert.deepEqual(items, available);
    assert.equal(total, 25, 'falls back to the number of items collected');
    // 10 + 10 + 5 (short, but not empty) + an empty page that ends it.
    assert.deepEqual(calls.map(c => c.offset), [0, 10, 20, 30]);
    assert.deepEqual(calls.map(c => c.limit), [10, 10, 10, 10]);
    assert.equal(offset, 40);
});

test('fetchPaginated does not send a final partial page until the pages before it are in', async () => {
    // 25 wanted = 10 + 10 + 5, but the last limit depends on how many items the
    // second page really returns (here 8, so one page at a time asks for 7).
    const available = makeItems(60);
    const { api, calls, stats } = makeHeldApi((limit, offset) => ({
        items: available.slice(offset, offset + (offset === 10 ? 8 : limit)),
        total: available.length
    }));

    const promise = api.fetchPaginated('get_artist_albums', { artist_id: 'a1' }, 25);
    const { items, offset } = await settleAll(calls, promise);

    assert.equal(stats.maxInFlight, 1);
    assert.deepEqual(calls.map(c => [c.limit, c.offset]), [[10, 0], [10, 10], [7, 20]]);
    assert.equal(items.length, 25);
    assert.equal(offset, 27);
});

// The page-at-a-time loop fetchPaginated used before pages were sent together.
async function fetchPaginatedOneAtATime(api, service, baseParams, desiredTotal, maxLimit = SpotifyApi.MAX_PAGE_LIMIT) {
    const items = [];
    let offset = baseParams.offset || 0;
    let total = null;
    while (items.length < desiredTotal) {
        if (total !== null && offset >= total) break;
        const limit = Math.min(maxLimit, desiredTotal - items.length);
        const res = await api.fetchSpotifyPlus(service, { ...baseParams, limit, offset });
        const page = res?.result?.items || [];
        if (total === null) total = res?.result?.total ?? null;
        items.push(...page);
        offset += limit;
        if (page.length === 0) break;
        if (total !== null && offset >= total) break;
    }
    return { items, total: total ?? items.length, offset };
}

test('fetchPaginated makes the same calls and returns the same result as one page at a time', async () => {
    // `short` trims that many items off every page that starts on an odd
    // multiple of the limit, mimicking Spotify's filtered/de-duped pages.
    const run = async (fetcher, { available, desired, maxLimit, base, short }) => {
        const calls = [];
        const hass = {
            callWS: async (payload) => {
                const { limit, offset } = payload.service_data;
                calls.push([limit, offset]);
                let page = available.slice(offset, offset + limit);
                if (short && (offset / maxLimit) % 2 === 1) page = page.slice(0, Math.max(1, page.length - short));
                return { response: { result: { items: page, total: available.length } } };
            }
        };
        const api = new SpotifyApi(hass, 'media_player.test');
        const result = await fetcher(api, 'search_tracks', { criteria: 'x', offset: base }, desired, maxLimit);
        return { calls, result };
    };

    let cases = 0;
    for (const size of [0, 3, 10, 11, 23, 50, 95, 200]) {
        for (const desired of [1, 5, 10, 12, 20, 25, 37, 50, 100, 130]) {
            for (const maxLimit of [7, 10, 50]) {
                for (const base of [0, 20]) {
                    for (const short of [0, 2]) {
                        const scenario = { available: makeItems(size), desired, maxLimit, base, short };
                        const expected = await run(fetchPaginatedOneAtATime, scenario);
                        const actual = await run((api, ...args) => api.fetchPaginated(...args), scenario);
                        const label = JSON.stringify({ size, desired, maxLimit, base, short });
                        assert.deepEqual(actual.result, expected.result, `result differs for ${label}`);
                        assert.deepEqual(actual.calls, expected.calls, `calls differ for ${label}`);
                        cases++;
                    }
                }
            }
        }
    }
    assert.equal(cases, 960);
});

test('fetchPaginated flags a first call that failed (failed: true), unlike a list that is genuinely empty', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const run = async (reply) => {
        const hass = { callWS: async () => reply() };
        return new SpotifyApi(hass, 'media_player.test').fetchPaginated('get_artist_albums', { artist_id: 'a1' }, 50);
    };
    assert.deepEqual(await run(() => { throw new Error('down'); }), { items: [], total: 0, offset: 10, failed: true });
    assert.deepEqual(await run(() => ({ response: { result: null } })), { items: [], total: 0, offset: 10, failed: true });
    assert.deepEqual(await run(() => ({ response: { result: { items: [], total: 0 } } })), { items: [], total: 0, offset: 10 });
});

test('fetchPaginated: a later page failing is not a failed read', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const available = makeItems(30);
    let n = 0;
    const hass = { callWS: async ({ service_data: { limit, offset } }) => {
        if (n++ === 0) return { response: { result: { items: available.slice(offset, offset + limit) } } }; // no total: one page at a time
        throw new Error('down');
    } };
    const res = await new SpotifyApi(hass, 'media_player.test').fetchPaginated('search_tracks', { criteria: 'x' }, 30);
    assert.deepEqual(res, { items: available.slice(0, 10), total: 10, offset: 20 });
});
