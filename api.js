export class SpotifyApi {
    constructor(hass, entityId, defaultDevice = null) {
        this.hass = hass;
        this.entityId = entityId;
        this.defaultDevice = defaultDevice; // Store default device
    }

    updateHass(hass) {
        this.hass = hass;
    }

    /**
     * Call SpotifyPlus services.
     * Automatically injects 'device_id' for player commands if configured.
     */
    async fetchSpotifyPlus(service, params = {}, expectResponse = true) {
        if (!this.hass) return null;
        
        // AUTO-INJECT DEVICE ID
        // If we have a default device, the param is missing, and it's a player command...
        if (this.defaultDevice && !params.device_id && service.startsWith('player_media_play')) {
            params.device_id = this.defaultDevice;
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

            if (expectResponse) {
                payload.return_response = true;
            }

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

    /**
     * Enhanced Play Media that leverages SpotifyPlus auto-wake capabilities
     */
    async playMedia(uri, type, specificDevice = null) {
        if (!this.hass || !uri) return { success: false, error: "No URI" };

        // Determine target device (Specific > Default > Active/None)
        const deviceToUse = specificDevice || this.defaultDevice;

        const params = {};
        if (deviceToUse) params.device_id = deviceToUse;

        try {
            // Case 1: Contexts (Playlist, Album, Artist, Show)
            // Docs: "This service will auto-power on the player if it is currently turned off."
            if (['playlist', 'album', 'artist', 'show'].includes(type)) {
                params.context_uri = uri;
                await this.fetchSpotifyPlus('player_media_play_context', params, false);
            } 
            // Case 2: Tracks
            else if (type === 'track') {
                params.uris = uri; 
                // We use track_favorites service which supports URIs and device_id
                await this.fetchSpotifyPlus('player_media_play_track_favorites', params, false);
            }
            // Case 3: Fallback (Standard Media Player)
            else {
                // If we are here, it's an unknown type. We fallback to standard call.
                // We lose the auto-wake capability here unless we do select_source,
                // but this case is rare for this card.
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
    
        // --- NEW: Volume Control ---
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
}
