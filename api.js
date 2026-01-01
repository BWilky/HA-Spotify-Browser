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

    // Inside api.js -> playMedia()

  async playMedia(uri, type, specificDevice = null, extraOptions = {}) {
      if (!this.hass) return { success: false, error: "No HASS" };

      const stateObj = this.hass.states[this.entityId];
      const isActive = stateObj && ['playing', 'paused'].includes(stateObj.state);
      let deviceToUse = specificDevice;

      // Device Selection Logic
      if (deviceToUse === this.defaultDevice && isActive) deviceToUse = null;
      if (!deviceToUse && !isActive) deviceToUse = this.defaultDevice;

      if (!deviceToUse && !isActive) {
          console.warn("[SpotifyBrowser] Cannot play: No active session/device.");
          return { success: false, error: { message: "no active Spotify player" } };
      }

      const params = { ...extraOptions };
      if (deviceToUse) params.device_id = deviceToUse;

      try {
          // A. Context Playback (Playlists, Albums)
          if (['playlist', 'album', 'artist', 'show'].includes(type)) {
              params.context_uri = uri;
              if (extraOptions.offset_uri) {
                  params.offset_uri = extraOptions.offset_uri;
              }
              
              // --- SMART HYBRID LOGIC ---
              const res = await this.fetchSpotifyPlus('player_media_play_context', params, false);
              
              // Check for failure (usually returns null on catch, or object with error)
              // If failed AND we were trying to offset to a specific song...
              if ((!res || res.error) && extraOptions.offset_uri) {
                  console.warn("[SpotifyAPI] Context jump failed. Song likely not in context. Falling back to Track Play.");
                  
                  // RECURSIVE FALLBACK:
                  // Play just the song (Track Mode)
                  return await this.playMedia(extraOptions.offset_uri, 'track', specificDevice);
              }
              
              return { success: true };
          } 
          
          // B. Liked Songs
          else if (type === 'likedsongs') {
              params.shuffle = true; 
              await this.fetchSpotifyPlus('player_media_play_track_favorites', params, false);
              return { success: true };
          } 
          
          // C. Tracks / Fallback
          else {
              if (deviceToUse) {
                   params.uris = Array.isArray(uri) ? uri : [uri]; 
                   await this.fetchSpotifyPlus('player_media_play_tracks', params, false);
              } else {
                   const contentId = Array.isArray(uri) ? uri[0] : uri;
                   await this.hass.callService('media_player', 'play_media', {
                       entity_id: this.entityId,
                       media_content_id: contentId,
                       media_content_type: type
                   });
              }
              return { success: true };
          }
      } catch (e) {
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
