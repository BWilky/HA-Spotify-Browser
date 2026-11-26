import { html, nothing } from "../lit.js";
import { getItemImage, pickImage, IMG_THUMB, IMG_CARD } from "../utils.js";
import { heartIcon, heartToggleIcon, queueIcon, menuIcon, playIcon, playingBarsIcon } from "./common/icons.js";
import { trackMenuDetail } from "./track-menu.js";

/**
 * The line under an item's name in lists and cards.
 *
 * Base rule (no options): a playlist shows its owner, an album or track its
 * artists, an artist "Artist". Each option is a point where the lists
 * disagree today; SUBTITLE_STYLE holds every list's current combination.
 *
 * @param {Object} item - Spotify playlist / album / artist / track (or a flattened pinned item).
 * @param {string} [type] - defaults to item.type.
 * @param {Object} [options]
 * @param {boolean} [options.preset] - a precomputed item.subtitle (pinned items) wins when non-empty.
 * @param {boolean} [options.typeLabel] - lead with the type: "Playlist • Owner", "Album • Artists", "Song • Artists".
 * @param {boolean} [options.byOwner] - playlist owner written "By <name>" (without typeLabel); "Playlist" when the owner has no name.
 * @param {boolean} [options.ownerAltName] - use owner.name when owner.display_name is empty.
 * @param {string}  [options.ownerFallback] - (typeLabel) owner text when the playlist has no owner name.
 * @param {boolean} [options.description] - a playlist with no owner shows its description.
 * @param {'lead'|'trail'|'fallback'} [options.year] - album release year: after the type label ('lead'), after the
 *        artists ('trail'), or only for an album without an artists list, else "Album" ('fallback').
 * @param {string}  [options.unknownArtist] - text for an album without an artists list.
 * @returns {string}
 */
export function itemSubtitle(item, type = item?.type, options = {}) {
    if (!item) return '';
    const {
        preset = false, typeLabel = false, byOwner = false, ownerAltName = false,
        ownerFallback = '', description = false, year = null, unknownArtist = '',
    } = options;
    if (preset && item.subtitle) return item.subtitle;

    const artists = Array.isArray(item.artists) ? item.artists.map(a => a.name).join(', ') : null;
    const yr = item.release_date ? item.release_date.split('-')[0] : '';
    switch (type) {
        case 'artist':
            return 'Artist';
        case 'playlist': {
            const owner = item.owner;
            let name = owner?.display_name;
            if (!name && ownerAltName) name = owner?.name;
            if (typeLabel) return `Playlist • ${name || ownerFallback}`;
            if (!owner) return (description && item.description) || '';
            // An owner without a display name reads "Playlist", not "By undefined".
            return byOwner ? (name ? `By ${name}` : 'Playlist') : (name || '');
        }
        case 'album': {
            if (typeLabel) return ['Album', year === 'lead' && yr, artists].filter(Boolean).join(' • ');
            if (year === 'fallback') return artists || (yr || 'Album');
            // An empty artists list counts as missing (no leading " • 2020").
            const text = artists || unknownArtist;
            return year === 'trail' && yr ? (text ? `${text} • ${yr}` : yr) : text;
        }
        case 'track':
            return typeLabel ? `Song • ${artists || ''}` : (artists || '');
        default:
            return artists || '';
    }
}

/**
 * Each list's subtitle wording as it stands (the lists disagree; see
 * itemSubtitle). Kept apart so one wording can be chosen later without
 * changing any list by accident.
 */
export const SUBTITLE_STYLE = Object.freeze({
    /** Your Library: "Playlist • Owner", "Album • Artists", "Artist". */
    library: Object.freeze({ typeLabel: true, ownerAltName: true, ownerFallback: 'Spotify' }),
    /** Search results: "Song • Artists", "Playlist • Owner", "Album • 2020 • Artists", "Artist". */
    search: Object.freeze({ typeLabel: true, ownerFallback: 'Spotify', year: 'lead' }),
    /** Home "See All" section pages: "By Owner" (else the description), "Artists • 2020", "Artist". */
    section: Object.freeze({ byOwner: true, description: true, year: 'trail', unknownArtist: 'Unknown Artist' }),
    /** Artist discography list: "By Owner", "Artists" (else the year, else "Album"), "Artist". */
    mediaRow: Object.freeze({ byOwner: true, year: 'fallback' }),
    /** Home cards: the item's own subtitle (pinned items), else "Owner", "Artists", "Artist". */
    card: Object.freeze({ preset: true }),
});

/** Right chevron at the end of a navigating row (discography list). */
export const rowChevronIcon = html`<svg width="24" height="24" fill="var(--spf-text-sub)" viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>`;

/**
 * One row for an album, playlist or artist in a list (search also uses it
 * for tracks): art, name, subtitle, then the caller's trailing controls as
 * further grid columns. Styled by listRowStyles (styles/list-row.styles.js);
 * each page sets the art size with --list-row-art.
 *
 * @param {Object} item
 * @param {string} [type] - defaults to item.type; 'artist' draws round art.
 * @param {Object} [options]
 * @param {Function} [options.onClick] - row click.
 * @param {*} [options.subtitle] - defaults to itemSubtitle(item, type).
 * @param {*} [options.trailing] - template(s) after the text, e.g. a menu button.
 * @param {boolean} [options.playing] - brand-coloured name (the item's context is playing).
 * @param {*} [options.name] - defaults to item.name, or nothing.
 * @param {boolean} [options.fallbackArt=true] - music-note placeholder when there is no image.
 */
export function renderListRow(item, type = item?.type, {
    onClick = null,
    subtitle,
    trailing = null,
    playing = false,
    name = item?.name || '',
    fallbackArt = true,
} = {}) {
    const img = getItemImage(item, type, IMG_THUMB);
    return html`
        <div class="row" @click=${onClick}>
            <div class="art ${type === 'artist' ? 'circle' : ''} ${!img && fallbackArt ? 'art-fallback' : ''}" style="${img ? `background-image: url('${img}')` : ''}"></div>
            <div class="info">
                <div class="name ${playing ? 'playing' : ''}">${name}</div>
                <div class="sub">${subtitle ?? itemSubtitle(item, type)}</div>
            </div>
            ${trailing || ''}
        </div>
    `;
}

/** `n` placeholder rows shaped like renderListRow (listRowStyles). */
export function renderRowSkeletons(n) {
    return html`${Array.from({ length: n }, () => html`
        <div class="skel skeleton-pulse"><div class="art"></div><div class="skel-lines"><div></div><div></div></div></div>`)}`;
}

/** A centred status line in a list ("No playlists yet.", "Loading more..."); listRowStyles' .empty. */
export function renderEmptyState(message) {
    return html`<div class="empty">${message}</div>`;
}

/** Scroll button of a carousel section: page the carousel 3/4 of its width to the right. */
function scrollCarouselRight(e) {
    e.stopPropagation();
    const wrapper = e.currentTarget.closest('.carousel-wrapper');
    const layout = wrapper ? wrapper.querySelector('.carousel-layout') : null;
    if (layout) layout.scrollBy({ left: layout.clientWidth * 0.75, behavior: 'smooth' });
}

/**
 * renderCarouselSection options of the artist page's rails (Discography,
 * Appears On, Fans Also Like); home's sections use the defaults.
 */
export const ARTIST_CAROUSEL = Object.freeze({ sectionClass: 'artist-section', skeletons: 5, scrollButton: false });

/**
 * A titled row of cards that scrolls sideways — or wraps into a grid when
 * expanded — with an optional expand/collapse toggle and a "See All" button.
 * Home's library sections use the defaults; the artist page's rails pass
 * the options marked (artist), most of them as ARTIST_CAROUSEL. Styles come
 * from sharedStyles.
 *
 * @param {Object} o
 * @param {string} [o.title] - text of the default header row.
 * @param {string} [o.id] - section id: data-section-id / data-section and the carousel id (carousel-<id>); omitted, none of the three is written.
 * @param {Array|null} [o.items] - null/undefined: loading (card skeletons); []: "No content found.".
 * @param {string} [o.type] - the section's item type: used for items with no type/_fallbackType; 'artist' draws round skeletons.
 * @param {Function} o.onItem - (item, type, subtitle, event) card click; subtitle is undefined without o.subtitle.
 * @param {Function} [o.subtitle] - (item, type) => card subtitle; omitted, renderCardTemplate picks its own.
 * @param {boolean} [o.expanded] - grid instead of carousel.
 * @param {Function} [o.onToggle] - (e) expand/collapse click; the toggle button shows only when given.
 * @param {Function} [o.seeAll] - (e) "See All" click; the button shows once there are items.
 * @param {*} [o.header] - (artist) template that replaces the default header row (title, toggle, See All).
 * @param {string} [o.sectionClass='home-section'] - (artist) class of the <section>.
 * @param {string} [o.layoutClass] - (artist) extra class on the carousel row.
 * @param {number} [o.skeletons=6] - (artist) number of card skeletons while loading.
 * @param {boolean} [o.roundSkeletons] - (artist) round card skeletons; defaults to type === 'artist'.
 * @param {boolean} [o.scrollButton=true] - (artist) the hover "scroll right" button.
 */
export function renderCarouselSection({
    title, id, items = null, type, onItem, subtitle, expanded = false, onToggle, seeAll,
    header, sectionClass = 'home-section', layoutClass = '', skeletons = 6,
    roundSkeletons = type === 'artist', scrollButton = true,
}) {
    const hasItems = !!items && items.length > 0;

    let content;
    if (items === null) {
        content = Array(skeletons).fill(0).map(() => renderCardSkeletonTemplate(roundSkeletons));
    } else if (items.length === 0) {
        content = html`<div style="padding:20px; opacity:0.5; white-space:nowrap;">No content found.</div>`;
    } else {
        content = items.map(item => {
            const itemType = item.type || item._fallbackType || type;
            if (!subtitle) return renderCardTemplate(item, itemType, (e) => onItem(item, itemType, undefined, e));
            const sub = subtitle(item, itemType);
            return renderCardTemplate({ ...item, subtitle: sub }, itemType, (e) => onItem(item, itemType, sub, e));
        });
    }

    return html`
        <section class="${sectionClass}" data-section-id="${id ?? nothing}">
            ${header ?? html`
            <div class="section-header" style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center;">
                    <h3 class="section-title" style="margin:0;">${title}</h3>
                    ${onToggle ? html`<button class="icon-btn expand-btn" @click=${onToggle} aria-label="Toggle View" style="background:none; border:none; color:var(--secondary-text-color, #b3b3b3); cursor:pointer; margin-left: 8px; padding: 4px; display: flex; align-items: center;">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(${expanded ? 180 : 0}deg);">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>` : ''}
                </div>
                ${hasItems && seeAll
                ? html`<button class="see-all-btn" @click=${seeAll}>See All</button>`
                : html`<button class="see-all-btn" style="display:none">See All</button>`}
            </div>`}
            <div class="carousel-wrapper">
                <div class="${expanded ? 'section-grid' : 'carousel-layout'}${layoutClass ? ` ${layoutClass}` : ''}" id="${id == null ? nothing : `carousel-${id}`}" data-section="${id ?? nothing}">
                    ${content}
                </div>
                ${scrollButton ? html`
                <button class="scroll-btn right" @click=${scrollCarouselRight} style="${hasItems && items.length > 5 && !expanded ? '' : 'display:none'}">
                    <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                </button>` : ''}
            </div>
        </section>
    `;
}

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
    const imgUrl = getItemImage(item, item?.type, IMG_CARD);
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
    const imgUrl = getItemImage(item, 'track', IMG_THUMB);
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
    // Row art is a <=48px slot: use the small variant.
    const thumb = pickImage(track.album?.images, IMG_THUMB) || image;
    // The track-menu payload (onMenu), with the row's own artist line.
    const trackData = trackMenuDetail(track, { artist: artistNames });

    const isPlaylist = options.layout === 'playlist';
    const { isPlaying = false, isAlbum = false, liked = false, onSave, onQueue, onMenu } = options;

    // First column. Playlist mode keeps the album art (playlists) / index
    // (albums) there even while playing — the now-playing cue is the inline
    // equalizer + green title next to the track name, matching the native app.
    const firstCol = (isPlaylist && image && !isAlbum)
        ? html`<img src="${thumb}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover;" loading="lazy" decoding="async">`
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
            <div class="track-art-small" style="background-image: url('${thumb}');"></div>
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
