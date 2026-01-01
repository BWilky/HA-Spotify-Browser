// --- external_providers.js ---

async function fetchExternal(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        console.error(`[External API] Fetch failed:`, e);
        return null;
    }
}

export async function fetchLastFmTrackRadio(artist, track, apiKey, limit) {
    // 1. URL Encode the parameters to handle spaces and special characters (&, ?, etc.)
    const safeArtist = encodeURIComponent(artist);
    const safeTrack = encodeURIComponent(track);
    
    // 2. Construct the URL
    const url = `https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=${safeArtist}&track=${safeTrack}&api_key=${apiKey}&limit=${limit}&format=json`;

    // --- DEBUG LOGS ---
    console.group("SpotifyCard Radio Debug");
    console.log("1. Artist:", artist);
    console.log("2. Track:", track);
    console.log("3. API Key (First 4 chars):", apiKey ? apiKey.substring(0, 4) + "..." : "MISSING");
    console.log("4. Request URL:", url);
    // ------------------

    try {
        const response = await fetch(url);
        const data = await response.json();

        // --- DEBUG RESPONSE ---
        console.log("5. Raw Response:", data);
        console.groupEnd();
        // ---------------------

        if (data.error) {
            console.error("Last.fm API Error:", data.message);
            return [];
        }

        if (data.similartracks && Array.isArray(data.similartracks.track)) {
            // Map strictly to the format our card expects
            return data.similartracks.track.map(t => ({
                name: t.name,
                artist: t.artist.name
            }));
        }
        
        return [];
    } catch (e) {
        console.error("Fetch failed:", e);
        console.groupEnd();
        return [];
    }
}

export async function fetchLastFmSimilarArtists(artistName, apiKey, limit = 10) {
    if (!artistName || !apiKey) return null;

    const encodedArtist = encodeURIComponent(artistName);
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodedArtist}&api_key=${apiKey}&format=json&limit=${limit}`;

    const data = await fetchExternal(url);

    if (data && data.similarartists && Array.isArray(data.similarartists.artist)) {
        // Return lightweight objects (Name only)
        return data.similarartists.artist.map(artist => ({
            name: artist.name,
            type: 'artist',
            id: null,     // Will be filled by Spotify Search
            uri: null,    // Will be filled by Spotify Search
            images: []    // Will be filled by Spotify Search
        }));
    }

    return null;
}
