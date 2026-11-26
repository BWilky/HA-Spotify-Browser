import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrackLikesController, VERIFY_MS } from '../src/components/controllers/track-likes-controller.js';

const flush = () => new Promise(r => setImmediate(r));

/**
 * Stub api: checkTrackFavorites answers from `server` ({ id: bool }); a list
 * of ids gets a map, a single id a boolean (like api.js). `failNext` makes the
 * next N check calls return null; `saveResult` is what save/remove return.
 */
function makeApi(server = {}) {
    const api = {
        server,
        checks: [],
        saves: [],
        failNext: 0,
        emptyNext: 0,
        saveResult: { success: true },
        async checkTrackFavorites(ids) {
            api.checks.push(Array.isArray(ids) ? [...ids] : ids);
            if (api.failNext > 0) { api.failNext--; return null; }
            if (api.emptyNext > 0) { api.emptyNext--; return {}; }
            if (!Array.isArray(ids)) return api.server[ids] === true;
            return Object.fromEntries(ids.map(id => [id, api.server[id] === true]));
        },
        async saveTrackFavorites(id) { api.saves.push(['save', id]); if (api.saveResult.success) api.server[id] = true; return api.saveResult; },
        async removeTrackFavorites(id) { api.saves.push(['remove', id]); if (api.saveResult.success) api.server[id] = false; return api.saveResult; },
    };
    return api;
}

function setup(t, { ids = [], server = {}, ...options } = {}) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const api = makeApi(server);
    const host = {
        isConnected: true,
        updates: 0,
        controllers: [],
        ids,
        addController(c) { this.controllers.push(c); },
        requestUpdate() { this.updates++; },
    };
    const toggled = [];
    const corrected = [];
    const likes = new TrackLikesController(host, {
        getApi: () => host.api === undefined ? api : host.api,
        getIds: () => host.ids,
        onToggled: (liked, ok) => toggled.push([liked, ok]),
        onCorrected: (id, confirmed) => corrected.push([id, confirmed]),
        ...options,
    });
    return { likes, api, host, toggled, corrected, tick: (ms) => t.mock.timers.tick(ms) };
}

const range = (n, p = 't') => Array.from({ length: n }, (_, i) => `${p}${i}`);

test('registers with the host', (t) => {
    const { likes, host } = setup(t);
    assert.equal(host.controllers[0], likes);
});

test('check: asks once for the page, merges the answer into a NEW map and re-renders', async (t) => {
    const { likes, api, host } = setup(t, { ids: ['a', 'b', 'c'], server: { b: true } });
    const before = likes.map;
    await likes.check();
    assert.deepEqual(api.checks, [['a', 'b', 'c']]);
    assert.notEqual(likes.map, before, 'replaced, not mutated');
    assert.deepEqual(before, {}, 'the old map is untouched');
    assert.deepEqual(likes.map, { a: false, b: true, c: false });
    assert.equal(likes.isLiked('b'), true);
    assert.equal(likes.isLiked('zzz'), false);
    assert.equal(host.updates, 1);
});

test('check: only ids not checked yet on this page (deltas), deduped, falsy ids dropped', async (t) => {
    const { likes, api, host } = setup(t, { ids: ['a', 'b', 'a', null, undefined, ''] });
    await likes.check();
    host.ids = ['a', 'b', 'c', 'd', 'c'];
    await likes.check();
    host.ids = ['a', 'b', 'c', 'd'];
    await likes.check(); // nothing new: no call
    assert.deepEqual(api.checks, [['a', 'b'], ['c', 'd']]);
});

test('check: chunks of 50, in parallel, every id sent once (500 tracks -> 10 calls)', async (t) => {
    const { likes, api, host } = setup(t, { ids: range(500) });
    const p = likes.check();
    assert.equal(api.checks.length, 10, 'all calls start before any answer');
    await p;
    assert.ok(api.checks.every(c => c.length === 50));
    assert.deepEqual(api.checks.flat(), range(500));
    host.ids = range(120);
    await likes.check();
    assert.equal(api.checks.length, 10, 'all already checked');
});

test('check: a partial chunk at the end', async (t) => {
    const { likes, api } = setup(t, { ids: range(120) });
    await likes.check();
    assert.deepEqual(api.checks.map(c => c.length), [50, 50, 20]);
});

test('check: maxPerCheck caps one pass to a single call; the rest wait for the next check', async (t) => {
    const { likes, api } = setup(t, { ids: range(60), maxPerCheck: 50 });
    await likes.check();
    assert.deepEqual(api.checks.map(c => c.length), [50]);
    await likes.check();
    assert.deepEqual(api.checks[1], range(60).slice(50));
});

test('check: a failed or empty answer unmarks its ids so the next check asks again', async (t) => {
    const { likes, api, host } = setup(t, { ids: range(120) });
    api.failNext = 1; // the first chunk fails
    await likes.check();
    assert.equal(Object.keys(likes.map).length, 70);
    await likes.check();
    assert.deepEqual(api.checks[3], range(50), 'only the failed chunk again');
    assert.equal(Object.keys(likes.map).length, 120);

    host.ids = ['x'];
    api.emptyNext = 1;
    const updates = host.updates;
    await likes.check();
    assert.equal(host.updates, updates, 'nothing merged, no render');
    await likes.check();
    assert.deepEqual(api.checks.slice(-2), [['x'], ['x']]);
});

test('check: ids in flight are not asked for again by an overlapping check', async (t) => {
    const { likes, api } = setup(t, { ids: ['a', 'b'] });
    const p1 = likes.check();
    const p2 = likes.check();
    await Promise.all([p1, p2]);
    assert.deepEqual(api.checks, [['a', 'b']]);
});

test('reset: the next check asks for everything again; the map is kept', async (t) => {
    const { likes, api } = setup(t, { ids: ['a', 'b'], server: { a: true } });
    await likes.check();
    likes.reset();
    await likes.check();
    assert.deepEqual(api.checks, [['a', 'b'], ['a', 'b']]);
    assert.equal(likes.isLiked('a'), true);
});

test('reset while a call is in flight: its failure does not unmark ids in the new set', async (t) => {
    const { likes, api } = setup(t, { ids: ['a'] });
    api.failNext = 1;
    const p = likes.check();
    likes.reset();
    const p2 = likes.check(); // new set: asks again
    await Promise.all([p, p2]);
    await likes.check(); // 'a' is checked in the new set (second call succeeded)
    assert.deepEqual(api.checks, [['a'], ['a']]);
});

test('check: no api or no ids -> no call', async (t) => {
    const { likes, api, host } = setup(t, { ids: undefined });
    await likes.check();
    host.ids = ['a'];
    host.api = null;
    await likes.check();
    assert.deepEqual(api.checks, []);
});

test('toggle: optimistic flip before the call returns, then feedback and a verify read', async (t) => {
    const { likes, api, host, toggled, tick } = setup(t);
    const p = likes.toggle('a');
    assert.equal(likes.isLiked('a'), true, 'flipped at once');
    assert.equal(host.updates, 1);
    await p;
    assert.deepEqual(api.saves, [['save', 'a']]);
    assert.deepEqual(toggled, [[true, true]]);
    tick(VERIFY_MS - 1);
    await flush();
    assert.deepEqual(api.checks, []);
    tick(1);
    await flush();
    assert.deepEqual(api.checks, ['a'], 'single-id re-read');
    assert.equal(likes.isLiked('a'), true);
    await likes.toggle('a');
    assert.deepEqual(api.saves, [['save', 'a'], ['remove', 'a']]);
    assert.deepEqual(toggled, [[true, true], [false, true]]);
    assert.equal(likes.isLiked('a'), false);
});

test('toggle: a failed save reverts, reports, and schedules no verify', async (t) => {
    const { likes, api, toggled, tick } = setup(t);
    api.saveResult = { success: false };
    const before = likes.map;
    await likes.toggle('a');
    assert.equal(likes.isLiked('a'), false);
    assert.notEqual(likes.map, before, 'revert is a new map as well');
    assert.deepEqual(toggled, [[true, false]]);
    tick(VERIFY_MS * 2);
    await flush();
    assert.deepEqual(api.checks, []);
});

test("verify 'latest': corrects a stale heart to what Spotify says", async (t) => {
    const { likes, api, tick } = setup(t);
    await likes.toggle('a');
    api.server.a = false; // changed elsewhere meanwhile
    tick(VERIFY_MS);
    await flush();
    assert.equal(likes.isLiked('a'), false);
});

test("verify 'latest': one pending re-check; a toggle of another track replaces it", async (t) => {
    const { likes, api, tick } = setup(t);
    await likes.toggle('a');
    tick(1000);
    await likes.toggle('b');
    tick(VERIFY_MS);
    await flush();
    assert.deepEqual(api.checks, ['b']);
});

test("verify 'latest': a non-boolean answer changes nothing", async (t) => {
    const { likes, api, host, tick } = setup(t);
    await likes.toggle('a');
    api.failNext = 1;
    const updates = host.updates;
    tick(VERIFY_MS);
    await flush();
    assert.equal(host.updates, updates);
    assert.equal(likes.isLiked('a'), true);
});

test("verify 'each': every toggle re-checks itself, compared with the state it set", async (t) => {
    const { likes, api, corrected, tick } = setup(t, { verify: 'each' });
    await likes.toggle('a');           // -> true
    tick(1000);
    await likes.toggle('b');           // -> true
    tick(1000);
    await likes.toggle('a');           // -> false
    tick(1000);                        // t=3000: a's first verify fires
    await flush();
    tick(1000);                        // b's verify
    await flush();
    tick(1000);                        // a's second verify
    await flush();
    assert.deepEqual(api.checks, ['a', 'b', 'a']);
    // a's first re-check reads false (the second toggle removed it), which is
    // not what that toggle set: corrected to false (already shown).
    assert.deepEqual(corrected, [['a', false]]);
    assert.equal(likes.isLiked('a'), false);
    assert.equal(likes.isLiked('b'), true);
});

test("verify 'each': null (failed read) changes nothing", async (t) => {
    const { likes, api, corrected, tick } = setup(t, { verify: 'each' });
    await likes.toggle('a');
    api.failNext = 1;
    tick(VERIFY_MS);
    await flush();
    assert.deepEqual(corrected, []);
    assert.equal(likes.isLiked('a'), true);
});

test('pending verifies are cancelled on disconnect (both modes); none run while disconnected', async (t) => {
    for (const verify of ['latest', 'each']) {
        const { likes, api, host, tick } = setup(t, { verify });
        await likes.toggle('a');
        await likes.toggle('b');
        likes.hostDisconnected();
        tick(VERIFY_MS * 2);
        await flush();
        assert.deepEqual(api.checks, [], verify);

        // A timer that fires while the host happens to be detached reads nothing.
        await likes.toggle('c');
        host.isConnected = false;
        tick(VERIFY_MS);
        await flush();
        assert.deepEqual(api.checks, [], verify);
        t.mock.timers.reset();
    }
});

test('toggle: no api -> nothing happens', async (t) => {
    const { likes, host, toggled } = setup(t);
    host.api = null;
    await likes.toggle('a');
    assert.equal(likes.isLiked('a'), false);
    assert.equal(host.updates, 0);
    assert.deepEqual(toggled, []);
});
