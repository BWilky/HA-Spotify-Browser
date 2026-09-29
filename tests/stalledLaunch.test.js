import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SpotifyApi } from '../api.js';

const ENTITY = 'media_player.test';

// A SpotifyPlus entity that reports "paused" on a device but has no track
// loaded: the stale Connect session Spotify accepts commands for but ignores.
function emptyPausedState() {
    return { state: 'paused', attributes: { source: "Bryce's MacBook Pro", sp_device_id: 'dev1' } };
}

function makeApi(stateObj) {
    const errors = [];
    const notices = [];
    const hass = { states: { [ENTITY]: stateObj }, callService: async () => {} };
    const api = new SpotifyApi(hass, ENTITY, null, null, (m) => notices.push(m), (e) => errors.push(e));
    api.fetchSpotifyPlus = async () => true;  // every service call "succeeds"
    api.triggerScan = () => {};
    return { api, hass, errors, notices };
}

test('playerHasItem is false for a paused player with no track', () => {
    assert.equal(SpotifyApi.playerHasItem(emptyPausedState()), false);
    assert.equal(SpotifyApi.playerHasItem({ state: 'paused', attributes: { media_title: 'Song' } }), true);
    assert.equal(SpotifyApi.playerHasItem({ state: 'playing', attributes: { media_content_id: 'spotify:track:x' } }), true);
    assert.equal(SpotifyApi.playerHasItem(null), false);
});

test('a play that the empty paused device ignores reports a stalled launch and remembers it', async (t) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => mock.timers.reset());
    const { api, errors } = makeApi(emptyPausedState());

    const res = await api.playMedia(['spotify:track:1', 'spotify:track:2'], 'track', null, { shuffle: false });
    assert.equal(res.success, true);
    assert.equal(errors.length, 0, 'nothing reported before the watchdog fires');

    mock.timers.tick(SpotifyApi.STALLED_LAUNCH_MS);

    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'stalled_device');
    assert.match(errors[0].message, /Bryce's MacBook Pro/);
    assert.equal(api.hasPendingPlay(), true, 'the launch is kept for replay on the next device pick');
});

test('no stalled report when the player starts within the window', async (t) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => mock.timers.reset());
    const { api, hass, errors } = makeApi(emptyPausedState());

    await api.playMedia('spotify:track:1', 'track');
    hass.states[ENTITY] = { state: 'playing', attributes: { media_title: 'Song', source: 'X' } };
    mock.timers.tick(SpotifyApi.STALLED_LAUNCH_MS);

    assert.equal(errors.length, 0);
    assert.equal(api.hasPendingPlay(), false);
});

test('picking a device after a stalled launch replays it there instead of a bare transfer', async (t) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => mock.timers.reset());
    const { api } = makeApi(emptyPausedState());
    const calls = [];
    api.fetchSpotifyPlus = async (service, params) => { calls.push({ service, params }); return true; };

    await api.playMedia(['spotify:track:1'], 'track', null, { shuffle: false });
    mock.timers.tick(SpotifyApi.STALLED_LAUNCH_MS);
    calls.length = 0;

    const res = await api.transferPlayback({ id: 'dev2', name: 'Office speaker' });

    assert.equal(res.success, true);
    assert.equal(res.replayed, true);
    assert.equal(calls[0].service, 'player_media_play_tracks');
    assert.equal(calls[0].params.device_id, 'dev2');
    assert.equal(calls[0].params.uris, 'spotify:track:1');
});
