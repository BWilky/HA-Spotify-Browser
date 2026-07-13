// Liked Songs artwork: the same purple gradient + white heart the Liked Songs
// view uses (linear-gradient(135deg, #4a35d6, #8d7bf0)), inlined as an SVG data
// URI so it can be used anywhere an image URL is expected (pills, cards, editor).
// Double quotes + encodeURIComponent keep it safe inside `url('...')`.
const LIKED_SONGS_SVG =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#4a35d6"/><stop offset="1" stop-color="#8d7bf0"/>` +
    `</linearGradient></defs>` +
    `<rect width="100" height="100" fill="url(#g)"/>` +
    `<g transform="translate(26,26) scale(2)"><path fill="#fff" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></g>` +
    `</svg>`;
export const LIKED_SONGS_IMAGE = `data:image/svg+xml,${encodeURIComponent(LIKED_SONGS_SVG)}`;

// The Liked Songs / User Library entry is mandatory and always pinned at #0.
// It is not user-editable (can't be removed, reordered off the top, or toggled).
export const USER_LIBRARY_ITEM = {
    id: 'user-library',
    type: 'library',
    name: 'User Library',
    title: 'User Library',
    subtitle: 'Your collection & liked songs',
    image: LIKED_SONGS_IMAGE,
    uri: 'spotify:user-library'
};

// Besides the mandatory Liked Songs entry, the user may pin up to 7 items
// (8 buttons total). Home fills any remaining slots with recently played items.
export const MAX_PINNED_OTHERS = 7;

export class PinnedItemsManager {
    constructor(hass, config, storageManager) {
        this.hass = hass;
        this.config = config || {};
        this.storageManager = storageManager;
        this._storageKey = 'pinned_items';
        // Optimistic write cache: a save fires a HA event and the sensor only
        // reflects it after a round-trip, so reads in between would be stale.
        // After a write we return this list until the sensor catches up (or a
        // timeout passes, so a lost/conflicting write can't get stuck).
        this._pendingWrite = null;
        this._pendingWriteAt = 0;
    }

    /** Effective pinned list: the optimistic write if the sensor hasn't caught up, else the sensor's. */
    _readItems() {
        const data = this.storageManager?.getData(this._storageKey);
        const sensorItems = Array.isArray(data) ? data : [];
        if (this._pendingWrite) {
            const expired = Date.now() - this._pendingWriteAt > 10000;
            if (expired || JSON.stringify(sensorItems) === JSON.stringify(this._pendingWrite)) {
                this._pendingWrite = null; // sensor caught up (or we gave up waiting)
            } else {
                return this._pendingWrite;
            }
        }
        return sensorItems;
    }

    updateHass(hass) {
        this.hass = hass;
        if (this.storageManager) {
            this.storageManager.updateHass(hass);
        }
    }

    updateConfig(config) {
        this.config = config || {};
    }

    /**
     * Whether the pinned section can be SHOWN (read). True whenever a sensor
     * backend exists — everyone who can see the sensor sees the pins, even if
     * they can't edit them.
     */
    checkAvailability() {
        if (!this.storageManager) return false;
        return this.storageManager.writeStatus() !== 'no_backend';
    }

    /**
     * Whether the current user can EDIT pins (pin/unpin, reorder). Requires write
     * access: an admin, or a guest with a working `storage.script` middle-man.
     * Guests without one see pins read-only (no pin button, no edit button).
     */
    canEdit() {
        if (!this.storageManager) return false;
        return this.storageManager.writeStatus() === 'ok';
    }

    get sensorEntity() {
        return this.storageManager?.config?.sensor || 'sensor.spotify_browser_data';
    }

    /**
     * Normalize a stored list into the canonical pinned list: the mandatory
     * Liked Songs entry first, then the user's other pins (max 7). Any stored
     * user-library entry is dropped and re-prepended so it's always #0.
     */
    _normalize(stored) {
        const arr = Array.isArray(stored) ? stored : [];
        const others = arr.filter(i => i && i.id !== 'user-library').slice(0, MAX_PINNED_OTHERS);
        return [{ ...USER_LIBRARY_ITEM }, ...others];
    }

    async getItems() {
        if (!this.checkAvailability()) return [];
        try {
            return this._normalize(this._readItems());
        } catch (e) {
            console.error("[PinnedItemsManager] Failed to fetch items:", e);
            return [{ ...USER_LIBRARY_ITEM }];
        }
    }

    isPinned(itemId) {
        if (!this.checkAvailability()) return false;
        if (itemId === 'user-library') return true; // mandatory, always pinned
        try {
            return !!this._readItems().find(i => i.id === itemId);
        } catch (e) {
            return false;
        }
    }

    async add(item) {
        if (!this.checkAvailability()) return { success: false, error: "No storage configured" };
        // Liked Songs is always pinned at #0; pinning it is a no-op.
        if (item.id === 'user-library') return { success: true };

        try {
            const currentItems = this._normalize(this._readItems()); // [library, ...others]
            const others = currentItems.filter(i => i.id !== 'user-library');

            // Check if already exists
            if (others.find(i => i.id === item.id)) {
                return { success: false, error: "Already pinned" };
            }

            if (others.length >= MAX_PINNED_OTHERS) {
                return { success: false, error: `Pinned is full (max ${MAX_PINNED_OTHERS} items besides Liked Songs)` };
            }

            // Create minimal stored object. Capture the name from every known
            // field and persist it under BOTH `name` and `title` so no reader (or
            // JSON round-trip dropping an undefined key) can lose it.
            const displayName = item.name || item.title || item.album?.name || '';
            const storedItem = {
                id: item.id,
                type: item.type,
                name: displayName,
                title: displayName,
                subtitle: item.subtitle || item.description || '',
                image: item.image || item.images?.[0]?.url || item.album?.images?.[0]?.url || null,
                uri: item.uri
            };

            // Library stays first; new pin goes to the top of the "others".
            const newItems = [{ ...USER_LIBRARY_ITEM }, storedItem, ...others].slice(0, 1 + MAX_PINNED_OTHERS);
            return await this._save(newItems);

        } catch (e) {
            console.error("[PinnedItemsManager] Add failed:", e);
            return { success: false, error: e.message };
        }
    }

    async remove(itemId) {
        if (!this.checkAvailability()) return { success: false, error: "No storage" };
        // Liked Songs is mandatory and cannot be removed.
        if (itemId === 'user-library') return { success: true };
        try {
            const currentItems = this._normalize(this._readItems());
            const newItems = currentItems.filter(i => i.id !== itemId);
            if (newItems.length === currentItems.length) return { success: true };

            return await this._save(newItems);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async toggle(item) {
        const items = this._normalize(this._readItems());
        const exists = items.find(i => i.id === item.id);
        if (exists) return await this.remove(item.id);
        else return await this.add(item);
    }

    async addByUri(api, uri) {
        if (!uri || !uri.startsWith('spotify:')) return { success: false, error: "Invalid URI format" };

        const parts = uri.split(':');
        let type = parts[1];
        let id = parts[2];

        if (parts[1] === 'user' && parts[3] === 'playlist') {
            type = 'playlist';
            id = parts[4];
        }

        const ALLOWED_TYPES = ['album', 'playlist', 'track', 'artist'];
        if (!ALLOWED_TYPES.includes(type)) {
            return { success: false, error: "URI must be for an Album, Playlist, Track, or Artist." };
        }

        if (!id) return { success: false, error: "Invalid URI: Missing ID" };

        try {
            let data = null;
            let title = '';
            let subtitle = '';
            let image = null;

            if (type === 'artist') {
                const res = await api.fetchSpotifyPlus('get_artist', { artist_id: id }, true);
                if (res) {
                    data = res.result || res;
                    title = data.name;
                    subtitle = 'Artist';
                    image = data.images?.[0]?.url;
                }
            } else if (type === 'album') {
                const res = await api.fetchSpotifyPlus('get_album', { album_id: id }, true);
                if (res) {
                    data = res.result || res;
                    title = data.name;
                    subtitle = data.artists ? data.artists.map(a => a.name).join(', ') : 'Album';
                    image = data.images?.[0]?.url;
                }
            } else if (type === 'playlist') {
                const res = await api.fetchSpotifyPlus('get_playlist', { playlist_id: id }, true);
                if (res) {
                    data = res.result || res;
                    title = data.name;
                    subtitle = data.description || (data.owner ? `By ${data.owner.display_name}` : 'Playlist');
                    image = data.images?.[0]?.url;
                }
            } else if (type === 'track') {
                const res = await api.fetchSpotifyPlus('get_track', { track_id: id }, true);
                if (res) {
                    data = res.result || res;
                    title = data.name;
                    const artistName = data.artists ? data.artists.map(a => a.name).join(', ') : '';
                    const albumName = data.album ? data.album.name : '';
                    subtitle = artistName ? `${artistName} • ${albumName}` : albumName;
                    image = data.album?.images?.[0]?.url;
                }
            }

            if (!data) return { success: false, error: `Could not fetch details for ${type}` };

            const item = {
                id: id,
                type: type,
                title: title,
                subtitle: subtitle,
                image: image,
                uri: uri
            };
            return await this.add(item);
        } catch (e) {
            return { success: false, error: e.message || "Fetch failed" };
        }
    }

    async reorder(orderedItemsOrIds) {
        if (!this.checkAvailability()) return { success: false };
        try {
            const currentItems = this._normalize(this._readItems());
            const itemMap = new Map(currentItems.map(i => [i.id, i]));

            // Rebuild the "others" order from the incoming list, dropping any
            // user-library entries (it's force-pinned at #0 below) and dupes.
            const others = [];
            const processedIds = new Set();
            for (const itemOrId of orderedItemsOrIds) {
                const id = (typeof itemOrId === 'object' && itemOrId.id) ? itemOrId.id : itemOrId;
                if (id === 'user-library' || processedIds.has(id)) continue;
                processedIds.add(id);
                if (typeof itemOrId === 'object') others.push(itemOrId);
                else if (itemMap.has(id)) others.push(itemMap.get(id));
            }

            const newOrder = [{ ...USER_LIBRARY_ITEM }, ...others.slice(0, MAX_PINNED_OTHERS)];
            return await this._save(newOrder);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async _save(items) {
        if (!this.checkAvailability()) return { success: false };
        // Reflect the new list immediately — BEFORE the network write — so reads
        // (home, the editor) update instantly instead of waiting for the event to
        // fire and the sensor's state to round-trip back through hass. Setting this
        // synchronously (before the first await) lets callers refresh right away.
        this._pendingWrite = items;
        this._pendingWriteAt = Date.now();
        try {
            // Directly save the array of objects (HA attributes handle complex types)
            const res = await this.storageManager.saveData(this._storageKey, items);
            // On failure drop the optimistic list so reads fall back to the sensor.
            if (res && res.success === false) this._pendingWrite = null;
            return res;
        } catch (e) {
            console.error('[PinnedItemsManager] Save failed:', e);
            this._pendingWrite = null;
            return { success: false, error: e.message };
        }
    }

    /**
     * Check if the pinned items data has changed between two HASS states
     * @param {Object} oldHass 
     * @param {Object} newHass 
     * @returns {boolean}
     */
    hasDataChanged(oldHass, newHass) {
        if (!oldHass || !newHass) return false;

        const entityId = this.sensorEntity;
        const oldState = oldHass.states[entityId];
        const newState = newHass.states[entityId];

        if (!oldState || !newState) return false;

        // Optimized check: compare references first, then the pinned slice only
        // (the 'data' attribute also holds device-manager state we don't care about)
        if (oldState === newState) return false;

        const oldData = oldState.attributes.data;
        const newData = newState.attributes.data;
        if (oldData === newData) return false;

        const parse = (d) => {
            if (typeof d !== 'string') return d;
            try { return JSON.parse(d); } catch (e) { return null; }
        };
        const oldItems = parse(oldData)?.[this._storageKey];
        const newItems = parse(newData)?.[this._storageKey];

        return JSON.stringify(oldItems) !== JSON.stringify(newItems);
    }

    async reset() {
        if (!this.checkAvailability()) return { success: false };
        // Keep the mandatory Liked Songs entry; clear the user's other pins.
        return await this._save([{ ...USER_LIBRARY_ITEM }]);
    }
}
