import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StorageManager } from '../components/controllers/storage-manager.js';
import { PinnedItemsManager } from '../components/controllers/pinned-items-manager.js';
import { DeviceManager } from '../components/devices/device-manager.js';

const SENSOR = 'sensor.test_store';
const TIMEOUT = StorageManager.PENDING_WRITE_MS;

/**
 * A fake Home Assistant whose storage sensor only changes when the test says so.
 *   ha.sent       every blob sent to HA, oldest first, as it went over the wire
 *   ha.show(blob) the sensor now shows `blob`; storage gets a new hass, as the app does
 *   ha.land(i)    the sensor catches up with sent blob i (default: the latest)
 *   ha.failWith   set to a message to make writes fail
 *   ha.tick(ms)   advance the injected clock
 */
function fakeHA({ data, sensor = true, admin = true, script = null, config = { sensor: SENSOR } } = {}) {
    const ha = { sent: [], events: [], scriptCalls: [], failWith: null, now: 1_000_000 };
    const transport = (blob) => {
        if (ha.failWith) throw new Error(ha.failWith);
        ha.sent.push(JSON.parse(JSON.stringify(blob)));
    };
    const makeHass = (states) => ({
        user: { is_admin: admin },
        states,
        connection: {
            sendMessagePromise: async (msg) => {
                if (!admin) throw new Error('Unauthorized'); // HA refuses fire_event for non-admins
                ha.events.push(msg.event_type);
                transport(msg.event_data.data);
            },
        },
        callService: async (domain, service, serviceData) => {
            ha.scriptCalls.push(`${domain}.${service}`);
            transport(serviceData.data);
        },
    });
    const sensorId = config.sensor || 'sensor.spotify_browser_data';
    ha.hass = makeHass(sensor ? { [sensorId]: { attributes: data === undefined ? {} : { data } } } : {});
    ha.storage = new StorageManager(ha.hass, { ...config, script });
    ha.storage._now = () => ha.now;
    ha.show = (blob) => {
        ha.hass = makeHass({ [sensorId]: { attributes: { data: blob } } });
        ha.storage.updateHass(ha.hass);
    };
    ha.land = (i = ha.sent.length - 1) => ha.show(ha.sent[i]);
    ha.tick = (ms) => { ha.now += ms; };
    return ha;
}

const pinConfig = (scope = 'shared') => ({
    entity: 'media_player.a',
    accounts: [{ entity: 'media_player.a' }, { entity: 'media_player.b' }],
    home: { pinned: { enabled: true, scope, items: [] } },
});
const album = (id) => ({ id, type: 'album', name: id, uri: `spotify:album:${id}` });
const speaker = (id) => ({ id, name: id, type: 'Speaker', is_default: false, is_backup: false, visible: true });
const ids = (list) => list.map(i => i.id);
const EMPTY_DEVICES = { settings: { version: 1 }, devices: [] };

/* ---------------------- read your own write ---------------------- */

test('a value is readable the moment saveData is called, before the write resolves or the sensor updates', async () => {
    const ha = fakeHA({ data: { a: 1, b: 'keep' } });
    const op = ha.storage.saveData('a', 2);
    assert.equal(ha.storage.getData('a'), 2);
    assert.deepEqual(await op, { success: true });
    assert.equal(ha.storage.getData('a'), 2); // the sensor still shows 1
    assert.equal(ha.storage.getData('b'), 'keep');
    assert.deepEqual(ha.sent, [{ a: 2, b: 'keep' }]);
});

test('values read while a write is pending are copies: changing one does not change storage', async () => {
    const ha = fakeHA({ data: {} });
    await ha.storage.saveData('list', [1, 2]);
    ha.storage.getData('list').push(3);
    assert.deepEqual(ha.storage.getData('list'), [1, 2]);
});

test('PinnedItemsManager: a pin is readable synchronously after add(), before the save resolves', async () => {
    const ha = fakeHA({ data: {} });
    const pins = new PinnedItemsManager(ha.hass, pinConfig(), ha.storage);
    const op = pins.add(album('p1'));
    assert.equal(pins.isPinned('p1'), true);
    assert.deepEqual(await op, { success: true });
    assert.deepEqual(ids(await pins.getItems()), ['user-library', 'p1']); // sensor still empty
});

test('PinnedItemsManager, shared scope: a fresh pin is still shown after switching account', async () => {
    const ha = fakeHA({ data: {} });
    const pins = new PinnedItemsManager(ha.hass, pinConfig('shared'), ha.storage);
    await pins.add(album('p1'));
    pins.setAccount('media_player.b');
    assert.equal(pins.isPinned('p1'), true);
});

/* ---------------------- writes to different keys must not revert each other ---------------------- */

test('a pin write followed by a device write before the sensor updates: the last blob sent has both', async () => {
    const ha = fakeHA({ data: { pinned_items: [album('old')], device_manager: EMPTY_DEVICES } });
    const pins = new PinnedItemsManager(ha.hass, pinConfig(), ha.storage);
    const devices = new DeviceManager(ha.hass, {}, ha.storage);

    await pins.add(album('p1'));
    await devices.saveDevices([speaker('d1')]);

    const last = ha.sent.at(-1);
    assert.deepEqual(ids(last.pinned_items), ['user-library', 'p1', 'old']);
    assert.deepEqual(ids(last.device_manager.devices), ['d1']);
});

test('a device write followed by a pin write before the sensor updates: the last blob sent has both', async () => {
    const ha = fakeHA({ data: { pinned_items: [album('old')], device_manager: EMPTY_DEVICES } });
    const pins = new PinnedItemsManager(ha.hass, pinConfig(), ha.storage);
    const devices = new DeviceManager(ha.hass, {}, ha.storage);

    await devices.updateSetting('hide_connect_devices', true);
    await pins.remove('old');

    const last = ha.sent.at(-1);
    assert.equal(last.device_manager.settings.hide_connect_devices, true);
    assert.deepEqual(ids(last.pinned_items), ['user-library']);
});

test('pin writes to two account scopes before the sensor updates: the last blob sent has both', async () => {
    const ha = fakeHA({ data: {} });
    const pins = new PinnedItemsManager(ha.hass, pinConfig('account'), ha.storage);

    await pins.add(album('a1'));
    pins.setAccount('media_player.b');
    await pins.add(album('b1'));

    const last = ha.sent.at(-1);
    assert.deepEqual(ids(last['pinned_items:media_player.a']), ['user-library', 'a1']);
    assert.deepEqual(ids(last['pinned_items:media_player.b']), ['user-library', 'b1']);
});

test('writes issued in the same tick, neither awaited, accumulate as well', async () => {
    const ha = fakeHA({ data: {} });
    const pins = new PinnedItemsManager(ha.hass, pinConfig(), ha.storage);
    const devices = new DeviceManager(ha.hass, {}, ha.storage);

    await Promise.all([pins.add(album('p1')), devices.saveDevices([speaker('d1')])]);

    const last = ha.sent.at(-1);
    assert.deepEqual(ids(last.pinned_items), ['user-library', 'p1']);
    assert.deepEqual(ids(last.device_manager.devices), ['d1']);
});

/* ---------------------- the sensor catches up ---------------------- */

test('once the sensor shows our write, reads come from the sensor again', async () => {
    const ha = fakeHA({ data: { a: 1 } });
    await ha.storage.saveData('a', 2);
    ha.land();
    assert.equal(ha.storage.getData('a'), 2);
    ha.show({ a: 3 }); // someone else changes it afterwards
    assert.equal(ha.storage.getData('a'), 3);
});

test('the sensor showing our first write does not hide a second write that is still on its way', async () => {
    const ha = fakeHA({ data: { a: 1, b: 1 } });
    await ha.storage.saveData('a', 2);
    await ha.storage.saveData('b', 2);
    ha.land(0); // { a: 2, b: 1 }
    assert.equal(ha.storage.getData('a'), 2);
    assert.equal(ha.storage.getData('b'), 2);
    await ha.storage.saveData('c', 2);
    assert.deepEqual(ha.sent.at(-1), { a: 2, b: 2, c: 2 });
});

test('a sensor that stores the blob as a JSON string works the same', async () => {
    const ha = fakeHA({ data: JSON.stringify({ a: 1 }) });
    assert.equal(ha.storage.getData('a'), 1);
    await ha.storage.saveData('b', 2);
    assert.equal(ha.storage.getData('b'), 2);
    ha.show(JSON.stringify({ a: 1, b: 2 }));
    ha.show(JSON.stringify({ a: 1, b: 3 }));
    assert.equal(ha.storage.getData('b'), 3); // confirmed, so the later change shows
});

/* ---------------------- the sensor never catches up ---------------------- */

test('a pending write stops standing in for the sensor after the timeout', async () => {
    const ha = fakeHA({ data: { a: 1 } });
    await ha.storage.saveData('a', 2);
    ha.tick(TIMEOUT);
    assert.equal(ha.storage.getData('a'), 2);
    ha.tick(1);
    assert.equal(ha.storage.getData('a'), 1);
});

test('a later write restarts the clock for every pending key, since it re-sends them', async () => {
    const ha = fakeHA({ data: { a: 1, b: 1 } });
    await ha.storage.saveData('a', 2);
    ha.tick(TIMEOUT - 1000);
    await ha.storage.saveData('b', 2);
    ha.tick(2000); // past the first write's timeout
    assert.equal(ha.storage.getData('a'), 2);
    ha.tick(TIMEOUT);
    assert.equal(ha.storage.getData('a'), 1);
    assert.equal(ha.storage.getData('b'), 1);
});

/* ---------------------- failed writes ---------------------- */

test('a failed write reports the error and reads fall back to the sensor', async () => {
    const ha = fakeHA({ data: { a: 1 } });
    ha.failWith = 'connection lost';
    const op = ha.storage.saveData('a', 2);
    assert.equal(ha.storage.getData('a'), 2); // optimistic until the failure is known
    assert.deepEqual(await op, { success: false, error: 'connection lost' });
    assert.equal(ha.storage.getData('a'), 1);
});

test('a failed write is not carried along by the next write', async () => {
    const ha = fakeHA({ data: { a: 1, b: 1 } });
    ha.failWith = 'connection lost';
    await ha.storage.saveData('a', 2);
    ha.failWith = null;
    await ha.storage.saveData('b', 2);
    assert.deepEqual(ha.sent, [{ a: 1, b: 2 }]);
});

test('a failed write puts back our earlier, still unconfirmed write of the same key', async () => {
    const ha = fakeHA({ data: { a: 1, b: 1 } });
    await ha.storage.saveData('a', 2);
    await ha.storage.saveData('b', 2);
    ha.failWith = 'connection lost';
    await ha.storage.saveData('a', 3);
    assert.equal(ha.storage.getData('a'), 2);
    assert.equal(ha.storage.getData('b'), 2);
});

test('a failed write does not take back a newer write of the same key', async () => {
    const ha = fakeHA({ data: { a: 1 } });
    ha.failWith = 'connection lost';
    const first = ha.storage.saveData('a', 2);
    ha.failWith = null;
    const second = ha.storage.saveData('a', 3);
    assert.equal((await first).success, false);
    assert.equal((await second).success, true);
    assert.equal(ha.storage.getData('a'), 3);
});

test('PinnedItemsManager: a failed save returns { success: false, error } and the pin is gone again', async () => {
    const ha = fakeHA({ data: { pinned_items: [album('old')] } });
    const pins = new PinnedItemsManager(ha.hass, pinConfig(), ha.storage);
    ha.failWith = 'connection lost';
    assert.deepEqual(await pins.add(album('p1')), { success: false, error: 'connection lost' });
    assert.equal(pins.isPinned('p1'), false);
    assert.deepEqual(ids(await pins.getItems()), ['user-library', 'old']);
});

test('DeviceManager: a failed save returns { success: false, error } and keeps the earlier unconfirmed save', async () => {
    const ha = fakeHA({ data: { device_manager: EMPTY_DEVICES } });
    const devices = new DeviceManager(ha.hass, {}, ha.storage);
    await devices.saveDevices([speaker('d1')]);
    ha.failWith = 'connection lost';
    assert.deepEqual(await devices.saveDevices([speaker('d1'), speaker('d2')]), { success: false, error: 'connection lost' });
    assert.deepEqual(ids(await devices.getDevices()), ['d1']);
});

/* ---------------------- another browser writes in between ---------------------- */

test('another browser changes a key we did not write: it shows at once and our next write carries it', async () => {
    const ha = fakeHA({ data: { a: 1, b: 1 } });
    await ha.storage.saveData('a', 2);
    ha.show({ a: 1, b: 9 }); // their write, built on the old blob, reached the sensor before ours
    assert.equal(ha.storage.getData('b'), 9);
    assert.equal(ha.storage.getData('a'), 2); // ours is still on its way
    await ha.storage.saveData('c', 2);
    assert.deepEqual(ha.sent.at(-1), { a: 2, b: 9, c: 2 });
});

test('another browser changes the key we just wrote: ours stays until the timeout, then theirs shows', async () => {
    const ha = fakeHA({ data: { a: 1 } });
    await ha.storage.saveData('a', 2);
    ha.show({ a: 9 });
    assert.equal(ha.storage.getData('a'), 2);
    ha.tick(TIMEOUT + 1);
    assert.equal(ha.storage.getData('a'), 9);
});

test('another browser overwrites our write after it was confirmed: theirs shows at once', async () => {
    const ha = fakeHA({ data: { a: 1 } });
    await ha.storage.saveData('a', 2);
    ha.land();       // confirmed on the hass update itself, no read needed
    ha.show({ a: 1 }); // they wrote the old value back
    assert.equal(ha.storage.getData('a'), 1);
});

/* ---------------------- reset ---------------------- */

test('resetStorage sends {} and everything reads as gone before the sensor updates', async () => {
    const ha = fakeHA({ data: { a: 1, b: 1 } });
    await ha.storage.saveData('c', 1);
    assert.deepEqual(await ha.storage.resetStorage(), { success: true });
    assert.deepEqual(ha.sent.at(-1), {});
    for (const key of ['a', 'b', 'c']) assert.equal(ha.storage.getData(key), null);
});

test('a write straight after a reset does not bring the wiped keys back', async () => {
    const ha = fakeHA({ data: { a: 1, b: 1 } });
    await ha.storage.resetStorage();
    await ha.storage.saveData('b', 2);
    assert.deepEqual(ha.sent.at(-1), { b: 2 });
    ha.land();
    assert.equal(ha.storage.getData('a'), null);
    assert.equal(ha.storage.getData('b'), 2);
});

test('a failed reset reports the error and leaves reads as they were', async () => {
    const ha = fakeHA({ data: { a: 1 } });
    await ha.storage.saveData('b', 2);
    ha.failWith = 'connection lost';
    assert.deepEqual(await ha.storage.resetStorage(), { success: false, error: 'connection lost' });
    assert.equal(ha.storage.getData('a'), 1);
    assert.equal(ha.storage.getData('b'), 2);
});

/* ---------------------- status, no sensor, guests ---------------------- */

test('checkStatus describes what the sensor holds, not what is pending', async () => {
    assert.equal(fakeHA({ data: undefined }).storage.checkStatus(), 'empty');
    assert.equal(fakeHA({ data: { a: 1 } }).storage.checkStatus(), 'ok');
    assert.equal(fakeHA({ data: '{"a":1}' }).storage.checkStatus(), 'ok');
    assert.equal(fakeHA({ data: 42 }).storage.checkStatus(), 'corrupted');
    assert.equal(fakeHA({ sensor: false }).storage.checkStatus(), 'error');
    assert.equal(new StorageManager(null, {}).checkStatus(), 'error');

    const ha = fakeHA({ data: '{not json' });
    assert.equal(ha.storage.checkStatus(), 'corrupted');
    await ha.storage.resetStorage();
    assert.equal(ha.storage.checkStatus(), 'corrupted'); // until the sensor shows the reset
    ha.land();
    assert.equal(ha.storage.checkStatus(), 'ok');
});

test('an unreadable sensor reads as empty, and a save starts a fresh blob', async (t) => {
    t.mock.method(console, 'error', () => {});
    const ha = fakeHA({ data: '{not json' });
    assert.equal(ha.storage.getData('a'), null);
    assert.deepEqual(await ha.storage.saveData('a', 1), { success: true });
    assert.deepEqual(ha.sent, [{ a: 1 }]);
    assert.equal(ha.storage.getData('a'), 1);
});

test('without hass nothing is read or written', async () => {
    const storage = new StorageManager(null, {});
    assert.equal(storage.writeStatus(), 'no_backend');
    assert.equal(storage.getData('a'), null);
    assert.deepEqual(await storage.saveData('a', 1), { success: false, error: 'No connection' });
    assert.deepEqual(await storage.resetStorage(), { success: false, error: 'No connection' });
});

test('no storage sensor: pins are unavailable and nothing is sent', async () => {
    const ha = fakeHA({ sensor: false });
    const pins = new PinnedItemsManager(ha.hass, pinConfig(), ha.storage);
    assert.equal(ha.storage.writeStatus(), 'no_backend');
    assert.equal(pins.checkAvailability(), false);
    assert.equal(pins.canEdit(), false);
    assert.deepEqual(await pins.getItems(), []);
    assert.deepEqual(await pins.add(album('p1')), { success: false, error: 'No storage configured' });
    assert.deepEqual(ha.sent, []);
});

test('no storage sensor: a device save still fires, shows until the timeout, then is gone', async () => {
    const ha = fakeHA({ sensor: false });
    const devices = new DeviceManager(ha.hass, {}, ha.storage);
    assert.deepEqual(await devices.getDevices(), []);
    assert.deepEqual(await devices.saveDevices([speaker('d1')]), { success: true });
    assert.deepEqual(ids(ha.sent.at(-1).device_manager.devices), ['d1']);
    assert.deepEqual(ids(await devices.getDevices()), ['d1']);
    ha.tick(TIMEOUT + 1);
    assert.deepEqual(await devices.getDevices(), []);
});

test('guest without a storage script: read-only, and a write attempt fails and is taken back', async () => {
    const ha = fakeHA({ data: { pinned_items: [album('old')] }, admin: false });
    const pins = new PinnedItemsManager(ha.hass, pinConfig(), ha.storage);
    assert.equal(ha.storage.writeStatus(), 'guest_local');
    assert.equal(pins.checkAvailability(), true);
    assert.equal(pins.canEdit(), false);
    assert.deepEqual(ids(await pins.getItems()), ['user-library', 'old']);
    assert.deepEqual(await pins.add(album('p1')), { success: false, error: 'Unauthorized' });
    assert.equal(pins.isPinned('p1'), false);
    assert.deepEqual(ha.sent, []);
});

test('guest with a storage script: writes go through the script and behave like any other write', async () => {
    const ha = fakeHA({ data: { pinned_items: [album('old')] }, admin: false, script: 'script.spotify_browser_store' });
    const pins = new PinnedItemsManager(ha.hass, pinConfig(), ha.storage);
    assert.equal(ha.storage.writeStatus(), 'ok');
    assert.equal(pins.canEdit(), true);
    assert.deepEqual(await pins.add(album('p1')), { success: true });
    assert.deepEqual(ha.scriptCalls, ['script.spotify_browser_store']);
    assert.deepEqual(ha.events, []);
    assert.deepEqual(ids(ha.sent.at(-1).pinned_items), ['user-library', 'p1', 'old']);
    assert.equal(pins.isPinned('p1'), true);
});

test('admin writes fire the configured event; the default sensor name is one exported constant', async () => {
    const { DEFAULT_STORAGE_SENSOR } = await import('../components/controllers/storage-manager.js');
    assert.equal(DEFAULT_STORAGE_SENSOR, 'sensor.spotify_browser_data');

    const ha = fakeHA({ data: { a: 1 }, config: { event: 'my_event' } }); // no sensor configured
    assert.equal(ha.storage.sensorEntity, DEFAULT_STORAGE_SENSOR);
    assert.equal(ha.storage.getData('a'), 1);
    await ha.storage.saveData('a', 2);
    assert.deepEqual(ha.events, ['my_event']);
    assert.equal(new PinnedItemsManager(ha.hass, pinConfig(), ha.storage).sensorEntity, DEFAULT_STORAGE_SENSOR);
    assert.equal(new DeviceManager(ha.hass, {}, ha.storage).storageEntityId, DEFAULT_STORAGE_SENSOR);
    assert.equal(fakeHA({ data: {} }).storage.sensorEntity, SENSOR);
});
