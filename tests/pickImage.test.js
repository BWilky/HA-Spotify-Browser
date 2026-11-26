import test from 'node:test';
import assert from 'node:assert/strict';
import { pickImage, getItemImage, IMG_THUMB, IMG_CARD } from '../src/utils.js';

const album = [
    { url: 'a640', width: 640, height: 640 },
    { url: 'a300', width: 300, height: 300 },
    { url: 'a64', width: 64, height: 64 },
];
const artist = [
    { url: 'r640', width: 640, height: 640 },
    { url: 'r320', width: 320, height: 320 },
    { url: 'r160', width: 160, height: 160 },
];

test('pickImage returns the first (largest) image when no size is asked for', () => {
    assert.equal(pickImage(album), 'a640');
    assert.equal(pickImage(album, 0), 'a640');
});

test('pickImage returns the smallest image at least minPx wide', () => {
    assert.equal(pickImage(album, IMG_THUMB), 'a64');
    assert.equal(pickImage(album, IMG_CARD), 'a300');
    assert.equal(pickImage(album, 301), 'a640');
    assert.equal(pickImage(artist, IMG_THUMB), 'r160');
    assert.equal(pickImage(artist, IMG_CARD), 'r320');
});

test('pickImage does not depend on the array being sorted', () => {
    assert.equal(pickImage([album[2], album[0], album[1]], IMG_CARD), 'a300');
});

test('pickImage falls back to the first image when nothing qualifies or sizes are unknown', () => {
    assert.equal(pickImage(album, 2000), 'a640');
    const unsized = [{ url: 'mosaic', width: null, height: null }, { url: 'other' }];
    assert.equal(pickImage(unsized, IMG_THUMB), 'mosaic');
    // A sized entry that qualifies wins over unsized ones.
    assert.equal(pickImage([{ url: 'u', width: null }, { url: 's', width: 300 }], IMG_THUMB), 's');
});

test('pickImage handles empty and malformed input', () => {
    assert.equal(pickImage(undefined, IMG_THUMB), '');
    assert.equal(pickImage([], IMG_THUMB), '');
    assert.equal(pickImage([{ width: 64 }], IMG_THUMB), '');
    assert.equal(pickImage([null, { url: 'ok', width: 64 }], IMG_THUMB), 'ok');
});

test('getItemImage keeps its old result without a size and sizes every item shape with one', () => {
    const track = { type: 'track', album: { images: album } };
    assert.equal(getItemImage(track), 'a640');
    assert.equal(getItemImage(track, 'track', IMG_THUMB), 'a64');
    assert.equal(getItemImage({ type: 'album', images: album }, undefined, IMG_CARD), 'a300');
    assert.equal(getItemImage({ type: 'artist', images: artist }, 'artist', IMG_THUMB), 'r160');
    assert.equal(getItemImage({ track: { album: { images: album } } }, undefined, IMG_THUMB), 'a64');
    // Flattened pinned items carry a single pre-resolved URL.
    assert.equal(getItemImage({ image: 'pinned-url', images: album }, 'album', IMG_THUMB), 'pinned-url');
    assert.equal(getItemImage(null, 'album', IMG_THUMB), '');
});
