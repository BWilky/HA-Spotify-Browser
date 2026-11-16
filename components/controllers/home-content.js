/**
 * Collapses a recent-tracks history list into unique albums
 * (keeping the most recent track's name/artists per album).
 */
export function dedupeRecentAlbums(historyItems = []) {
    const seenAlbumIds = new Set();
    const uniqueItems = [];
    historyItems.forEach(h => {
        if (h.track && h.track.album && !seenAlbumIds.has(h.track.album.id)) {
            seenAlbumIds.add(h.track.album.id);
            uniqueItems.push({ ...h.track.album, name: h.track.name, artists: h.track.artists, type: 'album', uri: h.track.album.uri });
        }
    });
    return uniqueItems;
}

/** Items per home section page (first load and each "load more"). */
export const HOME_PAGE_SIZE = 20;

/** Spotify's per-request max for the library endpoints home uses. */
const SPOTIFY_MAX_LIMIT = 50;

/**
 * Minimum gap between reopen refreshes of the home sections, so a quick
 * close/reopen (or a tablet waking repeatedly) doesn't hammer SpotifyPlus.
 */
export const HOME_REFRESH_COOLDOWN_MS = 60_000;

/**
 * Offset/limit for a home section fetch. A normal fetch pages on from the
 * current offset. A refresh (replace) restarts at 0 and re-reads as many items
 * as are already loaded (min one page, max 50), so a carousel the user had
 * scrolled into doesn't shrink under them.
 */
export function sectionFetchWindow({ replace = false, offset = 0, loaded = 0 } = {}) {
    if (!replace) return { offset, limit: HOME_PAGE_SIZE };
    return { offset: 0, limit: Math.min(SPOTIFY_MAX_LIMIT, Math.max(HOME_PAGE_SIZE, loaded)) };
}

/** True when enough time has passed since the last home refresh. */
export function homeRefreshDue(lastRefreshAt, now = Date.now()) {
    return now - (lastRefreshAt || 0) >= HOME_REFRESH_COOLDOWN_MS;
}

/** Max buttons in the pinned row before it stops topping up with recent items. */
export const PINNED_ROW_SIZE = 8;

/**
 * The pinned row as displayed: every pin (Liked Songs, config pins, user
 * pins — never trimmed), topped up to PINNED_ROW_SIZE with recently played
 * items that aren't already pinned. Returns null while pins are loading.
 */
export function buildPinnedRow(pins, recent = []) {
    if (pins === null || pins === undefined) return null;
    const row = Array.isArray(pins) ? [...pins] : [];
    const seen = new Set(row.map(i => i.id));
    for (const r of recent || []) {
        if (row.length >= PINNED_ROW_SIZE) break;
        if (!r || !r.id || seen.has(r.id)) continue;
        row.push({ ...r, type: r.type || r._fallbackType || 'album' });
        seen.add(r.id);
    }
    return row;
}

/**
 * Resolves the parser's flat `home.pinned.items` list into pin-shaped items
 * ({ id, type, name, title, subtitle, image, uri, fixed: true }). A config
 * `title` wins over the fetched name. Spotify-generated playlists
 * (`recommended: true`) can't be fetched like a normal playlist, so only
 * their cover art is looked up. Items that fail to resolve are dropped.
 */
export async function loadConfigPins(api, items) {
    if (!api || !Array.isArray(items) || items.length === 0) return [];

    const resolved = await Promise.all(items.map(async (item) => {
        try {
            const data = await fetchConfigPin(api, item);
            if (!data) return null;
            const name = item.title || data.name || '';
            return {
                id: item.id,
                type: item.type,
                name,
                title: name,
                subtitle: data.subtitle || '',
                image: data.image || null,
                uri: data.uri || `spotify:${item.type}:${item.id}`,
                fixed: true,
            };
        } catch (e) {
            console.warn(`[SpotifyBrowser] pinned: could not load ${item.type} ${item.id}:`, e?.message || e);
            return null;
        }
    }));
    return resolved.filter(Boolean);
}

async function fetchConfigPin(api, item) {
    const first = (res) => res?.result || null;
    if (item.recommended) {
        const res = await api.fetchSpotifyPlus('get_playlist_cover_image', { playlist_id: item.id });
        return { image: res?.result?.url || null, subtitle: 'By Spotify', uri: `spotify:playlist:${item.id}` };
    }
    if (item.type === 'album') {
        const d = first(await api.fetchSpotifyPlus('get_album', { album_id: item.id }));
        return d && { name: d.name, image: d.images?.[0]?.url, uri: d.uri, subtitle: (d.artists || []).map(a => a.name).join(', ') || 'Album' };
    }
    if (item.type === 'artist') {
        const d = first(await api.fetchSpotifyPlus('get_artist', { artist_id: item.id }));
        return d && { name: d.name, image: d.images?.[0]?.url, uri: d.uri, subtitle: 'Artist' };
    }
    if (item.type === 'track') {
        const d = first(await api.fetchSpotifyPlus('get_track', { track_id: item.id }));
        return d && { name: d.name, image: d.album?.images?.[0]?.url, uri: d.uri, subtitle: (d.artists || []).map(a => a.name).join(', ') };
    }
    const d = first(await api.fetchSpotifyPlus('get_playlist', { playlist_id: item.id }));
    return d && { name: d.name, image: d.images?.[0]?.url, uri: d.uri, subtitle: d.owner?.display_name ? `By ${d.owner.display_name}` : 'Playlist' };
}
