import { parseDeviceItems, parseWebApiDevices, normalizeDevice, deviceBrand, debugLog } from '../../utils.js';

const idOf = (d) => d?.id || d?.Id || null;

export class DeviceManager {
    /** How long a scanned live list answers scans that do not ask for `refresh`. */
    static LIVE_TTL_MS = 10000;

    constructor(hass, config, storageManager) {
        this.hass = hass;
        this.config = config || {};
        this.storageManager = storageManager;
        this._storageKey = 'device_manager';
        this._now = () => Date.now();
        // The one live device list every surface reads (see scanLiveDevices):
        // the last answered scan { api, devices, at, seq } and the scan in
        // flight { api, refresh, seq, promise }.
        this._live = null;
        this._liveScan = null;
        this._scanSeq = 0;
        // Volume capabilities (see _ensureVolumeCapabilities): id -> supports_volume,
        // the live ids present when get_player_devices last answered, the
        // request in flight, and an epoch that drops answers for a cleared cache.
        this._volumeCapability = null;
        this._capabilityAsked = null;
        this._capabilityFetch = null;
        this._capabilityEpoch = 0;
    }

    updateHass(hass) {
        this.hass = hass;
        if (this.storageManager) {
            this.storageManager.updateHass(hass);
        }
    }

    checkAvailability() {
        if (!this.storageManager) return false;
        return true;
    }

    /** Entity backing device storage, for hass-change comparisons. */
    get storageEntityId() {
        return this.storageManager?.sensorEntity || null;
    }

    /**
     * Synchronous read of saved devices/settings (storage is an in-memory
     * sensor). Storage answers with our own latest write until the sensor
     * reflects it, so a second quick action (two Adds, Hide then See all)
     * builds on the first instead of on stale data.
     */
    _readData() {
        if (!this.checkAvailability()) return { settings: { version: 1 }, devices: [] };

        try {
            const raw = this.storageManager.getData(this._storageKey);

            // Object schema
            if (raw && !Array.isArray(raw) && typeof raw === 'object') {
                return {
                    settings: raw.settings || { version: 1 },
                    devices: Array.isArray(raw.devices) ? raw.devices : []
                };
            }

            // Empty/invalid (including arrays)
            return { settings: { version: 1 }, devices: [] };

        } catch (e) {
            console.error('[DeviceManager] Load failed:', e);
            return { settings: { version: 1 }, devices: [] };
        }
    }

    async getDevices() {
        const data = this._readData();
        return data.devices;
    }

    async getSettings() {
        const data = this._readData();
        return data.settings;
    }

    async saveDevices(devices) {
        const data = this._readData();
        return await this._save({
            settings: data.settings,
            devices: devices
        });
    }

    async updateSetting(key, value) {
        const data = this._readData();
        const updatedSettings = {
            ...data.settings,
            [key]: value,
            last_updated: Date.now()
        };

        return await this._save({
            settings: updatedSettings,
            devices: data.devices
        });
    }

    /**
     * Name to show for a device: the saved (user-renamed) name when the id is
     * in the device manager, otherwise the raw Connect name. Lets a rename made
     * in the device manager show up in now-playing labels too, not just the
     * picker (#7).
     */
    displayName(deviceId, fallbackName) {
        if (!deviceId) return fallbackName;
        const saved = this._readData().devices.find(d => d.id === deviceId);
        return saved?.name || fallbackName;
    }

    /**
     * Live devices merged with saved devices and player attributes. The
     * single entry point for merged device lists.
     * options: { refresh: boolean, showHidden: boolean } — `refresh` scans
     * now instead of answering from the last live list (see scanLiveDevices).
     */
    async fetchMergedDevices(api, attributes = {}, options = {}) {
        // Before the first capability answer every id is unknown: ask in
        // parallel with the scan rather than after it.
        const early = this._volumeCapability ? null : this._fetchVolumeCapabilities(api);
        const rawDevices = await this.scanLiveDevices(api, options);
        if (early) {
            if (await early) this._markAsked(rawDevices);
        } else {
            await this._ensureVolumeCapabilities(api, rawDevices, attributes);
        }
        return await this.getMergedDevices(rawDevices, attributes, options);
    }

    /**
     * Raw live Connect devices (`get_spotify_connect_devices`), shared by
     * every caller:
     *   - a scan in flight answers concurrent callers — one request — unless
     *     it is a plain scan and this caller asked for `refresh`;
     *   - without `refresh`, a list scanned in the last LIVE_TTL_MS answers
     *     at once, with no request;
     *   - `refresh` always scans, and asks SpotifyPlus to rescan too.
     * A failed scan answers [] (as a failed request always did) and is not
     * kept. Lists belong to the `api` that scanned them: an account switch
     * builds a new api, so the previous account's list is never served.
     */
    scanLiveDevices(api, { refresh = false } = {}) {
        const flight = this._liveScan;
        if (flight && flight.api === api && (flight.refresh || !refresh)) return flight.promise;
        const live = this._live;
        if (!refresh && live && live.api === api && this._now() - live.at < DeviceManager.LIVE_TTL_MS) {
            return Promise.resolve([...live.devices]);
        }
        const scan = { api, refresh: !!refresh, seq: ++this._scanSeq, promise: null };
        scan.promise = (async () => {
            try {
                const response = await api.fetchSpotifyPlus('get_spotify_connect_devices', { refresh: !!refresh });
                const devices = parseDeviceItems(response);
                // null: the request failed (fetchSpotifyPlus has logged it).
                // A slower, older scan never replaces a newer answer.
                if (response != null && !(this._live?.api === api && this._live.seq > scan.seq)) {
                    this._live = { api, devices, at: this._now(), seq: scan.seq };
                }
                return [...devices];
            } finally {
                if (this._liveScan === scan) this._liveScan = null;
            }
        })();
        this._liveScan = scan;
        return scan.promise;
    }

    /**
     * The last live list for `api` when it is under LIVE_TTL_MS old, else
     * [] — what a picker can show at once while a fresh scan runs. Never
     * makes a request.
     */
    recentLiveDevices(api) {
        const live = this._live;
        if (!live || live.api !== api || this._now() - live.at >= DeviceManager.LIVE_TTL_MS) return [];
        return [...live.devices];
    }

    /**
     * Refetch volume capabilities only when this live list holds a device the
     * last get_player_devices answer did not cover: an id with no capability
     * that was not live when it answered, or the playing device with no
     * capability (the one every volume control reads). Connect devices the
     * Web API does not list stay unknown without a request on every scan.
     */
    async _ensureVolumeCapabilities(api, rawDevices, attributes = {}) {
        const caps = this._volumeCapability;
        const unknown = (id) => !!id && !caps?.has(id);
        const activeId = attributes.sp_device_id || idOf(rawDevices.find(d => d.is_active || d.IsActive));
        const needed = !caps || unknown(activeId)
            || rawDevices.some(d => unknown(idOf(d)) && !this._capabilityAsked?.has(idOf(d)));
        if (needed && await this._fetchVolumeCapabilities(api)) this._markAsked(rawDevices);
    }

    /** Remember which live ids the last capability answer covered. */
    _markAsked(rawDevices) {
        if (!this._volumeCapability) return; // cleared meanwhile
        if (!this._capabilityAsked) this._capabilityAsked = new Set();
        rawDevices.forEach(d => { const id = idOf(d); if (id) this._capabilityAsked.add(id); });
    }

    /**
     * Best-effort refresh of the id -> supports_volume map from the Web API
     * device list — the Connect-device model has no such field. One request
     * at a time per api; resolves true when it answered. Non-fatal on
     * failure: devices stay unknown and every caller treats unknown as
     * volume-capable.
     */
    _fetchVolumeCapabilities(api) {
        const flight = this._capabilityFetch;
        if (flight && flight.api === api) return flight.promise;
        const epoch = this._capabilityEpoch;
        const request = { api, promise: null };
        request.promise = (async () => {
            try {
                const response = await api.fetchSpotifyPlus('get_player_devices', {}, true, false);
                if (response == null || epoch !== this._capabilityEpoch) return false;
                const caps = this._volumeCapability || (this._volumeCapability = new Map());
                parseWebApiDevices(response).forEach(d => {
                    const id = idOf(d);
                    if (id) caps.set(id, d.supports_volume !== false);
                });
                return true;
            } catch (e) {
                debugLog('[DeviceManager] Volume capability refresh failed (non-fatal):', e);
                return false;
            } finally {
                if (this._capabilityFetch === request) this._capabilityFetch = null;
            }
        })();
        this._capabilityFetch = request;
        return request.promise;
    }

    /**
     * Cached volume capability for a device id: true/false, or null when the
     * device hasn't appeared in a get_player_devices response yet. Callers
     * must treat null as supported.
     */
    getVolumeCapability(deviceId) {
        if (!deviceId || !this._volumeCapability || !this._volumeCapability.has(deviceId)) return null;
        return this._volumeCapability.get(deviceId);
    }

    /** Device ids aren't meaningful across accounts — drop the cache on switch. */
    clearVolumeCapabilities() {
        this._volumeCapability = null;
        this._capabilityAsked = null;
        this._capabilityFetch = null;
        this._capabilityEpoch++;
    }

    async getMergedDevices(apiDevices = [], attributes = {}, options = {}) {
        const savedDevices = await this.getDevices();
        const settings = await this.getSettings();

        const savedMap = new Map();
        const savedIds = new Set();
        savedDevices.forEach(d => {
            savedMap.set(d.id, d);
            savedIds.add(d.id);
        });

        // 1. Identify Live IDs & Active Device
        const liveMap = new Map();
        let activeAttrId = attributes.sp_device_id || null;
        let activeAttrName = attributes.sp_device_name || attributes.source || null;

        let activeDeviceId = activeAttrId;
        let activeDeviceObj = null;

        apiDevices.forEach(d => {
            liveMap.set(d.id || d.Id, d);
            if ((d.is_active || d.IsActive) && !activeDeviceId) {
                activeDeviceId = d.id || d.Id;
            }
        });

        if (!activeDeviceId && activeAttrName) {
            const found = apiDevices.find(d => (d.name || d.Name) === activeAttrName);
            if (found) activeDeviceId = found.id || found.Id;
            if (!activeDeviceId) {
                const foundSaved = savedDevices.find(d => d.name === activeAttrName);
                if (foundSaved) activeDeviceId = foundSaved.id;
            }
        }

        // 2. Build Unified List
        let finalDevices = [];

        // A. Add Saved Devices
        savedDevices.forEach(saved => {
            const live = liveMap.get(saved.id);
            const isActive = (saved.id === activeDeviceId);
            if (isActive) activeDeviceObj = saved;

            finalDevices.push({
                id: saved.id,
                name: saved.name,
                type: saved.type,
                brand: deviceBrand(live) || saved.brand || null,
                isActive: isActive,
                isSaved: true,
                isOnline: !!live,
                is_default: saved.is_default,
                is_backup: saved.is_backup,
                visible: saved.visible !== false,
                supportsVolume: this.getVolumeCapability(saved.id)
            });
        });

        // B. Add Unknown Live Devices
        apiDevices.forEach(live => {
            const norm = normalizeDevice(live);
            if (!savedIds.has(norm.id)) {
                const isActive = (norm.id === activeDeviceId);
                if (isActive) activeDeviceObj = live;

                finalDevices.push({
                    ...norm,
                    isActive: isActive,
                    isOnline: true,
                    visible: true,
                    supportsVolume: this.getVolumeCapability(norm.id)
                });
            }
        });

        // 3. Filter Hidden
        if (settings.hide_connect_devices && !options.showHidden) {
            finalDevices = finalDevices.filter(d => d.isSaved === true || d.isActive);
        }

        if (settings.hide_offline_devices) {
            finalDevices = finalDevices.filter(d => d.isOnline === true || d.isActive || d.isSaved === false);
        }

        // 4. Sort Active to Top
        if (activeDeviceId) {
            const inListIndex = finalDevices.findIndex(d => d.id === activeDeviceId);
            if (inListIndex > 0) {
                const [item] = finalDevices.splice(inListIndex, 1);
                item.isActive = true;
                finalDevices.unshift(item);
            } else if (inListIndex === -1 && activeAttrName) {
                finalDevices.unshift({
                    id: activeDeviceId || 'custom-active',
                    name: activeAttrName,
                    type: 'Speaker',
                    isActive: true,
                    isSaved: false,
                    isOnline: true,
                    supportsVolume: this.getVolumeCapability(activeDeviceId)
                });
            }
        }

        return finalDevices;
    }

    async _save(items) {
        if (!this.checkAvailability()) return { success: false };
        try {
            return await this.storageManager.saveData(this._storageKey, items);
        } catch (e) {
            console.error('[DeviceManager] Save failed:', e);
            return { success: false, error: e.message };
        }
    }
}
