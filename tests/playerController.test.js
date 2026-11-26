import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController } from '../components/controllers/player-controller.js';

const ENTITY = 'media_player.spotifyplus';
const SONOS_ENTITY = 'media_player.sonos_kitchen';
const T0 = 1_700_000_000_000;

// Tracks carry no artwork on purpose: _preloadNeighborArt() does `new Image()`
// for a neighbour with art, and there is no Image under node.
const track = (n) => ({ id: `id${n}`, uri: `spotify:track:id${n}`, name: `Song ${n}`, artists: [{ name: 'Artist' }] });

/** A SpotifyPlus entity state. `last_updated` is "now" so position extrapolates from here. */
function playerState({ n = 0, position = 10, duration = 200, state = 'playing', ...attrs } = {}) {
    return {
        state,
        last_updated: new Date(Date.now()).toISOString(),
        attributes: {
            media_content_id: `spotify:track:id${n}`,
            media_title: `Song ${n}`,
            media_artist: 'Artist',
            media_position: position,
            media_duration: duration,
            volume_level: 0.5,
            source: 'Office',
            ...attrs,
        },
    };
}

const hassWith = (stateObj, extra = {}) => ({ states: { [ENTITY]: stateObj, ...extra } });

/** Let every pending promise chain (the stubbed service calls) run to completion. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A controller on fake timers + a fake clock, with a stub api whose queue /
 * recents responses the test can swap. `calls` counts service calls by name.
 */
function setup(t) {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 });
    const calls = {};
    const api = {
        queue: [track(1), track(2), track(3)],
        recent: [{ track: track(9) }],
        liked: false,
        fetchSpotifyPlus: async (service) => {
            calls[service] = (calls[service] || 0) + 1;
            if (service === 'get_player_queue_info') return { result: { queue: api.queue } };
            if (service === 'get_player_recent_tracks') return { result: { items: api.recent } };
            return { success: true };
        },
        checkTrackFavorites: async () => api.liked,
        saveTrackFavorites: async () => { api.liked = true; },
        removeTrackFavorites: async () => { api.liked = false; },
        playMedia: async () => ({ success: true }),
        triggerScan() {},
    };
    const ctrl = new PlayerController(api);
    ctrl.updateConfig({ entity: ENTITY });
    const events = [];
    ctrl.addEventListener('state-changed', (e) => events.push(e.detail));
    t.after(() => { ctrl.destroy(); mock.timers.reset(); });
    return { ctrl, api, calls, events };
}

/** setup() + a first hass update, settled: track 0 playing, queue [1,2,3] loaded. */
async function started(t, stateOpts) {
    const ctx = setup(t);
    ctx.ctrl.updateHass(hassWith(playerState(stateOpts)));
    await settle();
    ctx.events.length = 0;
    return ctx;
}

const queueCalls = (calls) => calls.get_player_queue_info || 0;

/* ---- state-changed: one fresh object per real change, none otherwise ---- */

test('a queue-only refresh dispatches exactly one state-changed with a new state object', async (t) => {
    const { ctrl, api, events } = await started(t);
    const before = ctrl.state;
    assert.deepEqual(before.queue.map(q => q.id), ['id1', 'id2', 'id3']);

    api.queue = [track(2), track(3), track(4)];
    await ctrl.refreshQueue();

    assert.equal(events.length, 1);
    assert.notEqual(events[0], before, 'detail is a new object, so an identity check sees the change');
    assert.equal(events[0], ctrl.state);
    assert.equal(events[0].queue, api.queue);
    assert.equal(events[0].track, before.track, 'nothing else changed');
});

test('a recents-only refresh dispatches one state-changed with a new state object', async (t) => {
    const { ctrl, api, events } = await started(t);
    const before = ctrl.state;

    api.recent = [{ track: track(8) }, { track: track(9) }];
    await ctrl.refreshRecent();

    assert.equal(events.length, 1);
    assert.notEqual(events[0], before);
    assert.equal(events[0].recentTracks, api.recent);
});

test('a hass update that changes nothing relevant dispatches nothing', async (t) => {
    const { ctrl, calls, events } = await started(t);
    const before = ctrl.state;
    const fetched = queueCalls(calls);
    const same = ctrl.hass.states[ENTITY];

    // Another entity changed: new hass object, same player state object.
    ctrl.updateHass(hassWith(same, { 'light.kitchen': { state: 'on', attributes: {} } }));
    // The player entity was re-posted with identical content.
    ctrl.updateHass(hassWith({ ...same, attributes: { ...same.attributes } }));
    await settle();

    assert.equal(events.length, 0);
    assert.equal(ctrl.state, before, 'state object is kept when nothing changed');
    assert.equal(queueCalls(calls), fetched, 'and no queue refresh was triggered');
});

test('a hass update that changes a rendered field dispatches one fresh object', async (t) => {
    const { ctrl, events } = await started(t);
    const before = ctrl.state;

    ctrl.updateHass(hassWith(playerState({ volume_level: 0.8 })));

    assert.equal(events.length, 1);
    assert.notEqual(events[0], before);
    assert.equal(events[0].volume, 80);
    assert.equal(before.volume, 50);
    assert.equal(events[0].queue, before.queue, 'queue carries over by reference');
});

test('a like check that confirms the current value dispatches nothing; a toggle dispatches', async (t) => {
    const { ctrl, events } = await started(t);
    const before = ctrl.state;

    await ctrl.checkTrackFavorites('id0');
    assert.equal(events.length, 0);

    await ctrl.toggleLike();
    await settle(); // the follow-up check agrees with the optimistic flip
    assert.equal(events.length, 1);
    assert.notEqual(events[0], before);
    assert.equal(events[0].isLiked, true);
    assert.equal(before.isLiked, false);
});

/* ---- snapshots handed to listeners are never edited afterwards ---- */

test('a state snapshot is not mutated by later refreshes or optimistic actions', async (t) => {
    const { ctrl, api } = await started(t);
    const snap = ctrl.state;
    const frozen = structuredClone(snap);
    const unchanged = (step) => assert.deepEqual(snap, frozen, `snapshot changed after ${step}`);

    api.queue = [track(2), track(3), track(4), track(5)];
    await ctrl.refreshQueue();
    unchanged('refreshQueue');

    api.recent = [{ track: track(7) }];
    await ctrl.refreshRecent();
    unchanged('refreshRecent');

    await ctrl.toggleLike();
    unchanged('toggleLike');

    await ctrl.playTrackFromQueue(ctrl.state.queue[1]);
    unchanged('playTrackFromQueue');

    await ctrl.skipNext();
    unchanged('skipNext');

    assert.notEqual(ctrl.state, snap);
    assert.deepEqual(snap.queue.map(q => q.id), ['id1', 'id2', 'id3']);
});

test('playTrackFromQueue trims the queue in a new state and the safety timer restores the backup', async (t) => {
    const { ctrl, events } = await started(t);
    const before = ctrl.state;

    await ctrl.playTrackFromQueue(before.queue[1]);

    assert.equal(events.length, 1);
    const trimmed = events[0];
    assert.notEqual(trimmed, before);
    assert.deepEqual(trimmed.queue.map(q => q.id), ['id3']);
    assert.deepEqual(before.queue.map(q => q.id), ['id1', 'id2', 'id3'], 'previous snapshot keeps its queue');

    // HASS never confirms the jump: after 8s the optimistic state is reverted.
    mock.timers.tick(8000);

    assert.equal(events.length, 2);
    assert.notEqual(events[1], trimmed);
    assert.deepEqual(events[1].queue.map(q => q.id), ['id1', 'id2', 'id3']);
    assert.deepEqual(trimmed.queue.map(q => q.id), ['id3'], 'the trimmed snapshot is not edited by the revert');
    assert.equal(ctrl._queueBackup, null);
});

test('playing a track that is not in the queue leaves state alone and dispatches nothing', async (t) => {
    const { ctrl, events } = await started(t);
    const before = ctrl.state;

    await ctrl.playTrackFromQueue(track(42));
    mock.timers.tick(8000);

    assert.equal(events.length, 0);
    assert.equal(ctrl.state, before);
});

test('skipNext / skipPrev each dispatch one fresh optimistic state', async (t) => {
    const { ctrl, events } = await started(t);
    const before = ctrl.state;

    await ctrl.skipNext();
    assert.equal(events.length, 1);
    assert.equal(events[0].track.id, 'id1');
    assert.deepEqual(events[0].queue.map(q => q.id), ['id2', 'id3']);
    assert.equal(events[0].recentTracks[0].track, before.track);
    assert.equal(before.track.id, 'id0');
    assert.equal(before.queue.length, 3);

    const afterNext = ctrl.state;
    await ctrl.skipPrev();
    assert.equal(events.length, 2);
    assert.equal(events[1].track.id, 'id0');
    assert.deepEqual(events[1].queue.map(q => q.id), ['id1', 'id2', 'id3']);
    assert.equal(afterNext.track.id, 'id1');
    assert.deepEqual(afterNext.queue.map(q => q.id), ['id2', 'id3']);
});

test('Sonos queue refresh dispatches the upcoming slice, then once more when art arrives', async (t) => {
    const { ctrl, api, events } = setup(t);
    const full = [track(0), track(1), track(2)];
    ctrl.setSonosBridge({
        activeTarget: () => ({ isSonos: true, entity: SONOS_ENTITY }),
        getQueue: async () => full,
        log() {},
    });
    const sonosState = { ...playerState(), attributes: { ...playerState().attributes, queue_position: 0 } };
    ctrl.updateHass(hassWith(playerState(), { [SONOS_ENTITY]: sonosState }));
    await settle();
    assert.deepEqual(ctrl.state.queue.map(q => q.id), ['id1', 'id2']);
    assert.equal(ctrl._sonosQueueBase, 1);

    events.length = 0;
    const before = ctrl.state;
    api.getTrackArt = async (id) => `https://img.test/${id}`;
    await ctrl.refreshQueue();
    await settle();

    assert.equal(events.length, 2);
    assert.notEqual(events[0], before);
    assert.notEqual(events[1], events[0]);
    assert.notEqual(events[1].queue, events[0].queue, 'art arrival is announced with a new queue array');
    assert.equal(events[1].queue[0].album.images[0].url, 'https://img.test/id1');
});

/* ---- end-of-track refresh: once per track, not a 300ms loop ---- */

test('past the end of an unchanged track, the end-of-track refresh fires once and then stays quiet', async (t) => {
    // Position already at the duration: HASS still says "playing" on this track.
    const { ctrl, calls } = await started(t, { position: 200, duration: 200 });
    assert.equal(queueCalls(calls), 1, 'the initial track-change refresh');

    mock.timers.tick(300);
    await settle();
    assert.equal(queueCalls(calls), 2, 'the end-of-track refresh');

    // Each completed refresh re-enters _resyncEOSTimer; it must not re-arm.
    for (let i = 0; i < 20; i++) {
        mock.timers.tick(300);
        await settle();
    }
    assert.equal(queueCalls(calls), 2);
    assert.equal(ctrl._eosTimer, null, 'no end-of-track timer is pending');

    // Unrelated hass ticks while still past the end don't re-arm it either.
    for (let i = 0; i < 5; i++) {
        ctrl.updateHass(hassWith(ctrl.hass.states[ENTITY], { 'light.kitchen': { state: String(i), attributes: {} } }));
        mock.timers.tick(300);
        await settle();
    }
    assert.equal(queueCalls(calls), 2);

    // A manual refresh completing doesn't restart the loop.
    await ctrl.refreshQueue();
    mock.timers.tick(5000);
    await settle();
    assert.equal(queueCalls(calls), 3, 'only the manual refresh itself');
});

test('a track that plays through to its end triggers one end-of-track refresh', async (t) => {
    const { calls } = await started(t, { position: 190, duration: 200 });
    assert.equal(queueCalls(calls), 1);

    mock.timers.tick(10_299);
    await settle();
    assert.equal(queueCalls(calls), 1, 'not before end + 300ms');

    mock.timers.tick(1);
    await settle();
    assert.equal(queueCalls(calls), 2);

    mock.timers.tick(60_000);
    await settle();
    assert.equal(queueCalls(calls), 2);
});

test('the end-of-track latch re-arms when the track id changes', async (t) => {
    const { ctrl, calls } = await started(t, { position: 200, duration: 200 });
    mock.timers.tick(300);
    await settle();
    assert.equal(queueCalls(calls), 2);
    assert.equal(ctrl._eosFiredFor, 'spotify:track:id0');

    // The integration posts the next track.
    ctrl.updateHass(hassWith(playerState({ n: 1, position: 0, duration: 180 })));
    assert.equal(ctrl._eosFiredFor, null, 're-armed for the new track');
    mock.timers.tick(1000); // debounced track-change refresh
    await settle();
    assert.equal(queueCalls(calls), 3);

    mock.timers.tick(179_300); // new track reaches its end + 300ms
    await settle();
    assert.equal(queueCalls(calls), 4, 'end-of-track refresh for the new track');

    mock.timers.tick(60_000);
    await settle();
    assert.equal(queueCalls(calls), 4, 'and again only once');
});

test('the end-of-track latch re-arms when the same track moves back before its end', async (t) => {
    const { ctrl, calls } = await started(t, { position: 200, duration: 200 });
    mock.timers.tick(300);
    await settle();
    assert.equal(queueCalls(calls), 2);

    // Seek / repeat-one restart: same track id, position back at 150s.
    ctrl.updateHass(hassWith(playerState({ position: 150, duration: 200 })));
    await settle();
    assert.equal(queueCalls(calls), 2, 'same track id, so no track-change refresh');

    mock.timers.tick(50_300);
    await settle();
    assert.equal(queueCalls(calls), 3, 'one more end-of-track refresh');

    mock.timers.tick(60_000);
    await settle();
    assert.equal(queueCalls(calls), 3);
});
