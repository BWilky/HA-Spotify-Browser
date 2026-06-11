/**
 * Storage Strategy: Home Assistant Trigger Template Sensor
 * Uses 'sensor.spotify_browser_data' and events to persist data across reboots.
 */
export class DataTriggerTemplate {
    constructor(hass, config) {
        this.hass = hass;
        this.config = config || {};
        this._sensorEntity = this.config.sensor_entity || 'sensor.spotify_browser_data';
        this._eventType = this.config.event_type || 'spotify_browser_store_data';
        this._storageAttribute = 'data';
    }

    updateHass(hass) {
        this.hass = hass;
    }

    /**
     * Check if this strategy is available (Sensor exists)
     */
    isAvailable() {
        return this.hass && this.hass.states[this._sensorEntity] !== undefined;
    }

    /**
     * Check status of data in the sensor
     * @returns {string} 'ok', 'empty', 'corrupted', 'error'
     */
    checkStatus() {
        if (!this.hass) return 'error';

        const stateObj = this.hass.states[this._sensorEntity];
        if (!stateObj) return 'error';

        let fullData = stateObj.attributes[this._storageAttribute];

        // 1. Check for Empty/Missing
        if (fullData === undefined || fullData === null) {
            return 'empty';
        }

        // 2. Check for Corruption
        if (typeof fullData === 'string') {
            try {
                const parsed = JSON.parse(fullData);
                if (typeof parsed !== 'object' || parsed === null) return 'corrupted';
            } catch (e) {
                return 'corrupted';
            }
        } else if (typeof fullData !== 'object') {
            return 'corrupted';
        }

        return 'ok';
    }

    /**
     * Retrieve data from the storage sensor attributes
     */
    getData(key) {
        if (!this.hass) return null;
        const stateObj = this.hass.states[this._sensorEntity];
        if (!stateObj || !stateObj.attributes) return null;

        // Read the giant attribute
        let fullData = stateObj.attributes[this._storageAttribute];

        if (typeof fullData === 'string') {
            try {
                fullData = JSON.parse(fullData);
            } catch (e) {
                console.error('[DataTriggerTemplate] Failed to parse storage attribute:', e);
                return null;
            }
        }

        if (!fullData || typeof fullData !== 'object') return null;

        return fullData[key] || null;
    }

    /**
     * Helper to fire event functionality using websocket connection
     */
    async _fireEvent(data) {
        if (!this.hass || !this.hass.connection) {
            throw new Error("No Home Assistant connection available.");
        }
        // Use websocket command 'fire_event'
        // This bypasses the need for a service call service (service: event.fire) which may not exist.
        return this.hass.connection.sendMessagePromise({
            type: 'fire_event',
            event_type: this._eventType,
            event_data: data
        });
    }

    /**
     * Save data by firing an event to the trigger sensor
     */
    async saveData(key, value) {
        if (!this.hass) {
            return { success: false, error: "No connection" };
        }

        try {
            // 1. Get current full data
            const stateObj = this.hass.states[this._sensorEntity];
            let fullData = (stateObj && stateObj.attributes && stateObj.attributes[this._storageAttribute]) ? stateObj.attributes[this._storageAttribute] : {};

            if (typeof fullData === 'string') {
                try {
                    fullData = JSON.parse(fullData);
                } catch (e) {
                    fullData = {};
                }
            }

            // 2. Merge new data
            fullData = { ...fullData, [key]: value };

            // 3. Fire event via websocket
            await this._fireEvent({
                [this._storageAttribute]: fullData
            });

            return { success: true };
        } catch (e) {
            console.error('[DataTriggerTemplate] Save failed:', e);
            return { success: false, error: e.message };
        }
    }

    async resetStorage() {
        if (!this.hass) return { success: false, error: "No connection" };

        console.warn('[DataTriggerTemplate] Wiping persistent data...');

        try {
            // Fire event via websocket
            await this._fireEvent({
                [this._storageAttribute]: {}
            });
            return { success: true };
        } catch (e) {
            console.error('[DataTriggerTemplate] Reset failed:', e);
            return { success: false, error: e.message };
        }
    }
}
