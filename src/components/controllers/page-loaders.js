import { dedupeRecentAlbums } from './home-content.js';
import { playlistSortParams } from '../../utils.js';
import { isPlaylistOwner } from '../playlist-actions.js';

/*
 * Data loading for the pages spotify-context-view hosts: one loader per page
 * type, plus the follow-up reads those pages make (load more, the playlist
 * background pager). Plain functions with no Lit or DOM in them, so they run
 * under `node --test` against a stub api.
 *
 * A loader never touches the component. It gets one context object, `ctx`:
 *
 *   ctx.api        the SpotifyApi. Read it at each call (`ctx.api.x(...)`):
 *                  the host hands out whichever api it holds at that moment.
 *   ctx.type, ctx.id
 *                  the page id's two parts ('playlist', '<id>'); Liked Songs
 *                  is 'likedsongs', 'me'.
 *   ctx.options    { autoEdit, artistName, lastFmApiKey }: the playlist's
 *                  one-shot edit intent, the artist name the discography
 *                  page was opened with, the Last.fm key from the config.
 *   ctx.user       { id }: the host's memo of the account's user id. Loaders
 *                  read and update it in place.
 *   ctx.current()  the page's data as it stands now; null once this load has
 *                  been superseded (what supersedes a load is the host's
 *                  call: see _loadContext in spotify-context-view.js).
 *   ctx.commit(patch, { replace = false, cache = true } = {})
 *                  merge `patch` into the page's data (`replace`: make it the
 *                  data) and write the result to the static page cache
 *                  (`cache: false`: show it without caching it). With no
 *                  patch, cache the data as it stands. Returns false, and
 *                  changes nothing, once this load has been superseded; a
 *                  loader stops there.
 *   ctx.claimPager()
 *                  a context for the playlist background pager. Claiming one
 *                  supersedes any earlier pager of the same page, and the
 *                  host's refresh() supersedes it too.
 *
 * A loader resolves once the page's first state is decided: committed, or,
 * when the read failed, left alone. The host then judges the load: a loading
 * placeholder nobody replaced becomes its "couldn't load" state (LOAD_FAILED
 * merged in). A loader that has replaced the placeholder already (Liked
 * Songs shows its own shell while loading) or shares its body with load
 * more (sections) commits LOAD_FAILED itself, uncached. A failed page is
 * never cached, and showing it again retries it; nor is a page with a failed
 * rail (see isCacheable). A loader may resolve to a function, which the host
 * calls straight after that judgement: the artist page, when the artist
 * itself failed, wires its rails there, so a rail that already answered
 * cannot replace the placeholder first and leave the page on "Loading...".
 *
 * A load more whose read fails changes nothing but isLoading (uncached): the
 * page keeps its `hasMore`, so scrolling on retries it. Only a read that
 * worked and came back empty ends the paging.
 */

const LIKED_SONGS_IMAGE = 'https://t.scdn.co/images/3099b3803ad9496896c43f22fe9be8c4.png';

/** What a page whose read failed shows: merged into its data, never cached. */
export const LOAD_FAILED = Object.freeze({
    isLoading: false, hasMore: false, loadFailed: true, name: "Couldn't load this page"
});

/** What a load more whose read failed commits (uncached): `hasMore` stays as it was. */
const LOAD_MORE_FAILED = Object.freeze({ isLoading: false });

/**
 * Whether page data may go in the page cache: not a failed page, nor an
 * artist page whose albums rail failed (`albumsFailed`). The host drops the
 * page's entry instead, so the next visit reads it again.
 */
export function isCacheable(data) {
    return !!data && !data.loadFailed && !data.albumsFailed;
}

async function playlist(ctx) {
    // No `fields` filter: the full object carries owner.id,
    // snapshotId, public/collaborative and a trustworthy
    // tracks.total — all needed for edit support. Only the first
    // page (<=100 tracks) comes inline; the rest pages in below.
    const response = await ctx.api.fetchSpotifyPlus('get_playlist', { playlist_id: ctx.id });
    if (!response?.result) return;
    const result = response.result;
    const user = ctx.user;

    // Current account id: the response carries it for free.
    if (!user.id) {
        user.id = response.user_profile?.id
            || (await ctx.api.getCurrentUserId())
            || null;
    }
    const isOwner = isPlaylistOwner(result, user.id);
    const totalTracks = result.tracks?.total ?? (result.tracks?.items?.length || 0);

    // Follow state only matters for playlists we don't own
    // (drives the heart button and collaborative edit rights).
    const needsFollow = !isOwner && !!user.id && !!(result.id || ctx.id);

    const shown = ctx.commit({
        ...result,
        type: 'playlist',
        isLoading: false,
        // Playlist tracks page in in the background, never via load-more.
        hasMore: false,
        isOwner,
        canEditItems: isOwner,
        // The playlist view reads isFollowing from here instead of
        // re-fetching it; followPending tells it to wait for us.
        followPending: needsFollow,
        snapshotId: result.snapshotId || result.snapshot_id || null,
        tracksComplete: (result.tracks?.items?.length || 0) >= totalTracks,
        ...(ctx.options.autoEdit ? { autoEdit: true } : {})
    }, { cache: false });
    if (!shown) return;

    if (needsFollow) {
        let isFollowing;
        try {
            const follows = await ctx.api.checkUserFollowsPlaylist(ctx.current().id, user.id);
            if (follows && Array.isArray(follows) && follows.length > 0) isFollowing = !!follows[0];
        } catch (e) { }
        const current = ctx.current();
        if (!current) return;
        // Edit rights from this answer only: with none, no isFollowing goes
        // in (the view asks again) and no edit rights either, rather than an
        // earlier load's answer that the heart would then contradict.
        ctx.commit({
            canEditItems: !!current.collaborative && isFollowing === true,
            followPending: false,
            ...(isFollowing !== undefined ? { isFollowing } : {})
        }, { cache: false });
    }

    if (!ctx.commit()) return;

    if (!ctx.current().tracksComplete) {
        pageInPlaylistTracks(ctx.claimPager());
    }
}

/**
 * Background-page the rest of a playlist's tracks (get_playlist only
 * inlines the first <=100). Appends page-by-page so the list grows while
 * you look at it; `tracksComplete` flips true at the end and gates edit
 * mode (reorder math needs the full list). Takes a ctx from claimPager():
 * it stops cold once a newer pager, a refresh() or a different playlist
 * takes over.
 */
export async function pageInPlaylistTracks(ctx) {
    const start = ctx.current();
    const playlistId = start?.id;
    if (!playlistId || !start?.tracks?.items) return;

    const total = start.tracks.total || 0;
    let offset = start.tracks.items.length;

    while (offset < total) {
        const page = await ctx.api.getPlaylistItemsPage(playlistId, offset, 50);
        // Superseded by navigation, refresh() or a newer pager? Stop cold.
        const current = ctx.current();
        if (!current?.tracks?.items || current.id !== playlistId) return;

        const items = page?.items || [];
        if (items.length === 0) break; // defensive: never spin on a bad page

        const tracks = { ...current.tracks, items: [...current.tracks.items, ...items] };
        offset = tracks.items.length;
        ctx.commit({
            tracks,
            tracksComplete: offset >= (tracks.total || total)
        });
    }

    // Total can overstate (deleted/unavailable items); don't leave the
    // flag stuck false when Spotify stops returning pages.
    const current = ctx.current();
    if (current?.id === playlistId && !current.tracksComplete) {
        ctx.commit({ tracksComplete: true });
    }
}

async function album(ctx) {
    const albumData = await ctx.api.getAlbum(ctx.id);
    if (albumData) {
        // Check if tracks are missing or empty (API quirk)
        if (!albumData.tracks || !albumData.tracks.items || albumData.tracks.items.length === 0) {
            const tracksRes = await ctx.api.fetchSpotifyPlus('get_album_tracks', { album_id: ctx.id, limit: 50 });
            if (tracksRes?.result?.items) {
                if (!albumData.tracks) albumData.tracks = {};
                albumData.tracks.items = tracksRes.result.items;
                albumData.tracks.total = tracksRes.result.total;
            }
        }

        // hasMore: albums arrive whole; nothing to load more of.
        ctx.commit({ ...albumData, type: 'album', isLoading: false, hasMore: false });
    } else {
        console.error('[ContextView] Album Load Failed:', albumData);
    }
}

/**
 * Artist pages load progressively: the artist itself first, then each rail
 * (albums, top tracks, playlists, similar artists) as its read resolves. The
 * reads go out together, so a rail can answer before the artist does.
 * @returns {Promise<(() => void) | void>}  wireRails when the artist itself failed (see the header)
 */
async function artist(ctx) {
    const id = ctx.id;
    const artistPromise = ctx.api.getArtist(id);
    const albumsPromise = ctx.api.fetchPaginated('get_artist_albums', { artist_id: id, include_groups: 'album,single' }, 10);
    const topTracksPromise = (async () => {
        // Spotify's own top-tracks list (market-aware, by popularity).
        // Falls back to a track search, which is newest-first, if the
        // service isn't available or returns nothing.
        try {
            const top = await ctx.api.fetchSpotifyPlus('get_artist_top_tracks', { artist_id: id });
            const r = top?.result;
            const items = Array.isArray(r) ? r : (r?.items || r?.tracks || []);
            if (items.length) return items.slice(0, 12);
        } catch (e) { /* fall through to search */ }
        try {
            const name = (await artistPromise)?.name;
            if (!name) return [];
            const { items } = await ctx.api.fetchPaginated('search_tracks', {
                criteria: `artist:"${name}"`
            }, 10);
            return items;
        } catch (e) { return []; }
    })();
    const similarArtistsPromise = (async () => {
        const name = (await artistPromise)?.name;
        if (!name) return [];
        return fetchLastFmSimilarArtists(name, ctx.options.lastFmApiKey);
    })();

    const artistData = await artistPromise;
    if (artistData) {
        if (!ctx.commit({ ...artistData, isLoading: false })) return;
    }

    const wireRails = () => {
        albumsPromise.then(({ items, failed }) => {
            // Always resolve the rail's loading state, even when the artist
            // has zero results under Spotify's "album" group classification
            // (e.g. an artist whose only releases are singles/EPs). A read
            // that failed is not "no releases": the rail is resolved the same
            // way (albums: []) but marked, and the page is not cached with it
            // (isCacheable), so the next visit reads it again.
            ctx.commit(failed ? { albums: [], albumsFailed: true } : { albums: items });
        });

        topTracksPromise.then(tracks => {
            ctx.commit({ topTracks: tracks });
        });

        const playlistsPromise = (async () => {
            try {
                const name = (await artistPromise)?.name;
                if (!name) return [];
                const res = await ctx.api.searchPlaylists(name, 10);
                return res?.result?.items || [];
            } catch (e) { return []; }
        })();

        playlistsPromise.then(playlists => {
            ctx.commit({ playlists: playlists });
        });

        similarArtistsPromise.then(async (artists) => {
            if (artists.length > 0) {
                const hydrated = await hydrateSimilarArtists(ctx.api, artists);
                ctx.commit({ similarArtists: hydrated });
            } else {
                ctx.commit({ similarArtists: [] });
            }
        });
    };

    // With the artist on screen a rail may land at once. Without it the host
    // has yet to show its failed state, which a rail landing first would
    // mask (the page would sit on "Loading..."): wire them after that.
    if (!artistData) return wireRails;
    wireRails();
}

/** Last.fm's similar artists for `artistName` ([{ name }]); [] without a key or on any failure. */
export async function fetchLastFmSimilarArtists(artistName, apiKey) {
    if (!apiKey || !artistName) return [];

    try {
        const encodedArtist = encodeURIComponent(artistName);
        const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodedArtist}&api_key=${apiKey}&format=json&limit=10`;

        const response = await fetch(url);
        if (!response.ok) return [];

        const data = await response.json();
        if (data?.similarartists?.artist && Array.isArray(data.similarartists.artist)) {
            return data.similarartists.artist.map(a => ({ name: a.name }));
        }
    } catch (e) {
        console.warn("Last.fm fetch failed:", e);
    }
    return [];
}

/** Spotify artist objects for the first six Last.fm names, in Last.fm's order; misses dropped. */
export async function hydrateSimilarArtists(api, artists) {
    // Take top 6 for "Fans Also Like"
    const targetArtists = artists.slice(0, 6);

    // Look them up concurrently; results keep Last.fm's order.
    const results = await Promise.all(targetArtists.map(async (artist) => {
        try {
            // Search matching artist in Spotify to get Image & ID
            return await api.findArtist(artist.name);
        } catch (e) {
            return null; // Skip if search fails
        }
    }));
    return results.filter(Boolean);
}

async function artistDiscography(ctx) {
    const id = ctx.id;
    // Artist name comes from the nav payload, NOT the page data's name —
    // that is the 'Loading...' placeholder. Fall back to a fetch if it's
    // missing.
    let artistName = ctx.options.artistName;
    if (!artistName) {
        artistName = (await ctx.api.getArtist(id))?.name || 'Artist';
    }
    const limit = 50;
    const { items, total, failed } = await ctx.api.fetchPaginated('get_artist_albums', { artist_id: id, include_groups: 'album,single,compilation' }, limit);
    // Nothing could be read: leave the placeholder for the host to mark
    // failed, rather than commit (and cache) an empty discography.
    if (failed) return;

    ctx.commit({
        id,
        type: 'artist-discography', // This tells context-list what it IS
        name: `${artistName} Discography`,
        items: items,
        total: total,
        offset: items.length,
        hasMore: items.length < total,
        isLoading: false
    }, { replace: true });
}

async function likedSongs(ctx) {
    const shown = ctx.commit({
        type: 'likedsongs',
        id: 'me',
        isLoading: true,
        name: 'Liked Songs',
        images: [{ url: LIKED_SONGS_IMAGE }],
        tracks: null
    }, { replace: true, cache: false });
    if (!shown) return;
    try {
        const page = await ctx.api.getSavedTracks({ limit: 50, offset: 0, sort_result: false });
        // A failed read (null) is the failed state, not an empty list. The
        // shell has replaced the placeholder, so it is committed here.
        if (!page) {
            ctx.commit(LOAD_FAILED, { cache: false });
            return;
        }
        const items = page.items;
        const total = page.total ?? items.length;
        // Use the real user id so the URI matches the playable context
        // we start from a track row (and the hero "is playing" check).
        // `me` is not a valid owner in a playable collection URI.
        const userId = await ctx.api.getCurrentUserId();
        ctx.commit({
            tracks: { items, total },
            total,
            offset: items.length,
            hasMore: items.length < total,
            isLoading: false,
            uri: userId ? `spotify:user:${userId}:collection` : 'spotify:user:me:collection'
        });
    } catch (e) {
        console.error('[ContextView] Liked Songs load failed:', e);
        ctx.commit(LOAD_FAILED, { cache: false });
    }
}

/**
 * One page of a "See All" section (`recent`, `favorites`, `albums`,
 * `artists`): offset 0 starts the list, a later offset appends to it
 * (followed artists page by `cursor`, the last artist id seen). When the
 * first page cannot be read the page shows LOAD_FAILED (uncached).
 */
export async function loadSection(ctx, sectionId, offset, cursor = null) {
    const limit = 50; // Use larger limit for lists?
    let newItems = [];
    let total = null;
    let title = '';
    let nextCursor = null;
    let read = false; // whether the response held a list (an empty one included)

    try {
        if (sectionId === 'recent') {
            title = 'Recently Played';
            // The recent-tracks endpoint is cursor-based and capped (~50 items),
            // so this section loads a single page only: a read of its own (a
            // limit other than the 30 home and the player share).
            const page = await ctx.api.getRecentTracks({ limit });
            if (page) {
                read = true;
                // A later offset (never asked for: the first page is all
                // there is) adds nothing, and so ends the paging.
                if (offset === 0) {
                    newItems = dedupeRecentAlbums(page.items);
                    total = newItems.length;
                }
            }
        } else if (sectionId === 'favorites') {
            title = 'Your Favorite Playlists';
            const page = await ctx.api.getSavedPlaylists({ limit, offset, ...playlistSortParams() });
            if (page) {
                read = true;
                newItems = page.items;
                total = page.total;
            }
        } else if (sectionId === 'albums') {
            title = 'Your Favorite Albums';
            // User requested logic for Albums (Offset based)
            // The albums themselves, out of their saved-album wrappers.
            const page = await ctx.api.getSavedAlbums({ limit, offset });
            if (page) {
                read = true;
                newItems = page.items;
                total = page.total;
            }
        } else if (sectionId === 'artists') {
            title = 'Followed Artists';
            // User requested specific logic: limit 15, sort_result false
            const params = { limit: 15, sort_result: false };

            // STRICT CURSOR LOGIC:
            // User requirement: feed the last artist ID received.
            if (cursor) {
                params.after = cursor;
            }

            const page = await ctx.api.getFollowedArtists(params);

            if (page) {
                read = true;
                newItems = page.items;
                total = page.total;

                // Logic: Cursor is strictly the ID of the last item (not
                // the page's own `after`).
                if (newItems.length > 0) {
                    nextCursor = newItems[newItems.length - 1].id;
                }
            }
        }

        // The page could not be read. The first one: the failed state, not
        // an empty section (which would be cached). A later one: not the end
        // of the list either, so `hasMore` stays and scrolling on retries.
        // (`title`: an unknown section id makes no read and still shows an
        // empty page, as before.)
        if (!read && title) {
            ctx.commit(offset === 0 ? LOAD_FAILED : LOAD_MORE_FAILED, { cache: false });
            return;
        }

        // Update State
        const currentItems = (offset === 0) ? [] : (ctx.current().items || []);

        // Deduplicate logic
        const currentIds = new Set(currentItems.map(i => i.id));
        const distinctNewItems = newItems.filter(i => !currentIds.has(i.id));
        const allItems = [...currentItems, ...distinctNewItems];


        // STOP CONDITIONS
        const reachedTotal = (total !== null && allItems.length >= total);
        // If we got items but they were all dupes, we're likely looping.
        const isLooping = (newItems.length > 0 && distinctNewItems.length === 0);

        // Should we look for more?
        let shouldLoadMore = false;

        if (reachedTotal || isLooping) {
            shouldLoadMore = false;
        } else {
            if (sectionId === 'artists') {
                // Artist Logic: Use Next Cursor Presence + fetched count
                // valid cursor + we actually got some items (limit reached or not? API can return fewer)
                shouldLoadMore = (nextCursor !== null && newItems.length > 0);
            } else {
                // Standard Offset Logic (Playlists/Albums)
                // If total is known, we are not done. If total unknown, check if we got full page.
                shouldLoadMore = (total === null && newItems.length >= limit) || (total !== null && allItems.length < total);
            }
        }

        ctx.commit({
            isLoading: false,
            name: title,
            items: allItems,
            offset: offset + newItems.length,
            total: total,
            hasMore: shouldLoadMore,
            _lastFetchCount: newItems.length,
            // Only keep cursor if we actually have more to load
            nextCursor: shouldLoadMore ? nextCursor : null
        });

    } catch (e) {
        console.error('Error loading section data:', e);
        ctx.commit(offset === 0 ? LOAD_FAILED : LOAD_MORE_FAILED, { cache: false });
    }
}

/** The section view's "load more": the next page of the section on screen. */
export async function loadSectionMore(ctx) {
    const data = ctx.current();
    if (!data || data.isLoading || !data.hasMore) return;

    // simple debounce or lock
    if (!ctx.commit({ isLoading: true }, { cache: false })) return;

    await loadSection(ctx, data.id, data.offset, data.nextCursor);
}

/**
 * "Load more" for the pages that page on demand: Liked Songs (which the
 * playlist view renders from `tracks.items`) and an artist's discography
 * (`items`). Any other page has nothing more to load.
 */
export async function loadMore(ctx) {
    const data = ctx.current();
    if (!data || data.isLoading || !data.hasMore) return;

    const type = data.type;
    const offset = data.offset || 0;
    const limit = 50;

    if (!ctx.commit({ isLoading: true }, { cache: false })) return;

    try {
        let newItems = [];
        let total = data.total;

        if (type === 'likedsongs') {
            const page = await ctx.api.getSavedTracks({ limit, offset, sort_result: false });
            const current = ctx.current();
            if (!current) return;
            // A failed read (null) is not the end of the list.
            if (!page) {
                ctx.commit(LOAD_MORE_FAILED, { cache: false });
                return;
            }
            newItems = page.items;
            total = page.total || total;

            // Liked Songs renders via spotify-playlist-view, which reads
            // tracks.items (not .items). Append there.
            const existing = current.tracks?.items || [];
            const merged = newItems.length > 0 ? [...existing, ...newItems] : existing;
            ctx.commit({
                tracks: { items: merged, total },
                total,
                offset: offset + newItems.length,
                hasMore: newItems.length > 0 && merged.length < total,
                isLoading: false
            });
            return;
        } else if (type === 'artist-discography') {
            const paged = await ctx.api.fetchPaginated('get_artist_albums', {
                artist_id: data.id,
                include_groups: 'album,single,compilation',
                offset: offset
            }, limit);
            // Nothing could be read: not the end of the discography.
            if (paged.failed) {
                ctx.commit(LOAD_MORE_FAILED, { cache: false });
                return;
            }
            newItems = paged.items;
            total = paged.total || total;
        }

        const current = ctx.current();
        if (!current) return;
        if (newItems.length > 0) {
            const updatedItems = [...current.items, ...newItems];
            ctx.commit({
                items: updatedItems,
                total: total,
                offset: offset + newItems.length,
                hasMore: updatedItems.length < total,
                isLoading: false
            });
        } else {
            ctx.commit({ isLoading: false, hasMore: false }, { cache: false });
        }

    } catch (e) {
        console.error('[ContextView] Load More Failed:', e);
        ctx.commit(LOAD_MORE_FAILED, { cache: false });
    }
}

/** One loader per page type the context view hosts. */
export const pageLoaders = {
    playlist,
    album,
    artist,
    'artist-discography': artistDiscography,
    likedsongs: likedSongs,
    section: (ctx) => loadSection(ctx, ctx.id, 0),
};
