import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reorderList, dragTargetIndex, deviceTypeLabel, normalizeRename, unsavedLiveDevices } from '../utils.js';

test('reorderList moves an item and leaves the input untouched', () => {
    const src = ['a', 'b', 'c', 'd'];
    assert.deepEqual(reorderList(src, 0, 2), ['b', 'c', 'a', 'd']);
    assert.deepEqual(reorderList(src, 3, 0), ['d', 'a', 'b', 'c']);
    assert.deepEqual(src, ['a', 'b', 'c', 'd']);
});

test('reorderList returns a copy for no-op or out-of-range moves', () => {
    const src = ['a', 'b'];
    const same = reorderList(src, 1, 1);
    assert.deepEqual(same, src);
    assert.notEqual(same, src);
    assert.deepEqual(reorderList(src, 5, 0), src);
    assert.deepEqual(reorderList(src, 0, -1), src);
});

test('dragTargetIndex counts other rows above the pointer', () => {
    const mids = [50, 150, 250];
    assert.equal(dragTargetIndex(mids, 160, 0), 1);
    assert.equal(dragTargetIndex(mids, 40, 0), 0);
    assert.equal(dragTargetIndex(mids, 100, 2), 1);
    assert.equal(dragTargetIndex(mids, 300, 0), 2);
});

test('dragTargetIndex clamps for a single row and out-of-bounds pointers', () => {
    assert.equal(dragTargetIndex([50], 5000, 0), 0);
    assert.equal(dragTargetIndex([50], -5000, 0), 0);
    assert.equal(dragTargetIndex([], 10, 0), 0);
    assert.equal(dragTargetIndex([50, 150], 99999, 0), 1);
});

test('deviceTypeLabel maps Spotify device types to display words', () => {
    assert.equal(deviceTypeLabel('CastAudio'), 'Cast audio');
    assert.equal(deviceTypeLabel('castvideo'), 'Cast video');
    assert.equal(deviceTypeLabel('smartphone'), 'Smartphone');
    assert.equal(deviceTypeLabel('phone'), 'Smartphone');
    assert.equal(deviceTypeLabel('TV'), 'TV');
    assert.equal(deviceTypeLabel('stb'), 'Set-top box');
    assert.equal(deviceTypeLabel('audiodongle'), 'Audio dongle');
    assert.equal(deviceTypeLabel('avr'), 'AVR');
    assert.equal(deviceTypeLabel('computer'), 'Computer');
    assert.equal(deviceTypeLabel(''), 'Speaker');
    assert.equal(deviceTypeLabel(null), 'Speaker');
    assert.equal(deviceTypeLabel('gameConsole'), 'GameConsole');
});

test('normalizeRename trims and rejects empty or unchanged names', () => {
    assert.equal(normalizeRename('  Kitchen ', 'Office'), 'Kitchen');
    assert.equal(normalizeRename('   ', 'Office'), null);
    assert.equal(normalizeRename('', 'Office'), null);
    assert.equal(normalizeRename('Office', 'Office'), null);
    assert.equal(normalizeRename(undefined, 'Office'), null);
});

test('unsavedLiveDevices drops devices already saved by id', () => {
    const live = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'C', name: 'C' }];
    const saved = [{ id: 'b' }, { id: 'c' }];
    assert.deepEqual(unsavedLiveDevices(live, saved).map(d => d.id), ['a', 'C']);
    assert.deepEqual(unsavedLiveDevices(live, []), live);
    assert.deepEqual(unsavedLiveDevices([], saved), []);
});
