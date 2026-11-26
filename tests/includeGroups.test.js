import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageLoaders, loadMore } from '../src/components/controllers/page-loaders.js';
import { stubApi, makeHost, flush, album, artist, range } from './pageLoaderStubs.js';

// Which release groups each artist surface asks get_artist_albums for. There
// are exactly three requests: the artist page's Albums rail, the full
// discography page, and the discography's "Load More" continuation. These
// drive the real loaders and read the parameters off the recorded calls.

const albumsCalls = (api) => api.calls.filter(([m, service]) => m === 'fetchPaginated' && service === 'get_artist_albums');

function artistApi() {
    return stubApi({
        'fetchSpotifyPlus:get_artist': { result: artist(1) },
        'fetchPaginated:get_artist_albums': { items: range(10, album), total: 23, offset: 10 },
        'fetchSpotifyPlus:get_artist_top_tracks': { result: [] },
        'fetchPaginated:search_tracks': { items: [], total: 0, offset: 10 },
        searchPlaylists: { result: { items: [] } },
    });
}

function discographyApi() {
    return stubApi({
        'fetchPaginated:get_artist_albums': (params, n) => ({ items: range(Math.min(n, 120 - (params.offset || 0)), album, params.offset || 0), total: 120, offset: (params.offset || 0) + n }),
    });
}

test('artist page Albums rail requests include_groups=album,single (10 items)', async () => {
    const api = artistApi();
    const host = makeHost({ pageId: 'artist:ar1', type: 'artist', id: 'ar1', api });
    await pageLoaders.artist(host.ctx);
    await flush();

    const calls = albumsCalls(api);
    assert.equal(calls.length, 1, 'the artist page asks for albums once');
    assert.deepEqual(calls[0], ['fetchPaginated', 'get_artist_albums', { artist_id: 'ar1', include_groups: 'album,single' }, 10]);
});

test('full discography page requests include_groups=album,single,compilation (50 items)', async () => {
    const api = discographyApi();
    const host = makeHost({ pageId: 'artist-discography:ar1', type: 'artist-discography', id: 'ar1', api, options: { artistName: 'Artist 1' } });
    await pageLoaders['artist-discography'](host.ctx);

    const calls = albumsCalls(api);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ['fetchPaginated', 'get_artist_albums', { artist_id: 'ar1', include_groups: 'album,single,compilation' }, 50]);
});

test('discography "Load More" continuation uses the same include_groups as the initial discography load', async () => {
    const api = discographyApi();
    const host = makeHost({ pageId: 'artist-discography:ar1', type: 'artist-discography', id: 'ar1', api, options: { artistName: 'Artist 1' } });
    await pageLoaders['artist-discography'](host.ctx);
    await loadMore(host.ctx);

    const [initial, more] = albumsCalls(api);
    assert.deepEqual(more, ['fetchPaginated', 'get_artist_albums', { artist_id: 'ar1', include_groups: 'album,single,compilation', offset: 50 }, 50]);
    assert.equal(more[2].include_groups, initial[2].include_groups);
    assert.doesNotMatch(more[2].include_groups, /appears_on/);
});
