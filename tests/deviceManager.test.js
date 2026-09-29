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
