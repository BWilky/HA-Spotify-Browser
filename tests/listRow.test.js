import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalized, markup, listeners } from './helpers/lit-env.js';
import { html } from '../src/lit.js';
import {
    renderListRow, renderRowSkeletons, renderEmptyState, renderCarouselSection,
    renderCardTemplate, renderCardSkeletonTemplate, itemSubtitle, SUBTITLE_STYLE,
} from '../src/components/media-templates.js';
import { getItemImage, IMG_THUMB } from '../src/utils.js';
import { menuIcon, playIcon } from '../src/components/common/icons.js';

const img = (seed) => [640, 300, 64].map(w => ({ url: `https://img.test/${w}/${seed}.png`, width: w, height: w }));
const album = { id: 'al1', uri: 'spotify:album:al1', type: 'album', name: 'Album 1', images: img('al1'), artists: [{ name: 'Artist 1' }], release_date: '2020-01-01' };
const playlist = { id: 'p1', uri: 'spotify:playlist:p1', type: 'playlist', name: 'Playlist 1', images: img('p1'), owner: { display_name: 'Someone' } };
const artist = { id: 'ar1', uri: 'spotify:artist:ar1', type: 'artist', name: 'Artist 1', images: img('ar1') };
const track = { id: 't1', uri: 'spotify:track:t1', type: 'track', name: 'Track 1', artists: [{ name: 'Artist 1' }], album: { name: 'Album 1', images: img('al1') } };
const noArt = { ...album, id: 'al2', name: 'No Art', images: [] };
const noop = () => {};

// ---- Legacy row markup, copied verbatim from each list before the refactor ----

// components/views/spotify-library.js — _renderRow (sub computed by its own rule)
function legacyLibraryRow(item, type, playing) {
    const img = getItemImage(item, type, IMG_THUMB);
    const isArtist = type === 'artist';
    const sub = itemSubtitle(item, type, SUBTITLE_STYLE.library);
    return html`
            <div class="row" @click=${noop}>
                <div class="art ${isArtist ? 'circle' : ''} ${img ? '' : 'art-fallback'}" style="${img ? `background-image: url('${img}')` : ''}"></div>
                <div class="info">
                    <div class="name ${playing ? 'playing' : ''}">${item.name || ''}</div>
                    <div class="sub">${sub}</div>
                </div>
                ${isArtist ? '' : html`
                    <button class="row-menu-btn" aria-label="More options"
                            @click=${noop}>${menuIcon}</button>`}
            </div>
        `;
}

// components/spotify-search.js — _renderRow (TYPE_LABEL badge + trailing button)
const TYPE_LABEL = { track: 'Song', playlist: 'Playlist', artist: 'Artist', album: 'Album' };
const searchTrailing = (type) => html`
                <span class="type-badge">${TYPE_LABEL[type] || ''}</span>
                ${type === 'track' ? html`
                    <button class="row-btn" @click=${noop} aria-label="More">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>
                    </button>
                ` : html`
                    <button class="row-btn" aria-label="Open">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
                    </button>
                `}`;
function legacySearchRow(item, type) {
    const img = getItemImage(item, type, IMG_THUMB);
    const isArtist = type === 'artist';
    const sub = itemSubtitle(item, type, SUBTITLE_STYLE.search);
    return html`
            <div class="row" @click=${noop}>
                <div class="art ${isArtist ? 'circle' : ''}" style="background-image: url('${img}')"></div>
                <div class="info">
                    <div class="name">${item.name}</div>
                    <div class="sub">${sub}</div>
                </div>
                ${searchTrailing(type)}
            </div>
        `;
}

// components/views/spotify-library.js _renderSkeletons / spotify-search.js (same markup)
const legacySkeletons = (n) => html`${Array(n).fill(0).map(() => html`
            <div class="skel skeleton-pulse"><div class="art"></div><div class="skel-lines"><div></div><div></div></div></div>`)}`;

// components/spotify-home.js — cardSubtitle + _cardTemplate + _carouselSection
function legacyCardSubtitle(item, type) {
    let subtitle = item.subtitle;
    if (!subtitle && item.owner) subtitle = item.owner.display_name;
    if (!subtitle && item.artists && Array.isArray(item.artists)) subtitle = item.artists.map(a => a.name).join(', ');
    if (!subtitle) subtitle = type === 'artist' ? 'Artist' : '';
    return subtitle;
}
function legacyCarousel(host, title, sectionId, items = null) {
    const hasItems = !!items && items.length > 0;
    const expanded = host._expandedSections.has(sectionId);
    const cardTemplate = (item, type) => {
        const subtitle = legacyCardSubtitle(item, type);
        return renderCardTemplate({ ...item, subtitle }, type, () => host._onItemClick(item, type, subtitle));
    };
    let content;
    if (items === null) {
        content = Array(6).fill(0).map(() => renderCardSkeletonTemplate(sectionId.includes('artists')));
    } else if (items.length === 0) {
        content = html`<div style="padding:20px; opacity:0.5; white-space:nowrap;">No content found.</div>`;
    } else {
        content = items.map(item => cardTemplate(item, item.type || item._fallbackType));
    }
    return html`
        <section class="home-section" data-section-id="${sectionId}">
            <div class="section-header" style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center;">
                    <h3 class="section-title" style="margin:0;">${title}</h3>
                    <button class="icon-btn expand-btn" @click=${(e) => host._toggleSectionView(e, sectionId)} aria-label="Toggle View" style="background:none; border:none; color:var(--secondary-text-color, #b3b3b3); cursor:pointer; margin-left: 8px; padding: 4px; display: flex; align-items: center;">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(${expanded ? 180 : 0}deg);">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>
                </div>
                ${hasItems
                ? html`<button class="see-all-btn" @click=${(e) => host._onNavigateSection(e, sectionId)}>See All</button>`
                : html`<button class="see-all-btn" style="display:none">See All</button>`}
            </div>
            <div class="carousel-wrapper">
                <div class="${expanded ? 'section-grid' : 'carousel-layout'}" id="carousel-${sectionId}" data-section="${sectionId}">
                    ${content}
                </div>
                <button class="scroll-btn right" @click=${noop} style="${hasItems && items.length > 5 && !expanded ? '' : 'display:none'}">
                    <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                </button>
            </div>
        </section>
        `;
}

// ---- Tests ----

test('renderListRow: library rows match the library markup', () => {
    for (const [item, type] of [[album, 'album'], [playlist, 'playlist'], [artist, 'artist'], [noArt, 'album']]) {
        for (const playing of [false, true]) {
            const row = renderListRow(item, type, {
                subtitle: itemSubtitle(item, type, SUBTITLE_STYLE.library),
                playing,
                onClick: noop,
                trailing: type === 'artist' ? '' : html`
                    <button class="row-menu-btn" aria-label="More options"
                            @click=${noop}>${menuIcon}</button>`,
            });
            assert.equal(normalized(row), normalized(legacyLibraryRow(item, type, playing)), `${type} ${item.name} playing=${playing}`);
        }
    }
});

test('renderListRow: search rows match the search markup (art present)', () => {
    for (const [item, type] of [[track, 'track'], [album, 'album'], [playlist, 'playlist'], [artist, 'artist']]) {
        const row = renderListRow(item, type, {
            subtitle: itemSubtitle(item, type, SUBTITLE_STYLE.search),
            fallbackArt: false,
            onClick: noop,
            trailing: searchTrailing(type),
        });
        assert.equal(normalized(row), normalized(legacySearchRow(item, type)), type);
    }
});

test('renderListRow: missing art', () => {
    // Default: the music-note placeholder, no inline image.
    const withFallback = normalized(renderListRow(noArt, 'album'));
    assert.match(withFallback, /<div class="art art-fallback" style="">/);
    // fallbackArt: false (search, section) draws the bare art box. Search
    // used to write `background-image: url('')`, which paints nothing either.
    const bare = normalized(renderListRow(noArt, 'album', { fallbackArt: false }));
    assert.match(bare, /<div class="art" style="">/);
});

test('renderListRow: defaults', () => {
    const row = normalized(renderListRow(artist, 'artist'));
    assert.match(row, /<div class="art circle" style="background-image: url\('https:\/\/img.test\/64\/ar1.png'\)">/);
    assert.match(row, /<div class="name">Artist 1<\/div><div class="sub">Artist<\/div><\/div><\/div>$/);
    // name override (section / discography show "Unknown" for nameless items)
    assert.match(normalized(renderListRow({ type: 'album' }, 'album', { name: 'Unknown' })), /<div class="name">Unknown<\/div>/);
    assert.match(normalized(renderListRow({ type: 'album' }, 'album')), /<div class="name"><\/div>/);
    // type defaults to item.type; click listener is attached to the row
    let clicked = 0;
    const tpl = renderListRow(album, undefined, { onClick: () => clicked++ });
    assert.match(normalized(tpl), /class="art"/);
    listeners(tpl).forEach(fn => fn());
    assert.equal(clicked, 1);
});

test('renderRowSkeletons / renderEmptyState match the library + search markup', () => {
    assert.equal(normalized(renderRowSkeletons(5)), normalized(legacySkeletons(5)));
    assert.equal((markup(renderRowSkeletons(3)).match(/class="skel skeleton-pulse"/g) || []).length, 3);
    assert.equal(normalized(renderEmptyState('No playlists yet.')), '<div class="empty">No playlists yet.</div>');
});

function homeHost(expanded = []) {
    const calls = [];
    return {
        calls,
        _expandedSections: new Set(expanded),
        _toggleSectionView: (e, id) => calls.push(['toggle', id]),
        _onNavigateSection: (e, id) => calls.push(['seeAll', id]),
        _onItemClick: (item, type, subtitle) => calls.push(['item', item.id, type, subtitle]),
    };
}
const SECTION_TYPE = { recent: 'album', favorites: 'playlist', artists: 'artist', albums: 'album' };
function newCarousel(host, title, sectionId, items) {
    return renderCarouselSection({
        title, id: sectionId, items, type: SECTION_TYPE[sectionId],
        expanded: host._expandedSections.has(sectionId),
        onToggle: (e) => host._toggleSectionView(e, sectionId),
        seeAll: (e) => host._onNavigateSection(e, sectionId),
        subtitle: (item, type) => itemSubtitle(item, type, SUBTITLE_STYLE.card),
        onItem: (item, type, subtitle) => host._onItemClick(item, type, subtitle),
    });
}

test("renderCarouselSection reproduces home's carousel sections", () => {
    const fb = (items, type) => items.map(i => ({ ...i, _fallbackType: type }));
    const cases = [
        ['Recently Played', 'recent', undefined],
        ['Recently Played', 'recent', null],
        ['Followed Artists', 'artists', null],
        ['Your Favorite Playlists', 'favorites', []],
        ['Your Favorite Playlists', 'favorites', fb([playlist, { ...playlist, id: 'p2', owner: undefined, images: [] }], 'playlist')],
        ['Followed Artists', 'artists', fb(Array.from({ length: 7 }, (_, i) => ({ ...artist, id: `ar${i}` })), 'artist')],
        ['Your Albums', 'albums', fb(Array.from({ length: 6 }, (_, i) => ({ ...album, id: `al${i}` })), 'album')],
        ['Your Albums', 'albums', fb([{ ...album, type: undefined }], 'album')],
    ];
    for (const expanded of [[], ['recent', 'favorites', 'artists', 'albums']]) {
        for (const [title, id, items] of cases) {
            const a = homeHost(expanded), b = homeHost(expanded);
            const want = legacyCarousel(a, title, id, items);
            const got = newCarousel(b, title, id, items);
            assert.equal(normalized(got), normalized(want), `${id} ${JSON.stringify(items)?.slice(0, 40)} expanded=${expanded.length > 0}`);
            // Same listeners in the same order, doing the same thing.
            const la = listeners(want), lb = listeners(got);
            assert.equal(lb.length, la.length, `${id}: listener count`);
            const ev = { stopPropagation() {}, currentTarget: { closest: () => null } };
            la.forEach(fn => fn(ev)); lb.forEach(fn => fn(ev));
            assert.deepEqual(b.calls, a.calls, `${id}: handler calls`);
        }
    }
});

test('renderCarouselSection without a subtitle function leaves card subtitles to renderCardTemplate', () => {
    const got = renderCarouselSection({ title: 'Discography', id: 'd', items: [album], type: 'album', onItem: noop });
    assert.match(normalized(got), /<div class="media-subtitle">2020<\/div>/);
    // no toggle / see-all handlers: no expand button, hidden See All
    assert.doesNotMatch(normalized(got), /expand-btn/);
    assert.match(normalized(got), /<button class="see-all-btn" style="display:none">See All<\/button>/);
    assert.ok(playIcon); // card overlay icon still comes from icons.js
});
