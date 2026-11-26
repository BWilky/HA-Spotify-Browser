import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definedElement } from './helpers/elements.js';
import '../src/components/views/spotify-library.js';
import { PinnedItemsManager } from '../src/components/controllers/pinned-items-manager.js';

// The library's row "…" menu (D4/D5) and how the library follows a
// `playlist-changed` (the app passes each one on: library.playlistChanged).
// The element is not rendered: a bare instance with the fields its methods
// read, and the menu opened the way a row's button opens it.

const Library = definedElement('spotify-library');

const img = (seed) => [{ url: `https://img.test/${seed}.png`, width: 64, height: 64 }];
const playlist = (id, extra = {}) => ({
    id, type: 'playlist', uri: `spotify:playlist:${id}`, name: `Playlist ${id}`, images: img(id), description: 'desc',
    owner: { id: 'someone', display_name: 'Someone' }, public: true, collaborative: false, ...extra,
});
const OWN = playlist('pown', { owner: { id: 'me', display_name: 'Me' } });
const SHARED = playlist('pcol', { public: false, collaborative: true });
const FOLLOWED = playlist('p1');
const ALBUM = { id: 'al1', type: 'album', uri: 'spotify:album:al1', name: 'Album 1', images: img('al1'), artists: [{ id: 'ar1', name: 'Artist 1' }] };

function makeApi({ follows = {}, fail = false } = {}) {
    const calls = [];
    const result = () => (fail ? { success: false, error: new Error('boom') } : { success: true });
    return {
        calls,
        async getCurrentUserId() { calls.push(['getCurrentUserId']); return 'me'; },
        async checkUserFollowsPlaylist(id, user) { calls.push(['checkUserFollowsPlaylist', id, user]); return [follows[id] ?? false]; },
        async changePlaylistDetails(id, opts) { calls.push(['changePlaylistDetails', id, opts]); return result(); },
        async followPlaylist(id) { calls.push(['followPlaylist', id]); return result(); },
        async unfollowPlaylist(id) { calls.push(['unfollowPlaylist', id]); return result(); },
    };
}

function makePinned(stored = []) {
    const store = { pinned_items: stored };
    const storage = {
        writeStatus: () => 'ok', sensorEntity: 'sensor.spotify_browser_data',
        getData: (k) => store[k],
        async saveData(k, v) { store[k] = v; return { success: true }; },
    };
    const pinned = new PinnedItemsManager(null, { entity: 'media_player.spotify' }, storage);
    pinned.store = store;
    return pinned;
}

/** A library holding `playlists` (Playlists filter) and `recent`, with recorded events. */
function makeLibrary({ filter = 'playlist', playlists = [OWN, SHARED, FOLLOWED], recent = null, api = makeApi(), pinned = makePinned() } = {}) {
    const lib = Object.create(Library.prototype);
    const events = [];
    Object.assign(lib, {
        api, pinned, _filter: filter, _playlists: playlists, _recent: recent, _albums: null, _artists: null,
        _loading: {}, _paging: {}, refreshes: 0,
    });
    lib.requestUpdate = () => {};
    lib.refresh = () => { lib.refreshes++; };
    lib.dispatchEvent = (e) => { events.push(e); return true; };
    return { lib, events, api, pinned };
}

const RECT = { x: 1, y: 2, width: 3, height: 4 };
const click = () => ({ stopPropagation() {}, currentTarget: { getBoundingClientRect: () => RECT } });

/** Open a row's menu; resolves to the open-context-menu detail (or null when none opened). */
async function openMenu(lib, events, item, type = 'playlist') {
    const before = events.length;
    await lib._openRowMenu(click(), item, type);
    const opened = events.slice(before).filter(e => e.type === 'open-context-menu');
    return opened.length ? opened[0].detail : null;
}

/** The events dispatched since `from`, as [type, detail] (functions dropped). */
const since = (events, from) => events.slice(from).map(e => [e.type, e.detail && JSON.parse(JSON.stringify(e.detail))]);
const settle = () => new Promise(r => setTimeout(r, 0));

// ---- The menu per role ------------------------------------------------------

test('Playlists filter, owner: the playlist page\'s owner menu, in its order, with its labels and icons', async () => {
    const { lib, events, api } = makeLibrary();
    const menu = await openMenu(lib, events, OWN);
    assert.deepEqual(menu.items, [
        { id: 'pm-edit', label: 'Edit Playlist', icon: 'pencil' },
        { id: 'pm-toggle-public', label: 'Make Private', icon: 'lock' },
        { id: 'pm-toggle-collab', label: 'Make Collaborative', icon: 'people' },
        { id: 'pm-pin', label: 'Pin to Home', icon: 'pin' },
        { id: 'pm-delete', label: 'Delete Playlist', icon: 'trash', danger: true },
    ]);
    assert.deepEqual(menu.header, { image: 'https://img.test/pown.png', name: 'Playlist pown', subtitle: 'Playlist' });
    assert.equal(menu.anchor, RECT);
    assert.deepEqual(api.calls, [['getCurrentUserId']], 'no follow check for your own playlist');
});

test('Playlists filter, collaborator (D5) and follower: no follow check (the filter lists followed playlists)', async () => {
    const { lib, events, api } = makeLibrary();
    assert.deepEqual((await openMenu(lib, events, SHARED)).items, [
        { id: 'pm-edit', label: 'Edit Playlist', icon: 'pencil' },
        { id: 'pm-unfollow', label: 'Remove from Your Library', icon: 'heart-filled' },
        { id: 'pm-pin', label: 'Pin to Home', icon: 'pin' },
    ]);
    assert.deepEqual((await openMenu(lib, events, FOLLOWED)).items, [
        { id: 'pm-unfollow', label: 'Remove from Your Library', icon: 'heart-filled' },
        { id: 'pm-pin', label: 'Pin to Home', icon: 'pin' },
    ]);
    assert.equal(api.calls.some(c => c[0] === 'checkUserFollowsPlaylist'), false);
});

test('Recents: a playlist you do not own is checked, as the playlist page does ("Add to" when not followed)', async () => {
    const api = makeApi({ follows: { pcol: true } });
    const { lib, events } = makeLibrary({ filter: null, playlists: null, recent: [SHARED, FOLLOWED, ALBUM], api });
    assert.deepEqual((await openMenu(lib, events, FOLLOWED)).items.map(i => i.label), ['Add to Your Library', 'Pin to Home']);
    assert.deepEqual((await openMenu(lib, events, SHARED)).items.map(i => i.label), ['Edit Playlist', 'Remove from Your Library', 'Pin to Home']);
    assert.deepEqual(api.calls.filter(c => c[0] === 'checkUserFollowsPlaylist'), [['checkUserFollowsPlaylist', 'p1', 'me'], ['checkUserFollowsPlaylist', 'pcol', 'me']]);
});

test('a row without the settings fields gets no settings items (hidden, not guessed)', async () => {
    const { lib, events } = makeLibrary();
    const bare = { id: 'pown', type: 'playlist', name: 'Playlist pown', owner: { id: 'me' } };
    assert.deepEqual((await openMenu(lib, events, bare)).items.map(i => i.label), ['Edit Playlist', 'Pin to Home', 'Delete Playlist']);
});

test('album rows keep their menu: Go to Artist', async () => {
    const { lib, events } = makeLibrary({ filter: 'album' });
    const menu = await openMenu(lib, events, ALBUM, 'album');
    assert.deepEqual(menu.items, [{ id: 'lm-artist', label: 'Go to Artist', icon: 'artist' }]);
    assert.deepEqual(menu.header.subtitle, 'Album');
    const from = events.length;
    menu.onAction('lm-artist');
    assert.deepEqual(since(events, from), [['navigate', { pageId: 'artist:ar1', data: { title: 'Artist 1', type: 'artist', subtitle: 'Artist' } }]]);
});

// ---- The actions ------------------------------------------------------------

test('Make Private from a row: the call, the toast, playlist-changed; the patch updates the row and its next menu', async () => {
    const { lib, events, api } = makeLibrary({ recent: [OWN, ALBUM] });
    const menu = await openMenu(lib, events, OWN);
    const from = events.length;
    await menu.onAction('pm-toggle-public');
    await settle();
    assert.deepEqual(api.calls.at(-1), ['changePlaylistDetails', 'pown', { name: 'Playlist pown', description: 'desc', isPublic: false, collaborative: false }]);
    const changed = since(events, from);
    assert.deepEqual(changed, [
        ['show-toast', { message: 'Playlist is now private' }],
        ['playlist-changed', { playlistId: 'pown', action: 'edit', patch: { public: false, collaborative: false } }],
    ]);
    // The app passes the change on (see appPlaylistChanged.test.js).
    lib.playlistChanged(changed[1][1]);
    assert.equal(lib.refreshes, 0, 'patched in place, not re-read');
    const row = lib._playlists.find(p => p.id === 'pown');
    assert.equal(row.public, false);
    assert.equal(lib._recent[0].public, false, 'Recents row too');
    assert.equal(OWN.public, true, 'rows are replaced, not mutated');
    assert.deepEqual((await openMenu(lib, events, row)).items.map(i => i.label),
        ['Edit Playlist', 'Make Public', 'Make Collaborative', 'Pin to Home', 'Delete Playlist']);
});

test('Make Collaborative from a row: patched to private + collaborative', async () => {
    const { lib, events } = makeLibrary();
    const menu = await openMenu(lib, events, OWN);
    const from = events.length;
    await menu.onAction('pm-toggle-collab');
    await settle();
    const [, change] = since(events, from);
    assert.deepEqual(change, ['playlist-changed', { playlistId: 'pown', action: 'edit', patch: { public: false, collaborative: true } }]);
    lib.playlistChanged(change[1]);
    const row = lib._playlists.find(p => p.id === 'pown');
    assert.deepEqual((await openMenu(lib, events, row)).items.map(i => i.label),
        ['Edit Playlist', 'Make Public', 'Remove Collaborative', 'Pin to Home', 'Delete Playlist']);
});

test('Remove from Your Library from a row: unfollow, toast, playlist-changed; the row is dropped', async () => {
    const { lib, events, api } = makeLibrary({ recent: [ALBUM, FOLLOWED] });
    lib._paging.playlist = { offset: 50, after: null, hasMore: true, visible: 50 };
    const menu = await openMenu(lib, events, FOLLOWED);
    const from = events.length;
    await menu.onAction('pm-unfollow');
    await settle();
    assert.deepEqual(api.calls.at(-1), ['unfollowPlaylist', 'p1']);
    const changed = since(events, from);
    assert.deepEqual(changed, [
        ['show-toast', { message: 'Removed from your library.' }],
        ['playlist-changed', { playlistId: 'p1', action: 'unfollow' }],
    ]);
    lib.playlistChanged(changed[1][1]);
    assert.deepEqual(lib._playlists.map(p => p.id), ['pown', 'pcol']);
    assert.deepEqual(lib._recent.map(p => p.id), ['al1']);
    assert.equal(lib._paging.playlist.offset, 49, 'the next page starts where Spotify\'s list now is');
    assert.equal(lib.refreshes, 0);
});

test('a failed unfollow: the failure toast, no playlist-changed, the row stays', async () => {
    const { lib, events } = makeLibrary({ api: makeApi({ fail: true }) });
    const menu = await openMenu(lib, events, FOLLOWED);
    const from = events.length;
    await menu.onAction('pm-unfollow');
    await settle();
    assert.deepEqual(since(events, from), [['show-toast', { message: 'Failed to unfollow playlist.' }]]);
    assert.equal(lib._playlists.length, 3);
});

test('Add to Your Library from a Recents row: follow, toast, playlist-changed {follow}', async () => {
    const { lib, events, api } = makeLibrary({ filter: null, playlists: null, recent: [FOLLOWED] });
    const menu = await openMenu(lib, events, FOLLOWED);
    const from = events.length;
    await menu.onAction('pm-follow');
    await settle();
    assert.deepEqual(api.calls.at(-1), ['followPlaylist', 'p1']);
    assert.deepEqual(since(events, from), [
        ['show-toast', { message: 'Added to your library.' }],
        ['playlist-changed', { playlistId: 'p1', action: 'follow' }],
    ]);
});

test('Edit Playlist from a row, owner and collaborator: open the playlist page in edit mode', async () => {
    for (const item of [OWN, SHARED]) {
        const { lib, events } = makeLibrary();
        const menu = await openMenu(lib, events, item);
        const from = events.length;
        menu.onAction('pm-edit');
        assert.deepEqual(since(events, from), [['navigate', { pageId: `playlist:${item.id}`, data: { title: item.name, type: 'playlist', autoEdit: true } }]]);
    }
});

test('Delete Playlist from a row: the same alert as the page; confirmed -> "Playlist deleted" and playlist-changed', async () => {
    const { lib, events, api } = makeLibrary();
    const menu = await openMenu(lib, events, OWN);
    const from = events.length;
    menu.onAction('pm-delete');
    const alert = events[from];
    assert.equal(alert.type, 'show-alert');
    assert.deepEqual(Object.keys(alert.detail), ['title', 'message', 'confirmText', 'onConfirm'], 'no cancelText: the alert\'s default, as on the page');
    assert.equal(await alert.detail.onConfirm(), true);
    assert.deepEqual(api.calls.at(-1), ['unfollowPlaylist', 'pown']);
    assert.deepEqual(since(events, from + 1), [
        ['show-toast', { message: 'Playlist deleted' }],
        ['playlist-changed', { playlistId: 'pown', action: 'delete' }],
    ]);
});

test('Pin to Home from a row on a full list (D2): pinned-changed and "Removed <name> to make room"', async () => {
    const stored = Array.from({ length: 7 }, (_, i) => ({ id: 'u' + i, type: 'album', name: 'Old ' + i, title: 'Old ' + i }));
    const { lib, events, pinned } = makeLibrary({ pinned: makePinned(stored) });
    const menu = await openMenu(lib, events, FOLLOWED);
    const from = events.length;
    await menu.onAction('pm-pin');
    await settle();
    assert.deepEqual(since(events, from), [['pinned-changed', null], ['show-toast', { message: 'Removed Old 6 to make room' }]]);
    assert.equal(pinned.store.pinned_items[1].id, 'p1');
    assert.deepEqual((await openMenu(lib, events, FOLLOWED)).items.map(i => i.label), ['Remove from Your Library', 'Unpin from Home']);
});

// ---- playlistChanged --------------------------------------------------------

test('playlistChanged: create, delete, items, follow and a patchless edit re-read the library', () => {
    const { lib } = makeLibrary();
    for (const detail of [
        { playlistId: 'p9', action: 'create' }, { playlistId: 'pown', action: 'delete' },
        { playlistId: 'pown', action: 'items', patch: { name: 'x' } }, { playlistId: 'p1', action: 'follow' },
        { playlistId: 'pown', action: 'edit' }, {},
    ]) lib.playlistChanged(detail);
    assert.equal(lib.refreshes, 6);
    assert.equal(lib._playlists.length, 3, 'rows untouched until the re-read');
});

test('playlistChanged: a patch or an unfollow for a playlist not shown changes nothing; unloaded lists stay unloaded', () => {
    const { lib } = makeLibrary({ playlists: null, recent: null });
    lib.playlistChanged({ playlistId: 'p1', action: 'unfollow' });
    lib.playlistChanged({ playlistId: 'p1', action: 'edit', patch: { public: false } });
    assert.equal(lib._playlists, null);
    assert.equal(lib._recent, null);
    const shown = makeLibrary();
    const before = shown.lib._playlists;
    shown.lib.playlistChanged({ playlistId: 'nope', action: 'unfollow' });
    assert.equal(shown.lib._playlists, before, 'same list: nothing re-renders');
    assert.equal(shown.lib.refreshes, 0);
});
