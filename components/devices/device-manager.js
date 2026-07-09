import { parseDeviceItems, normalizeDevice, deviceBrand } from '../../utils.js';

export class DeviceManager {
    constructor(hass, config, storageManager) {
        this.hass = hass;
        this.config = config || {};
        this.storageManager = storageManager;
        this._storageKey = 'device_manager';
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

    // Simplified access to storage with schema migration
    async _loadData() {
        if (!this.checkAvailability()) return { settings: { version: 1 }, devices: [] };

        try {
            const raw = this.storageManager.getData(this._storageKey);

            // Case 1: New Object Schema
            if (raw && !Array.isArray(raw) && typeof raw === 'object') {
                return {
                    settings: raw.settings || { version: 1 },
                    devices: Array.isArray(raw.devices) ? raw.devices : []
                };
            }

            // Case 2: Old Array Schema (Migration)
            if (Array.isArray(raw)) {
                const settings = raw.find(i => i.type === 'SETTINGS') || { version: 1 };
                const devices = raw.filter(i => i.type !== 'SETTINGS');
                return { settings, devices };
            }

            // Case 3: Empty/Invalid
            return { settings: { version: 1 }, devices: [] };

        } catch (e) {
            console.error('[DeviceManager] Load failed:', e);
            return { settings: { version: 1 }, devices: [] };
        }
    }

    async getDevices() {
        const data = await this._loadData();
        return data.devices;
    }

    async getSettings() {
        const data = await this._loadData();
        return data.settings;
    }

    async saveDevices(devices) {
        const data = await this._loadData();
        return await this._save({
            settings: data.settings,
            devices: devices
        });
    }

    async setDefault(deviceId) {
        const devices = await this.getDevices();
        const updated = devices.map(d => ({
            ...d,
            is_default: d.id === deviceId
        }));
        return await this.saveDevices(updated);
    }

    async setBackup(deviceId) {
        const devices = await this.getDevices();
        const updated = devices.map(d => ({
            ...d,
            is_backup: d.id === deviceId ? !d.is_backup : false
        }));
        return await this.saveDevices(updated);
    }

    async add(device) {
        const devices = await this.getDevices();
        if (devices.find(d => d.id === device.id)) return { success: false, error: "Device already exists" };

        const newDevice = {
            id: device.id,
            name: device.name,
            type: device.type || 'Speaker',
            is_default: false,
            is_backup: false,
            visible: true
        };

        return await this.saveDevices([...devices, newDevice]);
    }

    async remove(deviceId) {
        const devices = await this.getDevices();
        const updated = devices.filter(d => d.id !== deviceId);
        return await this.saveDevices(updated);
    }

    async update(deviceId, changes) {
        const devices = await this.getDevices();
        const index = devices.findIndex(d => d.id === deviceId);
        if (index === -1) return { success: false, error: "Device not found" };

        devices[index] = { ...devices[index], ...changes };
        return await this.saveDevices(devices);
    }

    async updateSetting(key, value) {
        const data = await this._loadData();
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

    async rename(deviceId, newName) {
        return await this.update(deviceId, { name: newName });
    }

    /**
     * Fetch live devices from the API and merge them with saved devices and
     * player attributes. The single entry point for device scans.
     * options: { refresh: boolean, showHidden: boolean }
     */
    async fetchMergedDevices(api, attributes = {}, options = {}) {
        const response = await api.fetchSpotifyPlus('get_spotify_connect_devices', { refresh: !!options.refresh });
        const rawDevices = parseDeviceItems(response);
        return await this.getMergedDevices(rawDevices, attributes, options);
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
                visible: saved.visible !== false
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
                    visible: true
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
                    isOnline: true
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
