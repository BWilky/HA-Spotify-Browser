import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerStateController } from '../components/controllers/player-state-controller.js';

class FakePlayer extends EventTarget {
    constructor(state) { super(); this.state = state; }
    set(state) { this.state = state; this.dispatchEvent(Object.assign(new Event('state-changed'), { detail: state })); }
}

function makeHost(playerController = null) {
    return {
        playerController,
        updates: 0,
        controllers: [],
        addController(c) { this.controllers.push(c); },
        requestUpdate() { this.updates++; },
    };
}

test('registers with the host and exposes the controller state', () => {
    const player = new FakePlayer({ track: { id: 'a' } });
    const host = makeHost(player);
    const c = new PlayerStateController(host);
    assert.equal(host.controllers[0], c);
    assert.equal(c.state, null); // not connected yet
    c.hostConnected();
    assert.deepEqual(c.state, { track: { id: 'a' } });
    assert.equal(c.controller, player);
});

test('a state change re-renders the host and the new state is readable', () => {
    const player = new FakePlayer({ n: 1 });
    const host = makeHost(player);
    const c = new PlayerStateController(host);
    c.hostConnected();
    const before = host.updates;
    player.set({ n: 2 });
    assert.equal(host.updates, before + 1);
    assert.deepEqual(c.state, { n: 2 });
});

test('while inactive, changes do not schedule renders but onChange still runs', () => {
    const player = new FakePlayer({ n: 1 });
    const host = makeHost(player);
    let active = false;
    const seen = [];
    const c = new PlayerStateController(host, { isActive: () => active, onChange: (s) => seen.push(s.n) });
    c.hostConnected();
    const before = host.updates;
    player.set({ n: 2 });
    assert.equal(host.updates, before);
    assert.deepEqual(seen, [2]);
    assert.deepEqual(c.state, { n: 2 }); // still current when the host does render
    active = true;
    player.set({ n: 3 });
    assert.equal(host.updates, before + 1);
});

test('a controller assigned after connect is picked up on the next host update', () => {
    const host = makeHost(null);
    const c = new PlayerStateController(host);
    c.hostConnected();
    assert.equal(c.state, null);
    const player = new FakePlayer({ n: 1 });
    host.playerController = player;
    const before = host.updates;
    c.hostUpdated();
    assert.equal(host.updates, before + 1); // render with the new controller's state
    assert.deepEqual(c.state, { n: 1 });
    player.set({ n: 2 });
    assert.equal(host.updates, before + 2);
});

test('a replaced controller is released and the new one followed', () => {
    const first = new FakePlayer({ who: 'first' });
    const second = new FakePlayer({ who: 'second' });
    const host = makeHost(first);
    const c = new PlayerStateController(host);
    c.hostConnected();
    host.playerController = second;
    c.hostUpdated();
    const before = host.updates;
    first.set({ who: 'first-again' });
    assert.equal(host.updates, before); // old controller no longer drives the host
    assert.deepEqual(c.state, { who: 'second' });
    second.set({ who: 'second-again' });
    assert.equal(host.updates, before + 1);
});

test('disconnect unsubscribes; reconnect resubscribes', () => {
    const player = new FakePlayer({ n: 1 });
    const host = makeHost(player);
    const c = new PlayerStateController(host);
    c.hostConnected();
    c.hostDisconnected();
    const before = host.updates;
    player.set({ n: 2 });
    assert.equal(host.updates, before);
    c.hostConnected();
    player.set({ n: 3 });
    assert.ok(host.updates > before);
    assert.deepEqual(c.state, { n: 3 });
});

test('a custom getController is used', () => {
    const player = new FakePlayer({ n: 1 });
    const host = makeHost(null);
    const c = new PlayerStateController(host, { getController: () => player });
    c.hostConnected();
    assert.deepEqual(c.state, { n: 1 });
});
