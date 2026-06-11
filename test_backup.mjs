
// Mock Dependencies
class SpotifyApi {
    constructor(hass, entityId, defaultDevice = null, defaultVolumeConfig = null, onNotification = null) {
        this.hass = hass;
        this.entityId = entityId;
        this.defaultDevice = defaultDevice;
        this.defaultVolumeConfig = defaultVolumeConfig;
        this.onNotification = onNotification;
    }

    _notify(message) {
        if (this.onNotification) this.onNotification(message);
    }

    _resolveDefaultVolume() {
        // Simplified for testing
        return 25;
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

            if (expectResponse) payload.return_response = true;

            const response = await this.hass.callWS(payload);

            if (!expectResponse) return true;

            if (response && response.response) return response.response;
            return response;

        } catch (e) {
            // console.warn(`[SpotifyAPI] Failed Call [${service}]:`, JSON.stringify(e, null, 2));
            return null;
        }
    }

    async playMedia(uri, type, specificDevice = null, extraOptions = {}) {
        if (!this.hass) return { success: false, error: "No HASS" };

        const stateObj = this.hass.states[this.entityId];
        const isActive = stateObj && ['playing', 'paused', 'buffering'].includes(stateObj.state);

        // 1. Determine Device Strategy
        let deviceToUse = null;
        let backupDevice = null;
        let primaryDeviceName = "Default Device";
        let defaultShuffle = null;

        if (specificDevice) {
            deviceToUse = specificDevice;
        } else {
            if (!isActive) {
                if (this.defaultDevice) {
                    if (typeof this.defaultDevice === 'object' && this.defaultDevice.primary) {
                        deviceToUse = this.defaultDevice.primary;
                        backupDevice = this.defaultDevice.backup || null;
                        primaryDeviceName = this.defaultDevice.primary;
                        if (this.defaultDevice.shuffle !== undefined) defaultShuffle = this.defaultDevice.shuffle;
                    } else if (typeof this.defaultDevice === 'string') {
                        deviceToUse = this.defaultDevice;
                        primaryDeviceName = this.defaultDevice;
                    }
                }
            } else {
                deviceToUse = null;
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
                    // Simplified
                    return { success: true, paramsUsed: params }; // Return params for test verification
                }
                else if (type === 'likedsongs') {
                    // Simplified
                    return { success: true };
                }
                else {
                    if (deviceIdToTry) {
                        params.uris = Array.isArray(uri) ? uri : [uri];
                        const res = await this.fetchSpotifyPlus('player_media_play_tracks', params, false);
                        if (!res) return { success: false, error: "Call Failed" };
                    } else {
                        // Simplified
                    }
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
            // console.warn(`[SpotifyBrowser] Primary device ${deviceToUse} failed. Trying backup ${backupDevice}.`);
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
}


async function runTests() {
    console.log("Starting Backup Player Logic Tests...");

    let notifications = [];
    const mockHass = {
        states: {
            'media_player.spotify': { state: 'idle' }
        },
        callWS: async (payload) => {
            const data = payload.service_data;
            // Mock Failure for "DeviceA"
            if (data.device_id === 'DeviceA') {
                throw new Error("DeviceA Unreachable");
            }
            // Mock Success for "DeviceB"
            if (data.device_id === 'DeviceB') {
                return { result: "Success" };
            }
            return { result: "Success" };
        }
    };

    const onNotification = (msg) => {
        // console.log(`[Notification] ${msg}`);
        notifications.push(msg);
    };

    // --- TEST 1: Primary Fails, Backup Succeeds ---
    console.log("\n--- TEST 1: Primary 'DeviceA' Fails, Backup 'DeviceB' Succeeds ---");
    notifications = [];
    const config1 = { primary: 'DeviceA', backup: 'DeviceB' };
    const api1 = new SpotifyApi(mockHass, 'media_player.spotify', config1, null, onNotification);

    const res1 = await api1.playMedia('spotify:track:123', 'track');

    if (notifications.includes("Playback Failed on DeviceA") &&
        notifications.includes("Trying Backup Device...") &&
        !notifications.includes("Playback Failed on Backup Device") &&
        res1.success === true) {
        console.log("PASS: Test 1");
    } else {
        console.error("FAIL: Test 1");
        console.error("Notifications were:", notifications);
        console.error("Result was:", res1);
    }

    // --- TEST 2: Single Device Fails ---
    console.log("\n--- TEST 2: Single Device 'DeviceA' Fails ---");
    notifications = [];
    const config2 = 'DeviceA';
    const api2 = new SpotifyApi(mockHass, 'media_player.spotify', config2, null, onNotification);

    const res3 = await api2.playMedia('spotify:track:123', 'track');

    if (notifications.includes("Playback Failed on DeviceA") &&
        !notifications.includes("Trying Backup Device...") &&
        res3.success === false) {
        console.log("PASS: Test 2");
    } else {
        console.error("FAIL: Test 2");
        console.error("Notifications were:", notifications);
        console.error("Result was:", res3);
    }

    // --- TEST 3: Shuffle Config Applied ---
    console.log("\n--- TEST 3: Shuffle Config Applied ---");
    notifications = [];
    const config3 = { primary: 'DeviceA', shuffle: true };
    const api3 = new SpotifyApi(mockHass, 'media_player.spotify', config3, null, onNotification);

    // Reset mock to success always
    mockHass.callWS = async () => ({ result: "Success" });

    const res4 = await api3.playMedia('spotify:playlist:123', 'playlist');

    // console.log("Test 3 Result:", res4);

    if (res4.success === true && res4.paramsUsed && res4.paramsUsed.shuffle === true) {
        console.log("PASS: Test 3");
    } else {
        console.error("FAIL: Test 3");
        console.error("Params used:", res4.paramsUsed);
    }

    console.log("\nAll Tests Completed.");
}

runTests();
