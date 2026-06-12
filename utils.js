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
        isActive: !!(d.is_active || d.IsActive),
        isSaved: false
    };
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
