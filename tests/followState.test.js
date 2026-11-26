import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FollowStateController } from '../src/components/controllers/follow-state-controller.js';
import { VERIFY_MS } from '../src/components/controllers/track-likes-controller.js';

const flush = () => new Promise(r => setImmediate(r));

function setup(t, options = {}) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const host = {
        updates: 0,
        controllers: [],
        addController(c) { this.controllers.push(c); },
        requestUpdate() { this.updates++; },
    };
    const follow = new FollowStateController(host, options);
    return { host, follow, tick: (ms) => t.mock.timers.tick(ms) };
}

test('registers with the host; `following` starts at `initial` and updates the host only on a change', (t) => {
    const { host, follow } = setup(t);
    assert.deepEqual(host.controllers, [follow]);
    assert.equal(follow.following, false);
    follow.following = false;
    assert.equal(host.updates, 0);
    follow.following = true;
    assert.equal(host.updates, 1);
    assert.equal(new FollowStateController(host, { initial: null }).following, null);
});

test('toggle: flips at once, keeps it on success; setFollowed gets the new state', async (t) => {
    const { host, follow } = setup(t);
    const asked = [];
    let seenDuringCall;
    const ok = await follow.toggle(async (next) => { asked.push(next); seenDuringCall = follow.following; return true; });
    assert.equal(ok, true);
    assert.deepEqual(asked, [true]);
    assert.equal(seenDuringCall, true, 'optimistic');
    assert.equal(follow.following, true);
    assert.equal(host.updates, 1);
    assert.equal(await follow.toggle(async () => ({ success: true }).success), true);
    assert.equal(follow.following, false);
});

test('toggle: a falsy answer reverts to !follow (from "not known" too) and resolves false', async (t) => {
    const { follow } = setup(t, { initial: null });
    assert.equal(await follow.toggle(async () => false), false);
    assert.equal(follow.following, false);
    follow.following = true;
    assert.equal(await follow.toggle(async () => undefined), false);
    assert.equal(follow.following, true);
});

test('no verify option: nothing is scheduled', async (t) => {
    const { follow, tick } = setup(t);
    await follow.toggle(async () => true);
    tick(VERIFY_MS * 2);
    await flush();
    assert.equal(follow.following, true);
    assert.equal(follow._verifyTimers.size, 0);
});

test('verify: re-read VERIFY_MS after a success; a differing answer corrects it, onCorrected first', async (t) => {
    const answers = [];
    const log = [];
    const { follow, tick } = setup(t, {
        verify: async () => { log.push('verify'); return answers.shift(); },
        onCorrected: () => log.push(`corrected (shown ${follow.following})`),
    });
    answers.push(false);
    await follow.toggle(async () => true);
    tick(VERIFY_MS - 1);
    await flush();
    assert.deepEqual(log, []);
    tick(1);
    await flush();
    assert.deepEqual(log, ['verify', 'corrected (shown true)']);
    assert.equal(follow.following, false);
    assert.equal(follow._verifyTimers.size, 0);
});

test('verify: null or the same answer leaves it; a failed toggle schedules no re-check', async (t) => {
    const answers = [null, true];
    let verifies = 0;
    const { follow, tick } = setup(t, { verify: async () => { verifies++; return answers.shift(); } });
    await follow.toggle(async () => true);
    tick(VERIFY_MS); await flush();
    follow.following = false;
    await follow.toggle(async () => true);
    tick(VERIFY_MS); await flush();
    assert.equal(verifies, 2);
    assert.equal(follow.following, true);
    await follow.toggle(async () => false);
    tick(VERIFY_MS); await flush();
    assert.equal(verifies, 2);
});

test('every toggle re-checks on its own; host disconnect cancels the pending ones', async (t) => {
    let verifies = 0;
    const { follow, tick } = setup(t, { verify: async () => { verifies++; return null; } });
    await follow.toggle(async () => true);
    await follow.toggle(async () => true);
    assert.equal(follow._verifyTimers.size, 2);
    tick(VERIFY_MS); await flush();
    assert.equal(verifies, 2);

    await follow.toggle(async () => true);
    follow.hostDisconnected();
    tick(VERIFY_MS); await flush();
    assert.equal(verifies, 2);
    assert.equal(follow._verifyTimers.size, 0);
});
