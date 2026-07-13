/**
 * Storage Strategy: Home Assistant Trigger Template Sensor
 * Uses 'sensor.spotify_browser_data' and events to persist data across reboots.
 */
export class DataTriggerTemplate {
    constructor(hass, config) {
        this.hass = hass;
        this.config = config || {};
        this._sensorEntity = this.config.sensor || 'sensor.spotify_browser_data';
        this._eventType = this.config.event || 'spotify_browser_store_data';
        // Optional middle-man script (e.g. 'script.spotify_browser_store') used to
        // persist data for non-admin users — see _write().
        this._writeScript = this.config.script || null;
        this._storageAttribute = 'data';
    }

    updateHass(hass) {
        this.hass = hass;
    }

    /** True for guests/non-admins (who cannot fire events). */
    get _isNonAdmin() {
        return this.hass?.user?.is_admin === false;
    }

    /**
     * Whether the current user can persist to the sensor, and why not. Reads
     * always work for anyone who can see the sensor; this only describes WRITES.
     *   'no_backend'     — the storage sensor doesn't exist
     *   'ok'             — admin (fires the event) or guest with a storage.script configured
     *   'guest_local'    — non-admin, no storage.script -> read-only for them
     *
     * Note: when a storage.script is configured we trust it rather than requiring
     * the script entity to be present in hass.states. Non-admin users can CALL a
     * script they aren't allowed to SEE, so the entity is often absent from their
     * state map even though the call succeeds — gating on its visibility would
     * wrongly lock guests out of editing.
     */
    writeStatus() {
        if (!this.hass || this.hass.states[this._sensorEntity] === undefined) return 'no_backend';
        if (!this._isNonAdmin) return 'ok';
        if (!this._writeScript) return 'guest_local';
        return 'ok';
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
     * Persist the full data object to the sensor. Admins fire the event directly
     * over the websocket (fast, no extra config). Non-admins can't fire events,
     * so when a `storage.script` middle-man is configured they call it instead —
     * the script validates the payload and fires the event in HA's context.
     */
    async _write(fullData) {
        if (this._writeScript && this._isNonAdmin) {
            return this._callScript(fullData);
        }
        return this._fireEvent({ [this._storageAttribute]: fullData });
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
     * Call the middle-man script, passing the payload as the `data` field.
     * Calling scripts is permitted for non-admin users, unlike firing events.
     */
    async _callScript(fullData) {
        if (!this.hass) throw new Error("No Home Assistant connection available.");
        const objectId = this._writeScript.includes('.')
            ? this._writeScript.split('.').slice(1).join('.')
            : this._writeScript;
        return this.hass.callService('script', objectId, {
            [this._storageAttribute]: fullData
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

            // 3. Persist (event for admins, middle-man script for guests)
            await this._write(fullData);

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
            await this._write({});
            return { success: true };
        } catch (e) {
            console.error('[DataTriggerTemplate] Reset failed:', e);
            return { success: false, error: e.message };
        }
    }
}
