// Stubs for driving components/controllers/page-loaders.js under node --test:
// a recording api, Spotify-shaped canned data, and a host that implements the
// loader `ctx` the way spotify-context-view does.
import { isCacheable } from '../src/components/controllers/page-loaders.js';
import { SpotifyApi } from '../src/api.js';

export const img = (seed) => [640, 300, 64].map(w => ({ url: `https://img.test/${w}/${seed}.png`, width: w, height: w }));
export const artist = (i) => ({ id: `ar${i}`, uri: `spotify:artist:ar${i}`, name: `Artist ${i}`, type: 'artist', images: img(`ar${i}`), genres: ['indie'] });
export const album = (i) => ({ id: `al${i}`, uri: `spotify:album:al${i}`, name: `Album ${i}`, type: 'album', album_type: 'album', images: img(`al${i}`), artists: [artist(i % 7)] });
export const track = (i) => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Track ${i}`, type: 'track', duration_ms: 180000, artists: [artist(i % 7)], album: album(i % 13) });
export const playlistItem = (i) => ({ track: track(i), added_at: '2024-01-01T00:00:00Z' });
export const playlistObj = (id, { total = 30, inline = Math.min(100, total), owner = 'someoneelse', collaborative = false } = {}) => ({
    id, uri: `spotify:playlist:${id}`, name: `Playlist ${id}`, type: 'playlist', description: 'desc', images: img(id),
    owner: { id: owner, display_name: owner }, public: true, collaborative, snapshot_id: 'snap',
    tracks: { total, items: Array.from({ length: inline }, (_, k) => playlistItem(k)) },
});
export const range = (n, make, from = 0) => Array.from({ length: n }, (_, k) => make(from + k));

/** The loading placeholder spotify-context-view installs before calling a loader. */
export const placeholder = (type, id) => ({
    type, id, isLoading: true, name: 'Loading...', items: [], offset: 0, total: null, hasMore: true,
    images: [], tracks: null, albums: null, playlists: null, topTracks: null, similarArtists: null
});

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/**
 * SpotifyApi's read methods (getArtist, getSavedTracks, ...): the stub runs
 * the real ones, so they make their calls through the stub's
 * fetchSpotifyPlus, where they are recorded and answered per service.
 */
const READ_METHODS = ['getArtist', 'getAlbum', 'getTrack', 'getPlaylist', 'getSavedPlaylists',
    'getSavedAlbums', 'getSavedTracks', 'getFollowedArtists', 'getRecentTracks'];

/**
 * An api whose every method records `[method, ...args]` in `api.calls` and
 * answers from `responses[method]` (a value, or a function of the call's
 * arguments; `responses['fetchSpotifyPlus:<service>']` and
 * `'fetchPaginated:<service>'` per service). Answers are deep copies, as the
 * real api's are. A missing answer is an error, so an unexpected call fails.
 * The READ_METHODS are SpotifyApi's own, over the stub's fetchSpotifyPlus:
 * only their SpotifyPlus calls are recorded.
 */
export function stubApi(responses = {}) {
    const calls = [];
    const answer = async (key, args) => {
        if (!(key in responses)) throw new Error(`unexpected api call ${key}`);
        const r = responses[key];
        const v = await (typeof r === 'function' ? r(...args) : r);
        return clone(v);
    };
    const record = (method, args) => calls.push(clone([method, ...args]));
    const api = {
        calls,
        fetchSpotifyPlus(service, params) { record('fetchSpotifyPlus', [service, params]); return answer(`fetchSpotifyPlus:${service}`, [params]); },
        fetchPaginated(service, params, n) { record('fetchPaginated', [service, params, n]); return answer(`fetchPaginated:${service}`, [params, n]); },
        getPlaylistItemsPage(...a) { record('getPlaylistItemsPage', a); return answer('getPlaylistItemsPage', a); },
        checkUserFollowsPlaylist(...a) { record('checkUserFollowsPlaylist', a); return answer('checkUserFollowsPlaylist', a); },
        getCurrentUserId(...a) { record('getCurrentUserId', a); return answer('getCurrentUserId', a); },
        searchPlaylists(...a) { record('searchPlaylists', a); return answer('searchPlaylists', a); },
    };
    for (const name of READ_METHODS) api[name] = (...a) => SpotifyApi.prototype[name].apply(api, a);
    return api;
}

/** A promise you settle by hand, to control which read lands first. */
export function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/** Let every queued promise reaction run. */
export const flush = () => new Promise(r => setImmediate(r));

/**
 * A host with spotify-context-view's ctx semantics: commit merges into
 * `host.data` (or replaces it), writes `host.cache` unless `cache: false` —
 * or, when the data may not be cached (isCacheable: a failed page or rail),
 * drops the page's entry — and refuses once the load is superseded
 * (`host.supersede()`). Each call to commit is logged in `host.commits` as
 * { patch, options, applied }.
 */
export function makeHost({ pageId, type, id, api, options = {}, user = { id: null }, data } = {}) {
    const host = {
        pageId, api, user,
        data: data === undefined ? placeholder(type, id) : data,
        cache: new Map(),
        commits: [],
        live: true,
        pagerToken: null,
        supersede() { this.live = false; },
        /** What the cache holds for this page (undefined if nothing). */
        get cached() { return this.cache.get(pageId); },
        /** Only the commits that took effect. */
        get applied() { return this.commits.filter(c => c.applied); },
    };
    const contextFor = (isCurrent) => ({
        api, type, id, options, user,
        current: () => (isCurrent() ? host.data : null),
        commit(patch, opts = {}) {
            if (!isCurrent()) { host.commits.push({ patch: clone(patch), options: opts, applied: false }); return false; }
            if (patch) host.data = opts.replace ? patch : { ...host.data, ...patch };
            if (opts.cache !== false) {
                if (isCacheable(host.data)) host.cache.set(pageId, host.data);
                else host.cache.delete(pageId);
            }
            host.commits.push({ patch: clone(patch), options: opts, applied: true });
            return true;
        },
        claimPager() {
            const token = Symbol('pager');
            host.pagerToken = token;
            return contextFor(() => host.live && host.pagerToken === token);
        },
    });
    host.ctx = contextFor(() => host.live);
    return host;
}
