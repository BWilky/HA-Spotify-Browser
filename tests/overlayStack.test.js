import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOverlayStack, registerOverlay } from '../components/controllers/overlay-stack.js';

/** Minimal EventTarget stand-in that records listener churn. */
function fakeTarget() {
    const listeners = new Set();
    return {
        adds: 0, removes: 0,
        addEventListener(type, fn) { assert.equal(type, 'keydown'); listeners.add(fn); this.adds++; },
        removeEventListener(type, fn) { listeners.delete(fn); this.removes++; },
        get count() { return listeners.size; },
        press(init = {}) {
            const e = {
                key: 'Escape', isComposing: false, keyCode: 27, defaultPrevented: false,
                ...init,
                preventDefault() { this.defaultPrevented = true; },
            };
            for (const fn of [...listeners]) fn(e);
            return e;
        },
    };
}

function entry(log, name, ret) {
    return { name, close: () => { log.push(name); return ret; } };
}

test('listener exists only while the stack is non-empty', () => {
    const t = fakeTarget();
    const s = createOverlayStack(t);
    assert.equal(t.count, 0);
    const a = s.push({ close() {} });
    const b = s.push({ close() {} });
    assert.equal(t.count, 1);
    assert.equal(t.adds, 1, 'one listener, not one per overlay');
    s.remove(a);
    assert.equal(t.count, 1);
    s.remove(b);
    assert.equal(t.count, 0);
    assert.equal(s.listening, false);
});

test('Escape closes only the top of three, then the next', () => {
    const t = fakeTarget();
    const s = createOverlayStack(t);
    const log = [];
    const a = s.push(entry(log, 'a'));
    const b = s.push(entry(log, 'b'));
    const c = s.push(entry(log, 'c'));
    const e = t.press();
    assert.deepEqual(log, ['c']);
    assert.equal(e.defaultPrevented, true);
    // The overlay's host reacts to close by hiding it, which removes it.
    s.remove(c);
    t.press();
    assert.deepEqual(log, ['c', 'b']);
    s.remove(b);
    t.press();
    assert.deepEqual(log, ['c', 'b', 'a']);
    s.remove(a);
    assert.equal(t.count, 0);
});

test('removing from the middle keeps the top', () => {
    const t = fakeTarget();
    const s = createOverlayStack(t);
    const log = [];
    const a = s.push(entry(log, 'a'));
    const b = s.push(entry(log, 'b'));
    const c = s.push(entry(log, 'c'));
    s.remove(b);
    assert.equal(s.top(), c);
    assert.equal(s.size, 2);
    t.press();
    assert.deepEqual(log, ['c']);
    s.remove(c);
    assert.equal(s.top(), a);
});

test('re-opening the same entry moves it to the top without duplicating it', () => {
    const t = fakeTarget();
    const s = createOverlayStack(t);
    const log = [];
    const a = s.push(entry(log, 'a'));
    s.push(entry(log, 'b'));
    s.push(a);
    assert.equal(s.size, 2);
    assert.equal(s.top(), a);
    t.press();
    assert.deepEqual(log, ['a']);
    s.remove(a);
    assert.equal(s.size, 1, 'a single remove clears it');
});

test('remove of an absent entry is a no-op; double unregister is harmless', () => {
    const t = fakeTarget();
    const s = createOverlayStack(t);
    s.remove({ close() {} });
    assert.equal(t.count, 0);
    const unregister = registerOverlay(() => {}, s);
    assert.equal(s.size, 1);
    unregister();
    unregister();
    assert.equal(s.size, 0);
    assert.equal(t.count, 0);
});

test('tear-down of everything open (DOM removed) leaves no entries and no listener', () => {
    const t = fakeTarget();
    const s = createOverlayStack(t);
    const unregs = [1, 2, 3].map(() => registerOverlay(() => {}, s));
    // disconnectedCallback order is arbitrary
    unregs[1](); unregs[0](); unregs[2]();
    assert.equal(s.size, 0);
    assert.equal(t.count, 0);
    // and a later open works again
    registerOverlay(() => {}, s);
    assert.equal(t.count, 1);
});

test('IME composition does not close anything', () => {
    const t = fakeTarget();
    const s = createOverlayStack(t);
    const log = [];
    s.push(entry(log, 'a'));
    const e1 = t.press({ isComposing: true });
    const e2 = t.press({ keyCode: 229 });
    assert.deepEqual(log, []);
    assert.equal(e1.defaultPrevented, false);
    assert.equal(e2.defaultPrevented, false);
});

test('Escape already handled inside the overlay (defaultPrevented) is ignored', () => {
    const t = fakeTarget();
    const s = createOverlayStack(t);
    const log = [];
    s.push(entry(log, 'a'));
    t.press({ defaultPrevented: true });
    assert.deepEqual(log, []);
});

test('other keys are ignored', () => {
    const t = fakeTarget();
    const s = createOverlayStack(t);
    const log = [];
    s.push(entry(log, 'a'));
    const e = t.press({ key: 'Enter' });
    assert.deepEqual(log, []);
    assert.equal(e.defaultPrevented, false);
});

test('a top entry that declines (opted out of Escape) shields those below', () => {
    const t = fakeTarget();
    const s = createOverlayStack(t);
    const log = [];
    s.push(entry(log, 'below'));
    s.push(entry(log, 'no-escape', false));
    const e = t.press();
    assert.deepEqual(log, ['no-escape']);
    assert.equal(e.defaultPrevented, false, 'declined: the key is left alone');
});

test('a null target (no window, e.g. node) still tracks order', () => {
    const s = createOverlayStack(null);
    const a = s.push({ close() {} });
    assert.equal(s.top(), a);
    assert.equal(s.listening, false);
    s.remove(a);
    assert.equal(s.size, 0);
});
