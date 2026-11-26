import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { NowPlayingController } from '../components/controllers/now-playing-controller.js';

const T0 = 1_700_000_000_000;

/** A minimal Lit-like host: collects controllers and counts requestUpdate(). */
function makeHost(props = {}) {
    const host = {
        controllers: [],
        updates: 0,
        addController(c) { this.controllers.push(c); },
        requestUpdate() { this.updates++; },
        ...props,
    };
    return host;
}

/** A PlayerController stand-in: an EventTarget with `state` and recorded calls. */
function makePlayer(state = {}, stateObj = null) {
    const pc = new EventTarget();
    pc.calls = [];
    pc.state = {
        track: { id: 't1', name: 'Song', artists: [{ name: 'A' }, { name: 'B' }],
            album: { images: [{ url: 'big', width: 640 }, { url: 'small', width: 64 }] }, duration_ms: 200000 },
        isPlaying: true, isShuffle: false, isLiked: true, repeat: 'all',
        contextName: 'Mix', contextUri: 'spotify:playlist:p', deviceId: 'd1', activeDevice: 'Office', volume: 40,
        ...state,
    };
    pc.playbackStateObj = () => stateObj;
    pc.api = { seeks: [], seek(s) { this.seeks.push(s); } };
    for (const m of ['pause', 'skipNext', 'skipPrev', 'toggleShuffle', 'toggleLike', 'cycleRepeat']) {
        pc[m] = (...args) => { pc.calls.push([m, ...args]); };
    }
    pc.emit = (patch) => {
        pc.state = { ...pc.state, ...patch };
        pc.dispatchEvent(new CustomEvent('state-changed', { detail: pc.state }));
    };
    return pc;
}

const entity = (position = 30, duration = 180) => ({
    state: 'paused', last_updated: new Date(T0).toISOString(),
    attributes: { media_position: position, media_duration: duration },
});

function setup(t, { visible = true, interval = 500, watch, stateObj = entity(), state } = {}) {
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });
    t.after(() => mock.timers.reset());
    const rendered = [];
    const host = makeHost({ visible, playerController: makePlayer(state, stateObj) });
    const np = new NowPlayingController(host, {
        interval,
        isActive: () => host.visible,
        renderProgress: (p) => rendered.push(p),
        watch,
    });
    return { host, np, rendered, pc: host.playerController };
}

test('registers itself with the host', (t) => {
    const { host, np } = setup(t);
    assert.deepEqual(host.controllers, [np]);
});

test('accessors read the PlayerController state', (t) => {
    const { np } = setup(t);
    assert.equal(np.track.id, 't1');
    assert.equal(np.artistLine, 'A, B');
    assert.equal(np.artUrl(), 'big');
    assert.equal(np.artUrl(64), 'small');
    assert.equal(np.isPlaying, true);
    assert.equal(np.isShuffle, false);
    assert.equal(np.isLiked, true);
    assert.equal(np.repeat, 'all');
    assert.equal(np.contextName, 'Mix');
    assert.equal(np.contextUri, 'spotify:playlist:p');
    assert.equal(np.deviceId, 'd1');
    assert.equal(np.deviceName, 'Office');
});

test('accessors are safe with no player and default sensibly', (t) => {
    const { host, np } = setup(t);
    host.playerController = null;
    assert.equal(np.track, null);
    assert.equal(np.artistLine, '');
    assert.equal(np.artUrl(), '');
    assert.equal(np.isPlaying, false);
    assert.equal(np.repeat, 'off');
    assert.equal(np.deviceName, null);
    assert.equal(np.contextUri, null);
    assert.deepEqual(np.position(), { position: 0, duration: 0 });
});

test('position() reads the playback entity, falling back to the track duration', (t) => {
    const { np, pc } = setup(t);
    assert.deepEqual(np.position(), { position: 30, duration: 180 });
    pc.playbackStateObj = () => ({ state: 'paused', attributes: {} });
    pc.state = { ...pc.state, track: { ...pc.state.track, progress_ms: 5000 } };
    assert.deepEqual(np.position(), { position: 5, duration: 200 });
});

test('the ticker starts on connect while active, ticks at the interval and stops on disconnect', (t) => {
    const { np, rendered } = setup(t, { interval: 1000 });
    np.hostConnected();
    assert.equal(rendered.length, 1, 'an immediate tick');
    assert.deepEqual(rendered[0], { position: 30, duration: 180, held: false });
    mock.timers.tick(3000);
    assert.equal(rendered.length, 4);
    np.hostDisconnected();
    mock.timers.tick(5000);
    assert.equal(rendered.length, 4);
});

test('no ticker while inactive; it follows the active flag on host updates', (t) => {
    const { host, np, rendered } = setup(t, { visible: false });
    np.hostConnected();
    np.hostUpdated();
    mock.timers.tick(5000);
    assert.equal(rendered.length, 0);

    host.visible = true;
    np.hostUpdated();
    assert.equal(rendered.length, 1);
    np.hostUpdated(); // a further update doesn't start a second interval
    mock.timers.tick(500);
    assert.equal(rendered.length, 2);

    host.visible = false;
    np.hostUpdated();
    mock.timers.tick(5000);
    assert.equal(rendered.length, 2);
});

test('tick() renders nothing while inactive', (t) => {
    const { host, np, rendered } = setup(t, { visible: false });
    np.tick();
    assert.equal(rendered.length, 0);
    host.visible = true;
    np.tick();
    assert.equal(rendered.length, 1);
});

test('next() holds the progress at 0 for 2.5s and skips optimistically', (t) => {
    const { np, pc, rendered } = setup(t);
    np.hostConnected();
    rendered.length = 0;
    np.next();
    assert.deepEqual(pc.calls, [['skipNext']]);
    assert.deepEqual(rendered[0], { position: 0, duration: 0, held: true }, 'held immediately');
    mock.timers.tick(2000);
    assert.ok(rendered.every(p => p.held));
    mock.timers.tick(1000);
    assert.equal(rendered.at(-1).held, false);
});

test('prev() passes its options through (default: restart when >3s in)', (t) => {
    const { np, pc } = setup(t);
    np.prev();
    np.prev({ allowRestart: false });
    assert.deepEqual(pc.calls, [['skipPrev', { allowRestart: true }], ['skipPrev', { allowRestart: false }]]);
});

test('the other actions call the PlayerController', (t) => {
    const { np, pc } = setup(t);
    np.playPause();
    np.toggleShuffle();
    np.toggleLike();
    np.cycleRepeat();
    assert.deepEqual(pc.calls.map(c => c[0]), ['pause', 'toggleShuffle', 'toggleLike', 'cycleRepeat']);
});

test('seekRatio seeks to a clamped fraction of the duration and returns it', (t) => {
    const { host, np, pc } = setup(t);
    assert.equal(np.seekRatio(0.5), 0.5);
    assert.equal(np.seekRatio(1.4), 1);
    assert.equal(np.seekRatio(-1), 0);
    assert.deepEqual(pc.api.seeks, [90, 180, 0]);

    host.api = { seeks: [], seek(s) { this.seeks.push(s); } };
    np.seekRatio(0.25);
    assert.deepEqual(host.api.seeks, [45], "prefers the host's api");
});

test('seekRatio does nothing without a duration or an api', (t) => {
    const { np, pc } = setup(t, { stateObj: null, state: { track: null } });
    assert.equal(np.seekRatio(0.5), null);
    assert.deepEqual(pc.api.seeks, []);
    pc.api = null;
    pc.playbackStateObj = () => entity();
    assert.equal(np.seekRatio(0.5), null);
});

test('watched fields re-render the host only when they change and the host is active', (t) => {
    const { host, np, pc } = setup(t, { watch: ['volume', 'deviceId'] });
    np.hostConnected();

    pc.emit({ isPlaying: false });
    assert.equal(host.updates, 0, 'an unwatched field');
    pc.emit({ volume: 60 });
    assert.equal(host.updates, 1);
    pc.emit({ volume: 60, isShuffle: true });
    assert.equal(host.updates, 1, 'unchanged watched value');

    host.visible = false;
    pc.emit({ volume: 70 });
    assert.equal(host.updates, 1, 'no render while inactive');
    host.visible = true;
    pc.emit({ volume: 60 }); // back to a value seen before going inactive
    assert.equal(host.updates, 2);

    np.hostDisconnected();
    pc.emit({ deviceId: 'd2' });
    assert.equal(host.updates, 2, 'unsubscribed on disconnect');
});

test('the watch subscription follows a replaced playerController', (t) => {
    const { host, np, pc } = setup(t, { watch: ['volume'] });
    np.hostConnected();
    const next = makePlayer();
    host.playerController = next;
    np.hostUpdated();
    pc.emit({ volume: 99 });
    assert.equal(host.updates, 0, 'old controller detached');
    next.emit({ volume: 99 });
    assert.equal(host.updates, 1);
});

test('without watch fields nothing subscribes', (t) => {
    const { host, np, pc } = setup(t);
    np.hostConnected();
    pc.emit({ volume: 1, deviceId: 'x' });
    assert.equal(host.updates, 0);
});
