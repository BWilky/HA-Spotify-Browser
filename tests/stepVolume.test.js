import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepVolume } from '../src/utils.js';
import { ConfigParser } from '../src/config_parser.js';

test('stepVolume nudges by the step and clamps to 0..100', () => {
    assert.equal(stepVolume(50, +1, 2), 52);
    assert.equal(stepVolume(50, -1, 2), 48);
    assert.equal(stepVolume(99, +1, 2), 100);
    assert.equal(stepVolume(1, -1, 2), 0);
    assert.equal(stepVolume(100, +1, 2), 100);
    assert.equal(stepVolume(0, -1, 2), 0);
});

test('stepVolume rounds a fractional current level before stepping', () => {
    assert.equal(stepVolume(49.6, +1, 2), 52);
    assert.equal(stepVolume(undefined, +1, 2), 2);
});

test('devices.volume.step defaults to 2 and accepts 1..25', () => {
    const parse = (devices) => ConfigParser.parse({ entity: 'media_player.x', devices }).devices.volume.step;
    assert.equal(parse({}), 2);
    assert.equal(parse({ volume: { step: 5 } }), 5);
    assert.equal(parse({ volume: 30 }), 2);        // scalar shorthand keeps the default step
    assert.equal(parse({ volume: { step: 0 } }), 2);
    assert.equal(parse({ volume: { step: 'x' } }), 2);
    assert.equal(parse({ volume: { step: 50 } }), 25);
});
