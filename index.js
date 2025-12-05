export class SpotifyApi {
    constructor(hass, entityId) {
        this.hass = hass;
        this.entityId = entityId;
    }

    updateHass(hass) {
        this.hass = hass;
    }

    async fetchSpotifyPlus(service, params = {}, expectResponse = true) {
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

            // FIX: Only add this line if we actually WANT a response.
            // If expectResponse is false (e.g. queue add), this line is skipped.
            if (expectResponse) {
                payload.return_response = true;
            }

            const response = await this.hass.callWS(payload);
            
            // If fire-and-forget, we are done here.
            if (!expectResponse) return true;

            // Handle the nested response structure common in SpotifyPlus
            // Some responses put data in 'user_profile', some in 'result', some in 'response'.
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
            console.warn("Failed Params:", params); 
            return null;
        }
    }

    async playMedia(uri, type, defaultDevice) {
        if (!this.hass || !uri) return { success: false, error: "No URI" };

        const stateObj = this.hass.states[this.entityId];
        const isActive = stateObj && ['playing', 'paused', 'idle', 'on'].includes(stateObj.state);

        try {
            if (!isActive && defaultDevice && (stateObj.state === 'off' || stateObj.state === 'unavailable')) {
                // Try to wake device
                await this.hass.callService('media_player', 'select_source', {
                    entity_id: this.entityId,
                    source: defaultDevice
                });
                // Wait and play
                return new Promise((resolve) => {
                    setTimeout(async () => {
                        try {
                            await this._executePlayCall(uri, type);
                            resolve({ success: true });
                        } catch (e) {
                            resolve({ success: false, error: e });
                        }
                    }, 1500);
                });
            } else {
                // Direct Play
                await this._executePlayCall(uri, type);
                return { success: true };
            }
        } catch (e) {
            console.error("Failed to play media:", e);
            // Return the error object so the UI can handle it
            return { success: false, error: e };
        }
    }

    async _executePlayCall(uri, type) {
        await this.hass.callService('media_player', 'play_media', {
            entity_id: this.entityId,
            media_content_id: uri,
            media_content_type: type
        });
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
