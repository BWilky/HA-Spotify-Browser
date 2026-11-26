// What a failed play call does (B12). The play calls are made with
// throwOnError, so a failure never comes back as a falsy result: it throws,
// executePlay's catch returns { success: false, error } with the error
// itself, and playMedia's own failure handling runs on that. There is no
// play-the-track-alone fallback when a context (or its offset) is rejected:
// its branch tested for a falsy result and so could never run (removed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpotifyApi } from '../src/api.js';

const ENTITY = 'media_player.spotifyplus_test';
const PLAYING = { state: 'playing', attributes: { media_title: 'Song', source: 'Kitchen' } };
const IDLE = { state: 'idle', attributes: {} };

const haError = (message, code = 'home_assistant_error') => Object.assign(new Error(message), { code });

/** A real SpotifyApi whose play services fail with `err`; every HA call is recorded. */
function makeApi(t, { state, err, device = null }) {
    const calls = [];
    const notices = [];
    const reported = [];
    const hass = {
        states: { [ENTITY]: state },
        callWS: async (payload) => { calls.push(['callWS', payload.service, payload.service_data]); throw err; },
        callService: async (domain, service, data) => { calls.push(['callService', domain, service, data]); },
    };
    const resolver = device ? async () => device : null;
    const api = new SpotifyApi(hass, ENTITY, resolver, null, (m) => notices.push(m), (e) => reported.push(e));
    api.triggerScan = () => {};
    const errors = t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'warn', () => {});
    return { api, calls, notices, reported, errors };
}

test('a failed context play with an offset: one call, the error returned as is, no track fallback (active device)', async (t) => {
    const err = haError('Spotify rejected the context');
    const { api, calls, notices, reported, errors } = makeApi(t, { state: PLAYING, err });

    const res = await api.playMedia('spotify:user:u1:collection', 'playlist', null, { offset_uri: 'spotify:track:t1', offset_position: 4 });

    assert.deepEqual(res, { success: false, error: err });
    assert.deepEqual(calls, [['callWS', 'player_media_play_context', {
        entity_id: ENTITY, context_uri: 'spotify:user:u1:collection', offset_uri: 'spotify:track:t1'
    }]]);
    assert.deepEqual(notices, [], 'an active device gets no generic toast');
    assert.deepEqual(reported, [], 'an unclassified error is not reported to onError');
    assert.deepEqual(errors.mock.calls[0].arguments, ['Playback execution failed:', err]);
    assert.equal(api.hasPendingPlay(), false);
});

test('a failed context play on an idle launch: the generic toast, nothing remembered for a replay', async (t) => {
    const err = haError('Spotify rejected the context');
    const { api, calls, notices, reported } = makeApi(t, { state: IDLE, err, device: { id: 'dev1', name: 'Kitchen' } });

    const res = await api.playMedia('spotify:album:al1', 'album', null, { offset_uri: 'spotify:track:t1' });

    assert.deepEqual(res, { success: false, error: err });
    assert.deepEqual(calls.map(c => c[1]), ['player_media_play_context']);
    assert.deepEqual(calls[0][2], { entity_id: ENTITY, context_uri: 'spotify:album:al1', offset_uri: 'spotify:track:t1', device_id: 'dev1' });
    assert.deepEqual(notices, ['Playback failed on Kitchen']);
    assert.deepEqual(reported, []);
    assert.equal(api.hasPendingPlay(), false);
});

test('a context play failing on a device problem: reported once (onError), no generic toast, the launch kept for a replay', async (t) => {
    for (const err of [haError('There is no active Spotify player device'), haError('Validation error: x', 'service_validation_error')]) {
        const { api, calls, notices, reported } = makeApi(t, { state: IDLE, err, device: { id: 'dev1', name: 'Kitchen' } });

        const res = await api.playMedia('spotify:playlist:p1', 'playlist', null, { offset_uri: 'spotify:track:t1' });

        assert.equal(res.success, false);
        assert.equal(res.error, err);
        assert.equal(res.error._sbReported, true);
        assert.deepEqual(calls.map(c => c[1]), ['player_media_play_context'], err.message);
        assert.deepEqual(reported, [err], err.message);
        assert.deepEqual(notices, [], err.message);
        assert.equal(api.hasPendingPlay(), true, err.message);
    }
});

test('Liked Songs and track plays that fail return the error itself (never "Call Failed")', async (t) => {
    for (const [uri, type, service] of [['spotify:collection', 'likedsongs', 'player_media_play_track_favorites'], [['spotify:track:t1'], 'track', 'player_media_play_tracks']]) {
        const err = haError('boom');
        const { api, calls } = makeApi(t, { state: PLAYING, err });
        const res = await api.playMedia(uri, type);
        assert.deepEqual(res, { success: false, error: err }, type);
        assert.deepEqual(calls.map(c => c[1]), [service], type);
    }
});
