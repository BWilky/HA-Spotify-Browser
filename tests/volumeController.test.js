import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VolumeController, THROTTLE_MS, HOLD_MS } from '../src/components/controllers/volume-controller.js';

function setup(t, config = {}) {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    const sent = [];
    const host = {
        updates: 0,
        controllers: [],
        addController(c) { this.controllers.push(c); },
        requestUpdate() { this.updates++; },
    };
    const vol = new VolumeController(host, { send: (v) => sent.push(v), getConfig: () => config });
    return { vol, host, sent, tick: (ms) => t.mock.timers.tick(ms) };
}

test('registers with the host', (t) => {
    const { vol, host } = setup(t);
    assert.equal(host.controllers[0], vol);
});

test('throttle: the first change goes out at once, the rest are coalesced into one trailing send', (t) => {
    const { vol, sent, tick } = setup(t);
    vol.input(10);
    assert.deepEqual(sent, [10], 'leading edge');
    tick(50); vol.input(20);
    tick(50); vol.input(30);
    assert.deepEqual(sent, [10], 'inside the window nothing more is sent');
    tick(99);
    assert.deepEqual(sent, [10]);
    tick(1); // window ends THROTTLE_MS after the leading send
    assert.deepEqual(sent, [10, 30], 'trailing send carries the latest value');
});

test('throttle: never more than one send per window, and the final value is always sent', (t) => {
    const { vol, sent, tick } = setup(t);
    const times = [];
    const origPush = sent.push.bind(sent);
    sent.push = (v) => { times.push(Date.now()); return origPush(v); };
    for (let i = 1; i <= 50; i++) { vol.input(i); tick(17); }
    tick(THROTTLE_MS);
    assert.equal(sent[sent.length - 1], 50);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= THROTTLE_MS);
});

test('throttle: a change after a pending trailing send never sends an older value last', (t) => {
    const { vol, sent, tick } = setup(t);
    vol.input(10);              // t=0 leading
    tick(150); vol.input(20);   // pending, trailing at t=200
    tick(100); vol.input(30);   // t=250: a window has passed, but a trailing send already ran
    tick(THROTTLE_MS * 2);
    assert.equal(sent[sent.length - 1], 30);
    assert.deepEqual(sent, [10, 20, 30]);
});

test('a change after a quiet window is sent immediately', (t) => {
    const { vol, sent, tick } = setup(t);
    vol.input(10);
    tick(THROTTLE_MS + 1);
    vol.input(20);
    assert.deepEqual(sent, [10, 20]);
});

test('rate_control: false sends every change immediately', (t) => {
    const { vol, sent, tick } = setup(t, { rate_control: false });
    vol.input(10); vol.input(20); vol.input(30);
    assert.deepEqual(sent, [10, 20, 30]);
    tick(1000);
    assert.deepEqual(sent, [10, 20, 30]);
});

test('commit sends the final value now and drops the pending trailing send', (t) => {
    const { vol, sent, tick } = setup(t);
    vol.input(10);
    tick(20); vol.input(40);
    vol.commit(40);
    assert.deepEqual(sent, [10, 40]);
    tick(1000);
    assert.deepEqual(sent, [10, 40], 'no duplicate trailing send');
});

test('commit does not resend a value that already went out', (t) => {
    const { vol, sent } = setup(t);
    vol.input(10);
    vol.commit(10);
    assert.deepEqual(sent, [10]);
    vol.commit(12);
    assert.deepEqual(sent, [10, 12]);
});

test('optimistic hold: shows the user value for HOLD_MS, then the state, and re-renders once at expiry', (t) => {
    const { vol, host, tick } = setup(t);
    assert.equal(vol.displayed(30), 30);
    vol.input(60);
    assert.equal(vol.displayed(30), 60);
    assert.ok(vol.holding);
    tick(HOLD_MS - 1);
    assert.equal(vol.displayed(30), 60);
    const before = host.updates;
    tick(1);
    assert.equal(vol.holding, false);
    assert.equal(vol.displayed(30), 30);
    assert.equal(host.updates, before + 1, 'the host re-renders when the hold ends');
});

test('optimistic hold is extended by every change', (t) => {
    const { vol, tick } = setup(t);
    vol.input(60);
    tick(HOLD_MS - 100);
    vol.input(65);
    tick(HOLD_MS - 100);
    assert.equal(vol.displayed(30), 65);
    tick(100);
    assert.equal(vol.displayed(30), 30);
});

test('optimistic: false never holds a value', (t) => {
    const { vol, sent } = setup(t, { optimistic: false });
    vol.input(60);
    vol.commit(70);
    assert.equal(vol.holding, false);
    assert.equal(vol.displayed(30), 30);
    assert.deepEqual(sent, [60, 70]);
});

test('both flags off: plain pass-through', (t) => {
    const { vol, sent } = setup(t, { optimistic: false, rate_control: false });
    vol.input(1); vol.input(2);
    assert.deepEqual(sent, [1, 2]);
    assert.equal(vol.displayed(5), 5);
});

test('no config means both features on (README defaults)', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const sent = [];
    const vol = new VolumeController({ requestUpdate() {} }, { send: (v) => sent.push(v) });
    vol.input(10); vol.input(20);
    assert.deepEqual(sent, [10]);
    assert.equal(vol.displayed(0), 20);
});

test('disconnect clears the timers and flushes a pending final value', (t) => {
    const { vol, host, sent, tick } = setup(t);
    vol.input(10);
    tick(20); vol.input(55);
    vol.hostDisconnected();
    assert.deepEqual(sent, [10, 55], 'pending trailing value is sent, not dropped');
    assert.equal(vol.holding, false);
    const before = host.updates;
    tick(HOLD_MS * 2);
    assert.deepEqual(sent, [10, 55], 'no timer fires after disconnect');
    assert.equal(host.updates, before, 'no re-render after disconnect');
});
