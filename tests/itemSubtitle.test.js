import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/lit-env.js';
import { itemSubtitle, SUBTITLE_STYLE } from '../src/components/media-templates.js';

// The line under an item's name: one rule, three wordings (owner's decision
// D1, 2026-11-26).
//   list         Library, Search, "See All": "Playlist • Owner", "Album • Artists",
//                "Song • Artists", "Artist"; no year.
//   card         Home cards: just the owner / artists, "Artist"; a pinned
//                item's own subtitle wins.
//   discography  "<year> • <Album|Single|Compilation>".

const X = { id: 'x', name: 'X' }, Y = { id: 'y', name: 'Y' };
const I = {
    playlist: { type: 'playlist', name: 'P', owner: { id: 'u1', display_name: 'Someone' }, description: 'desc' },
    playlistOwnerBothNames: { type: 'playlist', name: 'P', owner: { display_name: 'Shown', name: 'Alt' } },
    playlistOwnerAltName: { type: 'playlist', name: 'P', owner: { id: 'u3', name: 'Alt' } },
    playlistOwnerNullName: { type: 'playlist', name: 'P', owner: { id: 'u2', display_name: null } },
    playlistOwnerEmptyName: { type: 'playlist', name: 'P', owner: { id: 'u2', display_name: '' } },
    playlistNoOwner: { type: 'playlist', name: 'P', description: 'A description' },
    playlistBare: { type: 'playlist', name: 'P' },
    playlistPinned: { type: 'playlist', name: 'P', subtitle: 'By Spotify' },
    playlistPinnedEmpty: { type: 'playlist', name: 'P', subtitle: '' },
    album: { type: 'album', name: 'A', album_type: 'album', artists: [X, Y], release_date: '2020-05-01' },
    single: { type: 'album', name: 'A', album_type: 'single', artists: [X], release_date: '2015-03-02' },
    compilation: { type: 'album', name: 'A', album_type: 'compilation', artists: [X], release_date: '1999' },
    albumNoType: { type: 'album', name: 'A', artists: [X], release_date: '2020-05-01' },
    albumEmptyType: { type: 'album', name: 'A', album_type: '', artists: [X], release_date: '2020-05-01' },
    singleNoDate: { type: 'album', name: 'A', album_type: 'single', artists: [X] },
    albumEmptyDate: { type: 'album', name: 'A', album_type: 'album', artists: [X], release_date: '' },
    albumNoArtists: { type: 'album', name: 'A', album_type: 'album', release_date: '2020-05-01' },
    albumNullArtists: { type: 'album', name: 'A', artists: null, release_date: '2020-05-01' },
    albumEmptyArtists: { type: 'album', name: 'A', artists: [], release_date: '2020-05-01' },
    albumBlankArtists: { type: 'album', name: 'A', artists: [{ name: '' }, {}], release_date: '2020-05-01' },
    albumSomeBlankArtists: { type: 'album', name: 'A', artists: [X, { name: '' }, Y], release_date: '2020-05-01' },
    albumBare: { type: 'album', name: 'A' },
    albumPinned: { type: 'album', name: 'A', album_type: 'single', artists: [X], release_date: '2020-05-01', subtitle: 'Pinned sub' },
    artist: { type: 'artist', name: 'Z' },
    artistPinned: { type: 'artist', name: 'Z', subtitle: 'Artist' },
    artistPinnedEmpty: { type: 'artist', name: 'Z', subtitle: '' },
    track: { type: 'track', name: 'T', artists: [X, Y], album: { name: 'Al' } },
    trackNoArtists: { type: 'track', name: 'T' },
    trackEmptyArtists: { type: 'track', name: 'T', artists: [] },
    trackBlankArtists: { type: 'track', name: 'T', artists: [{ name: '' }] },
    trackPinned: { type: 'track', name: 'T', artists: [X], subtitle: 'X • Al' },
    likedSongs: { type: 'library', name: 'User Library', subtitle: 'Your collection & liked songs' },
};

// [item, list, card, discography]
const TABLE = [
    ['playlist', 'Playlist • Someone', 'Someone', 'Playlist • Someone'],
    ['playlistOwnerBothNames', 'Playlist • Shown', 'Shown', 'Playlist • Shown'],
    ['playlistOwnerAltName', 'Playlist • Alt', 'Alt', 'Playlist • Alt'],
    ['playlistOwnerNullName', 'Playlist • Spotify', '', 'Playlist • Spotify'],
    ['playlistOwnerEmptyName', 'Playlist • Spotify', '', 'Playlist • Spotify'],
    // The description is never the subtitle.
    ['playlistNoOwner', 'Playlist • Spotify', '', 'Playlist • Spotify'],
    ['playlistBare', 'Playlist • Spotify', '', 'Playlist • Spotify'],
    // A pinned item's own subtitle counts on Home only.
    ['playlistPinned', 'Playlist • Spotify', 'By Spotify', 'Playlist • Spotify'],
    ['playlistPinnedEmpty', 'Playlist • Spotify', '', 'Playlist • Spotify'],
    ['album', 'Album • X, Y', 'X, Y', '2020 • Album'],
    ['single', 'Album • X', 'X', '2015 • Single'],
    ['compilation', 'Album • X', 'X', '1999 • Compilation'],
    ['albumNoType', 'Album • X', 'X', '2020 • Album'],
    ['albumEmptyType', 'Album • X', 'X', '2020 • Album'],
    ['singleNoDate', 'Album • X', 'X', 'Single'],
    ['albumEmptyDate', 'Album • X', 'X', 'Album'],
    ['albumNoArtists', 'Album', '', '2020 • Album'],
    ['albumNullArtists', 'Album', '', '2020 • Album'],
    ['albumEmptyArtists', 'Album', '', '2020 • Album'],
    ['albumBlankArtists', 'Album', '', '2020 • Album'],
    ['albumSomeBlankArtists', 'Album • X, Y', 'X, Y', '2020 • Album'],
    ['albumBare', 'Album', '', 'Album'],
    ['albumPinned', 'Album • X', 'Pinned sub', '2020 • Single'],
    ['artist', 'Artist', 'Artist', 'Artist'],
    ['artistPinned', 'Artist', 'Artist', 'Artist'],
    ['artistPinnedEmpty', 'Artist', 'Artist', 'Artist'],
    ['track', 'Song • X, Y', 'X, Y', 'Song • X, Y'],
    ['trackNoArtists', 'Song', '', 'Song'],
    ['trackEmptyArtists', 'Song', '', 'Song'],
    ['trackBlankArtists', 'Song', '', 'Song'],
    ['trackPinned', 'Song • X', 'X • Al', 'Song • X'],
    // Liked Songs (pinned, type 'library'): only Home shows it, with its own line.
    ['likedSongs', '', 'Your collection & liked songs', ''],
];
const STYLES = ['list', 'card', 'discography'];

test('every type in every style, with the edge cases', () => {
    for (const [key, ...expected] of TABLE) {
        const item = I[key];
        STYLES.forEach((style, i) => {
            assert.equal(itemSubtitle(item, item.type, SUBTITLE_STYLE[style]), expected[i], `${style} / ${key}`);
        });
    }
});

test('three wordings, no aliases; the styles are frozen', () => {
    assert.ok(Object.isFrozen(SUBTITLE_STYLE));
    assert.deepEqual(Object.keys(SUBTITLE_STYLE).sort(), ['card', 'discography', 'list']);
});

test('defaults: the list wording, type from item.type; no item, no subtitle', () => {
    assert.equal(itemSubtitle(I.album), 'Album • X, Y');
    assert.equal(itemSubtitle(I.album, 'album'), 'Album • X, Y');
    assert.equal(itemSubtitle(I.playlistPinned, 'playlist'), 'Playlist • Spotify');
    // An unknown style reads as a list.
    assert.equal(itemSubtitle(I.track, 'track', 'nope'), 'Song • X, Y');
    assert.equal(itemSubtitle(null, 'album'), '');
    assert.equal(itemSubtitle(undefined), '');
});

test('the type argument wins over item.type (lists pass the filter or section type)', () => {
    const typeless = { name: 'A', artists: [X], release_date: '2020-05-01', album_type: 'single', owner: { display_name: 'O' } };
    assert.equal(itemSubtitle(typeless, 'album', SUBTITLE_STYLE.list), 'Album • X');
    assert.equal(itemSubtitle(typeless, 'album', SUBTITLE_STYLE.discography), '2020 • Single');
    assert.equal(itemSubtitle(typeless, 'playlist', SUBTITLE_STYLE.card), 'O');
    assert.equal(itemSubtitle(typeless, 'artist', SUBTITLE_STYLE.list), 'Artist');
    // A type with no label (none of the lists shows one): just who.
    assert.equal(itemSubtitle(typeless, 'show', SUBTITLE_STYLE.list), 'X');
});
