import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listeners } from './helpers/lit-env.js';
import { trackMenuDetail, openTrackMenu } from '../components/track-menu.js';
import { renderTrackRowTemplate } from '../components/media-templates.js';
import { getItemImage, pickImage, IMG_THUMB } from '../utils.js';

const images = [640, 300, 64].map(w => ({ url: `https://img.test/${w}/al.png`, width: w, height: w }));
const TRACK = { id: 't1', uri: 'spotify:track:t1', name: 'Song', type: 'track', artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'Album', images } };
const THUMB = pickImage(images, IMG_THUMB);
const RECT = { x: 10, y: 20, width: 36, height: 36, top: 20, left: 10, right: 46, bottom: 56 };
const button = () => ({ getBoundingClientRect: () => RECT });
const fakeEvent = () => ({ currentTarget: button(), stopPropagation() {}, preventDefault() {} });

// The open-track-menu payloads as each surface built them by hand before
// track-menu.js (copied verbatim; `this` became parameters).
const legacy = {
    // components/players/sidebar/queue.js and components/players/queue-panel.js (identical)
    queue: (e, track, playerController) => ({
        name: track?.name,
        artist: track?.artists?.map(a => a.name).join(', ') || '',
        album: track?.album?.name || '',
        uri: track?.uri,
        id: track?.id,
        image: track?.album?.images?.[0]?.url,
        anchor: e.currentTarget.getBoundingClientRect(),
        context: { surface: 'queue', sourceUri: playerController?.sourceContextUri() || null }
    }),
    // components/players/now-playing-mobile.js — _openMenu (np = NowPlayingController)
    nowPlaying: (track, np) => ({
        name: track.name,
        artist: np.artistLine,
        album: track.album?.name || '',
        uri: track.uri,
        id: track.id,
        image: track.album?.images?.[0]?.url,
        context: { surface: 'nowplaying', sourceUri: np.contextUri }
    }),
    // components/spotify-search.js — _trackMenu
    search: (e, item) => ({
        name: item.name,
        artist: item.artists?.map(a => a.name).join(', ') || '',
        album: item.album?.name || '',
        uri: item.uri,
        id: item.id,
        image: getItemImage(item, 'track', IMG_THUMB),
        anchor: e.currentTarget.getBoundingClientRect(),
    }),
    // components/media-templates.js — renderTrackRowTemplate's trackData
    trackRow: (track) => {
        const artistNames = track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown';
        const image = track.album?.images?.[0]?.url;
        return { name: track.name, artist: artistNames, album: track.album?.name || '', uri: track.uri, id: track.id, image };
    },
};

const npFor = (track) => ({ artistLine: track?.artists?.map(a => a.name).join(', ') || '', contextUri: 'spotify:playlist:p1' });
const playerController = { sourceContextUri: () => 'spotify:album:al1' };
const swapImage = (payload, image) => ({ ...payload, image });

/** Dispatches through openTrackMenu and returns the event it sent. */
function capture(track, options) {
    const host = new EventTarget();
    let event = null;
    host.addEventListener('open-track-menu', (e) => { event = e; });
    openTrackMenu(host, track, options);
    return event;
}

const TRACKS = {
    full: TRACK,
    noArtists: { ...TRACK, artists: undefined },
    emptyArtists: { ...TRACK, artists: [] },
    noAlbum: { id: 't2', uri: 'spotify:track:t2', name: 'Bare' },
    hassTrack: { ...TRACK, album: { name: 'Album', images: [{ url: 'https://ha/entity_picture' }] } },
};

test('queue rows (sidebar + mobile panel): same payload, image now the thumb', () => {
    for (const [k, track] of Object.entries(TRACKS)) {
        const e = fakeEvent();
        const ev = capture(track, { anchorEl: e.currentTarget, context: { surface: 'queue', sourceUri: playerController.sourceContextUri() || null } });
        const want = swapImage(legacy.queue(e, track, playerController), pickImage(track.album?.images, IMG_THUMB));
        assert.deepEqual(ev.detail, want, k);
        assert.deepEqual(Object.keys(ev.detail), Object.keys(want), `${k}: key order`);
    }
});

test('now playing: no anchor (bottom sheet), nowplaying context', () => {
    for (const [k, track] of Object.entries(TRACKS)) {
        const np = npFor(track);
        const ev = capture(track, { context: { surface: 'nowplaying', sourceUri: np.contextUri } });
        const want = swapImage(legacy.nowPlaying(track, np), pickImage(track.album?.images, IMG_THUMB));
        assert.deepEqual(ev.detail, want, k);
        assert.equal('anchor' in ev.detail, false, k);
    }
});

test('search: payload identical, image included (it already used the thumb)', () => {
    for (const [k, track] of Object.entries(TRACKS)) {
        const e = fakeEvent();
        const ev = capture(track, { anchorEl: e.currentTarget });
        assert.deepEqual(ev.detail, legacy.search(e, track), k);
    }
});

test('the event bubbles out of shadow roots', () => {
    const ev = capture(TRACK, {});
    assert.equal(ev.type, 'open-track-menu');
    assert.equal(ev.bubbles, true);
    assert.equal(ev.composed, true);
});

test('trackMenuDetail: fields, thumb-size image, extras merged last', () => {
    assert.deepEqual(trackMenuDetail(TRACK), {
        name: 'Song', artist: 'A, B', album: 'Album', uri: 'spotify:track:t1', id: 't1', image: THUMB,
    });
    assert.equal(THUMB, 'https://img.test/64/al.png');
    assert.equal(trackMenuDetail(TRACK, { artist: 'Unknown' }).artist, 'Unknown');
    assert.deepEqual(trackMenuDetail(null), { name: undefined, artist: '', album: '', uri: undefined, id: undefined, image: '' });
    // Art without sizes (Home Assistant's entity_picture) is used as is.
    assert.equal(trackMenuDetail(TRACKS.hassTrack).image, 'https://ha/entity_picture');
});

test("renderTrackRowTemplate's menu payload: same fields, image now the thumb", () => {
    for (const [k, track] of Object.entries(TRACKS)) {
        for (const layout of [undefined, 'playlist']) {
            let got = null;
            const tpl = renderTrackRowTemplate(track, 1, null, { layout, onMenu: (e, data) => { got = data; } });
            for (const fn of listeners(tpl)) fn(fakeEvent());
            const want = swapImage(legacy.trackRow(track), pickImage(track.album?.images, IMG_THUMB));
            assert.deepEqual(got, want, `${k} / ${layout}`);
            assert.deepEqual(Object.keys(got), Object.keys(want), `${k} / ${layout}: key order`);
        }
    }
});
