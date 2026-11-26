import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController } from '../src/components/controllers/player-controller.js';

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
            return { success: true };
        },
        // SpotifyApi.getRecentTracks: counted as the read it stands for
        // (`since` is recorded; sharing itself is tested in apiReadCache).
        getRecentTracks: async (options) => {
            calls.get_player_recent_tracks = (calls.get_player_recent_tracks || 0) + 1;
            api.recentOptions.push(options);
            return { items: api.recent };  // a ListPage
        },
        recentOptions: [],
        checkTrackFavorites: async () => { calls.check_favorites = (calls.check_favorites || 0) + 1; return api.liked; },
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
const totalCalls = (calls) => Object.values(calls).reduce((sum, n) => sum + n, 0);

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

/* ---- setActive: no automatic network work or timers while nothing is on screen ---- */

test('while inactive, a track change is announced but makes no api calls, preloads no art and arms no timers', async (t) => {
    const { ctrl, api, calls, events } = setup(t);
    const preloads = [];
    globalThis.Image = class { set src(url) { preloads.push(url); } };
    t.after(() => { delete globalThis.Image; });
    const withArt = (n) => ({ ...track(n), album: { images: [{ url: `https://img.test/${n}` }] } });
    api.queue = [withArt(1), withArt(2)];

    ctrl.setActive(false);
    ctrl.updateHass(hassWith(playerState()));
    await settle();

    assert.equal(events.length, 1);
    assert.equal(events[0].track.id, 'id0');
    assert.equal(events[0].isPlaying, true);
    assert.equal(totalCalls(calls), 0);

    // An explicit refresh gives peekNext() art to preload; the next track change must not use it.
    await ctrl.refreshQueue();
    const afterRefresh = totalCalls(calls);
    ctrl.updateHass(hassWith(playerState({ n: 5, position: 0, duration: 100 })));
    await settle();

    assert.equal(ctrl.state.track.id, 'id5');
    assert.equal(ctrl._lastTrackId, 'spotify:track:id5', 'track-change bookkeeping stays current');
    assert.equal(totalCalls(calls), afterRefresh);
    assert.deepEqual(preloads, []);
    assert.equal(ctrl._eosTimer, null);
    assert.ok(!ctrl._refreshTimer);

    mock.timers.tick(600_000); // well past the track end and any debounce
    await settle();
    assert.equal(totalCalls(calls), afterRefresh);
});

test('an explicit refreshQueue / refreshRecent still works while inactive, without chaining further work', async (t) => {
    const { ctrl, api, calls, events } = setup(t);
    ctrl.setActive(false);
    ctrl.updateHass(hassWith(playerState({ position: 200, duration: 200 }))); // already past its end
    await settle();
    events.length = 0;

    await ctrl.refreshQueue();
    await ctrl.refreshRecent();

    assert.equal(events.length, 2);
    assert.equal(events[0].queue, api.queue);
    assert.equal(events[1].recentTracks, api.recent);
    assert.equal(totalCalls(calls), 2);
    assert.equal(ctrl._eosTimer, null, 'the refresh re-enters state sync but arms no end-of-track timer');

    mock.timers.tick(60_000);
    await settle();
    assert.equal(totalCalls(calls), 2);
});

test('setActive(false) cancels an armed end-of-track timer and a pending debounced refresh', async (t) => {
    const { ctrl, calls } = await started(t, { position: 190, duration: 200 });
    ctrl.updateHass(hassWith(playerState({ n: 1, position: 0, duration: 30 }))); // arms the 1s debounce
    await settle();
    assert.ok(ctrl._eosTimer, 'end-of-track timer armed while active');
    assert.ok(ctrl._refreshTimer, 'debounced queue refresh pending while active');
    const before = totalCalls(calls);

    ctrl.setActive(false);

    assert.equal(ctrl._eosTimer, null);
    assert.equal(ctrl._refreshTimer, null);
    mock.timers.tick(600_000);
    await settle();
    assert.equal(totalCalls(calls), before);
});

test('setActive(true) re-checks the like state once, re-arms the end-of-track timer and fetches neither queue nor recents', async (t) => {
    const { ctrl, api, calls, events } = await started(t, { position: 190, duration: 200 });
    ctrl.setActive(false);
    api.liked = true; // liked from another client while nothing was on screen
    const before = { ...calls };
    events.length = 0;

    ctrl.setActive(true);
    await settle();

    assert.equal(calls.check_favorites, before.check_favorites + 1);
    assert.equal(queueCalls(calls), queueCalls(before));
    assert.equal(calls.get_player_recent_tracks, before.get_player_recent_tracks);
    assert.equal(ctrl.state.isLiked, true);
    assert.equal(events.length, 1, 'only the like change is announced');
    assert.ok(ctrl._eosTimer, 'end-of-track timer re-armed from the current hass state');

    mock.timers.tick(10_300);
    await settle();
    assert.equal(queueCalls(calls), queueCalls(before) + 1, 'and it still fires at the end of the track');
});

test('setActive with the current value is a no-op', async (t) => {
    const { ctrl, calls, events } = await started(t);
    const before = totalCalls(calls);

    ctrl.setActive(true);
    await settle();

    assert.equal(totalCalls(calls), before);
    assert.equal(events.length, 0);
});

test('a track that advanced through the queue while inactive is trimmed out of "up next" on return', async (t) => {
    const { ctrl, calls, events } = await started(t);
    ctrl.setActive(false);
    const before = { ...calls };

    // Two tracks later: id2 is playing; the queue [id1, id2, id3] was never re-fetched.
    ctrl.updateHass(hassWith(playerState({ n: 1, position: 0, duration: 100 })));
    ctrl.updateHass(hassWith(playerState({ n: 2, position: 0, duration: 100 })));
    await settle();
    assert.equal(ctrl.state.track.id, 'id2');
    assert.deepEqual(ctrl.state.queue.map(q => q.id), ['id1', 'id2', 'id3'], 'untouched while inactive');
    assert.equal(totalCalls(calls), totalCalls(before));

    events.length = 0;
    ctrl.setActive(true);

    assert.deepEqual(ctrl.state.queue.map(q => q.id), ['id3']);
    assert.equal(ctrl.peekNext().id, 'id3', 'the next-track prediction is no longer a played track');
    assert.equal(events.length, 1);
    await settle();
    assert.equal(queueCalls(calls), queueCalls(before), 'the caller owns the queue fetch');
    assert.equal(calls.get_player_recent_tracks, before.get_player_recent_tracks);
    assert.equal(calls.check_favorites, before.check_favorites + 1, 'like state checked for the track now shown');

    // Returning again with no further track change trims nothing more.
    ctrl.setActive(false);
    ctrl.setActive(true);
    assert.deepEqual(ctrl.state.queue.map(q => q.id), ['id3']);
});

test('a track from outside the old queue leaves it for the caller\'s refresh to replace', async (t) => {
    const { ctrl, api } = await started(t);
    ctrl.setActive(false);
    ctrl.updateHass(hassWith(playerState({ n: 7, position: 0, duration: 100 })));

    ctrl.setActive(true);
    assert.deepEqual(ctrl.state.queue.map(q => q.id), ['id1', 'id2', 'id3']);

    api.queue = [track(8), track(9)];
    await ctrl.refreshQueue(); // what the app's _refreshAfterReturn does
    assert.deepEqual(ctrl.state.queue.map(q => q.id), ['id8', 'id9']);
});

test('the optimistic safety timer does not fetch while inactive', async (t) => {
    const { ctrl, calls } = await started(t);
    await ctrl.skipNext(); // arms the 8s safety net; HASS never confirms
    const before = { ...calls };

    ctrl.setActive(false);
    mock.timers.tick(8000);
    await settle();

    assert.equal(ctrl._optimisticTrack, null, 'the prediction is still dropped');
    assert.equal(queueCalls(calls), queueCalls(before));
    assert.equal(calls.get_player_recent_tracks, before.get_player_recent_tracks);
});

/* ---- hass-derived now-playing fields: repeat / context / device id ---- */

test('repeat, context name, context uri and device id are derived from hass', async (t) => {
    const { ctrl } = await started(t, {
        repeat: 'all', media_playlist: 'Road Trip', sp_device_id: 'dev1',
        sp_context_uri: 'spotify:playlist:abc',
    });
    assert.equal(ctrl.state.repeat, 'all');
    assert.equal(ctrl.state.contextName, 'Road Trip');
    assert.equal(ctrl.state.contextUri, 'spotify:playlist:abc');
    assert.equal(ctrl.state.deviceId, 'dev1');
});

test('the new fields default when hass omits them; context uri falls back to media_context_content_id', async (t) => {
    const { ctrl } = await started(t, { media_context_content_id: 'spotify:album:xyz' });
    assert.equal(ctrl.state.repeat, 'off');
    assert.equal(ctrl.state.contextName, null);
    assert.equal(ctrl.state.deviceId, null);
    assert.equal(ctrl.state.contextUri, 'spotify:album:xyz');
});

for (const [field, attrs, expected] of [
    ['repeat', { repeat: 'one' }, 'one'],
    ['contextName', { media_playlist: 'Focus' }, 'Focus'],
    ['contextUri', { sp_context_uri: 'spotify:playlist:new' }, 'spotify:playlist:new'],
    ['deviceId', { sp_device_id: 'dev2' }, 'dev2'],
]) {
    test(`a change to ${field} alone dispatches one fresh state`, async (t) => {
        const { ctrl, events } = await started(t);
        const before = ctrl.state;
        ctrl.updateHass(hassWith(playerState(attrs)));
        assert.equal(events.length, 1);
        assert.notEqual(events[0], before);
        assert.equal(events[0][field], expected);
        // Re-posting the same values dispatches nothing (_statesEqual covers the field).
        ctrl.updateHass(hassWith(playerState(attrs)));
        assert.equal(events.length, 1);
    });
}

test('with Sonos driving playback, repeat / context name / device id come from the Sonos entity and the context uri from SpotifyPlus', async (t) => {
    const { ctrl } = setup(t);
    ctrl.setSonosBridge({
        activeTarget: () => ({ isSonos: true, entity: SONOS_ENTITY }),
        getQueue: async () => [],
        log() {},
    });
    const sp = playerState({ repeat: 'off', media_playlist: 'SP list', sp_device_id: 'spdev', sp_context_uri: 'spotify:playlist:sp' });
    const sonos = playerState({ repeat: 'one', media_playlist: 'Sonos list', sp_context_uri: 'spotify:playlist:sonos' });
    delete sonos.attributes.sp_device_id;
    ctrl.updateHass(hassWith(sp, { [SONOS_ENTITY]: sonos }));
    await settle();
    assert.equal(ctrl.state.repeat, 'one');
    assert.equal(ctrl.state.contextName, 'Sonos list');
    assert.equal(ctrl.state.deviceId, null, 'the Sonos entity has no sp_device_id');
    assert.equal(ctrl.state.contextUri, 'spotify:playlist:sp');
    assert.equal(ctrl.sourceContextUri(), 'spotify:playlist:sp');
    assert.equal(ctrl.sourceAttributes().sp_device_id, 'spdev');
});

/* ---- shuffle / repeat: service call + delayed queue refresh ---- */

function recordParams(api) {
    const sent = [];
    const orig = api.fetchSpotifyPlus;
    api.fetchSpotifyPlus = async (service, params, ...rest) => {
        sent.push({ service, params });
        return orig(service, params, ...rest);
    };
    return sent;
}

test('toggleShuffle sends the inverse state and refreshes the queue at 500ms and 1500ms', async (t) => {
    const { ctrl, api, calls } = await started(t, { shuffle: true });
    const sent = recordParams(api);
    const fetched = queueCalls(calls);

    await ctrl.toggleShuffle();
    assert.deepEqual(sent[0], { service: 'player_shuffle', params: { state: false } });
    assert.equal(queueCalls(calls), fetched, 'no immediate refresh');

    mock.timers.tick(500);
    await settle();
    assert.equal(queueCalls(calls), fetched + 1);
    mock.timers.tick(1000);
    await settle();
    assert.equal(queueCalls(calls), fetched + 2);
    mock.timers.tick(5000);
    await settle();
    assert.equal(queueCalls(calls), fetched + 2, 'two passes only');
});

test('cycleRepeat steps off -> all -> one -> off and refreshes the queue twice', async (t) => {
    for (const [from, to] of [['off', 'all'], ['all', 'one'], ['one', 'off'], [undefined, 'all']]) {
        const { ctrl, api, calls } = await started(t, from ? { repeat: from } : {});
        const sent = recordParams(api);
        const fetched = queueCalls(calls);
        await ctrl.cycleRepeat();
        assert.deepEqual(sent[0], { service: 'player_repeat', params: { state: to } });
        mock.timers.tick(1500);
        await settle();
        assert.equal(queueCalls(calls), fetched + 2);
        ctrl.destroy();
        mock.timers.reset();
    }
});

test('a shuffle toggle while inactive schedules nothing and marks the queue stale', async (t) => {
    const { ctrl, calls } = await started(t);
    ctrl.setActive(false);
    const before = totalCalls(calls);
    await ctrl.toggleShuffle();
    mock.timers.tick(5000);
    await settle();
    assert.equal(totalCalls(calls), before + 1, 'only the shuffle call itself');
    assert.equal(ctrl._soonTimers.length, 0);
    assert.equal(ctrl._queueStale, true);
});

test('going inactive cancels pending post-toggle refreshes; destroy() does too', async (t) => {
    const { ctrl, calls } = await started(t);
    await ctrl.toggleShuffle();
    const fetched = queueCalls(calls);
    ctrl.setActive(false);
    mock.timers.tick(5000);
    await settle();
    assert.equal(queueCalls(calls), fetched);
    assert.equal(ctrl._queueStale, true);

    ctrl.setActive(true);
    await ctrl.cycleRepeat();
    ctrl.destroy();
    mock.timers.tick(5000);
    await settle();
    assert.equal(queueCalls(calls), fetched);
});

/* ---- reads shared on open (`since`) ---- */

test('refreshQueue({ since }) reads only when no queue read started at or after `since` still stands', async (t) => {
    const { ctrl, api, calls } = await started(t);
    const base = queueCalls(calls);

    // The desktop sidebar, shown on open, reads the queue; the app's refresh
    // for that same open (since = the moment of opening) takes it.
    mock.timers.tick(5000);
    const openedAt = Date.now();
    await ctrl.refreshQueue();
    await ctrl.refreshQueue({ since: openedAt });
    assert.equal(queueCalls(calls), base + 1);

    // A read from before `since` does not count.
    mock.timers.tick(10);
    await ctrl.refreshQueue({ since: Date.now() });
    assert.equal(queueCalls(calls), base + 2);

    // One still in flight stands too: one read for both.
    let release;
    const original = api.fetchSpotifyPlus;
    api.fetchSpotifyPlus = (service) => new Promise(r => { release = () => r(original(service)); });
    mock.timers.tick(10);
    const since = Date.now();
    const inFlight = ctrl.refreshQueue();
    await ctrl.refreshQueue({ since });
    release();
    await inFlight;
    api.fetchSpotifyPlus = original;
    assert.equal(queueCalls(calls), base + 3);
    assert.equal(ctrl._queueRead.at, since);
});

test('refreshQueue({ since }) reads again after an optimistic action, or after the read it would take failed', async (t) => {
    const { ctrl, api, calls } = await started(t);
    const since = Date.now();
    await ctrl.refreshQueue();
    await ctrl.skipNext(); // supersedes that read (its answer would be stale)
    const before = queueCalls(calls);
    await ctrl.refreshQueue({ since });
    assert.equal(queueCalls(calls), before + 1);

    const original = api.fetchSpotifyPlus;
    api.fetchSpotifyPlus = async (service) => { calls[service] = (calls[service] || 0) + 1; return null; };
    await ctrl.refreshQueue();
    api.fetchSpotifyPlus = original;
    await ctrl.refreshQueue({ since });
    assert.equal(queueCalls(calls), before + 3, 'a failed read covers nothing');
});

test('refreshRecent passes `since` to the shared read; a track change always reads afresh', async (t) => {
    const { ctrl, api } = await started(t);
    api.recentOptions.length = 0;
    await ctrl.refreshRecent({ since: 123 });
    await ctrl.refreshRecent();
    ctrl.updateHass(hassWith(playerState({ n: 4 })));
    await settle();
    assert.deepEqual(api.recentOptions, [{ since: 123 }, { since: null }, { since: null }]);
});

/* ---- neighbour art preload size ---- */

test('the neighbour art preload takes the size set by setNeighborArtSize (default: the largest)', async (t) => {
    const preloads = [];
    globalThis.Image = class { set src(url) { preloads.push(url); } };
    t.after(() => { delete globalThis.Image; });
    const art = (n) => [640, 300, 64].map(w => ({ url: `https://img.test/${w}/${n}`, width: w, height: w }));
    const withArt = (n) => ({ ...track(n), album: { images: art(n) } });

    const { ctrl, api } = setup(t);
    api.queue = [withArt(1), withArt(2)];
    api.recent = [{ track: withArt(9) }];
    ctrl.updateHass(hassWith(playerState()));
    await settle();
    preloads.length = 0;
    ctrl._preloadNeighborArt();
    assert.deepEqual(preloads, ['https://img.test/640/1', 'https://img.test/640/9'], 'mobile / default: full size');

    preloads.length = 0;
    ctrl.setNeighborArtSize(64);
    ctrl._preloadNeighborArt();
    assert.deepEqual(preloads, ['https://img.test/64/1', 'https://img.test/64/9'], 'desktop: thumbnails');

    preloads.length = 0;
    ctrl.setNeighborArtSize(128);
    ctrl._preloadNeighborArt();
    assert.deepEqual(preloads, ['https://img.test/300/1', 'https://img.test/300/9'], 'high-density thumbnails: the next size up');
});

test('toggleLike: a failed save shows the card\'s own message and re-checks the heart', async () => {
    const notes = [];
    const checks = [];
    const pc = Object.create(PlayerController.prototype);
    pc.state = { track: { id: 't1' }, isLiked: false };
    pc._setState = (patch) => { pc.state = { ...pc.state, ...patch }; };
    pc.checkTrackFavorites = (id) => checks.push(id);
    pc.api = {
        saveTrackFavorites: async () => ({ success: false, error: new Error('boom') }),
        removeTrackFavorites: async () => ({ success: true }),
        _notify: (m) => notes.push(m),
    };
    await pc.toggleLike();
    assert.deepEqual(notes, ['Failed to update your library.']);
    assert.deepEqual(checks, ['t1']);
    pc.state = { track: { id: 't1' }, isLiked: true };
    await pc.toggleLike(); // remove succeeds: no message
    assert.deepEqual(notes, ['Failed to update your library.']);
});
