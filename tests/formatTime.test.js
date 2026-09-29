import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime } from '../utils.js';

test('formatTime renders m:ss', () => {
    assert.equal(formatTime(0), '0:00');
    assert.equal(formatTime(5), '0:05');
    assert.equal(formatTime(65.9), '1:05');
    assert.equal(formatTime(3725), '62:05');
});

test('formatTime treats bad input as zero', () => {
    assert.equal(formatTime(-3), '0:00');
    assert.equal(formatTime(NaN), '0:00');
    assert.equal(formatTime(undefined), '0:00');
});
