export class SpotifyApi {
    constructor(hass, entityId, defaultDevice = null) {
        this.hass = hass;
        this.entityId = entityId;
        this.defaultDevice = defaultDevice; 
    }

    updateHass(hass) {
        this.hass = hass;
    }

    // Generic wrapper for SpotifyPlus custom services
    async fetchSpotifyPlus(service, params = {}, expectResponse = true) {
        if (!this.hass) return null;
        
        // AUTO-INJECT DEVICE ID (Only if inactive)
        // Only inject default if we aren't already playing
        if (this.defaultDevice && !params.device_id && service.startsWith('player_media_play')) {
            const stateObj = this.hass.states[this.entityId];
            const isActive = stateObj && ['playing', 'paused'].includes(stateObj.state);
            
            // Only force default device if we are NOT currently active
            if (!isActive) {
                params.device_id = this.defaultDevice;
            }
        }

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

            const result = response ? (
                response.user_profile || 
                (response.response && response.response.user_profile) || 
                response.result || 
                response.response
            ) : null;
            
            if (response && response.response) return response.response;
            return response;
        } catch (e) {
            console.warn(`[SpotifyAPI] Failed Call [${service}]:`, JSON.stringify(e, null, 2));
            return null;
        }
    }

    async playMedia(uri, type, specificDevice = null) {
        if (!this.hass || !uri) return { success: false, error: "No URI" };

        const stateObj = this.hass.states[this.entityId];
        const isActive = stateObj && ['playing', 'paused'].includes(stateObj.state);

        let deviceToUse = specificDevice;

        // If requested device is Default, but we are already playing elsewhere, ignore it.
        if (deviceToUse === this.defaultDevice && isActive) {
            deviceToUse = null; 
        }

        // If inactive and no device specified, wake up Default.
        if (!deviceToUse && !isActive) {
            deviceToUse = this.defaultDevice;
        }

        const params = {};
        if (deviceToUse) params.device_id = deviceToUse;

        try {
            // 1. Context Playback (Playlists, Albums, Artists)
            // Use 'player_media_play_context' which takes a context_uri
            if (['playlist', 'album', 'artist', 'show'].includes(type)) {
                params.context_uri = uri;
                await this.fetchSpotifyPlus('player_media_play_context', params, false);
            } 
            // 2. Track Playback (Single Songs / Popular Tracks)
            // FIX: Use 'player_media_play_tracks' which takes a 'uris' string/list
            else {
                if (deviceToUse) {
                     // We use the custom service because it supports 'device_id' injection
                     params.uris = uri; 
                     await this.fetchSpotifyPlus('player_media_play_tracks', params, false);
                } else {
                    // Standard fallback (safest for general playback)
                    await this.hass.callService('media_player', 'play_media', {
                        entity_id: this.entityId,
                        media_content_id: uri,
                        media_content_type: type
                    });
                }
            }
            return { success: true };
        } catch (e) {
            console.error("[SpotifyBrowser] Play failed:", e);
            return { success: false, error: e };
        }
    }

    async togglePlayback(play) {
        if (!this.hass) return;
        const service = play ? 'media_play' : 'media_pause';
        try {
            await this.hass.callService('media_player', service, {
                entity_id: this.entityId
            });
        } catch (e) {
            console.error(`Failed to ${service}:`, e);
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

    async setVolume(volumeLevel) {
        if (!this.hass) return;
        try {
            await this.hass.callService('media_player', 'volume_set', {
                entity_id: this.entityId,
                volume_level: volumeLevel
            });
        } catch (e) {
            console.error("Failed to set volume:", e);
        }
    }
}
