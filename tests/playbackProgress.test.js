import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { playbackProgress } from '../src/utils.js';

const T0 = Date.parse('2026-01-01T12:00:00Z');
const at = (ms) => new Date(T0 + ms).toISOString();

// A frozen clock, so `now`-anchored results are exact. The real clock sits
// well away from `now` in every test, which also checks that `now` (not the
// clock) is what the extrapolation is anchored to.
beforeEach(() => mock.timers.enable({ apis: ['Date'], now: T0 + 3_600_000 }));
afterEach(() => mock.timers.reset());

/** An entity state; pass `position: undefined` / `duration: undefined` to omit that attribute. */
function entity(opts = {}) {
    const { state = 'playing', updated = 0, position = 30, duration = 200, ...attrs } = opts;
    const attributes = { ...attrs };
    if (!('position' in opts) || opts.position !== undefined) attributes.media_position = position;
    if (!('duration' in opts) || opts.duration !== undefined) attributes.media_duration = duration;
    return { state, last_updated: at(updated), attributes };
}

test('playing: position extrapolates from last_updated to now', () => {
    assert.deepEqual(playbackProgress(entity(), null, T0 + 5000), { position: 35, duration: 200 });
});

test('paused: position is media_position however much time has passed', () => {
    assert.deepEqual(playbackProgress(entity({ state: 'paused' }), null, T0 + 60000), { position: 30, duration: 200 });
});

test('without `now` it extrapolates against the current time', () => {
    const s = { state: 'playing', last_updated: new Date(Date.now() - 2000).toISOString(),
        attributes: { media_position: 10, media_duration: 100 } };
    assert.deepEqual(playbackProgress(s, null), { position: 12, duration: 100 });
});

test('clamps a position past the end to the duration', () => {
    assert.deepEqual(playbackProgress(entity({ position: 190 }), null, T0 + 60000), { position: 200, duration: 200 });
});

test('clamps a negative extrapolation (clock skew) to 0', () => {
    assert.deepEqual(playbackProgress(entity({ position: 1 }), null, T0 - 5000), { position: 0, duration: 200 });
});

test('HA duration wins over the track duration', () => {
    const r = playbackProgress(entity(), { duration_ms: 999000, progress_ms: 1000 }, T0);
    assert.deepEqual(r, { position: 30, duration: 200 });
});

test('no media_duration: falls back to track.duration_ms and track.progress_ms', () => {
    const s = entity({ duration: undefined, position: undefined });
    assert.deepEqual(playbackProgress(s, { duration_ms: 180000, progress_ms: 45000 }, T0), { position: 45, duration: 180 });
});

test('no media_duration and no progress_ms: duration from the track, position from the entity', () => {
    const s = entity({ state: 'paused', duration: undefined, position: 12 });
    assert.deepEqual(playbackProgress(s, { duration_ms: 180000 }, T0), { position: 12, duration: 180 });
});

test('fallback progress is clamped to the fallback duration', () => {
    const s = entity({ duration: undefined, position: undefined });
    assert.deepEqual(playbackProgress(s, { duration_ms: 1000, progress_ms: 5000 }, T0), { position: 1, duration: 1 });
});

test('no duration anywhere: duration 0 and the position is not clamped to it', () => {
    const s = entity({ state: 'paused', duration: undefined, position: 7 });
    assert.deepEqual(playbackProgress(s, {}, T0), { position: 7, duration: 0 });
});

test('missing inputs return zeros', () => {
    assert.deepEqual(playbackProgress(null, null), { position: 0, duration: 0 });
    assert.deepEqual(playbackProgress(undefined, undefined, T0), { position: 0, duration: 0 });
    assert.deepEqual(playbackProgress({ state: 'idle' }, null, T0), { position: 0, duration: 0 });
});

test('no entity but a track: the track fallback still applies', () => {
    assert.deepEqual(playbackProgress(null, { duration_ms: 200000, progress_ms: 20000 }, T0), { position: 20, duration: 200 });
});
