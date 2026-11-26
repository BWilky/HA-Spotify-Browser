import { html } from "../../lit.js";

/**
 * Shared SVG icon templates.
 *
 * Single source of truth for the small inline icons that used to be
 * copy-pasted across media-templates / the context views / the device UIs /
 * the sheets and now-playing surfaces.
 * Each helper reproduces the exact markup of its original call sites
 * (sizes, viewBox, fill/stroke attributes), so swapping a call site over
 * must not change the rendered DOM.
 */

// --- Shared path data ---
const HEART_PATH = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';
const QUEUE_PATH = 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01';
const PLAY_PATH = 'M8 5v14l11-7z';
const PAUSE_PATH = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';

/**
 * Heart / like icon, 18px.
 * Filled variant is solid (no stroke); unfilled is the 2px outline.
 * Used by the pill (top tracks) like button and the legacy track-row save button.
 */
export function heartIcon(filled) {
    return filled
        ? html`<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="${HEART_PATH}"/></svg>`
        : html`<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="${HEART_PATH}"/></svg>`;
}

/**
 * Heart / like icon whose fill toggles but always keeps the 2px stroke
 * (the playlist view's optimistic-like styling). 18px rows, 28px hero.
 */
export function heartToggleIcon(filled, size = 18) {
    const fill = filled ? 'currentColor' : 'none';
    return size === 28
        ? html`<svg height="28" width="28" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2"><path d="${HEART_PATH}"/></svg>`
        : html`<svg width="18" height="18" fill="${fill}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="${HEART_PATH}"/></svg>`;
}

/** Add-to-queue icon (three lines + dots), 18px outline. */
export const queueIcon = html`<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="${QUEUE_PATH}"/></svg>`;

/** Three-dot (horizontal) context-menu icon, 20px. */
export const menuIcon = html`<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>`;

/**
 * Play triangle. Pass a size for the sized variants (24 card overlay,
 * 28 hero button); omit it for the unsized pill overlay variant.
 */
export function playIcon(size = null) {
    return size
        ? html`<svg height="${size}" width="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="${PLAY_PATH}"/></svg>`
        : html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="${PLAY_PATH}"/></svg>`;
}

/** Pause bars (hero play/pause button). */
export function pauseIcon(size = 28) {
    return html`<svg height="${size}" width="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="${PAUSE_PATH}"/></svg>`;
}

/**
 * Animated "now playing" equalizer bars (brand green).
 * 18px on home rows, 24px on the pill play overlay.
 */
export function playingBarsIcon(size = 18) {
    return html`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="var(--spf-brand)"><rect x="4" y="10" width="3" height="10"><animate attributeName="height" values="5;10;3;10;5" dur="1s" repeatCount="indefinite" /><animate attributeName="y" values="14;9;16;9;14" dur="1s" repeatCount="indefinite" /></rect><rect x="10" y="5" width="3" height="15"><animate attributeName="height" values="10;15;5;15;10" dur="1s" repeatCount="indefinite" /><animate attributeName="y" values="9;4;14;4;9" dur="1s" repeatCount="indefinite" /></rect><rect x="16" y="8" width="3" height="12"><animate attributeName="height" values="8;12;4;12;8" dur="1s" repeatCount="indefinite" /><animate attributeName="y" values="11;7;15;7;11" dur="1s" repeatCount="indefinite" /></rect></svg>`;
}

/* --- Playlist management icons ------------------------------------------ */

/** Trash / delete, 24px. */
export const trashIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;

/** Minus in a circle (remove from playlist), 24px. */
export const minusCircleIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M7 11v2h10v-2H7zm5-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>`;

/** Drag handle (two bars), 24px, for reorderable rows. */
export const dragHandleIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20 9H4v2h16V9zM4 15h16v-2H4v2z"/></svg>`;

/** Reorder handle (three bars, Spotify edit-mode style), 24px. */
export const reorderLinesIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7h18v2H3V7zm0 4h18v2H3v-2zm0 4h18v2H3v-2z"/></svg>`;

/** Map pin (pin-to-home actions), 24px. */
export const pinIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>`;

/** Person silhouette, 24px (account panel avatar fallback). */
export const personIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;

/* --- Sheet, player and list icons ---------------------------------------- */
// Unsized unless noted: each host sizes and colours them from its own CSS.

const CLOSE_PATH = 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';
const SHUFFLE_PATH = 'M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z';
const PREVIOUS_PATH = 'M6 6h2v12H6zm3.5 6l8.5 6V6z';
const NEXT_PATH = 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z';
const VOLUME_UP_PATH = 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z';

/**
 * A one-path glyph on the 24-unit grid. `pathFill` puts fill="currentColor"
 * on the <path> itself: the markup of the sidebar now-playing block and the
 * mini-player. Without it the path carries no fill (now-playing sheet, queue
 * sheet) and takes the svg's CSS fill.
 */
function glyph(d, pathFill) {
    return pathFill
        ? html`<svg viewBox="0 0 24 24"><path fill="currentColor" d="${d}"/></svg>`
        : html`<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
}

/** Play triangle, or pause bars while `playing` (see glyph() for `pathFill`). */
export function playPauseIcon(playing, pathFill = false) {
    return glyph(playing ? PAUSE_PATH : PLAY_PATH, pathFill);
}

/** Shuffle arrows (now-playing sheet, sidebar mini controls). */
export function shuffleIcon(pathFill = false) {
    return glyph(SHUFFLE_PATH, pathFill);
}

/** Skip-back (bar + triangle). */
export function previousIcon(pathFill = false) {
    return glyph(PREVIOUS_PATH, pathFill);
}

/** Skip-forward (triangle + bar). */
export function nextIcon(pathFill = false) {
    return glyph(NEXT_PATH, pathFill);
}

/**
 * Speaker with sound waves (sidebar volume button and its slider overlay).
 * The Connect sheet's -/+ volume icons use other path data and stay local.
 */
export function volumeUpIcon(pathFill = false) {
    return glyph(VOLUME_UP_PATH, pathFill);
}

/**
 * Close X. Unsized by default (device picker, create-playlist sheet); pass a
 * size for the variant with width/height and fill="currentColor" (reorder
 * dialog, 24px).
 */
export function closeIcon(size = null) {
    return size
        ? html`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="${CLOSE_PATH}"/></svg>`
        : html`<svg viewBox="0 0 24 24"><path d="${CLOSE_PATH}"/></svg>`;
}

/** Check mark (playlist picker selection circle, now-playing like button). */
export const checkIcon = html`<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;

/** Up/down arrows of the Recents / A–Z sort toggle, 14px outline. */
export const sortIcon = html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v14m0 0l-3-3m3 3l3-3M17 20V6m0 0l-3 3m3-3l3 3"/></svg>`;

/**
 * Speaker outline (portrait box, tweeter dot, woofer ring), stroked in
 * currentColor: the mini-player's device button and the Connect sheet's
 * active-device card.
 */
export const speakerOutlineIcon = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><circle cx="12" cy="6.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="14.5" r="3.2"/></svg>`;

/**
 * Equalizer bars standing still (the animated ones are playingBarsIcon):
 * the queue sheet's now-playing row while paused, the Connect sheet's
 * now-playing line.
 */
export const staticBarsIcon = html`<svg viewBox="0 0 24 24"><rect x="3" y="10" width="4" height="11" rx="1"/><rect x="10" y="5" width="4" height="16" rx="1"/><rect x="17" y="13" width="4" height="8" rx="1"/></svg>`;

/* --- Device UI icons ------------------------------------------------------ */
// Unsized and with no fill attribute: each device UI sizes and colours them
// from its own CSS (e.g. `.row-type svg`, `.act svg`).

/** Cast / Spotify Connect glyph (device row type line). */
export const castIcon = html`<svg viewBox="0 0 24 24"><path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>`;

/** Circular-arrow refresh (device picker footer, device manager rescan). */
export const refreshIcon = html`<svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`;

const LIST_PATH = 'M3 17v2h6v-2H3zM3 5v2h18V5H3zm0 6h12v-2H3v2z';

/**
 * Sort/list lines ("Manage devices" / "More devices..."). Unsized by default;
 * pass a size for the variant that carries width/height attributes (the
 * sidebar device dropdown's footer, 20px).
 */
export function listIcon(size = null) {
    return size
        ? html`<svg width="${size}" height="${size}" viewBox="0 0 24 24"><path d="${LIST_PATH}"/></svg>`
        : html`<svg viewBox="0 0 24 24"><path d="${LIST_PATH}"/></svg>`;
}

/* --- Device type icons --------------------------------------------------- */
const DEVICE_TABLET_ICON = html`<svg viewBox="0 0 24 24"><path d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-2 14H5V6h14v12z"/></svg>`;

/**
 * Icon for a Spotify Connect device type.
 * @param {string} type - Device type (case-insensitive), e.g. 'Computer'.
 */
export function deviceTypeIcon(type) {
    const t = (type || '').toLowerCase();

    if (t === 'computer') return html`<svg viewBox="0 0 24 24"><path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>`;
    if (t === 'smartphone' || t === 'phone') return html`<svg viewBox="0 0 24 24"><path d="M17 1H7c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 18H7V5h10v14z"/></svg>`;
    if (t === 'tablet') return DEVICE_TABLET_ICON;
    if (t === 'tv') return html`<svg viewBox="0 0 24 24"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>`;
    // Default: speaker
    return html`<svg viewBox="0 0 24 24"><path d="M17 2H7c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-5 2.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM12 19a4 4 0 110-8 4 4 0 010 8zm0-2a2 2 0 100-4 2 2 0 000 4z"/></svg>`;
}
