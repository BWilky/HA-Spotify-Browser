import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceManager } from '../components/devices/device-manager.js';

function managerWith(devices) {
    const storage = { getData: () => ({ settings: { version: 1 }, devices }), updateHass() {} };
    return new DeviceManager({}, {}, storage);
}

test('displayName returns the saved (renamed) name for a known device id (#7)', () => {
    const dm = managerWith([{ id: 'abc', name: 'Living Room Yamaha' }]);
    assert.equal(dm.displayName('abc', 'eDMP32MB_A25287'), 'Living Room Yamaha');
});

test('displayName falls back to the raw name for unknown ids', () => {
    const dm = managerWith([{ id: 'abc', name: 'Living Room Yamaha' }]);
    assert.equal(dm.displayName('zzz', 'Kitchen'), 'Kitchen');
    assert.equal(dm.displayName(null, 'Kitchen'), 'Kitchen');
});

test('displayName falls back when storage is unavailable', () => {
    const dm = new DeviceManager({}, {}, null);
    assert.equal(dm.displayName('abc', 'Kitchen'), 'Kitchen');
});

/* ---- Pending-write cache: reads reflect our own write until the sensor catches up ---- */

function laggingStorage() {
    // `served` is what hass currently shows; `stored` is what was last written.
    // They only converge when the test calls sync().
    const s = { served: { settings: { version: 1 }, devices: [] }, stored: null };
    s.storage = {
        getData: () => s.served,
        saveData: async (_key, items) => { s.stored = items; return { success: true }; },
        updateHass() {},
    };
    s.sync = () => { s.served = s.stored; };
    return s;
}

test('two quick saves both persist even though the sensor lags the first write', async () => {
    const s = laggingStorage();
    const dm = new DeviceManager({}, {}, s.storage);
    // The device-manager popup's path: read the list, append, save the whole list.
    await dm.saveDevices([...(await dm.getDevices()), { id: 'a', name: 'A', type: 'Speaker', is_default: false, is_backup: false, visible: true }]);
    await dm.saveDevices([...(await dm.getDevices()), { id: 'b', name: 'B', type: 'Speaker', is_default: false, is_backup: false, visible: true }]);
    assert.deepEqual(s.stored.devices.map(d => d.id), ['a', 'b']);
    assert.deepEqual((await dm.getDevices()).map(d => d.id), ['a', 'b']);
});

test('two quick setting toggles both persist', async () => {
    const s = laggingStorage();
    const dm = new DeviceManager({}, {}, s.storage);
    await dm.updateSetting('hide_connect_devices', true);
    await dm.updateSetting('see_all_devices', true);
    assert.equal(s.stored.settings.hide_connect_devices, true);
    assert.equal(s.stored.settings.see_all_devices, true);
    const settings = await dm.getSettings();
    assert.equal(settings.hide_connect_devices, true);
    assert.equal(settings.see_all_devices, true);
});

test('once a read sees the sensor matching the write, reads come from storage again', async () => {
    const s = laggingStorage();
    const dm = new DeviceManager({}, {}, s.storage);
    await dm.saveDevices([...(await dm.getDevices()), { id: 'a', name: 'A', type: 'Speaker', is_default: false, is_backup: false, visible: true }]);
    s.sync();
    await dm.getDevices(); // the hass update for our own write triggers a read
    // Another client then renames in storage; we must see it, not our cached write.
    s.served = { ...s.served, devices: [{ ...s.served.devices[0], name: 'Renamed' }] };
    assert.equal((await dm.getDevices())[0].name, 'Renamed');
});

test('a pending write stops shadowing storage after 5 seconds', async () => {
    const s = laggingStorage();
    const dm = new DeviceManager({}, {}, s.storage);
    let now = 1000;
    dm._now = () => now;
    await dm.saveDevices([...(await dm.getDevices()), { id: 'a', name: 'A', type: 'Speaker', is_default: false, is_backup: false, visible: true }]);
    assert.equal((await dm.getDevices()).length, 1);
    now += 5001;
    assert.equal((await dm.getDevices()).length, 0); // sensor never caught up; stale cache dropped
});

test('non-object storage data (legacy array, garbage) falls back to the empty default', async () => {
    for (const raw of [[{ type: 'SETTINGS', version: 1 }, { id: 'a', name: 'A' }], 'garbage', 42]) {
        const dm = new DeviceManager({}, {}, { getData: () => raw, updateHass() {} });
        assert.deepEqual(await dm.getDevices(), []);
        assert.deepEqual(await dm.getSettings(), { version: 1 });
    }
});
