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
    const url = `https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}&api_key=${apiKey}&limit=${limit}&format=json`;
    try {
        const data = await fetchExternal(url);
        if (data && data.similartracks && Array.isArray(data.similartracks.track)) {
            return data.similartracks.track.map(t => ({ name: t.name, artist: t.artist.name }));
        }
        return [];
    } catch (e) { return []; }
}

export async function fetchLastFmSimilarArtists(artistName, apiKey, limit = 10) {
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(artistName)}&api_key=${apiKey}&format=json&limit=${limit}`;
    const data = await fetchExternal(url);
    if (data && data.similarartists && Array.isArray(data.similarartists.artist)) {
        return data.similarartists.artist.map(a => ({ name: a.name, type: 'artist', id: null, uri: null, images: [] }));
    }
    return null;
}

export async function fetchGeminiRadio(artist, track, apiKey, limit = 20) {
    if (!apiKey) throw new Error("Gemini API Key missing.");
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const prompt = `I need a music playlist recommendation. Based on the song "${track}" by "${artist}", list ${limit} similar songs. CRITICAL: Return ONLY a raw JSON array of objects with keys "artist" and "name". Do not include Markdown.`;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await response.json();
        let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const tracks = JSON.parse(text);
        if (!Array.isArray(tracks)) throw new Error("Invalid Gemini response");
        return tracks;
    } catch (error) {
        console.error("Gemini Radio Failed:", error);
        throw error;
    }
}