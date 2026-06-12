
// Mock Dependencies
class SpotifyApi {
    constructor(hass, entityId) {
        this.hass = hass;
        this.entityId = entityId;
    }

    async fetchSpotifyPlus(service, params = {}, expectResponse = true) {
        if (!this.hass) return null;
        try {
            const payload = {
                type: 'call_service',
                domain: 'spotifyplus',
                service: service,
                service_data: { entity_id: this.entityId, ...params }
            };
            if (expectResponse) payload.return_response = true;

            const response = await this.hass.callWS(payload);
            if (!expectResponse) return true;
            if (response && response.response) return response.response;
            return response;
        } catch (e) {
            return null;
        }
    }

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

    async checkUserFollowsPlaylist(playlistId, userIds) {
        if (!this.hass || !playlistId || !userIds) return null;
        try {
            const idsParam = Array.isArray(userIds) ? userIds.join(',') : userIds;
            const res = await this.fetchSpotifyPlus('check_playlist_followers', {
                playlist_id: playlistId,
                ids: idsParam
            }, true);
            return res?.result;
        } catch (e) {
            console.warn("Check Playlist Followers failed:", e);
            return null;
        }
    }
}

async function runTests() {
    console.log("Starting Playlist Follow Logic Tests...");

    const mockHass = {
        callService: async (domain, service, data) => {
            console.log(`[MockHass] CallService: ${domain}.${service}`, data);
            if (service === 'follow_playlist') {
                if (!data.playlist_id) throw new Error("Missing playlist_id");
            }
            if (service === 'unfollow_playlist') {
                if (!data.playlist_id) throw new Error("Missing playlist_id");
            }
            return { success: true };
        },
        callWS: async (payload) => {
            console.log(`[MockHass] CallWS: ${payload.service}`, payload.service_data);
            if (payload.service === 'check_playlist_followers') {
                return { result: [true] }; // Mock user follows
            }
            return { result: null };
        }
    };

    const api = new SpotifyApi(mockHass, 'media_player.spotify');

    // TEST 1: Follow Playlist
    console.log("\n--- TEST 1: Follow Playlist ---");
    const res1 = await api.followPlaylist('playlist123', true);
    if (res1.success) console.log("PASS: Follow Playlist");
    else console.error("FAIL: Follow Playlist");

    // TEST 2: Unfollow Playlist
    console.log("\n--- TEST 2: Unfollow Playlist ---");
    const res2 = await api.unfollowPlaylist('playlist123');
    if (res2.success) console.log("PASS: Unfollow Playlist");
    else console.error("FAIL: Unfollow Playlist");

    // TEST 3: Check Follow Status
    console.log("\n--- TEST 3: Check Follow Status ---");
    const res3 = await api.checkUserFollowsPlaylist('playlist123', 'userABC');
    if (res3 && res3[0] === true) console.log("PASS: Check User Follows");
    else console.error("FAIL: Check User Follows");

    console.log("\nAll Tests Completed.");
}

runTests();
