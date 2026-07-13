import { html } from "../../lit.js";

/**
 * Shared queue/recent row template: album art + track name + artist(s).
 *
 * Used by the mobile queue bottom sheet (spotify-queue-panel) and the sidebar
 * track list (spotify-sidebar-tracklist). The two consumers style their rows
 * with different class sets, so `variant` picks the class scheme; everything
 * else is driven by options:
 *
 * - `onClick`      row click handler (tap-to-play); null renders no listener
 * - `active`       marks the now-playing row (adds the variant's active class)
 * - `titleIcon`    template prefixed inside the title (e.g. equalizer icon)
 * - `trailing`     template appended after the info block (e.g. play/pause button)
 * - `playedAt`     text for an extra timestamp line (recently played)
 */
const VARIANTS = {
    panel: {
        row: 'row', active: 'now', art: 'art', info: 'meta',
        title: 'name', artist: 'sub'
    },
    sidebar: {
        row: 'queue-item', active: '', art: 'queue-art', info: 'queue-info',
        title: 'queue-title', artist: 'queue-artist'
    },
};

export function renderQueueRow(track, {
    variant = 'sidebar',
    onClick = null,
    active = false,
    titleIcon = null,
    trailing = null,
    playedAt = '',
} = {}) {
    const v = VARIANTS[variant];
    const art = track?.album?.images?.[0]?.url || '';
    const artist = track?.artists?.map(a => a.name).join(', ') || 'Unknown Artist';
    return html`
        <div class="${active ? `${v.row} ${v.active}` : v.row}" @click=${onClick}>
            <div class="${v.art} ${art ? '' : 'art-fallback'}" style="${art ? `background-image: url('${art}')` : ''}"></div>
            <div class="${v.info}">
                <div class="${v.title}">${titleIcon || ''}${track?.name || 'Unknown Track'}</div>
                <div class="${v.artist}">${artist}</div>
                ${playedAt ? html`<div class="queue-context-sub">${playedAt}</div>` : ''}
            </div>
            ${trailing || ''}
        </div>
    `;
}
