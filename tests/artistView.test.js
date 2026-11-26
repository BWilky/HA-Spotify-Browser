import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalized, listeners } from './helpers/lit-env.js';
import { html, nothing } from '../src/lit.js';
import {
    renderCarouselSection, renderCardTemplate, renderCardSkeletonTemplate, ARTIST_CAROUSEL,
} from '../src/components/media-templates.js';
import { openTrackMenu } from '../src/components/track-menu.js';
import { pickImage, IMG_THUMB } from '../src/utils.js';

// The artist view (components/views/spotify-artist-view.js) cannot be
// constructed under node; these tests pin the two pieces it now takes from
// shared helpers against its own code from before, copied verbatim.

const img = (seed) => [640, 300, 64].map(w => ({ url: `https://img.test/${w}/${seed}.png`, width: w, height: w }));
const album = (i) => ({ id: `al${i}`, uri: `spotify:album:al${i}`, type: 'album', name: `Album ${i}`, images: img(`al${i}`), artists: [{ name: 'A' }], release_date: '2020-01-01' });
const playlist = (i) => ({ id: `p${i}`, uri: `spotify:playlist:p${i}`, type: 'playlist', name: `Playlist ${i}`, images: img(`p${i}`), owner: { display_name: 'Someone' } });
const artist = (i) => ({ id: `ar${i}`, uri: `spotify:artist:ar${i}`, type: 'artist', name: `Artist ${i}`, images: img(`ar${i}`) });

/**
 * markup() (helpers/lit-env.js), except that an attribute bound to lit's
 * `nothing` is left out, as lit renders it.
 */
function markupLit(v) {
    if (v === null || v === undefined || v === false) return '';
    if (Array.isArray(v)) return v.map(markupLit).join('');
    if (typeof v === 'function') return '[fn]';
    if (typeof v === 'symbol') return '';
    if (typeof v === 'object' && Array.isArray(v.strings) && Array.isArray(v.values)) {
        let s = v.strings[0];
        for (let i = 0; i < v.values.length; i++) {
            let next = v.strings[i + 1];
            const attr = v.values[i] === nothing && s.match(/\s+[\w-]+="$/);
            if (attr) {
                s = s.slice(0, attr.index);
                next = next.replace(/^[^"]*"/, '');
            } else {
                s += markupLit(v.values[i]);
            }
            s += next;
        }
        return s;
    }
    return String(v);
}
const same = (tpl) => normalized(markupLit(tpl));

test('markupLit drops attributes bound to nothing', () => {
    assert.equal(same(html`<div class="a" id="${nothing}" data-x="${'1'}" data-y="${nothing}">x</div>`), '<div class="a" data-x="1">x</div>');
});

/** The artist view's rails as it wrote them (renderArtistProfile), on a stand-in host. */
function legacyRails(host, data) {
    return html`
                    ${data.albums === null || data.albums?.length ? html`
                        <section class="artist-section">
                            <div class="section-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                                <h2 style="margin: 0;">Discography</h2>
                                <button class="see-all-btn" @click=${() => host.dispatchEvent(new CustomEvent('navigate', { detail: { pageId: `artist-discography:${data.id}`, data: { name: data.name, id: data.id } }, bubbles: true, composed: true }))} style="background: none; border: none; color: #b3b3b3; font-size: var(--spf-text-sm, 12px); font-weight: 700; letter-spacing: 1px; cursor: pointer; text-transform: uppercase;">SEE ALL</button>
                            </div>
                            <div class="carousel-wrapper">
                                 <div class="carousel-layout">
                                    ${data.albums === null
                    ? Array(5).fill(0).map(() => renderCardSkeletonTemplate())
                    : data.albums.map(album => renderCardTemplate(album, 'album', (e) => host._navigateToAlbum(album, e)))
                }
                                 </div>
                            </div>
                        </section>
                    ` : ''}

                    ${data.playlists === undefined || data.playlists?.length ? html`
                        <section class="artist-section">
                            <h2>Appears On</h2>
                            <div class="carousel-wrapper">
                                <div class="carousel-layout">
                                    ${!data.playlists
                    ? Array(5).fill(0).map(() => renderCardSkeletonTemplate())
                    : data.playlists.map(playlist => renderCardTemplate(playlist, 'playlist', () => {
                        host.dispatchEvent(new CustomEvent('navigate', { detail: { pageId: `playlist:${playlist.id}`, data: playlist }, bubbles: true, composed: true }));
                    }))
                }
                                </div>
                            </div>
                        </section>
                    ` : ''}

                    ${data.similarArtists === null || data.similarArtists?.length ? html`
                        <section class="artist-section">
                            <h2>Fans Also Like</h2>
                            <div class="carousel-wrapper">
                                <div class="carousel-layout circle-cards">
                                    ${data.similarArtists === null
                    // Intended fix after the refactor: the "Fans Also Like" skeletons
                    // are round like the artist cards they stand in for (were square).
                    ? Array(5).fill(0).map(() => renderCardSkeletonTemplate(true))
                    : data.similarArtists.map(artist => renderCardTemplate(artist, 'artist', (e) => host._navigateToArtist(artist, e)))
                }
                                </div>
                            </div>
                        </section>
                    ` : ''}`;
}

/** The same rails as the artist view renders them now. */
function newRails(host, data) {
    return html`
                    ${data.albums === null || data.albums?.length ? renderCarouselSection({
                        ...ARTIST_CAROUSEL,
                        header: html`
                            <div class="section-header">
                                <h2 style="margin: 0;">Discography</h2>
                                <button class="see-all-btn" @click=${() => host._navigate(`artist-discography:${data.id}`, { name: data.name, id: data.id })} style="color: var(--spf-text-sub);">SEE ALL</button>
                            </div>`,
                        items: data.albums,
                        type: 'album',
                        onItem: (album, _type, _sub, e) => host._navigate(`album:${album.id}`, album, e),
                    }) : ''}

                    ${data.playlists === undefined || data.playlists?.length ? renderCarouselSection({
                        ...ARTIST_CAROUSEL,
                        header: html`<h2>Appears On</h2>`,
                        items: data.playlists,
                        type: 'playlist',
                        onItem: (playlist) => host._navigate(`playlist:${playlist.id}`, playlist),
                    }) : ''}

                    ${data.similarArtists === null || data.similarArtists?.length ? renderCarouselSection({
                        ...ARTIST_CAROUSEL,
                        header: html`<h2>Fans Also Like</h2>`,
                        items: data.similarArtists,
                        type: 'artist',
                        onItem: (artist, _type, _sub, e) => host._navigate(`artist:${artist.id}`, artist, e),
                    }) : ''}`;
}

/** A stand-in for the view: its old navigate helpers and the new one, logging what they dispatch. */
function host() {
    const log = [];
    const h = {
        log,
        dispatchEvent(e) { log.push(['dispatch', e.type, e.bubbles, e.composed, e.detail]); return true; },
        // Old helpers, verbatim.
        _navigateToAlbum(album, e) {
            if (e) e.stopPropagation();
            this.dispatchEvent(new CustomEvent('navigate', { detail: { pageId: `album:${album.id}`, data: album }, bubbles: true, composed: true }));
        },
        _navigateToArtist(artist, e) {
            if (e) e.stopPropagation();
            this.dispatchEvent(new CustomEvent('navigate', { detail: { pageId: `artist:${artist.id}`, data: artist }, bubbles: true, composed: true }));
        },
        // New helper, verbatim.
        _navigate(pageId, data, e) {
            if (e) e.stopPropagation();
            this.dispatchEvent(new CustomEvent('navigate', { detail: { pageId, data }, bubbles: true, composed: true }));
        },
    };
    return h;
}

const BASE = { id: 'ar1', name: 'Artist 1' };
const STATES = {
    'nothing loaded yet': { ...BASE, albums: null, playlists: undefined, similarArtists: null },
    'all rails loaded': { ...BASE, albums: [1, 2, 3, 4, 5, 6, 7].map(album), playlists: [1, 2].map(playlist), similarArtists: [1, 2, 3].map(artist) },
    'empty rails hidden': { ...BASE, albums: [], playlists: [], similarArtists: [] },
    'playlists failed (null), rest missing': { ...BASE, albums: undefined, playlists: null, similarArtists: undefined },
    'one of each, one item without a type': { ...BASE, albums: [{ ...album(1), type: undefined }], playlists: [playlist(1)], similarArtists: [{ ...artist(1), type: undefined }] },
};

/**
 * The intended differences from the old markup (X4, S14), applied to it:
 *  - the Discography header's inline flex repeated .section-header (sharedStyles);
 *  - the SEE ALL button's inline declarations repeated .see-all-btn, except its
 *    colour: kept, as the token (#b3b3b3), because it also holds the hover
 *    colour (.see-all-btn:hover would turn it white);
 *  - "circle-cards" had no CSS anywhere.
 */
const intended = (markup) => markup
    .replace('<div class="section-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">', '<div class="section-header">')
    .replace('style="background: none; border: none; color: #b3b3b3; font-size: var(--spf-text-sm, 12px); font-weight: 700; letter-spacing: 1px; cursor: pointer; text-transform: uppercase;"', 'style="color: var(--spf-text-sub);"')
    .replace('class="carousel-layout circle-cards"', 'class="carousel-layout"');

test('artist rails: renderCarouselSection + ARTIST_CAROUSEL reproduce the old markup (minus the intended X4/S14 changes)', () => {
    let changed = 0;
    for (const [name, data] of Object.entries(STATES)) {
        const legacy = same(legacyRails(host(), data));
        if (intended(legacy) !== legacy) changed++;
        assert.equal(same(newRails(host(), data)), intended(legacy), name);
    }
    assert.ok(changed >= 2, 'the intended changes were exercised');
});

test('artist rails: same listeners, dispatching the same navigate events, stopping propagation where they did', () => {
    for (const [name, data] of Object.entries(STATES)) {
        const a = host(), b = host();
        const la = listeners(legacyRails(a, data)), lb = listeners(newRails(b, data));
        assert.equal(lb.length, la.length, `${name}: listener count`);
        const run = (fns, h) => fns.forEach(fn => fn({ stopPropagation: () => h.log.push(['stopPropagation']) }));
        run(la, a); run(lb, b);
        assert.deepEqual(b.log, a.log, name);
    }
});

test('ARTIST_CAROUSEL: home defaults untouched when it is not passed', () => {
    const tpl = same(renderCarouselSection({ title: 'T', id: 'artists', items: null, type: 'artist', onItem: () => {} }));
    assert.equal((tpl.match(/media-card skeleton-pulse artist-card/g) || []).length, 6, 'six round skeletons');
    assert.match(tpl, /<section class="home-section" data-section-id="artists">/);
    assert.match(tpl, /<div class="carousel-layout" id="carousel-artists" data-section="artists">/);
    assert.match(tpl, /class="scroll-btn right"/);
    const artistTpl = same(renderCarouselSection({ ...ARTIST_CAROUSEL, header: html`<h2>X</h2>`, items: null, type: 'artist', onItem: () => {} }));
    assert.equal((artistTpl.match(/media-card skeleton-pulse artist-card/g) || []).length, 5, 'five round skeletons for an artist rail');
    const albumTpl = same(renderCarouselSection({ ...ARTIST_CAROUSEL, header: html`<h2>X</h2>`, items: null, type: 'album', onItem: () => {} }));
    assert.equal((albumTpl.match(/class="media-card skeleton-pulse"/g) || []).length, 5, 'five square skeletons for an album rail');
    assert.doesNotMatch(artistTpl, /scroll-btn|data-section|id=/);
});

test('renderCarouselSection passes the click event to onItem (4th argument)', () => {
    const got = [];
    const ev = { stopPropagation() {} };
    for (const subtitle of [undefined, () => 'sub']) {
        // No toggle, See All or scroll button: the card click is the only listener.
        const tpl = renderCarouselSection({ id: 'x', title: 'X', items: [album(1)], type: 'album', subtitle, scrollButton: false, onItem: (...args) => got.push(args) });
        listeners(tpl).forEach(fn => fn(ev));
    }
    assert.deepEqual(got.map(a => [a[0].id, a[1], a[2], a[3] === ev]), [['al1', 'album', undefined, true], ['al1', 'album', 'sub', true]]);
});

/* --- Top-track menu --- */

const RECT = { x: 1, y: 2, width: 36, height: 36, top: 2, left: 1, right: 37, bottom: 38 };
const button = { getBoundingClientRect: () => RECT };

/** renderArtistTopTrack's menu handler before openTrackMenu, verbatim (dispatch captured). */
function legacyTopTrackMenu(track, e) {
    const image = track.album?.images?.[0]?.url;
    return {
        name: track.name,
        artist: track.artists ? track.artists.map(a => a.name).join(', ') : '',
        album: track.album?.name || '',
        uri: track.uri,
        id: track.id,
        image,
        anchor: e.currentTarget.getBoundingClientRect(),
    };
}

const TRACKS = {
    full: { id: 't1', uri: 'spotify:track:t1', name: 'Song', artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'Album', images: img('al1') } },
    noArtists: { id: 't2', uri: 'spotify:track:t2', name: 'Song', album: { name: 'Album', images: img('al1') } },
    nullArtists: { id: 't2', uri: 'spotify:track:t2', name: 'Song', artists: null, album: { name: 'Album', images: img('al1') } },
    emptyArtists: { id: 't3', name: 'Song', artists: [], album: { name: 'Album', images: img('al1') } },
    namelessArtist: { id: 't4', name: 'Song', artists: [{}], album: { images: img('al1') } },
    noAlbum: { id: 't5', uri: 'spotify:track:t5', name: 'Bare', artists: [{ name: 'A' }] },
    noImages: { id: 't6', name: 'Song', artists: [{ name: 'A' }], album: { name: 'Album', images: [] } },
    unsizedArt: { id: 't7', name: 'Song', artists: [{ name: 'A' }], album: { name: 'Album', images: [{ url: 'https://ha/entity_picture' }] } },
};

test('top-track menu: openTrackMenu sends the old payload except a thumbnail-size image', () => {
    for (const [name, track] of Object.entries(TRACKS)) {
        const target = new EventTarget();
        let sent = null;
        target.addEventListener('open-track-menu', (e) => { sent = e; });
        openTrackMenu(target, track, { anchorEl: button });
        const want = legacyTopTrackMenu(track, { currentTarget: button });
        assert.equal(sent.bubbles, true);
        assert.equal(sent.composed, true);
        assert.deepEqual(Object.keys(sent.detail), Object.keys(want), `${name}: same fields, same order`);
        for (const k of Object.keys(want)) {
            if (k === 'image') continue;
            assert.deepEqual(sent.detail[k], want[k], `${name}: ${k}`);
        }
        // image: the old one was the album's first (largest) image; now the
        // smallest at least IMG_THUMB wide, '' (was undefined) when there is none.
        assert.equal(sent.detail.image, pickImage(track.album?.images, IMG_THUMB), `${name}: image`);
        assert.equal(sent.detail.image || undefined, want.image && pickImage(track.album.images, IMG_THUMB), `${name}: image present iff it was`);
    }
    assert.equal(legacyTopTrackMenu(TRACKS.full, { currentTarget: button }).image, 'https://img.test/640/al1.png');
    assert.match(pickImage(TRACKS.full.album.images, IMG_THUMB), /img\.test\/(64|300)\//);
});
