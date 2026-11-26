import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    planPlaylistEdit, entryUri, REPLACE_MAX_ITEMS, BLOCKED_PARTIAL_DUPLICATE
} from '../components/controllers/playlist-edit-plan.js';

const uri = (id) => `spotify:track:${id}`;
/** Edit entries as the editor builds them: key = `<uri>:<original index>`, item wraps the track. */
const entries = (ids) => ids.map((id, i) => ({ key: `${uri(id)}:${i}`, item: { track: { uri: uri(id), name: id } } }));
const ids = (list) => list.map(e => e.item.track.name);

/** The edits a user can make: drop a row, move a row. Both return a new list. */
const removeAt = (list, index) => list.filter((_, i) => i !== index);
const moveTo = (list, from, to) => {
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
};

/**
 * Apply a plan to the original list the way the Spotify operations behave:
 *   remove  — drops EVERY row whose uri is listed (Spotify cannot remove one
 *             copy of a duplicate by uri).
 *   reorder — 1-based positions against the list as it stands at that moment:
 *             take `rangeLength` rows starting at `rangeStart` and re-insert
 *             them in front of the row that was at `insertBefore`.
 *   replace — the playlist becomes exactly the given uris; row identity
 *             (added_at) is lost.
 * Returns the resulting uris, and the surviving row keys unless a replace
 * discarded row identity.
 */
function simulate(orig, ops) {
    let rows = orig.map(e => ({ key: e.key, uri: entryUri(e) }));
    let identityKept = true;
    for (const op of ops) {
        if (op.op === 'remove') {
            assert.ok(op.uris.length > 0, 'remove needs uris');
            const drop = new Set(op.uris);
            rows = rows.filter(r => !drop.has(r.uri));
        } else if (op.op === 'reorder') {
            const start = op.rangeStart - 1;
            const before = op.insertBefore - 1;
            assert.ok(start >= 0 && start + op.rangeLength <= rows.length, `range_start ${op.rangeStart} out of range`);
            assert.ok(before >= 0 && before <= rows.length, `insert_before ${op.insertBefore} out of range`);
            const moved = rows.splice(start, op.rangeLength);
            rows.splice(before > start ? before - op.rangeLength : before, 0, ...moved);
        } else if (op.op === 'replace') {
            rows = op.uris.map(u => ({ key: null, uri: u }));
            identityKept = false;
        } else {
            assert.fail(`unexpected op ${op.op}`);
        }
    }
    return { uris: rows.map(r => r.uri), keys: identityKept ? rows.map(r => r.key) : null };
}

/** Plan orig -> fin, check the plan reproduces fin, return the plan. */
function planAndCheck(orig, fin) {
    const plan = planPlaylistEdit(orig, fin);
    assert.equal(plan.blocked, null);
    const result = simulate(orig, plan.ops);
    assert.deepEqual(result.uris, fin.map(entryUri));
    // Without a replace the very same rows must survive (added_at preserved).
    if (result.keys) assert.deepEqual(result.keys, fin.map(e => e.key));
    for (const op of plan.ops) {
        if (op.op !== 'reorder') continue;
        assert.equal(op.rangeLength, 1);
        assert.ok(op.insertBefore < op.rangeStart, 'reorders only move a row up');
    }
    return plan;
}

test('no change gives an empty plan', () => {
    const orig = entries(['a', 'b', 'c']);
    assert.deepEqual(planPlaylistEdit(orig, [...orig]), { tracksChanged: false, blocked: null, ops: [] });
    assert.deepEqual(planPlaylistEdit([], []), { tracksChanged: false, blocked: null, ops: [] });
});

test('single remove is one remove of that uri', () => {
    const orig = entries(['a', 'b', 'c', 'd']);
    const plan = planAndCheck(orig, removeAt(orig, 1));
    assert.equal(plan.tracksChanged, true);
    assert.deepEqual(plan.ops, [{ op: 'remove', uris: [uri('b')] }]);
});

test('removing one copy of a duplicated track replaces the whole list', () => {
    const orig = entries(['a', 'b', 'a', 'c']);
    const fin = removeAt(orig, 2);
    const plan = planAndCheck(orig, fin);
    // A remove by uri would take out both copies of `a`.
    assert.deepEqual(plan.ops, [{ op: 'replace', uris: [uri('a'), uri('b'), uri('c')] }]);
    // Same when the FIRST copy goes: the order of what is left is what counts.
    assert.deepEqual(planAndCheck(orig, removeAt(orig, 0)).ops,
        [{ op: 'replace', uris: [uri('b'), uri('a'), uri('c')] }]);
});

test('removing every copy of a duplicated track is a plain remove', () => {
    const orig = entries(['a', 'b', 'a', 'c']);
    const plan = planAndCheck(orig, orig.filter(e => entryUri(e) !== uri('a')));
    assert.deepEqual(plan.ops, [{ op: 'remove', uris: [uri('a')] }]);
});

test('moving duplicated tracks without removing any only reorders', () => {
    const orig = entries(['a', 'b', 'a', 'c']);
    const plan = planAndCheck(orig, moveTo(orig, 2, 0));
    assert.deepEqual(plan.ops, [{ op: 'reorder', rangeStart: 3, insertBefore: 1, rangeLength: 1 }]);
});

test('single move up is one reorder', () => {
    const orig = entries(['a', 'b', 'c', 'd', 'e']);
    const plan = planAndCheck(orig, moveTo(orig, 3, 1));
    assert.deepEqual(plan.ops, [{ op: 'reorder', rangeStart: 4, insertBefore: 2, rangeLength: 1 }]);
});

test('single move down is expressed as upward moves of the rows it passed', () => {
    const orig = entries(['a', 'b', 'c', 'd', 'e']);
    const fin = moveTo(orig, 1, 3);
    assert.deepEqual(ids(fin), ['a', 'c', 'd', 'b', 'e']);
    const plan = planAndCheck(orig, fin);
    assert.deepEqual(plan.ops, [
        { op: 'reorder', rangeStart: 3, insertBefore: 2, rangeLength: 1 },
        { op: 'reorder', rangeStart: 4, insertBefore: 3, rangeLength: 1 }
    ]);
});

test('several moves', () => {
    const orig = entries(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    let fin = moveTo(orig, 6, 0);
    fin = moveTo(fin, 2, 5);
    fin = moveTo(fin, 4, 1);
    planAndCheck(orig, fin);
    // Full reversal: every row but the last has to move.
    const reversed = [...orig].reverse();
    assert.equal(planAndCheck(orig, reversed).ops.length, orig.length - 1);
});

test('remove + move: the remove goes first and reorder positions are post-remove', () => {
    const orig = entries(['a', 'b', 'c', 'd', 'e']);
    const fin = moveTo(removeAt(orig, 0), 3, 0);
    assert.deepEqual(ids(fin), ['e', 'b', 'c', 'd']);
    const plan = planAndCheck(orig, fin);
    assert.deepEqual(plan.ops, [
        { op: 'remove', uris: [uri('a')] },
        { op: 'reorder', rangeStart: 4, insertBefore: 1, rangeLength: 1 }
    ]);
});

test('everything removed is a single remove of every distinct uri', () => {
    const orig = entries(['a', 'b', 'a', 'c']);
    const plan = planAndCheck(orig, []);
    assert.equal(plan.tracksChanged, true);
    assert.deepEqual(plan.ops, [{ op: 'remove', uris: [uri('a'), uri('b'), uri('c')] }]);
});

test('captured scenario: 30 tracks, remove the 3rd, then move index 5 to index 1', () => {
    // Captured from the pre-refactor build in a browser. The editor sends
    // these as playlist_items_remove {uris: 'spotify:track:t2', snapshot_id}
    // then playlist_items_reorder {range_start: 6, insert_before: 2,
    // range_length: 1, snapshot_id}.
    const orig = entries(Array.from({ length: 30 }, (_, k) => `t${k}`));
    const w = [...orig];
    w.splice(2, 1);
    const [moved] = w.splice(5, 1);
    w.splice(1, 0, moved);
    const plan = planAndCheck(orig, w);
    assert.deepEqual(plan, {
        tracksChanged: true,
        blocked: null,
        ops: [
            { op: 'remove', uris: ['spotify:track:t2'] },
            { op: 'reorder', rangeStart: 6, insertBefore: 2, rangeLength: 1 }
        ]
    });
});

test('one copy of a duplicate removed: replace up to the limit, blocked above it', () => {
    const many = (n) => entries(['dup', 'dup', ...Array.from({ length: n - 1 }, (_, k) => `t${k}`)]);

    // 101 rows -> 100 left: still fits a replace.
    const atLimit = many(REPLACE_MAX_ITEMS);
    const finAtLimit = removeAt(atLimit, 0);
    assert.equal(finAtLimit.length, REPLACE_MAX_ITEMS);
    const ok = planAndCheck(atLimit, finAtLimit);
    assert.equal(ok.ops.length, 1);
    assert.equal(ok.ops[0].op, 'replace');
    assert.equal(ok.ops[0].uris.length, REPLACE_MAX_ITEMS);

    // 102 rows -> 101 left: nothing can express it.
    const over = many(REPLACE_MAX_ITEMS + 1);
    assert.deepEqual(planPlaylistEdit(over, removeAt(over, 0)),
        { tracksChanged: true, blocked: BLOCKED_PARTIAL_DUPLICATE, ops: [] });

    // Removing BOTH copies from the long list is fine: a plain remove.
    assert.deepEqual(planAndCheck(over, over.slice(2)).ops, [{ op: 'remove', uris: [uri('dup')] }]);
});

test('a final list that is not made of the original rows aborts after the ops it could plan', () => {
    const orig = entries(['a', 'b', 'c']);
    const stranger = { key: 'spotify:track:c:99', item: { track: { uri: uri('c') } } };
    const plan = planPlaylistEdit(orig, [orig[1], orig[0], stranger]);
    assert.deepEqual(plan.ops, [
        { op: 'reorder', rangeStart: 2, insertBefore: 1, rangeLength: 1 },
        { op: 'abort', message: 'reorder diff diverged' }
    ]);
});

test('items without a track wrapper (album-style) are read the same way', () => {
    const orig = ['a', 'b', 'c'].map((id, i) => ({ key: `${uri(id)}:${i}`, item: { uri: uri(id) } }));
    assert.deepEqual(planAndCheck(orig, [orig[2], orig[0]]).ops, [
        { op: 'remove', uris: [uri('b')] },
        { op: 'reorder', rangeStart: 2, insertBefore: 1, rangeLength: 1 }
    ]);
});

test('randomized edits always plan to the desired list', () => {
    // mulberry32 — seeded, so the run is deterministic.
    let seed = 0x5eed1234;
    const rand = () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (n) => Math.floor(rand() * n);

    let replaces = 0, reorderPlans = 0, removePlans = 0;
    for (let round = 0; round < 400; round++) {
        const length = int(13);
        // A small pool makes duplicates common; a large one makes them rare.
        const pool = rand() < 0.5 ? 4 : 40;
        const orig = entries(Array.from({ length }, () => `t${int(pool)}`));
        let fin = [...orig];
        for (let edits = int(6); edits > 0 && fin.length > 0; edits--) {
            fin = rand() < 0.4 ? removeAt(fin, int(fin.length)) : moveTo(fin, int(fin.length), int(fin.length));
        }
        const plan = planAndCheck(orig, fin);
        assert.equal(plan.tracksChanged, !(fin.length === orig.length && fin.every((e, i) => e === orig[i])));
        if (!plan.tracksChanged) assert.deepEqual(plan.ops, []);
        if (plan.ops.some(o => o.op === 'replace')) { replaces++; assert.equal(plan.ops.length, 1); }
        if (plan.ops.some(o => o.op === 'reorder')) reorderPlans++;
        if (plan.ops.some(o => o.op === 'remove')) {
            removePlans++;
            assert.equal(plan.ops.findIndex(o => o.op === 'remove'), 0, 'the remove is always first');
        }
    }
    // The generator must actually reach every path.
    assert.ok(replaces > 20 && reorderPlans > 100 && removePlans > 50, `${replaces}/${reorderPlans}/${removePlans}`);
});
