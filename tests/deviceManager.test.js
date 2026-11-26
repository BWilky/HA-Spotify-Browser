import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceManager } from '../src/components/devices/device-manager.js';
import { StorageManager } from '../src/components/controllers/storage-manager.js';

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

/* ---- Pending writes: reads reflect our own write until the sensor catches up ---- */

function laggingStorage() {
    // The real StorageManager (which holds the pending-write overlay) over a
    // fake hass. `served` is the device data the sensor currently shows;
    // `stored` is the device data in the last blob sent to Home Assistant.
    // They only converge when the test calls sync().
    const SENSOR = 'sensor.spotify_browser_data';
    let sent = null;
    const hass = {
        user: { is_admin: true },
        states: {},
        connection: { sendMessagePromise: async (msg) => { sent = JSON.parse(JSON.stringify(msg.event_data.data)); } },
    };
    const show = (blob) => { hass.states = { [SENSOR]: { attributes: { data: blob } } }; };
    show({ device_manager: { settings: { version: 1 }, devices: [] } });
    const s = {
        storage: new StorageManager(hass, {}),
        get stored() { return sent.device_manager; },
        get served() { return hass.states[SENSOR].attributes.data.device_manager; },
        set served(value) { show({ device_manager: value }); },
        sync: () => show(sent),
    };
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

test('a pending write stops shadowing storage after the storage timeout', async () => {
    const s = laggingStorage();
    const dm = new DeviceManager({}, {}, s.storage);
    let now = 1000;
    s.storage._now = () => now;
    await dm.saveDevices([...(await dm.getDevices()), { id: 'a', name: 'A', type: 'Speaker', is_default: false, is_backup: false, visible: true }]);
    assert.equal((await dm.getDevices()).length, 1);
    now += StorageManager.PENDING_WRITE_MS + 1;
    assert.equal((await dm.getDevices()).length, 0); // sensor never caught up; stale cache dropped
});

test('non-object storage data (legacy array, garbage) falls back to the empty default', async () => {
    for (const raw of [[{ type: 'SETTINGS', version: 1 }, { id: 'a', name: 'A' }], 'garbage', 42]) {
        const dm = new DeviceManager({}, {}, { getData: () => raw, updateHass() {} });
        assert.deepEqual(await dm.getDevices(), []);
        assert.deepEqual(await dm.getSettings(), { version: 1 });
    }
});

/* ---- Device scans (P2): one shared live list, single-flight, capabilities on demand ---- */

const CONNECT = [
    { id: 'k', name: 'Kitchen', type: 'Speaker' },
    { id: 's', name: 'Sonos Den', type: 'Speaker' },
];
const WEB = [{ id: 'k', name: 'Kitchen', type: 'Speaker', supports_volume: false }];

/**
 * A SpotifyPlus stub: every call is recorded and answers a macrotask later
 * (so calls made together overlap). `connect` / `web` are the device lists it
 * answers with; set either to null to make that request fail the way
 * fetchSpotifyPlus does (it resolves null), or `connectThrows` to reject.
 */
function stubApi({ connect = CONNECT, web = WEB } = {}) {
    const api = {
        calls: [], connect, web, connectThrows: false,
        count(service) { return this.calls.filter(c => c[0] === service).length; },
        fetchSpotifyPlus(service, params) {
            this.calls.push([service, params]);
            return new Promise((resolve, reject) => setTimeout(() => {
                if (service === 'get_spotify_connect_devices') {
                    if (this.connectThrows) reject(new Error('boom'));
                    else resolve(this.connect && { result: this.connect.map(d => ({ ...d })) });
                } else if (service === 'get_player_devices') {
                    resolve(this.web && { result: { devices: this.web.map(d => ({ ...d })) } });
                } else resolve(null);
            }, 1));
        },
    };
    return api;
}

function scanManager(saved = []) {
    const dm = managerWith(saved);
    let now = 1000;
    dm._now = () => now;
    return { dm, tick: (ms) => { now += ms; } };
}

const CONNECT_SCAN = 'get_spotify_connect_devices';
const CAPS = 'get_player_devices';

test('concurrent scans share one request (single-flight)', async () => {
    const { dm } = scanManager();
    const api = stubApi();
    const [a, b, c] = await Promise.all([
        dm.fetchMergedDevices(api, {}, { refresh: true }),
        dm.fetchMergedDevices(api, {}, {}),
        dm.fetchMergedDevices(api, {}, { refresh: true }),
    ]);
    assert.equal(api.count(CONNECT_SCAN), 1);
    assert.equal(api.count(CAPS), 1);
    assert.deepEqual(a, b);
    assert.deepEqual(a, c);
    assert.deepEqual(a.map(d => d.id), ['k', 's']);
});

test('the device manager popup joins a scan in flight', async () => {
    const { dm } = scanManager();
    const api = stubApi();
    const [merged, raw] = await Promise.all([
        dm.fetchMergedDevices(api, {}, { refresh: true }),
        dm.scanLiveDevices(api, { refresh: true }),
    ]);
    assert.equal(api.count(CONNECT_SCAN), 1);
    assert.deepEqual(raw.map(d => d.id), merged.map(d => d.id));
});

test('a refresh asked while a plain scan is in flight starts its own scan', async () => {
    const { dm } = scanManager();
    const api = stubApi();
    await Promise.all([dm.scanLiveDevices(api, {}), dm.scanLiveDevices(api, { refresh: true })]);
    assert.deepEqual(api.calls.filter(c => c[0] === CONNECT_SCAN).map(c => c[1]), [{ refresh: false }, { refresh: true }]);
});

test('without refresh a recent list answers with no request; refresh always scans', async () => {
    const { dm, tick } = scanManager();
    const api = stubApi();
    await dm.fetchMergedDevices(api, {}, { refresh: true });
    assert.equal(api.count(CONNECT_SCAN), 1);

    tick(DeviceManager.LIVE_TTL_MS - 1);
    const cached = await dm.fetchMergedDevices(api, {}, { showHidden: true });
    assert.equal(api.count(CONNECT_SCAN), 1, 'served from the recent list');
    assert.deepEqual(cached.map(d => d.id), ['k', 's']);

    await dm.fetchMergedDevices(api, {}, { refresh: true });
    assert.equal(api.count(CONNECT_SCAN), 2, 'refresh bypasses the recent list');
    assert.deepEqual(api.calls.at(-1), [CONNECT_SCAN, { refresh: true }]);

    tick(DeviceManager.LIVE_TTL_MS);
    await dm.fetchMergedDevices(api, {}, {});
    assert.equal(api.count(CONNECT_SCAN), 3, 'an old list is rescanned');
    assert.deepEqual(api.calls.at(-1), [CONNECT_SCAN, { refresh: false }]);
});

test('a served list is a copy: callers cannot change the shared list', async () => {
    const { dm } = scanManager();
    const api = stubApi();
    (await dm.scanLiveDevices(api, { refresh: true })).length = 0;
    assert.equal((await dm.scanLiveDevices(api, {})).length, 2);
});

test('a failed scan answers like before and is not kept', async () => {
    const { dm } = scanManager([{ id: 'k', name: 'Kitchen', type: 'Speaker' }]);
    const api = stubApi({ connect: null });
    const merged = await dm.fetchMergedDevices(api, {}, { refresh: true });
    // Same as a failed request always gave: saved devices, offline.
    assert.deepEqual(merged.map(d => [d.id, d.isOnline]), [['k', false]]);

    api.connect = CONNECT;
    const again = await dm.fetchMergedDevices(api, {}, {});
    assert.equal(api.count(CONNECT_SCAN), 2, 'the failure was not served from cache');
    assert.deepEqual(again.map(d => [d.id, d.isOnline]), [['k', true], ['s', true]]);
});

test('a scan that throws rejects every caller and leaves nothing behind', async () => {
    const { dm } = scanManager();
    const api = stubApi();
    api.connectThrows = true;
    const results = await Promise.allSettled([dm.scanLiveDevices(api, { refresh: true }), dm.scanLiveDevices(api, {})]);
    assert.deepEqual(results.map(r => r.status), ['rejected', 'rejected']);
    assert.equal(api.count(CONNECT_SCAN), 1);
    api.connectThrows = false;
    assert.equal((await dm.scanLiveDevices(api, {})).length, 2);
    assert.equal(api.count(CONNECT_SCAN), 2);
});

test('an older scan landing late does not replace a newer list', async () => {
    const { dm } = scanManager();
    const api = stubApi();
    // The plain scan is answered after the refresh scan that followed it.
    const original = api.fetchSpotifyPlus.bind(api);
    let first = true;
    api.fetchSpotifyPlus = (service, params) => {
        if (service === CONNECT_SCAN && first) {
            first = false;
            api.calls.push([service, params]);
            return new Promise(r => setTimeout(() => r({ result: [{ id: 'old', name: 'Old' }] }), 20));
        }
        return original(service, params);
    };
    await Promise.all([dm.scanLiveDevices(api, {}), dm.scanLiveDevices(api, { refresh: true })]);
    assert.deepEqual((await dm.scanLiveDevices(api, {})).map(d => d.id), ['k', 's']);
});

test('lists belong to the api that scanned them (account switch)', async () => {
    const { dm } = scanManager();
    const a = stubApi();
    const b = stubApi({ connect: [{ id: 'x', name: 'Other account' }] });
    await dm.scanLiveDevices(a, { refresh: true });
    assert.deepEqual((await dm.scanLiveDevices(b, {})).map(d => d.id), ['x']);
    assert.equal(b.count(CONNECT_SCAN), 1);
});

test('capabilities are refetched only for devices the last answer did not cover', async () => {
    const { dm } = scanManager();
    const api = stubApi();
    await dm.fetchMergedDevices(api, {}, { refresh: true });
    assert.equal(api.count(CAPS), 1);
    assert.equal(dm.getVolumeCapability('k'), false);
    assert.equal(dm.getVolumeCapability('s'), null, 'not in the Web API list: unknown');

    // Same devices: no refetch ('s' was live when the Web API answered).
    await dm.fetchMergedDevices(api, {}, { refresh: true });
    assert.equal(api.count(CAPS), 1);

    // A new id appears: refetch.
    api.connect = [...CONNECT, { id: 'n', name: 'New' }];
    api.web = [...WEB, { id: 'n', supports_volume: true }];
    await dm.fetchMergedDevices(api, {}, { refresh: true });
    assert.equal(api.count(CAPS), 2);
    assert.equal(dm.getVolumeCapability('n'), true);

    // The playing device has no capability: refetch even though it was asked about.
    const merged = await dm.fetchMergedDevices(api, { sp_device_id: 's' }, { refresh: true });
    assert.equal(api.count(CAPS), 3);
    assert.equal(merged.find(d => d.id === 's').supportsVolume, null);

    // Known playing device: no refetch.
    await dm.fetchMergedDevices(api, { sp_device_id: 'k' }, { refresh: true });
    assert.equal(api.count(CAPS), 3);
});

test('capabilities are fetched in parallel with the first scan and the merged rows carry them', async () => {
    const { dm } = scanManager([{ id: 'k', name: 'Kitchen', type: 'Speaker' }]);
    const api = stubApi();
    const merged = await dm.fetchMergedDevices(api, {}, { refresh: true });
    assert.deepEqual(api.calls.map(c => c[0]).sort(), [CONNECT_SCAN, CAPS].sort());
    assert.deepEqual(merged.map(d => [d.id, d.supportsVolume]), [['k', false], ['s', null]]);
});

test('a failed capability request is asked again on the next scan', async () => {
    const { dm } = scanManager();
    const api = stubApi({ web: null });
    await dm.fetchMergedDevices(api, {}, { refresh: true });
    assert.equal(dm.getVolumeCapability('k'), null);
    api.web = WEB;
    await dm.fetchMergedDevices(api, {}, { refresh: true });
    assert.equal(api.count(CAPS), 2);
    assert.equal(dm.getVolumeCapability('k'), false);
});

test('clearVolumeCapabilities forgets every capability, drops a late answer and refetches on the next scan', async () => {
    const { dm } = scanManager();
    const api = stubApi();
    await dm.fetchMergedDevices(api, {}, { refresh: true });
    assert.equal(dm.getVolumeCapability('k'), false);

    dm.clearVolumeCapabilities();
    assert.equal(dm.getVolumeCapability('k'), null);
    await dm.fetchMergedDevices(api, {}, { refresh: true });
    assert.equal(api.count(CAPS), 2);
    assert.equal(dm.getVolumeCapability('k'), false);

    // An answer still in flight when the cache is cleared (the previous
    // account's devices) is dropped, and does not block the next request.
    const late = dm._fetchVolumeCapabilities(api);
    dm.clearVolumeCapabilities();
    assert.equal(await late, false);
    assert.equal(dm.getVolumeCapability('k'), null);
    await dm.fetchMergedDevices(api, {}, {});
    assert.equal(api.count(CAPS), 4);
    assert.equal(dm.getVolumeCapability('k'), false);
});

test('fetchMergedDevices merges exactly as getMergedDevices does', async () => {
    const saved = [
        { id: 's', name: 'Den (renamed)', type: 'Speaker', is_default: true, visible: true },
        { id: 'gone', name: 'Offline', type: 'Speaker' },
    ];
    const attrs = { sp_device_id: 'k', sp_device_name: 'Kitchen' };
    const { dm } = scanManager(saved);
    const api = stubApi();
    const viaScan = await dm.fetchMergedDevices(api, attrs, { refresh: true });
    const direct = await dm.getMergedDevices(CONNECT.map(d => ({ ...d })), attrs, {});
    assert.deepEqual(viaScan, direct);
    assert.deepEqual(viaScan.map(d => d.id), ['k', 's', 'gone']);
});
