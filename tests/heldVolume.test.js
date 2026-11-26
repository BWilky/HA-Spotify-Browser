import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heldVolume } from '../src/utils.js';

// Optimistic volume hold for the mobile Connect sheet: after the user sets a
// level, keep showing it until the player state catches up or the hold expires.

test('heldVolume shows the state volume when nothing is held', () => {
    assert.deepEqual(heldVolume(37.4, null, 1000), { volume: 37, hold: null });
});

test('heldVolume keeps the user value while state is stale and the hold is live', () => {
    const hold = { value: 60, until: 4000 };
    assert.deepEqual(heldVolume(30, hold, 1000), { volume: 60, hold });
});

test('heldVolume releases early once state matches the user value', () => {
    const hold = { value: 60, until: 4000 };
    assert.deepEqual(heldVolume(60.2, hold, 1000), { volume: 60, hold: null });
});

test('heldVolume releases when the hold expires even if state never caught up', () => {
    const hold = { value: 60, until: 4000 };
    assert.deepEqual(heldVolume(30, hold, 4000), { volume: 30, hold: null });
});
