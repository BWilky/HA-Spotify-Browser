import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OptimisticPlaybackController, HOLD_MS, TRACK_HOLD_MS } from '../components/controllers/optimistic-playback-controller.js';

function setup(t, { context = { uri: 'spotify:playlist:p', type: 'playlist' } } = {}) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const api = {
        playMedia: async (uri, type) => { calls.push(['playMedia', uri, type]); },
        togglePlayback: async (play) => { calls.push(['togglePlayback', play]); },
    };
    const host = {
        isPlaying: false,
        playingTrackId: null,
        currentTrackId: null,
        api,
        context,
        updates: 0,
        controllers: [],
        addController(c) { this.controllers.push(c); },
        requestUpdate() { this.updates++; },
    };
    const pb = new OptimisticPlaybackController(host, {
        getApi: () => host.api,
        getContext: () => host.context,
    });
    // A host update after the parent set new values (what Lit does).
    const report = (patch) => { Object.assign(host, patch); pb.hostUpdated(); };
    pb.hostUpdated(); // first render
    return { pb, host, calls, report, tick: (ms) => t.mock.timers.tick(ms) };
}

test('registers with the host', (t) => {
    const { pb, host } = setup(t);
    assert.equal(host.controllers[0], pb);
});

test('without optimistic state the reported values apply', (t) => {
    const { pb, host } = setup(t);
    assert.equal(pb.isPlaying, false);
    assert.equal(pb.playingTrackId, null);
    host.isPlaying = true;
    host.playingTrackId = 't1';
    assert.equal(pb.isPlaying, true);
    assert.equal(pb.playingTrackId, 't1');
    host.playingTrackId = '';
    assert.equal(pb.playingTrackId, null, 'falsy -> null');
});

test('hold: the optimistic state wins for 3 s, restarted by each hold', (t) => {
    const { pb, host, tick } = setup(t);
    host.isPlaying = true;
    pb.hold('paused');
    assert.equal(pb.isPlaying, false);
    assert.equal(pb.playState, 'paused');
    tick(2000);
    pb.hold('paused'); // same value: no re-render, but the hold restarts
    assert.equal(host.updates, 1);
    tick(2000);
    assert.equal(pb.playState, 'paused');
    tick(1000);
    assert.equal(pb.playState, null);
    assert.equal(pb.isPlaying, true);
    assert.equal(host.updates, 2);
});

test('heroClick: plays the context when stopped, pauses when playing, optimistic either way', async (t) => {
    const { pb, host, calls, tick } = setup(t);
    pb.heroClick();
    assert.equal(pb.isPlaying, true);
    assert.deepEqual(calls, [['playMedia', 'spotify:playlist:p', 'playlist']]);
    pb.heroClick(); // the optimistic 'playing' decides: pause
    assert.equal(pb.isPlaying, false);
    assert.deepEqual(calls[1], ['togglePlayback', false]);
    tick(HOLD_MS);
    host.isPlaying = true;
    pb.heroClick();
    assert.deepEqual(calls[2], ['togglePlayback', false]);
    assert.equal(pb.playState, 'paused');
});

test('playContext: reads the context at call time; nothing without uri or api', async (t) => {
    const { pb, host, calls } = setup(t, { context: { uri: 'spotify:artist:a', type: 'artist' } });
    await pb.playContext();
    host.context = { uri: '', type: 'artist' };
    await pb.playContext();
    host.context = { uri: 'spotify:artist:b', type: 'artist' };
    host.api = null;
    await pb.playContext();
    assert.deepEqual(calls, [['playMedia', 'spotify:artist:a', 'artist']]);
});

test('startTrack: highlights the row until HASS reports it (handoff)', (t) => {
    const { pb, host, report } = setup(t);
    host.playingTrackId = 'old';
    pb.startTrack('t5');
    assert.equal(pb.playingTrackId, 't5');
    assert.equal(pb.playState, null, 'play state untouched without playing: true');
    report({ currentTrackId: 'between' }); // an intermediate id during the skip
    assert.equal(pb.trackId, 't5');
    report({ currentTrackId: 't5', playingTrackId: 't5' });
    assert.equal(pb.trackId, null);
    assert.equal(pb.playingTrackId, 't5', 'now from the reported value');
});

test('handoff only on a change of the reported track', (t) => {
    const { pb, report } = setup(t);
    report({ currentTrackId: 't5' });
    pb.startTrack('t5');        // already current: nothing will "change" to it
    report({});                 // an unrelated update
    assert.equal(pb.trackId, 't5');
});

test('startTrack: the 8 s safety timer clears the guess (and, with playing: true, the play state)', (t) => {
    const { pb, tick } = setup(t);
    pb.startTrack('a', { playing: true });
    assert.equal(pb.isPlaying, true);
    tick(TRACK_HOLD_MS - 1);
    assert.equal(pb.trackId, 'a');
    tick(1);
    assert.equal(pb.trackId, null);
    assert.equal(pb.playState, null);

    pb.hold('paused');
    pb.startTrack('b');         // without playing: true the state is not touched
    tick(TRACK_HOLD_MS);
    assert.equal(pb.trackId, null);
});

test('a new startTrack restarts the 8 s timer', (t) => {
    const { pb, tick } = setup(t);
    pb.startTrack('a');
    tick(5000);
    pb.startTrack('b');
    tick(5000);
    assert.equal(pb.trackId, 'b');
    tick(3000);
    assert.equal(pb.trackId, null);
});

test('startTrack(playing) does not restart the 3 s hold; the 8 s timer clears the state whatever set it', (t) => {
    const { pb, tick } = setup(t);
    pb.hold('paused');                       // t=0, hold ends at 3 s
    tick(1000);
    pb.startTrack('a', { playing: true });   // t=1 s, track timer at 9 s
    assert.equal(pb.playState, 'playing');
    tick(2000);                              // t=3 s: the hold timer still fires
    assert.equal(pb.playState, null);
    assert.equal(pb.trackId, 'a');
    tick(4000);
    pb.hold('paused');                       // t=7 s
    tick(2000);                              // t=9 s: the track timer clears it
    assert.equal(pb.playState, null);
    assert.equal(pb.trackId, null);
});

test('re-renders only on real changes', (t) => {
    const { pb, host } = setup(t);
    pb.startTrack('a', { playing: true });
    assert.equal(host.updates, 2);
    pb.startTrack('a', { playing: true });
    assert.equal(host.updates, 2);
});

test('disconnect clears both timers and keeps the values', (t) => {
    const { pb, tick } = setup(t);
    pb.hold('paused');
    pb.startTrack('a');
    pb.hostDisconnected();
    tick(TRACK_HOLD_MS * 2);
    assert.equal(pb.playState, 'paused');
    assert.equal(pb.trackId, 'a');
});
