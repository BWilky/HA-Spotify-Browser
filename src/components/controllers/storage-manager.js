/** Default storage sensor; `storage.sensor` in the card config overrides it. */
export const DEFAULT_STORAGE_SENSOR = 'sensor.spotify_browser_data';
const DEFAULT_STORAGE_EVENT = 'spotify_browser_store_data';
/** The one sensor attribute (and event/script field) that holds the whole blob. */
const STORAGE_ATTRIBUTE = 'data';

/**
 * The persisted blob: one JSON object, top-level key -> value (e.g.
 * 'pinned_items', the device manager's key). Values are whatever their owner
 * saved.
 * @typedef {Record<string, any>} StorageBlob
 */

/**
 * Persistence for the card: ONE JSON blob in the `data` attribute of a Home
 * Assistant trigger-template sensor, shared by every user and browser. There
 * is no localStorage fallback. Reads work for anyone who can see the sensor;
 * writes need an admin (fires the event) or a non-admin with a `storage.script`
 * middle-man (see _write).
 *
 * PENDING WRITES. Every write sends the whole blob, and the sensor only shows
 * it after a round trip through Home Assistant. Until then the sensor is stale,
 * so this class keeps the keys it has written and not yet seen come back
 * (`_pending`) and lays them over the sensor's blob. That overlaid blob is what
 * every read is answered from AND what every write is built on, so:
 *   - a read straight after a write returns what was written (the overlay is
 *     set synchronously, before the network call);
 *   - writes to different keys in quick succession accumulate. Building each
 *     one on the stale sensor instead would send the older keys' OLD values
 *     back and silently revert them.
 * A pending key is dropped when
 *   - the sensor's value for that key equals what we wrote (JSON compare),
 *     checked on every read and every updateHass(); or
 *   - PENDING_WRITE_MS has passed since the most recent write was issued. Each
 *     write re-sends all pending keys, so they share one clock. This is what
 *     stops a lost or overwritten write from hiding the real state for good; or
 *   - the write that set it fails: the key goes back to what it was before
 *     that write (an earlier unconfirmed write of ours, or the sensor's value).
 *
 * OTHER BROWSERS. When the sensor shows a blob that is neither the one we
 * started from nor the one we sent, someone else wrote in between. Nothing is
 * merged; the rules are per key, as they always were:
 *   - keys we have no pending write for are read from the sensor, so the other
 *     browser's change shows at once, and our next write carries it along;
 *   - keys we do have a pending write for stay ours, in reads and in the blobs
 *     we send, until confirmed or timed out. If the other write landed first,
 *     ours replaces it in Home Assistant and gets confirmed. If it landed
 *     after ours, we normally saw ours confirmed first and then show theirs;
 *     if that update was missed, theirs shows once the timeout passes.
 * Whole-blob last-writer-wins between browsers is unchanged: two browsers
 * writing within the same round trip can still lose one of the writes.
 */
export class StorageManager {
    /**
     * How long an unconfirmed write may stand in for the sensor. Longer than
     * any healthy round trip (well under a second locally, a few seconds
     * remotely): if this runs out too early, reads flip back to the stale
     * value and the next write is built on it, reverting the earlier one. Too
     * long only delays showing a lost or overwritten write. The clock starts
     * when the write is issued, so the request itself eats into it.
     */
    static PENDING_WRITE_MS = 10000;

    /** @param config the card's `storage` group: { sensor, event, script }. */
    constructor(hass, config) {
        this.hass = hass;
        this.config = config || {};
        this._sensorEntity = this.config.sensor || DEFAULT_STORAGE_SENSOR;
        this._eventType = this.config.event || DEFAULT_STORAGE_EVENT;
        // Optional middle-man script (e.g. 'script.spotify_browser_store') used to
        // persist data for non-admin users — see _write().
        this._writeScript = this.config.script || null;
        // key -> { json }: the value we last wrote for that key, as JSON
        // (undefined = key removed), until the sensor shows it.
        this._pending = new Map();
        this._pendingAt = 0;
        this._now = () => Date.now();
    }

    updateHass(hass) {
        this.hass = hass;
        // Confirm pending writes the moment the sensor shows them, not just on
        // the next read: a later write from another browser must not be taken
        // for "ours has not landed yet".
        if (this._pending.size) this._blob();
    }

    /** Entity holding persisted data. */
    get sensorEntity() {
        return this._sensorEntity;
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
     * Health of the data the SENSOR holds right now (pending writes are not
     * considered: this is what decides whether to offer a reset).
     * @returns {string} 'ok', 'empty', 'corrupted', 'error'
     */
    checkStatus() {
        if (!this.hass) return 'error';

        const stateObj = this.hass.states[this._sensorEntity];
        if (!stateObj) return 'error';

        const fullData = stateObj.attributes[STORAGE_ATTRIBUTE];
        if (fullData === undefined || fullData === null) return 'empty';

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
     * The blob the sensor shows right now; {} when missing, empty or unreadable.
     * @returns {StorageBlob}
     */
    _sensorBlob(logUnreadable = false) {
        let data = this.hass?.states?.[this._sensorEntity]?.attributes?.[STORAGE_ATTRIBUTE];
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch (e) {
                if (logUnreadable) console.error('[StorageManager] Failed to parse storage attribute:', e);
                return {};
            }
        }
        return (data && typeof data === 'object') ? data : {};
    }

    /**
     * The sensor's blob with our pending writes laid over it: what reads are
     * answered from and writes are built on. Drops pending keys that have
     * expired or that the sensor has caught up with.
     * @returns {StorageBlob}
     */
    _blob(logUnreadable = false) {
        const sensor = this._sensorBlob(logUnreadable);
        if (this._pending.size === 0) return sensor;
        if (this._now() - this._pendingAt > StorageManager.PENDING_WRITE_MS) {
            this._pending.clear();
            return sensor;
        }
        const blob = { ...sensor };
        for (const [key, { json }] of this._pending) {
            if (JSON.stringify(sensor[key]) === json) this._pending.delete(key);
            else if (json === undefined) delete blob[key];
            else blob[key] = JSON.parse(json); // a fresh copy per read: callers may mutate it
        }
        return blob;
    }

    /** Put back the pending entries a failed write replaced, unless a later write has replaced them again. */
    _undoPending(replaced, entry) {
        for (const [key, previous] of replaced) {
            if (this._pending.get(key) !== entry) continue;
            if (previous) this._pending.set(key, previous);
            else this._pending.delete(key);
        }
    }

    /**
     * Retrieve data from storage.
     * @param {string} key The key to read (e.g. 'pinned_items')
     * @returns {any} The data or null if not found
     */
    getData(key) {
        if (!this.hass) return null;
        return this._blob(true)[key] || null;
    }

    /**
     * Persist the full data object to the sensor. Admins fire the event directly
     * over the websocket (fast, no extra config). Non-admins can't fire events,
     * so when a `storage.script` middle-man is configured they call it instead —
     * the script validates the payload and fires the event in HA's context.
     * @param {StorageBlob} fullData
     */
    async _write(fullData) {
        if (this._writeScript && this._isNonAdmin) {
            return this._callScript(fullData);
        }
        return this._fireEvent({ [STORAGE_ATTRIBUTE]: fullData });
    }

    /**
     * Fire the storage event over the websocket ('fire_event' command), which
     * avoids needing an event.fire service that may not exist.
     */
    async _fireEvent(data) {
        if (!this.hass || !this.hass.connection) {
            throw new Error("No Home Assistant connection available.");
        }
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
            [STORAGE_ATTRIBUTE]: fullData
        });
    }

    /**
     * Save one key. The new value is readable through getData() as soon as
     * this is called (before the returned promise settles); if the write
     * fails it is taken back and { success: false, error } is returned.
     * @param {string} key The key to write
     * @param {any} value The data to store
     */
    async saveData(key, value) {
        if (!this.hass) {
            return { success: false, error: "No connection" };
        }

        const entry = {};
        const replaced = new Map();
        try {
            // Everything up to the await runs synchronously for the caller.
            entry.json = JSON.stringify(value);
            const fullData = { ...this._blob(), [key]: value };
            replaced.set(key, this._pending.get(key));
            this._pending.set(key, entry);
            this._pendingAt = this._now();

            // Persist (event for admins, middle-man script for guests)
            await this._write(fullData);

            return { success: true };
        } catch (e) {
            console.error('[StorageManager] Save failed:', e);
            this._undoPending(replaced, entry);
            return { success: false, error: e.message };
        }
    }

    /**
     * Resets the entire storage to a clean state (empty object).
     * CAUTION: This wipes all pinned items and device settings.
     */
    async resetStorage() {
        if (!this.hass) return { success: false, error: "No connection" };

        console.warn('[StorageManager] Wiping persistent data...');

        // The blob being sent is {}: until the sensor shows it, every key it
        // still holds (and every key we had pending) reads as gone, and a
        // write made meanwhile does not bring them back.
        const entry = { json: undefined };
        const replaced = new Map(this._pending);
        for (const key of Object.keys(this._sensorBlob())) {
            if (!replaced.has(key)) replaced.set(key, undefined);
        }
        for (const key of replaced.keys()) this._pending.set(key, entry);
        this._pendingAt = this._now();

        try {
            await this._write({});
            return { success: true };
        } catch (e) {
            console.error('[StorageManager] Reset failed:', e);
            this._undoPending(replaced, entry);
            return { success: false, error: e.message };
        }
    }
}
