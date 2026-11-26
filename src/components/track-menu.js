import { pickImage, IMG_THUMB } from '../utils.js';

/**
 * The track context menu. Any view opens it by dispatching a bubbling,
 * composed `open-track-menu` event; the app root (_handleOpenTrackMenu)
 * shows the menu and runs the chosen action on `detail`.
 *
 * detail: { name, artist, album, uri, id, image, anchor?, context? }
 *  - artist   artist names joined with ", " ('' when there are none)
 *  - image    album art at IMG_THUMB. Its only consumer is the menu header,
 *             which draws it at 40-46px; the actions (queue, add to
 *             playlist, go to artist, remove from playlist, go to the
 *             queue / source) never store or enlarge it.
 *  - anchor   DOMRect of the button that opened the menu, for the desktop
 *             popover. Omitted where the menu opens as a bottom sheet.
 *  - context  where the track was listed, which adds actions:
 *             { surface: 'queue' | 'nowplaying', sourceUri } or
 *             { surface: 'playlist', playlistId, canEditItems, snapshotId, uriCount }
 *
 * @typedef {object} TrackMenuDetail
 * @property {string} [name]
 * @property {string} artist
 * @property {string} album
 * @property {string} [uri]
 * @property {string|null} [id]
 * @property {string} image
 * @property {DOMRect} [anchor]
 * @property {object} [context]
 */

/**
 * Builds the `open-track-menu` detail for a Spotify track; `extra` fields are merged in last.
 * @param {import('../utils.js').SpotifyItem|null|undefined} track
 * @param {object} [extra]
 * @returns {TrackMenuDetail}
 */
export function trackMenuDetail(track, extra = {}) {
    return {
        name: track?.name,
        artist: track?.artists?.map(a => a.name).join(', ') || '',
        album: track?.album?.name || '',
        uri: track?.uri,
        id: track?.id,
        image: pickImage(track?.album?.images, IMG_THUMB),
        ...extra,
    };
}

/**
 * Opens the track menu for `track` from `host` (the element that dispatches
 * the event). `anchorEl` is the button that was pressed (its rect places the
 * desktop popover); any other option (e.g. `context`) goes into the detail.
 * @param {EventTarget} host
 * @param {import('../utils.js').SpotifyItem|null|undefined} track
 * @param {{anchorEl?: Element|null, context?: object}} [options]
 */
export function openTrackMenu(host, track, { anchorEl = null, ...extra } = {}) {
    const detail = trackMenuDetail(track);
    if (anchorEl) detail.anchor = anchorEl.getBoundingClientRect();
    Object.assign(detail, extra);
    host.dispatchEvent(new CustomEvent('open-track-menu', { detail, bubbles: true, composed: true }));
}
