import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfigPins, buildPinnedRow } from '../components/controllers/home-content.js';

function fakeApi(calls) {
    return {
        async fetchSpotifyPlus(method, params) {
            calls.push([method, params]);
            if (method === 'get_playlist_cover_image') return { result: { url: 'cover.jpg' } };
            if (method === 'get_playlist') return { result: { id: params.playlist_id, name: 'PL ' + params.playlist_id, type: 'playlist', uri: 'spotify:playlist:' + params.playlist_id, images: [{ url: 'pl.jpg' }], owner: { display_name: 'Me' } } };
            if (method === 'get_album') return { result: { id: params.album_id, name: 'AL', type: 'album', uri: 'spotify:album:' + params.album_id, images: [{ url: 'al.jpg' }], artists: [{ name: 'Band' }] } };
            if (method === 'get_artist') return { result: { id: params.artist_id, name: 'AR', type: 'artist', uri: 'spotify:artist:' + params.artist_id, images: [{ url: 'ar.jpg' }] } };
            throw new Error('unexpected ' + method);
        },
    };
}

test('recommended playlists resolve artwork through the cover-image endpoint', async () => {
    const calls = [];
    const items = await loadConfigPins(fakeApi(calls), [{ id: 'dm1', type: 'playlist', title: 'Daily Mix 1', recommended: true }]);
    assert.deepEqual(calls, [['get_playlist_cover_image', { playlist_id: 'dm1' }]]);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'dm1');
    assert.equal(items[0].name, 'Daily Mix 1');
    assert.equal(items[0].title, 'Daily Mix 1');
    assert.equal(items[0].type, 'playlist');
    assert.equal(items[0].uri, 'spotify:playlist:dm1');
    assert.equal(items[0].image, 'cover.jpg');
    assert.equal(items[0].fixed, true);
});

test('plain playlist, album and artist ids are fetched by type', async () => {
    const calls = [];
    const items = await loadConfigPins(fakeApi(calls), [
        { id: 'pl1', type: 'playlist' },
        { id: 'al1', type: 'album' },
        { id: 'ar1', type: 'artist' },
    ]);
    assert.deepEqual(calls.map(c => c[0]), ['get_playlist', 'get_album', 'get_artist']);
    assert.deepEqual(items.map(i => [i.id, i.type, i.name, i.image, i.uri]), [
        ['pl1', 'playlist', 'PL pl1', 'pl.jpg', 'spotify:playlist:pl1'],
        ['al1', 'album', 'AL', 'al.jpg', 'spotify:album:al1'],
        ['ar1', 'artist', 'AR', 'ar.jpg', 'spotify:artist:ar1'],
    ]);
    assert.equal(items[1].subtitle, 'Band');
});

test('a config title overrides the fetched name', async () => {
    const items = await loadConfigPins(fakeApi([]), [{ id: 'pl1', type: 'playlist', title: 'Top Hits' }]);
    assert.equal(items[0].name, 'Top Hits');
});

test('a fetch failure drops that item and keeps the rest', async () => {
    const api = { async fetchSpotifyPlus(m, p) { if (p.playlist_id === 'bad') throw new Error('nope'); return { result: { id: p.playlist_id, name: 'ok', images: [] } }; } };
    const items = await loadConfigPins(api, [{ id: 'bad', type: 'playlist' }, { id: 'good', type: 'playlist' }]);
    assert.deepEqual(items.map(i => i.id), ['good']);
});

test('loadConfigPins returns [] without an api or items', async () => {
    assert.deepEqual(await loadConfigPins(null, [{ id: 'x', type: 'playlist' }]), []);
    assert.deepEqual(await loadConfigPins(fakeApi([]), []), []);
});

test('buildPinnedRow tops pins up to 8 with recent items not already pinned', () => {
    const pins = [{ id: 'lib' }, { id: 'c1', fixed: true }, { id: 'u1' }];
    const recent = [{ id: 'u1' }, { id: 'r1', type: 'album' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }, { id: 'r5' }, { id: 'r6' }, { id: 'r7' }];
    const row = buildPinnedRow(pins, recent);
    assert.deepEqual(row.map(i => i.id), ['lib', 'c1', 'u1', 'r1', 'r2', 'r3', 'r4', 'r5']);
    assert.equal(row[3].type, 'album');
    assert.equal(row[4].type, 'album'); // recent items default to album
});

test('buildPinnedRow never trims pins, even past 8', () => {
    const pins = Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i }));
    const row = buildPinnedRow(pins, [{ id: 'r1' }]);
    assert.deepEqual(row.map(i => i.id), pins.map(i => i.id));
});

test('buildPinnedRow returns null while pins are still loading', () => {
    assert.equal(buildPinnedRow(null, []), null);
});
