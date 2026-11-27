// The open modal keeps the wheel to itself: a wheel event is cancelled
// unless something inside the modal can still scroll along it (otherwise
// the browser scrolls the dashboard behind the modal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canScrollAlong, wheelScrollsInside, touchScrollsInside } from '../src/utils.js';

const AUTO = { overflowX: 'hidden', overflowY: 'auto' };
const ROW = { overflowX: 'auto', overflowY: 'hidden' };
const NONE = { overflowX: 'visible', overflowY: 'visible' };
const box = (o = {}) => ({ nodeType: 1, scrollTop: 0, scrollLeft: 0, scrollHeight: 1000, scrollWidth: 300, clientHeight: 500, clientWidth: 300, style: AUTO, ...o });

test('canScrollAlong: a vertical scroll area scrolls down until its end, up until its top', () => {
    assert.equal(canScrollAlong(box(), 0, 100, AUTO), true, 'top, wheel down');
    assert.equal(canScrollAlong(box(), 0, -100, AUTO), false, 'top, wheel up');
    assert.equal(canScrollAlong(box({ scrollTop: 250 }), 0, -100, AUTO), true, 'middle, wheel up');
    assert.equal(canScrollAlong(box({ scrollTop: 500 }), 0, 100, AUTO), false, 'bottom, wheel down');
    assert.equal(canScrollAlong(box({ scrollTop: 499.5 }), 0, 100, AUTO), false, 'sub-pixel short of the bottom counts as the bottom');
});

test('canScrollAlong: no overflow, hidden overflow or nothing to scroll is not a scroll area', () => {
    assert.equal(canScrollAlong(box(), 0, 100, NONE), false);
    assert.equal(canScrollAlong(box(), 0, 100, { overflowX: 'hidden', overflowY: 'hidden' }), false);
    assert.equal(canScrollAlong(box({ scrollHeight: 500 }), 0, 100, AUTO), false);
    assert.equal(canScrollAlong(box(), 0, 100, { overflowX: 'hidden', overflowY: 'scroll' }), true);
});

test('canScrollAlong: a carousel scrolls sideways for deltaX, not for deltaY', () => {
    const row = box({ scrollWidth: 1200, clientWidth: 300, scrollHeight: 200, clientHeight: 200 });
    assert.equal(canScrollAlong(row, 100, 0, ROW), true);
    assert.equal(canScrollAlong(row, -100, 0, ROW), false, 'already at the start');
    assert.equal(canScrollAlong(row, 0, 100, ROW), false);
    assert.equal(canScrollAlong({ ...row, scrollLeft: 900 }, 100, 0, ROW), false, 'at the end');
});

const host = { nodeType: 1, name: 'host' };
const wheel = (path, deltaY, deltaX = 0) => ({ deltaX, deltaY, composedPath: () => path });
const styleOf = (el) => el.style || NONE;

test('wheelScrollsInside: true while a scroll area on the path below the host can take it', () => {
    const list = box();
    const row = { nodeType: 1 };
    assert.equal(wheelScrollsInside(wheel([row, list, host], 100), host, styleOf), true);
});

test('wheelScrollsInside: false at the end of the page, and over parts that do not scroll (header, backdrop)', () => {
    const list = box({ scrollTop: 500 });
    assert.equal(wheelScrollsInside(wheel([{ nodeType: 1 }, list, host], 100), host, styleOf), false, 'end of the page');
    assert.equal(wheelScrollsInside(wheel([{ nodeType: 1 }, { nodeType: 11 }, host], 100), host, styleOf), false, 'header');
});

test('wheelScrollsInside: an inner area at its end hands over to an outer one that still scrolls', () => {
    const inner = box({ scrollTop: 500 });
    const outer = box({ scrollTop: 100 });
    assert.equal(wheelScrollsInside(wheel([inner, outer, host], 100), host, styleOf), true);
});

test('wheelScrollsInside: elements above the host (the dashboard itself) never count', () => {
    const page = box();
    assert.equal(wheelScrollsInside(wheel([{ nodeType: 1 }, host, page], 100), host, styleOf), false);
});

// Touch screens: the same rule for a one-finger drag (finger up = content down).
const touch = (path, x, y) => ({ touches: [{ clientX: x, clientY: y }], composedPath: () => path });
const START = { x: 200, y: 400 };

test('touchScrollsInside: a finger dragging up scrolls a page down until its end', () => {
    assert.equal(touchScrollsInside(touch([box(), host], 200, 300), START, host, styleOf), true, 'top of the page');
    assert.equal(touchScrollsInside(touch([box({ scrollTop: 500 }), host], 200, 300), START, host, styleOf), false, 'end of the page');
    assert.equal(touchScrollsInside(touch([box({ scrollTop: 500 }), host], 200, 500), START, host, styleOf), true, 'end of the page, dragging back down');
});

test('touchScrollsInside: a drag over parts that do not scroll (header, backdrop) is not taken inside', () => {
    assert.equal(touchScrollsInside(touch([{ nodeType: 1 }, host], 200, 300), START, host, styleOf), false);
});

test('touchScrollsInside: only the main axis counts, so a near-vertical drag over a carousel at the page end is not taken', () => {
    const row = box({ scrollWidth: 1200, clientWidth: 300, scrollHeight: 200, clientHeight: 200, style: ROW });
    const pageEnd = box({ scrollTop: 500 });
    assert.equal(touchScrollsInside(touch([row, pageEnd, host], 190, 300), START, host, styleOf), false, 'mostly up, a little sideways');
    assert.equal(touchScrollsInside(touch([row, pageEnd, host], 100, 390), START, host, styleOf), true, 'mostly sideways');
});

test('touchScrollsInside: no movement yet is not cancelled', () => {
    assert.equal(touchScrollsInside(touch([{ nodeType: 1 }, host], 200, 400), START, host, styleOf), true);
});
