/**
 * Storage Strategy: Local Browser Storage
 * Uses window.localStorage to persist data on a per-device basis.
 * Used as a fallback when the Home Assistant Trigger Sensor is not available.
 */
export class DataLocal {
    constructor(hass, config) {
        this.hass = hass;
        this.config = config || {};
        this._storageKey = this.config.storage_key || 'spotify_browser_data';
    }

    updateHass(hass) {
        this.hass = hass;
    }

    /**
     * Always available (unless disabled by browser/user)
     */
    isAvailable() {
        try {
            const testKey = '__test__';
            localStorage.setItem(testKey, testKey);
            localStorage.removeItem(testKey);
            return true;
        } catch (e) {
            return false;
        }
    }

    checkStatus() {
        if (!this.isAvailable()) return 'error';

        const data = localStorage.getItem(this._storageKey);
        if (data === null) return 'empty'; // Not created yet

        try {
            const parsed = JSON.parse(data);
            if (typeof parsed !== 'object' || parsed === null) return 'corrupted';
        } catch (e) {
            return 'corrupted';
        }

        return 'ok';
    }

    getData(key) {
        try {
            const raw = localStorage.getItem(this._storageKey);
            if (!raw) return null;

            const fullData = JSON.parse(raw);
            return fullData[key] || null;
        } catch (e) {
            console.error('[DataLocal] Failed to read storage:', e);
            return null;
        }
    }

    async saveData(key, value) {
        try {
            const raw = localStorage.getItem(this._storageKey);
            let fullData = {};

            if (raw) {
                try {
                    fullData = JSON.parse(raw);
                } catch (e) {
                    fullData = {};
                }
            }

            fullData[key] = value;
            localStorage.setItem(this._storageKey, JSON.stringify(fullData));
            return { success: true };
        } catch (e) {
            console.error('[DataLocal] Save failed:', e);
            return { success: false, error: e.message };
        }
    }

    async resetStorage() {
        console.warn('[DataLocal] Wiping local storage data...');
        try {
            localStorage.removeItem(this._storageKey);
            // Re-initialize with empty object to respect "empty" vs "missing" semantics? 
            // Or just removing it returns 'empty' checkStatus.
            // Let's set it to empty object to match trigger behavior (it stores {})
            localStorage.setItem(this._storageKey, '{}');
            return { success: true };
        } catch (e) {
            console.error('[DataLocal] Reset failed:', e);
            return { success: false, error: e.message };
        }
    }
}
