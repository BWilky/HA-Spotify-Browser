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
