import { DataTriggerTemplate } from './storage/data_triggertemplate.js';

/**
 * Persistence facade. Data lives in a Home Assistant trigger-template sensor
 * (shared across users/devices). There is no localStorage fallback: reads work
 * for anyone who can see the sensor, writes require admin (fires the event) or a
 * non-admin with a working `write_script` middle-man (see DataTriggerTemplate).
 */
export class StorageManager {
    constructor(hass, config) {
        this.hass = hass;
        this.config = config || {};
        this.triggerStrategy = new DataTriggerTemplate(hass, config);
    }

    updateHass(hass) {
        this.hass = hass;
        this.triggerStrategy.updateHass(hass);
    }

    /** Entity holding persisted data. */
    get sensorEntity() {
        return this.config.sensor_entity || null;
    }

    /**
     * Check the status of the stored data.
     * @returns {string} One of: 'ok', 'empty', 'corrupted', 'error'
     */
    checkStatus() {
        return this.triggerStrategy.checkStatus();
    }

    /**
     * Whether the current user can persist to the sensor backend.
     * @returns {string} 'no_backend' | 'ok' | 'guest_local'
     */
    writeStatus() {
        return this.triggerStrategy.writeStatus();
    }

    /**
     * Retrieve data from storage.
     * @param {string} key The attribute key to read (e.g. 'pinned_items')
     * @returns {any} The data or null if not found
     */
    getData(key) {
        return this.triggerStrategy.getData(key);
    }

    /**
     * Save data.
     * @param {string} key The attribute key to write
     * @param {any} value The data to store
     */
    async saveData(key, value) {
        return await this.triggerStrategy.saveData(key, value);
    }

    /**
     * Resets the entire storage to a clean state (empty object).
     * CAUTION: This wipes all pinned items and device settings.
     */
    async resetStorage() {
        return await this.triggerStrategy.resetStorage();
    }
}
