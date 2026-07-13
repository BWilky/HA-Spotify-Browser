import { html } from "../../lit.js";

/**
 * Shared SVG icon templates.
 *
 * Single source of truth for the small inline icons that used to be
 * copy-pasted across media-templates / the context views / the device UIs.
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

/** Plus, 24px (create playlist buttons). */
export const plusIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;

/** Add-to-playlist (list + plus), 24px. */
export const playlistAddIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>`;

/** Pencil / edit, 24px. */
export const pencilIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;

/** Trash / delete, 24px. */
export const trashIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;

/** Minus in a circle (remove from playlist), 24px. */
export const minusCircleIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M7 11v2h10v-2H7zm5-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>`;

/** Drag handle (two bars), 24px, for reorderable rows. */
export const dragHandleIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20 9H4v2h16V9zM4 15h16v-2H4v2z"/></svg>`;

/** Reorder handle (three bars, Spotify edit-mode style), 24px. */
export const reorderLinesIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7h18v2H3V7zm0 4h18v2H3v-2zm0 4h18v2H3v-2z"/></svg>`;

/** Padlock (public/private toggle), 24px. */
export const lockIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/></svg>`;

/** Two-person group (collaborative toggle), 24px. */
export const peopleIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`;

/** Map pin (pin-to-home actions), 24px. */
export const pinIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>`;

/** Person / artist silhouette, 24px (track menu "Go to Artist"). */
export const personIcon = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;

/* --- Device type icons --------------------------------------------------- */
/*
 * Two variants exist because the device manager popup and the connect panel
 * historically drew slightly different glyphs: they share only the tablet
 * icon, while computer / phone / tv use different path data, the manager has
 * extra type keys (castaudio/speaker, avr/stb/audiodongle) and falls back to
 * a generic circle, and the panel falls back to a speaker box. Each variant
 * preserves its original caller's exact output.
 */

// Tablet is the only glyph both variants share.
const DEVICE_TABLET_ICON = html`<svg viewBox="0 0 24 24"><path d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-2 14H5V6h14v12z"/></svg>`;

// Manager fallback: generic circle (also used for castaudio/speaker there).
const DEVICE_MANAGER_FALLBACK = html`<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>`;

/**
 * Icon for a Spotify Connect device type.
 * @param {string} type - Device type (case-insensitive), e.g. 'Computer'.
 * @param {string} [variant='connect'] - 'connect' (connect panel glyph set)
 *                                       or 'manager' (device manager glyph set).
 */
export function deviceTypeIcon(type, variant = 'connect') {
    const t = (type || '').toLowerCase();

    if (variant === 'manager') {
        if (t === 'computer') return html`<svg viewBox="0 0 24 24"><path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>`;
        if (t === 'smartphone' || t === 'phone') return html`<svg viewBox="0 0 24 24"><path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/></svg>`;
        if (t === 'tablet') return DEVICE_TABLET_ICON;
        if (t === 'castaudio' || t === 'speaker') return DEVICE_MANAGER_FALLBACK;
        if (t === 'tv') return html`<svg viewBox="0 0 24 24"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L22 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>`;
        if (t === 'avr' || t === 'stb' || t === 'audiodongle') return html`<svg viewBox="0 0 24 24"><path d="M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zm6 0h-2V5h2v2zm6 0h-2V5h2v2z"/></svg>`;
        return DEVICE_MANAGER_FALLBACK;
    }

    // 'connect' variant (connect panel)
    if (t === 'computer') return html`<svg viewBox="0 0 24 24"><path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>`;
    if (t === 'smartphone' || t === 'phone') return html`<svg viewBox="0 0 24 24"><path d="M17 1H7c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 18H7V5h10v14z"/></svg>`;
    if (t === 'tablet') return DEVICE_TABLET_ICON;
    if (t === 'tv') return html`<svg viewBox="0 0 24 24"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>`;
    // Default: speaker
    return html`<svg viewBox="0 0 24 24"><path d="M17 2H7c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-5 2.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM12 19a4 4 0 110-8 4 4 0 010 8zm0-2a2 2 0 100-4 2 2 0 000 4z"/></svg>`;
}
