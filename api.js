export class SpotifyApi {
    constructor(hass, entityId, defaultDevice = null) {
        this.hass = hass;
        this.entityId = entityId;
        this.defaultDevice = defaultDevice; 
    }

    updateHass(hass) {
        this.hass = hass;
    }

    async fetchSpotifyPlus(service, params = {}, expectResponse = true) {
        if (!this.hass) return null;
        
        // AUTO-INJECT DEVICE ID (Only if inactive)
        // We replicate the logic here: only inject default if we aren't already playing
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

        // 1. Check current state
        const stateObj = this.hass.states[this.entityId];
        // 'on' is sometimes used by players, but usually 'playing'/'paused' implies active session
        const isActive = stateObj && ['playing', 'paused'].includes(stateObj.state);

        // 2. Determine Device Strategy
        let deviceToUse = specificDevice;

        // SMART CHECK:
        // If the requested device is the Default Device, AND we are already playing elsewhere,
        // ignore the request and stick with the current active device.
        if (deviceToUse === this.defaultDevice && isActive) {
            deviceToUse = null; 
        }

        // If no device is selected/forced, and we are inactive, THEN use default to wake it up.
        if (!deviceToUse && !isActive) {
            deviceToUse = this.defaultDevice;
        }

        const params = {};
        if (deviceToUse) params.device_id = deviceToUse;

        try {
            if (['playlist', 'album', 'artist', 'show'].includes(type)) {
                params.context_uri = uri;
                await this.fetchSpotifyPlus('player_media_play_context', params, false);
            } 
            else if (type === 'track') {
                params.uris = uri; 
                await this.fetchSpotifyPlus('player_media_play_track_favorites', params, false);
            }
            else {
                await this.hass.callService('media_player', 'play_media', {
                    entity_id: this.entityId,
                    media_content_id: uri,
                    media_content_type: type
                });
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
