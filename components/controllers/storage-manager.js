import { DataTriggerTemplate } from './storage/data_triggertemplate.js';
import { DataLocal } from './storage/data_local.js';

export class StorageManager {
    constructor(hass, config) {
        this.hass = hass;
        this.config = config || {};

        // Initialize Strategies
        this.triggerStrategy = new DataTriggerTemplate(hass, config);
        this.localStrategy = new DataLocal(hass, config);
    }

    updateHass(hass) {
        this.hass = hass;
        this.triggerStrategy.updateHass(hass);
        this.localStrategy.updateHass(hass);
    }

    /** Entity holding persisted data (when the trigger-template backend is active). */
    get sensorEntity() {
        return this.config.sensor_entity || null;
    }

    /**
     * Determines the active storage strategy.
     * Priority: Trigger Template (if sensor exists) > Local Storage
     */
    _getActiveStrategy() {
        if (this.triggerStrategy.isAvailable()) {
            return this.triggerStrategy;
        }
        return this.localStrategy;
    }

    /**
     * Check the status of the ACTIVE storage data.
     * @returns {string} One of: 'ok', 'empty', 'corrupted', 'error'
     */
    checkStatus() {
        const strategy = this._getActiveStrategy();
        return strategy.checkStatus();
    }

    /**
     * Retrieve data from the active storage
     * @param {string} key The attribute key to read (e.g. 'pinned_items')
     * @returns {any} The data or null if not found
     */
    getData(key) {
        const strategy = this._getActiveStrategy();
        return strategy.getData(key);
    }

    /**
     * Save data using the active storage strategy
     * @param {string} key The attribute key to write
     * @param {any} value The data to store
     */
    async saveData(key, value) {
        const strategy = this._getActiveStrategy();
        return await strategy.saveData(key, value);
    }

    /**
     * Resets the entire storage to a clean state (empty object).
     * CAUTION: This wipes all pinned items and device settings for the active storage.
     */
    async resetStorage() {
        const strategy = this._getActiveStrategy();
        return await strategy.resetStorage();
    }
}
