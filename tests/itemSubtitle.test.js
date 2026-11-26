import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/lit-env.js';
import { itemSubtitle, SUBTITLE_STYLE } from '../components/media-templates.js';

// The subtitle under an item's name was written out separately by five
// lists. These are those rules exactly as they were before itemSubtitle
// replaced them (copied verbatim, `this`-free), kept here as the reference
// that pins each list's wording.
const legacy = {
    // components/views/spotify-library.js — _renderRow
    library(item, type) {
        const isArtist = type === 'artist';
        let sub;
        if (isArtist) sub = 'Artist';
        else if (type === 'playlist') sub = `Playlist • ${item.owner?.display_name || item.owner?.name || 'Spotify'}`;
        else {
            const who = (item.artists || []).map(a => a.name).join(', ');
            sub = `Album${who ? ' • ' + who : ''}`;
        }
        return sub;
    },
    // components/spotify-search.js — _renderRow
    search(item, type) {
        const isArtist = type === 'artist';
        let sub;
        if (isArtist) sub = 'Artist';
        else if (type === 'playlist') sub = `Playlist • ${item.owner?.display_name || 'Spotify'}`;
        else if (type === 'album') {
            const yr = item.release_date ? item.release_date.split('-')[0] : '';
            const who = item.artists?.map(a => a.name).join(', ') || '';
            sub = `Album${yr ? ' • ' + yr : ''}${who ? ' • ' + who : ''}`;
        } else {
            sub = `Song • ${item.artists?.map(a => a.name).join(', ') || ''}`;
        }
        return sub;
    },
    // components/views/spotify-section-view.js — renderTableRow (reads item.type)
    section(item) {
        let subtitle = '';
        if (item.type === 'playlist') {
            if (item.owner) subtitle = `By ${item.owner.display_name}`;
            else if (item.description) subtitle = item.description;
        }
        else if (item.type === 'album') {
            const artistName = item.artists ? item.artists.map(a => a.name).join(', ') : 'Unknown Artist';
            const year = item.release_date ? ` • ${item.release_date.split('-')[0]}` : '';
            subtitle = `${artistName}${year}`;
        }
        else if (item.type === 'artist') {
            subtitle = 'Artist';
        }
        else {
            if (item.artists) subtitle = item.artists.map(a => a.name).join(', ');
            else if (item.owner) subtitle = `By ${item.owner.display_name}`;
        }
        return subtitle;
    },
    // components/media-templates.js — renderMediaRowTemplate (discography rows)
    mediaRow(item, type) {
        let subtitle = '';
        if (item.owner) subtitle = `By ${item.owner.display_name}`;
        else if (item.artists && Array.isArray(item.artists)) subtitle = item.artists.map(a => a.name).join(', ');
        else if (type === 'artist') subtitle = 'Artist';
        else if (type === 'album') subtitle = item.release_date ? item.release_date.split('-')[0] : 'Album';
        return subtitle;
    },
    // components/spotify-home.js — cardSubtitle (home cards)
    card(item, type) {
        let subtitle = item.subtitle;
        if (!subtitle && item.owner) subtitle = item.owner.display_name;
        if (!subtitle && item.artists && Array.isArray(item.artists)) subtitle = item.artists.map(a => a.name).join(', ');
        if (!subtitle) subtitle = type === 'artist' ? 'Artist' : '';
        return subtitle;
    },
};

const X = { id: 'x', name: 'X' }, Y = { id: 'y', name: 'Y' };
const I = {
    playlist: { type: 'playlist', name: 'P', owner: { id: 'u1', display_name: 'Someone' }, description: 'desc' },
    playlistOwnerNullName: { type: 'playlist', name: 'P', owner: { id: 'u2', display_name: null } },
    playlistOwnerAltName: { type: 'playlist', name: 'P', owner: { id: 'u3', name: 'Alt' } },
    playlistNoOwner: { type: 'playlist', name: 'P', description: 'A description' },
    playlistBare: { type: 'playlist', name: 'P' },
    album: { type: 'album', name: 'A', artists: [X, Y], release_date: '2020-05-01' },
    albumNoDate: { type: 'album', name: 'A', artists: [X] },
    albumYearDate: { type: 'album', name: 'A', artists: [X], release_date: '1999' },
    albumNoArtists: { type: 'album', name: 'A', release_date: '2020-05-01' },
    albumBare: { type: 'album', name: 'A' },
    albumEmptyArtists: { type: 'album', name: 'A', artists: [], release_date: '2020-05-01' },
    artist: { type: 'artist', name: 'Z' },
    track: { type: 'track', name: 'T', artists: [X, Y], album: { name: 'Al' } },
    trackNoArtists: { type: 'track', name: 'T' },
    pinnedPlaylist: { type: 'playlist', name: 'P', subtitle: 'By Spotify' },
    likedSongs: { type: 'library', name: 'User Library', subtitle: 'Your collection & liked songs' },
    pinnedArtistNoSubtitle: { type: 'artist', name: 'Z', subtitle: '' },
};

// [item, library, search, section, mediaRow, card] — undefined: that list never shows this type.
const TABLE = [
    ['playlist', 'Playlist • Someone', 'Playlist • Someone', 'By Someone', 'By Someone', 'Someone'],
    ['playlistOwnerNullName', 'Playlist • Spotify', 'Playlist • Spotify', 'By null', 'By null', ''],
    ['playlistOwnerAltName', 'Playlist • Alt', 'Playlist • Spotify', 'By undefined', 'By undefined', ''],
    ['playlistNoOwner', 'Playlist • Spotify', 'Playlist • Spotify', 'A description', '', ''],
    ['playlistBare', 'Playlist • Spotify', 'Playlist • Spotify', '', '', ''],
    ['album', 'Album • X, Y', 'Album • 2020 • X, Y', 'X, Y • 2020', 'X, Y', 'X, Y'],
    ['albumNoDate', 'Album • X', 'Album • X', 'X', 'X', 'X'],
    ['albumYearDate', 'Album • X', 'Album • 1999 • X', 'X • 1999', 'X', 'X'],
    ['albumNoArtists', 'Album', 'Album • 2020', 'Unknown Artist • 2020', '2020', ''],
    ['albumBare', 'Album', 'Album', 'Unknown Artist', 'Album', ''],
    ['albumEmptyArtists', 'Album', 'Album • 2020', ' • 2020', '', ''],
    ['artist', 'Artist', 'Artist', 'Artist', 'Artist', 'Artist'],
    ['track', undefined, 'Song • X, Y', 'X, Y', 'X, Y', 'X, Y'],
    ['trackNoArtists', undefined, 'Song • ', '', '', ''],
    ['pinnedPlaylist', undefined, undefined, undefined, undefined, 'By Spotify'],
    ['likedSongs', undefined, undefined, undefined, undefined, 'Your collection & liked songs'],
    ['pinnedArtistNoSubtitle', undefined, undefined, undefined, undefined, 'Artist'],
];
const SITES = ['library', 'search', 'section', 'mediaRow', 'card'];

/**
 * The legacy rules had three wording bugs that itemSubtitle deliberately does
 * not reproduce. This maps a legacy result to the corrected text:
 *  - "By null" / "By undefined" / "By " for a playlist whose owner has no
 *    display name -> "Playlist";
 *  - an album with an EMPTY artists list: section printed " • 2020" (now
 *    "Unknown Artist • 2020") and the discography list printed nothing (now
 *    the year, else "Album", as for an album with no artists list at all).
 */
function corrected(site, item, text) {
    if (/^By (null|undefined)?$/.test(text)) return 'Playlist';
    // "Empty" = an artists list that yields no text (no entries, or blank names).
    const emptyArtists = item.type === 'album' && Array.isArray(item.artists) && item.artists.map(a => a.name).join(', ') === '';
    if (!emptyArtists) return text;
    const yr = item.release_date ? item.release_date.split('-')[0] : '';
    if (site === 'section') return yr ? `Unknown Artist • ${yr}` : 'Unknown Artist';
    if (site === 'mediaRow') return yr || 'Album';
    return text;
}

test('the pinned wording is what each list rendered before the refactor', () => {
    for (const [key, ...expected] of TABLE) {
        const item = I[key];
        SITES.forEach((site, i) => {
            if (expected[i] === undefined) return;
            assert.equal(legacy[site](item, item.type), expected[i], `${site} / ${key}`);
        });
    }
});

test('itemSubtitle reproduces every list through its SUBTITLE_STYLE (minus the three corrected bugs)', () => {
    for (const [key, ...expected] of TABLE) {
        const item = I[key];
        SITES.forEach((site, i) => {
            if (expected[i] === undefined) return;
            assert.equal(itemSubtitle(item, item.type, SUBTITLE_STYLE[site]), corrected(site, item, expected[i]), `${site} / ${key}`);
        });
    }
});

// Every combination of the fields each type really carries, against the
// legacy rule of every list that shows that type.
function* variants() {
    const owners = [undefined, { display_name: 'O' }, { display_name: '' }, { display_name: null }, { name: 'N' }, { display_name: 'O', name: 'N' }];
    const descriptions = [undefined, '', 'D'];
    const artistLists = [undefined, [], [X], [X, Y], [{ name: '' }]];
    const dates = [undefined, '', '2021-03-04', '1987'];
    const subtitles = [undefined, '', 'Sub'];
    for (const owner of owners) for (const description of descriptions) for (const subtitle of subtitles)
        yield { type: 'playlist', name: 'P', ...(owner && { owner }), ...(description !== undefined && { description }), ...(subtitle !== undefined && { subtitle }) };
    for (const artists of artistLists) for (const release_date of dates) for (const subtitle of subtitles)
        yield { type: 'album', name: 'A', ...(artists && { artists }), ...(release_date !== undefined && { release_date }), ...(subtitle !== undefined && { subtitle }) };
    for (const artists of artistLists) for (const subtitle of subtitles)
        yield { type: 'track', name: 'T', ...(artists && { artists }), ...(subtitle !== undefined && { subtitle }) };
    for (const subtitle of subtitles) yield { type: 'artist', name: 'Z', ...(subtitle !== undefined && { subtitle }) };
}
const SHOWS = {
    library: ['playlist', 'album', 'artist'],
    search: ['track', 'playlist', 'album', 'artist'],
    section: ['playlist', 'album', 'artist'],
    mediaRow: ['playlist', 'album', 'artist', 'track'],
    card: ['playlist', 'album', 'artist', 'track'],
};

test('itemSubtitle matches each legacy rule on every realistic field combination (minus the three corrected bugs)', () => {
    let checked = 0;
    for (const item of variants()) {
        for (const site of SITES) {
            if (!SHOWS[site].includes(item.type)) continue;
            assert.equal(itemSubtitle(item, item.type, SUBTITLE_STYLE[site]), corrected(site, item, legacy[site](item, item.type)),
                `${site}: ${JSON.stringify(item)}`);
            checked++;
        }
    }
    assert.ok(checked > 500, `checked ${checked}`);
});

test('the base rule (no options): owner, artists, or "Artist"', () => {
    assert.equal(itemSubtitle(I.playlist, 'playlist'), 'Someone');
    assert.equal(itemSubtitle(I.album, 'album'), 'X, Y');
    assert.equal(itemSubtitle(I.track, 'track'), 'X, Y');
    assert.equal(itemSubtitle(I.artist, 'artist'), 'Artist');
    assert.equal(itemSubtitle(I.albumBare, 'album'), '');
    assert.equal(itemSubtitle(null, 'album'), '');
    // type defaults to item.type
    assert.equal(itemSubtitle(I.album), 'X, Y');
    // a precomputed subtitle is ignored unless asked for
    assert.equal(itemSubtitle(I.pinnedPlaylist, 'playlist'), '');
});

test('each option on its own', () => {
    assert.equal(itemSubtitle(I.album, 'album', { typeLabel: true }), 'Album • X, Y');
    assert.equal(itemSubtitle(I.album, 'album', { typeLabel: true, year: 'lead' }), 'Album • 2020 • X, Y');
    assert.equal(itemSubtitle(I.album, 'album', { year: 'trail' }), 'X, Y • 2020');
    assert.equal(itemSubtitle(I.albumNoArtists, 'album', { year: 'fallback' }), '2020');
    assert.equal(itemSubtitle(I.albumBare, 'album', { year: 'fallback' }), 'Album');
    assert.equal(itemSubtitle(I.albumBare, 'album', { unknownArtist: 'Unknown Artist' }), 'Unknown Artist');
    assert.equal(itemSubtitle(I.playlist, 'playlist', { byOwner: true }), 'By Someone');
    assert.equal(itemSubtitle(I.playlist, 'playlist', { typeLabel: true }), 'Playlist • Someone');
    assert.equal(itemSubtitle(I.playlistBare, 'playlist', { typeLabel: true, ownerFallback: 'Spotify' }), 'Playlist • Spotify');
    assert.equal(itemSubtitle(I.playlistOwnerAltName, 'playlist', { ownerAltName: true }), 'Alt');
    assert.equal(itemSubtitle(I.playlistNoOwner, 'playlist', { description: true }), 'A description');
    assert.equal(itemSubtitle(I.track, 'track', { typeLabel: true }), 'Song • X, Y');
    assert.equal(itemSubtitle(I.pinnedPlaylist, 'playlist', { preset: true }), 'By Spotify');
});

test('SUBTITLE_STYLE presets are frozen', () => {
    assert.ok(Object.isFrozen(SUBTITLE_STYLE));
    for (const site of SITES) assert.ok(Object.isFrozen(SUBTITLE_STYLE[site]), site);
});
