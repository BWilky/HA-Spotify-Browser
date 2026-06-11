import { PinnedItemsManager } from './components/controllers/pinned-items-manager.js'; // Keep import or remove? Removing as per request.

export class SpotifyApi {
    constructor(hass, entityId, deviceResolver = null, defaultVolumeConfig = null, onNotification = null, onError = null) {
        this.hass = hass;
        this.entityId = entityId;
        this.deviceResolver = deviceResolver; // Function that returns Promise<deviceId or null>
        this.defaultVolumeConfig = defaultVolumeConfig;
        this.onNotification = onNotification;
        this.onError = onError;
    }

    _notify(message) {
        if (this.onNotification) this.onNotification(message);
    }

    _reportError(error) {
        if (this.onError) this.onError(error);
    }

    _resolveDefaultVolume() {
        if (!this.defaultVolumeConfig) return null;

        const { fallback, rules } = this.defaultVolumeConfig;

        if (!rules || rules.length === 0) return fallback;

        const now = new Date();
        const currentH = now.getHours();
        const currentM = now.getMinutes();
        const currentTotalM = currentH * 60 + currentM;

        for (const rule of rules) {
            if (!rule.start || !rule.end || !rule.level) continue;

            const [sH, sM] = rule.start.split(':').map(Number);
            const [eH, eM] = rule.end.split(':').map(Number);

            const startTotal = sH * 60 + sM;
            const endTotal = eH * 60 + eM;

            // Handle Overnight (23:00 to 07:00) vs Day (09:00 to 17:00)
            let match = false;
            if (startTotal < endTotal) {
                // Normal Range
                if (currentTotalM >= startTotal && currentTotalM < endTotal) match = true;
            } else {
                // Overnight Range
                if (currentTotalM >= startTotal || currentTotalM < endTotal) match = true;
            }

            if (match) return Number(rule.level);
        }

        return Number(fallback);
    }

    updateHass(hass) {
        this.hass = hass;
    }

    // config is no longer needed here as API is pure SpotifyPlus
    setConfig(config) {
        this.config = config;
        this._manageScanInterval();
    }

    _manageScanInterval() {
        // Clear existing
        if (this._scanIntervalTimer) {
            clearInterval(this._scanIntervalTimer);
            this._scanIntervalTimer = null;
        }

        if (!this.config || !this.config.scan_interval) return;

        const interval = Number(this.config.scan_interval);

        // Validate: 1000ms to 15000ms
        if (isNaN(interval) || interval < 1000 || interval > 15000) {
            console.warn("[SpotifyAPI] Invalid scan_interval. Must be between 1000 and 15000 ms.");
            return;
        }

        console.log(`[SpotifyAPI] Starting Custom Scan Interval: ${interval}ms`);
        this._scanIntervalTimer = setInterval(() => {
            this.triggerScan();
        }, interval);
    }

    async fetchSpotifyPlus(service, params = {}, expectResponse = true, logError = true, throwOnError = false) {
        if (!this.hass) return null;

        // --- FIX: MAP STANDARD CONTROLS TO MEDIA_PLAYER DOMAIN ---
        // SpotifyPlus doesn't have custom services for basic transport controls.
        // We must redirect these to the standard HA 'media_player' domain.
        const standardServices = {
            'player_media_next_track': 'media_next_track',
            'player_media_previous_track': 'media_previous_track',
            'player_media_play': 'media_play',
            'player_media_pause': 'media_pause',
            'player_shuffle': 'shuffle_set',
            'player_repeat': 'repeat_set'
        };

        if (standardServices[service]) {
            const haService = standardServices[service];
            let callParams = { entity_id: this.entityId };

            // Handle Shuffle (Map 'state' -> 'shuffle')
            if (service === 'player_shuffle') {
                // If param is 'true' string or boolean true, use true.
                // Note: Standard HA toggle is hard, usually we just set it.
                // The UI sends { state: 'true' } usually.
                callParams.shuffle = params.state === 'true' || params.state === true;
            }

            // Handle Repeat (Map 'state' -> 'repeat')
            if (service === 'player_repeat') {
                callParams.repeat = params.state || 'all';
            }

            try {
                await this.hass.callService('media_player', haService, callParams);
                this.triggerScan(); // Trigger scan after standard transport
                return { success: true };
            } catch (e) {
                console.warn(`[SpotifyAPI] Standard Service Call Failed [${haService}]:`, e);
                return null;
            }
        }
        // ---------------------------------------------------------


        // AUTO-INJECT DEVICE ID REMOVED: Managed strictly in playMedia for better control
        // to avoid double-logic causing delays.

        if (!this.hass) return null;

        try {
            const payload = {
                type: 'call_service',
                domain: 'spotifyplus',
                service: service,
                service_data: {
                    entity_id: this.entityId,
                    ...params
                }
            };

            if (expectResponse) payload.return_response = true;

            const response = await this.hass.callWS(payload);

            if (!expectResponse) return true;

            if (response && response.response) return response.response;
            return response;

        } catch (e) {
            // Report major errors via callback
            const errCode = e.code || '';
            const errMsg = e.message || '';
            if (errCode === 'service_validation_error' || errMsg.includes('Validation error')) {
                this._reportError(e);
            }

            if (throwOnError) throw e;

            if (logError) {
                console.warn(`[SpotifyAPI] Failed Call [${service}]:`, JSON.stringify(e, null, 2));
            }
            return null;
        }
    }

    async triggerScan() {
        if (!this.hass) return;
        try {
            // Force HA to scan Spotify immediately
            await this.hass.callService('spotifyplus', 'trigger_scan_interval', {
                entity_id: this.entityId
            });
            // Wait 40ms for propagation as requested
            await new Promise(r => setTimeout(r, 40));
        } catch (e) {
            console.warn("[SpotifyAPI] Trigger Scan Failed:", e);
        }
    }

    async playMedia(uri, type, specificDevice = null, extraOptions = {}) {
        if (!this.hass) return { success: false, error: "No HASS" };

        const stateObj = this.hass.states[this.entityId];
        // Active = playing, paused, or buffering. Idle/Off is not active.
        const isActive = stateObj && ['playing', 'paused', 'buffering'].includes(stateObj.state);

        // ... (Device Strategy Code Omitted for brevity, unchanged) ...
        // 1. Determine Device Strategy
        let deviceToUse = null;
        let backupDevice = null;
        let primaryDeviceName = "Default Device";
        let defaultShuffle = null;

        if (specificDevice) {
            deviceToUse = specificDevice;
        } else {
            if (!isActive) {
                if (this.deviceResolver) {
                    try {
                        // Returns ID of device to use (from Default or User Selection)
                        const resolvedDevice = await this.deviceResolver();

                        if (resolvedDevice) {
                            if (typeof resolvedDevice === 'object') {
                                deviceToUse = resolvedDevice.id;
                                if (resolvedDevice.is_backup) backupDevice = resolvedDevice.backup_id; // Future proofing
                            } else {
                                deviceToUse = resolvedDevice;
                            }
                        } else {
                            // User cancelled or no device available
                            console.log("[SpotifyBrowser] Playback cancelled: No device selected.");
                            return { success: false, error: "No Device Selected" };
                        }
                    } catch (e) {
                        console.error("[SpotifyBrowser] Device resolution failed:", e);
                        return { success: false, error: "Device Resolution Failed" };
                    }
                } else {
                    console.warn("[SpotifyBrowser] Player idle & no device resolver. Playback may fail.");
                }

                // Apply Default Volume if configured (even if we resolved a device dynamically)
                // We might want to make this optional or tied to the device in future
                const vol = this._resolveDefaultVolume();
                if (vol !== null) {
                    console.log("[SpotifyBrowser] Applying Default Volume:", vol);
                    this.setVolume(vol / 100);
                }
            } else {
                deviceToUse = null; // Active -> Use current
            }
        }

        const executePlay = async (deviceIdToTry) => {
            const params = { ...extraOptions };
            if (deviceIdToTry) params.device_id = deviceIdToTry;

            if (defaultShuffle !== null && params.shuffle === undefined) {
                params.shuffle = defaultShuffle;
            }

            try {
                if (['playlist', 'album', 'artist', 'show'].includes(type)) {
                    params.context_uri = uri;
                    if (extraOptions.offset_uri) params.offset_uri = extraOptions.offset_uri;

                    // Enable throwOnError to catch validation errors
                    const res = await this.fetchSpotifyPlus('player_media_play_context', params, false, true, true);

                    if ((!res || res.error) && extraOptions.offset_uri) {
                        console.warn("[SpotifyAPI] Context jump failed. Falling back to Track Play.");
                        return await this.playMedia(extraOptions.offset_uri, 'track', deviceIdToTry);
                    }
                    if (!res) return { success: false, error: "Call Failed" };

                    // Trigger Scan on Success
                    this.triggerScan();
                    return { success: true };
                }
                else if (type === 'likedsongs') {
                    params.shuffle = true;
                    // Enable throwOnError
                    const res = await this.fetchSpotifyPlus('player_media_play_track_favorites', params, false, true, true);
                    if (!res) return { success: false, error: "Call Failed" };

                    // Trigger Scan on Success
                    this.triggerScan();
                    return { success: true };
                }
                else {
                    // C. Tracks / Fallback
                    if (deviceIdToTry || Array.isArray(uri)) {
                        const uriArray = Array.isArray(uri) ? uri : [uri];
                        params.uris = uriArray.join(',');

                        // Enable throwOnError
                        const res = await this.fetchSpotifyPlus('player_media_play_tracks', params, false, true, true);
                        if (!res) return { success: false, error: "Call Failed" };
                    } else {
                        const contentId = Array.isArray(uri) ? uri[0] : uri;
                        await this.hass.callService('media_player', 'play_media', {
                            entity_id: this.entityId,
                            media_content_id: contentId,
                            media_content_type: type
                        });
                    }
                    // Trigger Scan on Success
                    this.triggerScan();
                    return { success: true };
                }
            } catch (e) {
                console.error("Playback execution failed:", e);
                return { success: false, error: e };
            }
        };

        // --- EXECUTE PLAYBACK (With Retry Logic) ---
        let result = await executePlay(deviceToUse);

        if (specificDevice || isActive) return result;

        if (result.success === false && deviceToUse && backupDevice) {
            console.warn(`[SpotifyBrowser] Primary device ${deviceToUse} failed. Trying backup ${backupDevice}.`);
            this._notify(`Playback Failed on ${deviceToUse}`);
            this._notify(`Trying Backup Device...`);

            result = await executePlay(backupDevice);

            if (result.success === false) {
                this._notify(`Playback Failed on Backup Device`);
            }
        } else if (result.success === false && deviceToUse) {
            this._notify(`Playback Failed on ${deviceToUse}`);
        }

        return result;
    }

    async togglePlayback(play) {
        if (!this.hass) return;
        const service = play ? 'media_play' : 'media_pause';
        try {
            await this.hass.callService('media_player', service, {
                entity_id: this.entityId
            });
            // Trigger Scan
            this.triggerScan();
        } catch (e) {
            console.error(`Failed to ${service}:`, e);
        }
    }

    // --- PLAYLIST MANAGEMENT ---

    async followPlaylist(playlistId, isPublic = true) {
        if (!this.hass || !playlistId) return { success: false };
        try {
            await this.hass.callService('spotifyplus', 'follow_playlist', {
                entity_id: this.entityId,
                playlist_id: playlistId,
                public: isPublic
            });
            return { success: true };
        } catch (e) {
            console.error("Follow Playlist failed:", e);
            return { success: false, error: e };
        }
    }

    async unfollowPlaylist(playlistId) {
        if (!this.hass || !playlistId) return { success: false };
        try {
            await this.hass.callService('spotifyplus', 'unfollow_playlist', {
                entity_id: this.entityId,
                playlist_id: playlistId
            });
            return { success: true };
        } catch (e) {
            console.error("Unfollow Playlist failed:", e);
            return { success: false, error: e };
        }
    }

    // --- PINNED ITEMS (STICKY) MANAGEMENT ---

    async getPinnedItems(entityId) {
        if (!this.hass || !entityId) return [];
        try {
            const state = this.hass.states[entityId];
            if (!state || !state.attributes || !state.attributes.options) return [];

            // Options are strings. Parse them to objects.
            return state.attributes.options.map(opt => {
                try {
                    return JSON.parse(opt);
                } catch (e) { return null; }
            }).filter(item => item !== null);
        } catch (e) {
            console.error("[API] Failed to fetch pinned items:", e);
            return [];
        }
    }

    async addPinnedItem(entityId, item, limit = 10) {
        if (!this.hass || !entityId || !item) return { success: false };
        try {
            const currentItems = await this.getPinnedItems(entityId);

            // Check limits
            if (currentItems.length >= limit) {
                return { success: false, error: `Limit reached (Max ${limit})` };
            }

            // Check duplicates (by ID)
            if (currentItems.find(i => i.id === item.id)) {
                return { success: false, error: "Already pinned" };
            }

            const currentState = this.hass.states[entityId];
            const currentOptions = currentState.attributes.options || [];

            // Create minimal stored object to save space
            const storedItem = {
                id: item.id,
                type: item.type,
                title: item.title || item.name,
                subtitle: item.subtitle || item.description || '',
                image: item.image || item.images?.[0]?.url || null,
                uri: item.uri
            };

            const newItemStr = JSON.stringify(storedItem);
            const newOptions = [...currentOptions, newItemStr];

            await this.hass.callService('input_select', 'set_options', {
                entity_id: entityId,
                options: newOptions
            });
            return { success: true };

        } catch (e) {
            console.error("[API] Failed to add pinned item:", e);
            return { success: false, error: e };
        }
    }

    async removePinnedItem(entityId, itemId) {
        if (!this.hass || !entityId || !itemId) return { success: false };
        try {
            const currentState = this.hass.states[entityId];
            const currentOptions = currentState.attributes.options || [];

            // Filter out the item matching the ID (need to parse to check ID)
            const newOptions = currentOptions.filter(optStr => {
                try {
                    const obj = JSON.parse(optStr);
                    return obj.id !== itemId;
                } catch (e) { return true; } // Keep malformed items? Or remove? Let's keep to be safe.
            });

            if (newOptions.length === currentOptions.length) return { success: false, error: "Item not found" };

            await this.hass.callService('input_select', 'set_options', {
                entity_id: entityId,
                options: newOptions
            });
            return { success: true };

        } catch (e) {
            console.error("[API] Failed to remove pinned item:", e);
            return { success: false, error: e };
        }
    }

    async getCurrentUserProfile() {
        if (!this.hass) return null;
        try {
            // Workaround: Use get_playlist_favorites to retrieve user profile since no dedicated service exists
            const res = await this.fetchSpotifyPlus('get_playlist_favorites', { limit_total: 1 }, true);
            return res?.user_profile; // Returns full user object including ID
        } catch (e) {
            console.warn("Get Current User Profile failed:", e);
            return null;
        }
    }

    async checkUserFollowsPlaylist(playlistId, userIds) {
        if (!this.hass || !playlistId || !userIds) return null;
        try {
            const idsParam = Array.isArray(userIds) ? userIds.join(',') : userIds;
            const res = await this.fetchSpotifyPlus('check_playlist_followers', {
                playlist_id: playlistId,
                user_ids: idsParam
            }, true);

            if (res?.result) {
                return Object.values(res.result);
            }
            return null;
        } catch (e) {
            console.warn("Check Playlist Followers failed:", e);
            return null;
        }
    }

    // --- ARTIST FOLLOW MANAGEMENT ---

    async followArtist(ids) {
        if (!this.hass || !ids) return { success: false };
        try {
            await this.hass.callService('spotifyplus', 'follow_artists', {
                entity_id: this.entityId,
                ids: Array.isArray(ids) ? ids.join(',') : ids
            });
            return { success: true };
        } catch (e) {
            console.error("Follow Artist failed:", e);
            return { success: false, error: e };
        }
    }

    async unfollowArtist(ids) {
        if (!this.hass || !ids) return { success: false };
        try {
            await this.hass.callService('spotifyplus', 'unfollow_artists', {
                entity_id: this.entityId,
                ids: Array.isArray(ids) ? ids.join(',') : ids
            });
            return { success: true };
        } catch (e) {
            console.error("Unfollow Artist failed:", e);
            return { success: false, error: e };
        }
    }

    async checkArtistsFollowing(ids) {
        if (!this.hass || !ids) return null;
        try {
            const idsParam = Array.isArray(ids) ? ids.join(',') : ids;
            // The response structure is tricky:
            // "result": { "artistID": true }
            const res = await this.fetchSpotifyPlus('check_artists_following', {
                ids: idsParam
            }, true);

            if (res?.result) {
                // If checking single ID, return single boolean
                if (!Array.isArray(ids) && !idsParam.includes(',')) {
                    return res.result[idsParam];
                }
                return res.result;
            }
            return null;
        } catch (e) {
            console.error("Check Artists Following failed:", e);
            return null;
        }
    }

    async transferPlayback(deviceId) {
        if (!this.hass || !deviceId) return { success: false, error: { message: "No device ID" } };
        try {
            await this.hass.callService('spotifyplus', 'player_transfer_playback', {
                entity_id: this.entityId,
                device_id: deviceId,
                play: true
            });
            return { success: true };
        } catch (e) {
            console.error("Transfer failed:", e);
            return { success: false, error: e };
        }
    }

    async checkTrackFavorites(ids) {
        if (!this.hass || !ids) return null;
        try {
            const idsParam = Array.isArray(ids) ? ids.join(',') : ids;
            const res = await this.fetchSpotifyPlus('check_track_favorites', {
                ids: idsParam
            }, true);

            if (res?.result) {
                // If checking single ID, return single boolean
                if (!Array.isArray(ids) && !idsParam.includes(',')) {
                    return res.result[idsParam];
                }
                return res.result;
            }
            return null;
        } catch (e) {
            console.error("Check Track Favorites failed:", e);
            return null;
        }
    }

    async getTrackFavorites(options = {}) {
        if (!this.hass) return null;
        // options: limit, offset, market
        return await this.fetchSpotifyPlus('get_track_favorites', options);
    }

    async getCurrentUserPlaylists(options = {}) {
        if (!this.hass) return null;
        // options: limit, offset
        // Using 'get_playlist_favorites' as confirmed in old code and Wiki
        return await this.fetchSpotifyPlus('get_playlist_favorites', options);
    }

    async searchPlaylists(query, limit = 10, offset = 0) {
        if (!this.hass || !query) return { result: { items: [] } };

        // Use 'search_playlists' service
        return await this.fetchSpotifyPlus('search_playlists', {
            criteria: query,
            limit: limit,
            offset: offset
        });
    }

    async saveTrackFavorites(ids) {
        if (!this.hass || !ids) return { success: false };
        try {
            await this.hass.callService('spotifyplus', 'save_track_favorites', {
                entity_id: this.entityId,
                ids: Array.isArray(ids) ? ids.join(',') : ids
            });
            return { success: true };
        } catch (e) {
            console.error("Save Track Favorites failed:", e);
            return { success: false, error: e };
        }
    }

    async removeTrackFavorites(ids) {
        if (!this.hass || !ids) return { success: false };
        try {
            await this.hass.callService('spotifyplus', 'remove_track_favorites', {
                entity_id: this.entityId,
                ids: Array.isArray(ids) ? ids.join(',') : ids
            });
            return { success: true };
        } catch (e) {
            console.error("Remove Track Favorites failed:", e);
            return { success: false, error: e };
        }
    }

    async setVolume(volumeLevel) {
        if (!this.hass) return { success: false };
        try {
            await this.hass.callService('media_player', 'volume_set', {
                entity_id: this.entityId,
                volume_level: volumeLevel
            });
            return { success: true };
        } catch (e) {
            console.error("Failed to set volume:", e);
            return { success: false, error: e };
        }
    }
}