import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpotifyApi } from '../api.js';

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
