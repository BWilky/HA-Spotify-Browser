export class PinnedItemsManager {
    constructor(hass, config, storageManager) {
        this.hass = hass;
        this.config = config || {};
        this.storageManager = storageManager;
        this._validated = false;
        this._storageKey = 'pinned_items';
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

    get _limit() {
        return this.config.limit || 10;
    }

    checkAvailability() {
        if (!this.storageManager) return false;
        return true;
    }

    get sensorEntity() {
        return this.storageManager?.config?.sensor_entity || 'sensor.spotify_browser_data';
    }

    async getItems() {
        if (!this.checkAvailability()) return [];
        try {
            const data = this.storageManager.getData(this._storageKey);
            if (Array.isArray(data)) {
                return data;
            }
            return [];
        } catch (e) {
            console.error("[PinnedItemsManager] Failed to fetch items:", e);
            return [];
        }
    }

    isPinned(itemId) {
        if (!this.checkAvailability()) return false;
        try {
            const data = this.storageManager.getData(this._storageKey);
            if (Array.isArray(data)) {
                return !!data.find(i => i.id === itemId);
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    async add(item) {
        if (!this.checkAvailability()) return { success: false, error: "No storage configured" };

        try {
            const currentItems = await this.getItems();

            // Check if already exists
            if (currentItems.find(i => i.id === item.id)) {
                return { success: false, error: "Already pinned" };
            }

            // Create minimal stored object
            const storedItem = {
                id: item.id,
                type: item.type,
                title: item.title || item.name,
                subtitle: item.subtitle || item.description || '',
                image: item.image || item.images?.[0]?.url || null,
                uri: item.uri
            };

            // Add to TOP
            let newItems = [storedItem, ...currentItems];

            // Limit
            if (newItems.length > this._limit) {
                newItems = newItems.slice(0, this._limit);
            }

            return await this._save(newItems);

        } catch (e) {
            console.error("[PinnedItemsManager] Add failed:", e);
            return { success: false, error: e.message };
        }
    }

    async remove(itemId) {
        if (!this.checkAvailability()) return { success: false, error: "No storage" };
        try {
            const currentItems = await this.getItems();
            const newItems = currentItems.filter(i => i.id !== itemId);
            if (newItems.length === currentItems.length) return { success: true };

            return await this._save(newItems);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async toggle(item) {
        const items = await this.getItems();
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
            const currentItems = await this.getItems();
            const itemMap = new Map(currentItems.map(i => [i.id, i]));
            const USER_LIBRARY_ITEM = {
                id: 'user-library',
                type: 'library',
                title: 'User Library',
                subtitle: 'Your collection & liked songs',
                image: 'https://www.gstatic.com/images/icons/material/system/2x/library_music_white_24dp.png',
                uri: 'spotify:user-library'
            };

            const newOrder = [];
            const processedIds = new Set();

            for (const itemOrId of orderedItemsOrIds) {
                const id = (typeof itemOrId === 'object' && itemOrId.id) ? itemOrId.id : itemOrId;
                if (processedIds.has(id)) continue;

                if (typeof itemOrId === 'object') {
                    newOrder.push(itemOrId);
                    itemMap.delete(id);
                } else if (itemMap.has(id)) {
                    newOrder.push(itemMap.get(id));
                    itemMap.delete(id);
                } else if (id === 'user-library') {
                    newOrder.push(USER_LIBRARY_ITEM);
                }
                processedIds.add(id);
            }

            for (const [id, item] of itemMap) {
                if (id !== 'user-library' && !processedIds.has(id)) {
                    newOrder.push(item);
                }
            }

            // Ensure Library anchor logic if any (optional, but requested before)
            // ...

            return await this._save(newOrder);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async _save(items) {
        if (!this.checkAvailability()) return { success: false };
        try {
            // Directly save the array of objects (HA attributes handle complex types)
            return await this.storageManager.saveData(this._storageKey, items);
        } catch (e) {
            console.error('[PinnedItemsManager] Save failed:', e);
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

        // Optimized check: compare references first, then stringified data
        if (oldState === newState) return false;

        // Use the storage key to check specific attribute if possible, otherwise check 'data'
        const attrKey = 'data';
        const oldData = oldState.attributes[attrKey];
        const newData = newState.attributes[attrKey];

        if (oldData === newData) return false;

        return JSON.stringify(oldData) !== JSON.stringify(newData);
    }

    async reset() {
        if (!this.checkAvailability()) return { success: false };
        return await this._save([]);
    }
}
