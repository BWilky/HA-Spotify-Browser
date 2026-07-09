export function msToTime(duration) {
    if (!duration) return '--:--';
    const seconds = Math.floor((duration / 1000) % 60);
    const minutes = Math.floor((duration / (1000 * 60)) % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

export function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

export function fireHaptic(hapticType) {
    const event = new CustomEvent("haptic", {
        detail: hapticType,
        bubbles: true,
        composed: true,
    });
    window.dispatchEvent(event);
}

/* --- SpotifyPlus response helpers --- */

/**
 * Unwraps a `get_spotify_connect_devices` response into a raw device array.
 * Handles all observed shapes: { result: { Items: [...] } }, { result: [...] }, [...].
 */
export function parseDeviceItems(response) {
    if (!response) return [];
    if (Array.isArray(response)) return response;
    if (Array.isArray(response.result)) return response.result;
    if (Array.isArray(response.result?.Items)) return response.result.Items;
    return [];
}

/**
 * Canonicalizes one raw API device (which may use PascalCase keys)
 * to { id, name, type, isActive, isSaved }.
 */
export function normalizeDevice(d) {
    return {
        id: d.id || d.Id,
        name: d.name || d.Name,
        type: d.type || d.DeviceInfo?.DeviceType || 'Speaker',
        brand: deviceBrand(d),
        isActive: !!(d.is_active || d.IsActive),
        isSaved: false
    };
}

/**
 * Best-effort device brand (e.g. "Sonos") from a raw SpotifyPlus device object.
 * Used to detect Sonos targets, which need offset_position + the HA Sonos queue.
 */
export function deviceBrand(d) {
    if (!d) return null;
    return d.brand
        || d.DeviceInfo?.BrandDisplayName
        || d.DeviceInfo?.Brand
        || null;
}

/* --- Media item helpers --- */

/**
 * Resolves the best image URL for a media item (track, album, playlist, artist,
 * or flattened pinned item). Returns '' when none is available.
 */
export function getItemImage(item, type = item?.type) {
    if (!item) return '';
    if (item.image) return item.image; // Flattened pinned items
    if (type === 'track' && item.album?.images?.length) return item.album.images[0].url;
    if (item.images?.length) return item.images[0].url;
    if (item.album?.images?.length) return item.album.images[0].url;
    if (item.track?.album?.images?.length) return item.track.album.images[0].url;
    return '';
}

/**
 * Extracts a canonical `spotify:track:<id>` URI from a value that may be a Sonos
 * content id (e.g. `x-sonos-spotify:spotify%3atrack%3aID?sid=12&...`) or already
 * a plain Spotify URI. Returns null when no Spotify track URI can be found.
 */
export function spotifyUriFromContentId(contentId) {
    if (!contentId) return null;
    const decoded = String(contentId).replace(/%3a/gi, ':');
    const m = decoded.match(/spotify:track:[A-Za-z0-9]+/);
    return m ? m[0] : null;
}

/**
 * Parses a spotify:<type>:<id> URI. Returns { type, id } or null.
 */
export function parseSpotifyUri(uri) {
    if (!uri || typeof uri !== 'string' || !uri.startsWith('spotify:')) return null;
    const parts = uri.split(':');
    if (parts.length < 3) return null;
    return { type: parts[1], id: parts[2] };
}

/* --- Player state helpers --- */

/** The media_player state object for the given entity, or null. */
export function getPlayerStateObj(hass, entityId) {
    if (!hass || !entityId) return null;
    return hass.states[entityId] || null;
}

/** Spotify track id of the current track (any state), or null. */
export function getCurrentTrackId(hass, entityId) {
    const contentId = getPlayerStateObj(hass, entityId)?.attributes?.media_content_id;
    return contentId ? contentId.replace('spotify:track:', '') : null;
}

/** Spotify track id of the current track, only while actively playing. */
export function getPlayingTrackId(hass, entityId) {
    const stateObj = getPlayerStateObj(hass, entityId);
    if (!stateObj || stateObj.state !== 'playing') return null;
    return getCurrentTrackId(hass, entityId);
}

/** True when the given context URI (playlist/album/artist) is actively playing. */
export function isContextPlaying(hass, entityId, contextUri) {
    const stateObj = getPlayerStateObj(hass, entityId);
    if (!stateObj || stateObj.state !== 'playing' || !contextUri) return false;
    const attrs = stateObj.attributes;
    return attrs.media_context_content_id === contextUri || attrs.media_content_id === contextUri;
}

/* --- Album-art accent colour --- */

const _vibrantCache = new Map();

/** Nudge a colour into a usable brightness band for a dark-UI gradient. */
function _conditionAccent(r, g, b) {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 55) { const k = 55 / Math.max(lum, 1); r *= k; g *= k; b *= k; }
    else if (lum > 200) { const k = 200 / lum; r *= k; g *= k; b *= k; }
    return [Math.min(255, r) | 0, Math.min(255, g) | 0, Math.min(255, b) | 0];
}

/**
 * Extracts a vibrant accent colour from an image URL. Downscales to a small
 * canvas, buckets pixels by quantised colour, and picks the bucket that best
 * balances population and saturation (so we get a punchy colour, not a muddy
 * average). Returns Promise<[r,g,b]> or null (transparent/tainted/failed).
 * Results are cached per URL. Requires a CORS-readable image (Spotify's CDN
 * sends Access-Control-Allow-Origin, so crossOrigin='anonymous' works).
 */
export function getVibrantColor(url) {
    if (!url) return Promise.resolve(null);
    if (_vibrantCache.has(url)) return Promise.resolve(_vibrantCache.get(url));
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            let out = null;
            try {
                const size = 32;
                const c = document.createElement('canvas');
                c.width = c.height = size;
                const ctx = c.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(img, 0, 0, size, size);
                const data = ctx.getImageData(0, 0, size, size).data;
                const buckets = new Map();
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i + 3] < 125) continue; // skip transparent
                    const r = data[i], g = data[i + 1], b = data[i + 2];
                    // Quantise to 4 bits/channel (16 levels) for the bucket key.
                    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
                    let e = buckets.get(key);
                    if (!e) { e = { r: 0, g: 0, b: 0, n: 0 }; buckets.set(key, e); }
                    e.r += r; e.g += g; e.b += b; e.n++;
                }
                let bestScore = -1;
                buckets.forEach((e) => {
                    const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n;
                    const max = Math.max(r, g, b), min = Math.min(r, g, b);
                    const light = (max + min) / 510;                 // 0..1
                    const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
                    const lightWeight = Math.max(1 - Math.abs(light - 0.5) * 1.2, 0.15);
                    const score = e.n * (0.25 + sat) * lightWeight;   // populous + saturated + mid-light
                    if (score > bestScore) { bestScore = score; out = _conditionAccent(r, g, b); }
                });
            } catch (_) { out = null; } // tainted canvas, etc.
            _vibrantCache.set(url, out);
            resolve(out);
        };
        img.onerror = () => { _vibrantCache.set(url, null); resolve(null); };
        img.src = url;
    });
}
