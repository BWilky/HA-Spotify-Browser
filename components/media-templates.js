import { html } from "../lit.js";
import { getItemImage } from "../utils.js";
import { heartIcon, heartToggleIcon, queueIcon, menuIcon, playIcon, playingBarsIcon } from "./common/icons.js";

/**
 * Standardizes the "Card" layout (Square for Album/Playlist, Circle for Artist).
 * Used for Grids and Carousels.
 * 
 * @param {Object} item - The media item data.
 * @param {string|boolean} type - The item type ('artist' renders a circle), or legacy boolean isArtist.
 * @param {Function} clickHandler - (Lit Only) Function to call on click.
 * @returns {TemplateResult} Lit-html template.
 */
export function renderCardTemplate(item, type, clickHandler) {
    const isArtist = type === true || type === 'artist';
    const imgUrl = getItemImage(item);
    const name = item.name || item.title || 'Unknown';
    // An explicitly provided subtitle wins (even an empty one — home passes a
    // precomputed subtitle); otherwise fall back to release year / type.
    const subtitle = item.subtitle ?? (item.release_date?.split('-')[0] || item.type || '');

    return html`
        <div class="media-card interactive ${isArtist ? 'artist-card' : ''}" 
             @click=${clickHandler}>
            <div class="media-image-wrapper">
                <div class="media-image ${imgUrl ? '' : 'art-fallback'}" style="${imgUrl ? `background-image: url('${imgUrl}');` : ''} ${isArtist ? 'border-radius: 50%;' : ''}"></div>
                ${!isArtist ? html`
                <div class="play-btn-overlay">
                    ${playIcon(24)}
                </div>
                ` : ''}
            </div>
            <div class="media-title" style="${isArtist ? 'text-align: center;' : ''}">${name}</div>
            ${!isArtist ? html`<div class="media-subtitle">${subtitle}</div>` : ''}
        </div>
    `;
}

/**
 * Standardizes the "Pill" layout (Wide button with Image + Text + Actions).
 * Used for "Popular" tracks list and potentially other lists.
 * 
 * @param {Object} item - The media item data.
 * @param {Function} playHandler - (Lit Only) Function to call on play.
 * @param {Function} menuHandler - (Lit Only) Function to call on menu click.
 * @param {Function} saveHandler - (Lit Only) Function to call on save click.
 * @returns {TemplateResult} Lit-html template.
 */
export function renderPillTemplate(item, playHandler, menuHandler, saveHandler, isLiked = false, isPlaying = false) {
    const imgUrl = getItemImage(item, 'track');
    const name = item.name || 'Unknown';
    // const duration = msToTime(item.duration_ms); // Pass pre-formatted or format here if utils available

    return html`
        <div class="artist-top-track interactive">
            <div class="track-art-left ${imgUrl ? '' : 'art-fallback'}" style="${imgUrl ? `background-image: url('${imgUrl}')` : ''}">
                <button class="play-btn-overlay mini" @click=${(e) => { e.stopPropagation(); playHandler(e); }}>
                    ${isPlaying ? playingBarsIcon(24) : playIcon()}
                </button>
            </div>
            <div class="track-info-middle">
                <div class="track-title" style="${isPlaying ? 'color: var(--spf-brand); font-weight: bold;' : ''}">
                    ${isPlaying ? html`<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 4px; display:inline-block; vertical-align: middle;"><rect x="4" y="6" width="3" height="12"><animate attributeName="height" values="6;12;4;12;6" dur="0.8s" repeatCount="indefinite" /><animate attributeName="y" values="12;6;14;6;12" dur="0.8s" repeatCount="indefinite" /></rect><rect x="10" y="3" width="3" height="18"><animate attributeName="height" values="10;18;5;18;10" dur="0.9s" repeatCount="indefinite" /><animate attributeName="y" values="10;3;13;3;10" dur="0.9s" repeatCount="indefinite" /></rect><rect x="16" y="8" width="3" height="12"><animate attributeName="height" values="8;12;5;12;8" dur="1.1s" repeatCount="indefinite" /><animate attributeName="y" values="11;8;13;8;11" dur="1.1s" repeatCount="indefinite" /></rect></svg>` : ''}
                    ${name}
                </div>
                <!-- Optional Meta info -->
            </div>
            <div class="track-actions-right">
                <button class="track-action-btn" @click=${saveHandler} style="${isLiked ? 'color: var(--spf-brand);' : ''}">
                   ${heartIcon(isLiked)}
                </button>
                <button class="track-action-btn" @click=${menuHandler}>
                     ${menuIcon}
                </button>
            </div>
        </div>
    `;
}

/**
 * Renders a skeleton for a Card (Square/Circle).
 */
export function renderCardSkeletonTemplate(isArtist = false) {
    return html`
      <div class="media-card skeleton-pulse ${isArtist ? 'artist-card' : ''}">
        <div class="media-image-wrapper">
            <div class="card-image-sk" style="${isArtist ? 'border-radius:50%' : ''}"></div>
        </div>
        <div class="card-text-sk"></div>
        <div class="card-text-sk short"></div>
      </div>
    `;
}

/**
 * Renders a skeleton for a Pill (Popular Track row).
 */
export function renderPillSkeletonTemplate() {
    return html`
        <div class="artist-top-track skeleton-pulse">
            <div class="track-art-left skeleton-pulse" style="background: var(--spf-bg-card-hover);"></div>
            <div class="track-info-middle">
                <div class="card-text-sk" style="width: 40%; margin-bottom: 4px;"></div>
                <div class="card-text-sk short" style="width: 25%;"></div>
            </div>
        </div>
    `;
}

/**
 * Renders a skeleton for a Track Row.
 */
export function renderTrackSkeletonTemplate() {
    return html`
        <div class="track-row skeleton-pulse" style="pointer-events: none;">
            <div class="track-num" style="width: 16px; height: 16px; background: rgba(255,255,255,0.1); border-radius: 4px;"></div>
            <div class="track-art-small" style="width: 40px; height: 40px; background: rgba(255,255,255,0.1); border-radius: 4px; margin-right: 12px;"></div>
            <div class="track-info">
                <div class="card-text-sk" style="width: 40%; margin-bottom: 6px;"></div>
                <div class="card-text-sk short" style="width: 25%;"></div>
            </div>
            <div class="track-actions-right"></div>
        </div>
    `;
}

/**
 * Standardizes the "Track Row" layout (Index + Image + Title + Artist + Actions).
 * Used for Playlists, Albums, and Track Lists.
 *
 * Playlist mode (options.layout === 'playlist') is the superset used by the
 * live playlist view: album art replaces the index column (playlists only —
 * albums keep the index), the playing row carries an inline equalizer and
 * 'playing' class, and the like button reflects optimistic state. Action
 * buttons render only for the handlers the caller supplies.
 *
 * @param {Object} track
 * @param {number} index - 1-based row number.
 * @param {Function} clickHandler - (e, track) row click.
 * @param {Object} [options]
 * @param {string}   [options.layout] - 'playlist' for the playlist superset layout.
 * @param {boolean}  [options.isPlaying] - row is the now-playing track.
 * @param {boolean}  [options.isAlbum] - album context (index column, default title colour).
 * @param {boolean}  [options.liked] - optimistic like state for the heart button.
 * @param {Function} [options.onSave] - (e, track) like button click.
 * @param {Function} [options.onQueue] - (e, track) queue button click.
 * @param {Function} [options.onMenu] - (e, trackData) menu button click.
 */
export function renderTrackRowTemplate(track, index, clickHandler, options = {}) {
    if (!track) return '';
    const artistNames = track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown';
    const image = track.album?.images?.[0]?.url;
    // Track Data for menu/actions
    const trackData = {
        name: track.name,
        artist: artistNames,
        album: track.album?.name || '',
        uri: track.uri,
        id: track.id,
        image,
    };

    const isPlaylist = options.layout === 'playlist';
    const { isPlaying = false, isAlbum = false, liked = false, onSave, onQueue, onMenu } = options;

    // First column. Playlist mode keeps the album art (playlists) / index
    // (albums) there even while playing — the now-playing cue is the inline
    // equalizer + green title next to the track name, matching the native app.
    const firstCol = (isPlaylist && image && !isAlbum)
        ? html`<img src="${image}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover;" loading="lazy">`
        : html`<div class="track-num">${index}</div>`;

    // Title: playlist mode carries the inline equalizer on the playing row and
    // forces a white title on playlist (non-album) rows.
    const titleBlock = isPlaylist
        ? html`
            <div class="track-name" style="${isPlaying ? '' : (isAlbum ? '' : 'color: white;')}">
                ${isPlaying ? html`<div class="track-eq" aria-label="Now playing"><span></span><span></span><span></span></div>` : ''}
                <span class="track-name-text">${track.name}</span>
            </div>`
        : html`<div class="track-name">${track.name}</div>`;

    // Row actions require caller-supplied handlers (like / queue / context menu).
    const actions = html`
        ${onSave ? html`
            <button class="track-action-btn ${liked ? 'is-favorite' : ''}" data-action="save" @click=${(e) => onSave(e, track)}>
               ${heartToggleIcon(liked)}
            </button>` : ''}
        ${onQueue ? html`
            <button class="track-action-btn" data-action="queue" @click=${(e) => onQueue(e, track)}>
               ${queueIcon}
            </button>` : ''}
        ${onMenu ? html`
            <button class="track-action-btn" data-action="menu" @click=${(e) => onMenu(e, trackData)}>
                ${menuIcon}
            </button>` : ''}`;

    return html`
        <div class="track-row interactive ${isPlaylist ? (isPlaying ? 'playing' : '') : (image ? 'with-art' : '')}"
             data-track-id="${track.id}"
             data-uri="${track.uri}"
             @click=${clickHandler ? (e) => clickHandler(e, track) : null}>

            ${firstCol}

            ${!isPlaylist && image ? html`
            <div class="track-art-small" style="background-image: url('${image}');"></div>
            ` : ''}

            <div class="track-info">
                ${titleBlock}
                <div class="track-artist">${artistNames}</div>
            </div>

            <div class="track-actions-right">
                ${actions}
            </div>
        </div>
    `;
}

/**
 * Renders a generic "Row" layout for non-track items (Playlists, Albums, Artists).
 * Used for "See All" lists where a vertical list is preferred over a grid.
 */
export function renderMediaRowTemplate(item, type, clickHandler) {
    const imgUrl = getItemImage(item, type);
    const name = item.name || 'Unknown';

    let subtitle = '';
    if (item.owner) subtitle = `By ${item.owner.display_name}`;
    else if (item.artists && Array.isArray(item.artists)) subtitle = item.artists.map(a => a.name).join(', ');
    else if (type === 'artist') subtitle = 'Artist';
    else if (type === 'album') subtitle = item.release_date ? item.release_date.split('-')[0] : 'Album';

    const isArtist = type === 'artist';

    return html`
        <div class="track-row interactive" 
             style="grid-template-columns: 80px 1fr auto; height: auto; padding: 12px;"
             @click=${clickHandler}>
            
            <div class="track-art-small ${imgUrl ? '' : 'art-fallback'}" style="${imgUrl ? `background-image: url('${imgUrl}');` : ''} width: 64px; height: 64px; border-radius: ${isArtist ? '50%' : '4px'}; margin-right: 16px;"></div>

            <div class="track-info">
                <div class="track-name" style="font-size: var(--spf-text-md, 15px); margin-bottom: 4px;">${name}</div>
                <div class="track-artist">${subtitle}</div>
            </div>

            <div class="track-actions-right">
                <svg width="24" height="24" fill="var(--spf-text-sub)" viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
            </div>
        </div>
    `;
}
