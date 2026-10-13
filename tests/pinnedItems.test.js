import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PinnedItemsManager, USER_LIBRARY_ITEM } from '../components/controllers/pinned-items-manager.js';

function fakeStorage(items, status = 'ok') {
    const store = { pinned_items: items };
    return {
        store,
        getData: (k) => store[k],
        writeStatus: () => status,
        async saveData(k, v) { store[k] = v; return { success: true }; },
        updateHass() {},
    };
}

const homeCfg = (items, extra = {}) => ({ entity: 'media_player.a', accounts: [], home: { pinned: { enabled: true, scope: 'shared', items } }, ...extra });
const CFG = [{ id: 'dm1', type: 'playlist', title: 'Daily Mix 1', recommended: true }];

test('getItems lists Liked Songs, then config pins (fixed), then user pins', async () => {
    const m = new PinnedItemsManager({}, homeCfg(CFG), fakeStorage([{ id: 'u1', type: 'album', name: 'U1' }]));
    const items = await m.getItems();
    assert.deepEqual(items.map(i => i.id), ['user-library', 'dm1', 'u1']);
    assert.equal(items[1].fixed, true);
    assert.equal(items[1].title, 'Daily Mix 1');
    assert.equal(items[2].fixed, undefined);
});

test('resolved config pins (with artwork) replace the config placeholders', async () => {
    const m = new PinnedItemsManager({}, homeCfg(CFG), fakeStorage([]));
    m.setResolvedConfigPins([{ id: 'dm1', type: 'playlist', name: 'Daily Mix 1', image: 'cover.jpg', fixed: true }]);
    const items = await m.getItems();
    assert.equal(items[1].image, 'cover.jpg');
});

test('a user pin that duplicates a config pin is hidden', async () => {
    const m = new PinnedItemsManager({}, homeCfg(CFG), fakeStorage([{ id: 'dm1', type: 'playlist' }, { id: 'u1' }]));
    assert.deepEqual((await m.getItems()).map(i => i.id), ['user-library', 'dm1', 'u1']);
});

test('without a storage backend, config pins still show (read-only)', async () => {
    const m = new PinnedItemsManager({}, homeCfg(CFG), fakeStorage(undefined, 'no_backend'));
    assert.equal(m.checkAvailability(), true);
    assert.equal(m.canEdit(), false);
    assert.deepEqual((await m.getItems()).map(i => i.id), ['user-library', 'dm1']);
});

test('without a storage backend and no config pins, the row is unavailable', () => {
    const m = new PinnedItemsManager({}, homeCfg([]), fakeStorage(undefined, 'no_backend'));
    assert.equal(m.checkAvailability(), false);
});

test('config pins count as pinned and cannot be added, removed or toggled', async () => {
    const storage = fakeStorage([]);
    const m = new PinnedItemsManager({}, homeCfg(CFG), storage);
    assert.equal(m.isPinned('dm1'), true);
    const add = await m.add({ id: 'dm1', type: 'playlist' });
    assert.equal(add.success, false);
    const rm = await m.remove('dm1');
    assert.equal(rm.success, false);
    const tg = await m.toggle({ id: 'dm1', type: 'playlist' });
    assert.equal(tg.success, false);
    assert.deepEqual(storage.store.pinned_items, []);
});

test('reorder drops config pins from what gets saved', async () => {
    const storage = fakeStorage([{ id: 'u1' }, { id: 'u2' }]);
    const m = new PinnedItemsManager({}, homeCfg(CFG), storage);
    await m.reorder(['user-library', 'dm1', 'u2', 'u1']);
    assert.deepEqual(storage.store.pinned_items.map(i => i.id), ['user-library', 'u2', 'u1']);
});

test('config pins do not count against the 7 user pins', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ id: 'u' + i }));
    const m = new PinnedItemsManager({}, homeCfg(CFG), fakeStorage(seven));
    const items = await m.getItems();
    assert.equal(items.length, 1 + 1 + 7);
    const add = await m.add({ id: 'u8', type: 'album' });
    assert.equal(add.success, false); // still full for user pins
});

test('USER_LIBRARY_ITEM is marked fixed', () => {
    assert.equal(USER_LIBRARY_ITEM.fixed, true);
});

/* ---------------------- per-account scope ---------------------- */

const ACCOUNTS = [
    { entity: 'media_player.a', name: 'A', pinned: [{ id: 'a-only', type: 'playlist', title: 'A Only' }] },
    { entity: 'media_player.b', name: 'B', pinned: [] },
];
const accountCfg = (scope, stored) => new PinnedItemsManager({}, {
    entity: 'media_player.a',
    accounts: ACCOUNTS,
    home: { pinned: { enabled: true, scope, items: CFG } },
}, fakeStorage(stored));

test('config pins = shared home items, then the active account\'s own items', async () => {
    const m = accountCfg('shared', []);
    assert.deepEqual((await m.getItems()).map(i => i.id), ['user-library', 'dm1', 'a-only']);
    m.setAccount('media_player.b');
    assert.deepEqual((await m.getItems()).map(i => i.id), ['user-library', 'dm1']);
});

test('shared scope: every account reads and writes the one pinned_items list', async () => {
    const storage = fakeStorage([{ id: 'u1' }]);
    const m = new PinnedItemsManager({}, { entity: 'media_player.a', accounts: ACCOUNTS, home: { pinned: { enabled: true, scope: 'shared', items: [] } } }, storage);
    m.setAccount('media_player.b');
    assert.deepEqual((await m.getItems()).map(i => i.id), ['user-library', 'u1']);
    await m.add({ id: 'u2', type: 'album' });
    assert.deepEqual(Object.keys(storage.store), ['pinned_items']);
});

test('account scope: pins live under pinned_items:<entity> and start empty per account', async () => {
    const storage = fakeStorage([{ id: 'shared1' }]);
    storage.store['pinned_items:media_player.b'] = [{ id: 'b1', type: 'album' }];
    const m = new PinnedItemsManager({}, { entity: 'media_player.a', accounts: ACCOUNTS, home: { pinned: { enabled: true, scope: 'account', items: [] } } }, storage);
    assert.deepEqual((await m.getItems()).map(i => i.id), ['user-library', 'a-only']); // not the shared list
    await m.add({ id: 'a1', type: 'album' });
    assert.deepEqual(storage.store['pinned_items:media_player.a'].map(i => i.id), ['user-library', 'a1']);
    assert.deepEqual(storage.store.pinned_items.map(i => i.id), ['shared1']); // untouched

    m.setAccount('media_player.b');
    assert.deepEqual((await m.getItems()).map(i => i.id), ['user-library', 'b1']);
    assert.equal(m.isPinned('a1'), false);
});

test('account scope: hasDataChanged only reacts to the active account\'s list', () => {
    const m = accountCfg('account', []);
    const hassWith = (data) => ({ states: { 'sensor.spotify_browser_data': { attributes: { data } } } });
    const base = { 'pinned_items:media_player.a': [{ id: 'x' }], 'pinned_items:media_player.b': [] };
    const otherAccountChanged = { ...base, 'pinned_items:media_player.b': [{ id: 'y' }] };
    const mineChanged = { ...base, 'pinned_items:media_player.a': [] };
    assert.equal(m.hasDataChanged(hassWith(base), hassWith(otherAccountChanged)), false);
    assert.equal(m.hasDataChanged(hassWith(base), hassWith(mineChanged)), true);
});

test('setAccount drops resolved config pins so the next account resolves its own', async () => {
    const m = accountCfg('shared', []);
    m.setResolvedConfigPins([{ id: 'a-only', type: 'playlist', name: 'A Only', image: 'a.jpg', fixed: true }]);
    assert.equal((await m.getItems()).find(i => i.id === 'a-only').image, 'a.jpg');
    m.setAccount('media_player.b');
    m.setAccount('media_player.a');
    assert.equal((await m.getItems()).find(i => i.id === 'a-only').image, null);
});
