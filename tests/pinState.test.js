import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PinStateController } from '../src/components/controllers/pin-state-controller.js';
import { PinnedItemsManager } from '../src/components/controllers/pinned-items-manager.js';

/** A PinnedItemsManager over an in-memory storage stub. */
function makeManager({ stored = [], status = 'ok', config = {} } = {}) {
    const storage = {
        data: { pinned_items: stored },
        writeStatus: () => status,
        getData(key) { return this.data[key]; },
        sensorEntity: 'sensor.spotify_browser_storage',
        saveFails: false,
        async saveData(key, items) {
            if (this.saveFails) return { success: false, error: 'boom' };
            this.data[key] = items;
            return { success: true };
        },
    };
    const m = new PinnedItemsManager(null, { entity: 'media_player.spotify', ...config }, storage);
    m.storage = storage;
    return m;
}

function setup({ pinned = makeManager(), data = { id: 'p1', type: 'playlist', name: 'Mix', uri: 'spotify:playlist:p1' } } = {}) {
    const events = [];
    const host = {
        pinned,
        data,
        updates: 0,
        controllers: [],
        addController(c) { this.controllers.push(c); },
        requestUpdate() { this.updates++; },
        dispatchEvent(e) { events.push(e); return true; },
    };
    const pin = new PinStateController(host, {
        getPinId: () => host.data.type === 'likedsongs' ? 'user-library' : host.data.id,
        getPinItem: () => ({ id: host.data.id, type: host.data.type, name: host.data.name, uri: host.data.uri }),
    });
    return { pin, host, events };
}

test('registers with the host; nothing shown before a check', () => {
    const { pin, host } = setup();
    assert.equal(host.controllers[0], pin);
    assert.equal(pin.entity, null);
    assert.equal(pin.isPinned, false);
});

test('check: an editor sees the button with the pinned state as Home shows it', async () => {
    const { pin, host } = setup({ pinned: makeManager({ stored: [{ id: 'p1' }] }) });
    await pin.check();
    assert.equal(pin.isPinned, true);
    assert.equal(pin.entity, 'sensor.spotify_browser_storage');
    assert.equal(host.updates, 2);
    await pin.check();
    assert.equal(host.updates, 2, 'no re-render when nothing changed');
});

test('check: a user who cannot edit pins gets no button', async () => {
    const { pin } = setup({ pinned: makeManager({ stored: [{ id: 'p1' }], status: 'read_only' }) });
    await pin.check();
    assert.equal(pin.entity, null);
    assert.equal(pin.isPinned, false);
});

test('check: no manager or no page -> nothing happens', async () => {
    const a = setup({ pinned: null });
    await a.pin.check();
    const b = setup({ data: null });
    await b.pin.check();
    assert.equal(a.host.updates + b.host.updates, 0);
});

test('check: Liked Songs is always pinned; config pins count; ids are read after the lookup', async () => {
    const liked = setup({ data: { id: 'me', type: 'likedsongs' } });
    await liked.pin.check();
    assert.equal(liked.pin.isPinned, true);

    const cfg = setup({ pinned: makeManager({ config: { home: { pinned: { items: [{ id: 'c1', type: 'album' }] } } } }), data: { id: 'c1', type: 'album' } });
    await cfg.pin.check();
    assert.equal(cfg.pin.isPinned, true);

    const { pin, host } = setup({ pinned: makeManager({ stored: [{ id: 'p2' }] }) });
    const p = pin.check();
    host.data = { id: 'p2', type: 'playlist' }; // swapped while getItems() was pending
    await p;
    assert.equal(pin.isPinned, true);
});

test('check: matches Home\'s pinned row (and isPinned()) for a stored list over the cap', async () => {
    const stored = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => ({ id }));
    const pinned = makeManager({ stored });
    const { pin } = setup({ pinned, data: { id: 'h', type: 'playlist' } });
    await pin.check();
    assert.equal(pin.isPinned, false, 'the 8th stored pin is not in the row');
    assert.equal(pinned.isPinned('h'), false, 'the manager agrees');
});

test('toggle: pins, flips the state and tells Home', async () => {
    const pinned = makeManager();
    const { pin, events } = setup({ pinned });
    await pin.check();
    assert.equal(pin.isPinned, false);
    await pin.toggle();
    assert.equal(pin.isPinned, true);
    assert.equal(pinned.storage.data.pinned_items.some(i => i.id === 'p1'), true);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'pinned-changed');
    assert.equal(events[0].bubbles && events[0].composed, true);
    await pin.toggle();
    assert.equal(pin.isPinned, false);
    assert.equal(pinned.storage.data.pinned_items.some(i => i.id === 'p1'), false);
});

test('toggle: a failure keeps the state and shows an alert with the reason', async () => {
    const pinned = makeManager();
    pinned.storage.saveFails = true;
    const { pin, events } = setup({ pinned });
    await pin.check();
    await pin.toggle();
    assert.equal(pin.isPinned, false);
    assert.equal(events[0].type, 'show-alert');
    assert.deepEqual(events[0].detail, { title: 'Pinning Failed', message: 'boom', confirmText: 'OK', size: 'mini' });
});

test('toggle: does nothing until a check showed the button', async () => {
    const { pin, events } = setup();
    await pin.toggle();
    assert.equal(events.length, 0);
});

test('toggle is bound (usable directly as a listener)', async () => {
    const { pin } = setup();
    await pin.check();
    const listener = pin.toggle;
    await listener.call({ notTheController: true });
    assert.equal(pin.isPinned, true);
});
