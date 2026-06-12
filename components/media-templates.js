import { html } from "../lit.js";
import { getItemImage } from "../utils.js";

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
    const subtitle = item.subtitle || item.release_date?.split('-')[0] || item.type || '';

    return html`
        <div class="media-card interactive ${isArtist ? 'artist-card' : ''}" 
             @click=${clickHandler}>
            <div class="media-image-wrapper">
                <div class="media-image" style="background-image: url('${imgUrl}'); ${isArtist ? 'border-radius: 50%;' : ''}"></div>
                ${!isArtist ? html`
                <div class="play-btn-overlay">
                    <svg height="24" width="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
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
            <div class="track-art-left" style="background-image: url('${imgUrl}')">
                <button class="play-btn-overlay mini" @click=${(e) => { e.stopPropagation(); playHandler(e); }}>
                    ${isPlaying
            ? html`<svg width="24" height="24" viewBox="0 0 24 24" fill="var(--spf-brand)"><rect x="4" y="10" width="3" height="10"><animate attributeName="height" values="5;10;3;10;5" dur="1s" repeatCount="indefinite" /><animate attributeName="y" values="14;9;16;9;14" dur="1s" repeatCount="indefinite" /></rect><rect x="10" y="5" width="3" height="15"><animate attributeName="height" values="10;15;5;15;10" dur="1s" repeatCount="indefinite" /><animate attributeName="y" values="9;4;14;4;9" dur="1s" repeatCount="indefinite" /></rect><rect x="16" y="8" width="3" height="12"><animate attributeName="height" values="8;12;4;12;8" dur="1s" repeatCount="indefinite" /><animate attributeName="y" values="11;7;15;7;11" dur="1s" repeatCount="indefinite" /></rect></svg>`
            : html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`
        }
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
                   ${isLiked
            ? html`<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`
            : html`<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`
        }
                </button>
                <button class="track-action-btn" @click=${menuHandler}>
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>
                </button>
            </div>
        </div>
    `;
}

/**
 * Returns HTML String for the "Card" layout.
 * Used by spotify-home.js which relies on innerHTML.
 */
export function renderCardHtml(item, type) {
    const id = item.id;
    const uri = item.uri;
    const title = item.name || item.title || 'Unknown';

    let subtitle = item.subtitle;
    if (!subtitle && item.owner) subtitle = item.owner.display_name;
    if (!subtitle && item.artists && Array.isArray(item.artists)) subtitle = item.artists.map(a => a.name).join(', ');
    if (!subtitle) subtitle = type === 'artist' ? 'Artist' : '';

    const img = getItemImage(item, type);

    const safeTitle = title.replace(/"/g, '&quot;');
    const safeSubtitle = subtitle.replace(/"/g, '&quot;');
    const isArtist = type === 'artist';
    const containerClass = isArtist ? 'media-card artist-card interactive' : 'media-card interactive';

    // IMPORTANT: Matches structure of renderCardTemplate
    return `
      <div class="${containerClass}" 
           data-id="${id}" 
           data-type="${type}" 
           data-uri="${uri || ''}" 
           data-title="${safeTitle}"
           data-subtitle="${safeSubtitle}">
        
        <div class="media-image-wrapper">
            <div class="media-image" style="background-image: url('${img}'); ${isArtist ? 'border-radius: 50%;' : ''}"></div>
            ${!isArtist ? `
            <div class="play-btn-overlay">
                <svg height="24" width="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </div>
            ` : ''}
        </div>
        
        <div class="media-title" ${isArtist ? 'style="text-align:center;"' : ''}>${title}</div>
        ${!isArtist ? `<div class="media-subtitle">${subtitle}</div>` : ''}
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
 * Dispatches 'open-track-menu', 'play-track' (via click), 'save-track', 'queue-track'.
 */
export function renderTrackRowTemplate(track, index, clickHandler) {
    if (!track) return '';
    const artistNames = track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown';
    const image = track.album?.images?.[0]?.url;
    // Track Data for menu/actions
    const trackData = {
        name: track.name,
        artist: artistNames,
        uri: track.uri,
        id: track.id,
        image,
    };

    const dispatchAction = (e, action, detail = {}) => {
        e.stopPropagation();
        const target = e.target;
        target.dispatchEvent(new CustomEvent(action, {
            detail: { ...detail, trackData: trackData }, // standardized detail
            bubbles: true,
            composed: true
        }));
    };

    return html`
        <div class="track-row interactive" 
             data-track-id="${track.id}" 
             data-uri="${track.uri}"
             @click=${clickHandler ? (e) => clickHandler(e, track) : null}>
            
            <div class="track-num">${index}</div>
            
            ${image ? html`
            <div class="track-art-small" style="background-image: url('${image}'); width: 40px; height: 40px; background-size: cover; border-radius: 4px; margin-right: 12px; flex-shrink: 0;"></div>
            ` : ''}

            <div class="track-info">
                <div class="track-name">${track.name}</div>
                <div class="track-artist">${artistNames}</div>
            </div>

            <div class="track-actions-right">
                <button class="track-action-btn" data-action="save" 
                        @click=${(e) => dispatchAction(e, 'save-track')}>
                   <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                </button>
                <button class="track-action-btn" data-action="queue"
                        @click=${(e) => dispatchAction(e, 'queue-track')}>
                   <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
                </button>
                <button class="track-action-btn" data-action="menu" 
                        @click=${(e) => dispatchAction(e, 'open-track-menu', trackData)}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>
                </button>
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
            
            <div class="track-art-small" style="background-image: url('${imgUrl}'); width: 64px; height: 64px; border-radius: ${isArtist ? '50%' : '4px'}; margin-right: 16px;"></div>

            <div class="track-info">
                <div class="track-name" style="font-size: 16px; margin-bottom: 4px;">${name}</div>
                <div class="track-artist">${subtitle}</div>
            </div>

            <div class="track-actions-right">
                <svg width="24" height="24" fill="var(--spf-text-sub)" viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
            </div>
        </div>
    `;
}
