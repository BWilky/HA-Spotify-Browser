import { test } from 'node:test';
import assert from 'node:assert/strict';
import { popoverPosition } from '../utils.js';

const size = { width: 270, height: 200 };
const full = { left: 0, top: 0, width: 1000, height: 800 };

test('popoverPosition opens below the anchor, 6px down, aligned left', () => {
    const anchor = { left: 100, top: 100, right: 144, bottom: 144 };
    assert.deepEqual(popoverPosition(anchor, full, size), { left: 100, top: 150, origin: 'bottom left' });
});

test('popoverPosition converts viewport anchors into the overlay\'s own coordinates', () => {
    // The overlay (and the card) live in a containing block that starts at (300, 70).
    const bounds = { left: 300, top: 70, width: 1200, height: 835 };
    const anchor = { left: 1087, top: 351, right: 1131, bottom: 395 };
    assert.deepEqual(popoverPosition(anchor, bounds, { width: 256, height: 204 }),
        { left: 787, top: 331, origin: 'bottom left' });
});

test('popoverPosition flips above the anchor when it would run off the bottom', () => {
    const anchor = { left: 100, top: 700, right: 144, bottom: 744 };
    assert.deepEqual(popoverPosition(anchor, full, size), { left: 100, top: 494, origin: 'top left' });
});

test('popoverPosition clamps to 8px inside the right and top edges', () => {
    const right = { left: 900, top: 100, right: 944, bottom: 144 };
    assert.equal(popoverPosition(right, full, size).left, 722);
    const top = { left: 100, top: 2, right: 144, bottom: 4 };
    // Below fits (10 + 200 < 792), so it stays below and is not clamped.
    assert.equal(popoverPosition(top, full, size).top, 10);
});

test('popoverPosition centers in the overlay when there is no anchor', () => {
    assert.deepEqual(popoverPosition(null, full, size), { left: 365, top: 300, origin: 'bottom left' });
});
