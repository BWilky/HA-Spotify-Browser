import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DragDismissController, slideOut } from '../src/components/controllers/drag-dismiss-controller.js';

// Plain objects stand in for the DOM: an element is { style, offsetHeight }
// plus a listener registry; the window is a listener registry.

function fakeTarget() {
    const listeners = new Map(); // type -> Set(fn)
    return {
        listeners,
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(fn);
        },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        count() { let n = 0; for (const s of listeners.values()) n += s.size; return n; },
        fire(type, ev = {}) { for (const fn of [...(listeners.get(type) || [])]) fn(ev); },
    };
}

function fakeEl(offsetHeight = 0) {
    return Object.assign(fakeTarget(), { style: { transform: '', transition: '', opacity: '' }, offsetHeight });
}

function move(win, clientY) {
    const ev = { clientY, prevented: false, preventDefault() { this.prevented = true; } };
    win.fire('pointermove', ev);
    return ev;
}

// The app panel's options (spotify-browser-app.js).
const APP_RELEASE = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
function appPanel(t, { desktop = false } = {}) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const win = fakeTarget();
    const panel = fakeEl(800);
    const backdrop = fakeEl();
    const host = { controllers: [], addController(c) { this.controllers.push(c); }, isOpen: true, closeCount: 0 };
    const drag = new DragDismissController(host, {
        canStart: () => !desktop,
        getPanel: () => panel,
        getBackdrop: () => backdrop,
        threshold: 140,
        fadeDistance: 500,
        releaseTransition: APP_RELEASE,
        onDismiss: ({ panel: p, backdrop: b }) => slideOut(p, b, {
            transition: APP_RELEASE, fadeBackdrop: false, settleMs: 360,
            onSettled: () => { host.isOpen = false; host.closeCount++; },
        }),
        onSnapBack: ({ panel: p }) => { setTimeout(() => { p.style.transition = ''; }, 320); },
        eventTarget: win,
    });
    return { drag, win, panel, backdrop, host, tick: (ms) => t.mock.timers.tick(ms) };
}

// A bottom sheet's options (bottom-sheet.js).
function sheet(t, { height = 400, modal = false } = {}) {
    if (!t.__timers) { t.mock.timers.enable({ apis: ['setTimeout'] }); t.__timers = true; }
    const win = fakeTarget();
    const panel = fakeEl(height);
    const backdrop = fakeEl();
    const closes = [];
    const host = { controllers: [], addController(c) { this.controllers.push(c); } };
    const drag = new DragDismissController(host, {
        canStart: () => !modal,
        getPanel: () => panel,
        getBackdrop: () => backdrop,
        threshold: (h) => Math.min(140, h * 0.3),
        fadeDistance: (h) => h,
        preventDefault: true,
        releaseTransition: '',
        onDismiss: ({ panel: p, backdrop: b }) => slideOut(p, b, {
            settleMs: 420, waitForTransitionEnd: false,
            onStart: () => closes.push({ transform: p.style.transform, opacity: b.style.opacity }),
        }),
        eventTarget: win,
    });
    return { drag, win, panel, backdrop, closes, host, tick: (ms) => t.mock.timers.tick(ms) };
}

test('registers with the host', (t) => {
    const { drag, host } = appPanel(t);
    assert.equal(host.controllers[0], drag);
});

test('app panel: follows the finger, fades the backdrop over 500px, never moves up', (t) => {
    const { drag, win, panel, backdrop } = appPanel(t);
    drag.start({ clientY: 100 });
    assert.equal(panel.style.transition, 'none');
    const ev = move(win, 200);
    assert.equal(ev.prevented, false, 'the app panel does not preventDefault');
    assert.equal(panel.style.transform, 'translateY(100px)');
    assert.equal(backdrop.style.opacity, '0.8');
    move(win, 50);
    assert.equal(panel.style.transform, 'translateY(0px)');
    assert.equal(backdrop.style.opacity, '1');
    move(win, 900);
    assert.equal(backdrop.style.opacity, '0');
});

test('app panel: a short drag springs back, the transition is cleared after 320ms', (t) => {
    const { drag, win, panel, backdrop, host, tick } = appPanel(t);
    drag.start({ clientY: 100 });
    move(win, 240); // exactly 140: not past the threshold
    win.fire('pointerup');
    assert.equal(panel.style.transform, '');
    assert.equal(backdrop.style.opacity, '');
    assert.equal(panel.style.transition, APP_RELEASE);
    tick(319);
    assert.equal(panel.style.transition, APP_RELEASE);
    tick(1);
    assert.equal(panel.style.transition, '');
    assert.equal(host.isOpen, true);
});

test('app panel: past 140px it slides out, then closes and clears its styles (360ms or transitionend)', (t) => {
    const { drag, win, panel, backdrop, host, tick } = appPanel(t);
    drag.start({ clientY: 100 });
    move(win, 241);
    win.fire('pointerup');
    assert.equal(panel.style.transition, APP_RELEASE);
    assert.equal(panel.style.transform, 'translateY(100%)');
    assert.equal(backdrop.style.opacity, String(1 - 141 / 500), 'backdrop left where the drag put it');
    assert.equal(host.isOpen, true, 'closes after the slide, not before');
    tick(359);
    assert.equal(host.isOpen, true);
    tick(1);
    assert.equal(host.isOpen, false);
    assert.deepEqual([panel.style.transform, panel.style.transition, backdrop.style.opacity], ['', '', '']);
});

test('app panel: transitionend settles the slide early, and only once', (t) => {
    const { drag, win, panel, host, tick } = appPanel(t);
    drag.start({ clientY: 0 });
    move(win, 300);
    win.fire('pointercancel'); // a cancel releases like a pointerup
    panel.fire('transitionend', { target: panel });
    assert.equal(host.isOpen, false);
    assert.equal(panel.style.transform, '');
    tick(360);
    assert.equal(host.closeCount, 1);
});

test('app panel: no drag on the desktop layout', (t) => {
    const { drag, win, panel } = appPanel(t, { desktop: true });
    drag.start({ clientY: 100 });
    assert.equal(drag.dragging, false);
    assert.equal(win.count(), 0);
    assert.equal(panel.style.transition, '');
});

test('sheet: threshold is min(140, 30% of the height); fade distance is the height', (t) => {
    const { drag, win, panel, backdrop } = sheet(t, { height: 400 });
    drag.start({ clientY: 0 });
    const ev = move(win, 100);
    assert.equal(ev.prevented, true, 'the sheet owns the vertical drag');
    assert.equal(panel.style.transform, 'translateY(100px)');
    assert.equal(backdrop.style.opacity, '0.75');
    move(win, 120); // 30% of 400: not past it
    win.fire('pointerup');
    assert.equal(panel.style.transform, '', 'springs back');
    assert.equal(panel.style.transition, '', 'back to the CSS spring');
    assert.equal(backdrop.style.opacity, '');
});

test('sheet: past the threshold it closes at once with the panel already sliding, styles cleared after 420ms', (t) => {
    const { drag, win, panel, backdrop, closes, tick } = sheet(t, { height: 400 });
    drag.start({ clientY: 0 });
    move(win, 121);
    win.fire('pointerup');
    assert.deepEqual(closes, [{ transform: 'translateY(100%)', opacity: '0' }]);
    assert.equal(panel.style.transition, '');
    panel.fire('transitionend'); // the sheet waits for the timer only
    assert.equal(panel.style.transform, 'translateY(100%)');
    tick(420);
    assert.deepEqual([panel.style.transform, backdrop.style.opacity], ['', '']);
    assert.equal(closes.length, 1);
});

test('sheet: a tall sheet uses 140px; an unmeasured one (height 0) falls back to 500', (t) => {
    const tall = sheet(t, { height: 1000 });
    tall.drag.start({ clientY: 0 });
    move(tall.win, 141);
    tall.win.fire('pointerup');
    assert.equal(tall.closes.length, 1);

    const flat = sheet(t, { height: 0 });
    flat.drag.start({ clientY: 0 });
    move(flat.win, 125);
    assert.equal(flat.backdrop.style.opacity, String(1 - 125 / 500));
    flat.win.fire('pointerup');
    assert.equal(flat.closes.length, 0, '125 < min(140, 150)');
});

test('sheet: the desktop popup variant does not drag', (t) => {
    const { drag, win } = sheet(t, { modal: true });
    drag.start({ clientY: 0 });
    assert.equal(win.count(), 0);
});

test('listeners: added on pointerdown, removed on pointerup and on pointercancel', (t) => {
    const { drag, win } = appPanel(t);
    assert.equal(win.count(), 0);
    drag.start({ clientY: 0 });
    assert.deepEqual([...win.listeners.keys()].sort(), ['pointercancel', 'pointermove', 'pointerup']);
    assert.equal(win.count(), 3);
    win.fire('pointerup');
    assert.equal(win.count(), 0);
    drag.start({ clientY: 0 });
    win.fire('pointercancel');
    assert.equal(win.count(), 0);
    assert.equal(drag.dragging, false);
});

test('listeners: removed when the host disconnects mid-drag; the panel is left alone', (t) => {
    const { drag, win, panel, host } = appPanel(t);
    drag.start({ clientY: 0 });
    move(win, 300);
    host.controllers[0].hostDisconnected();
    assert.equal(win.count(), 0);
    assert.equal(drag.dragging, false);
    assert.equal(panel.style.transform, 'translateY(300px)');
    drag._end(); // a stray release after the disconnect does nothing
    assert.equal(host.isOpen, true);
});

test('no panel: nothing starts', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const win = fakeTarget();
    const drag = new DragDismissController({}, { getPanel: () => null, eventTarget: win });
    drag.start({ clientY: 0 });
    assert.equal(drag.dragging, false);
    assert.equal(win.count(), 0);
});

test('slideOut without a transition leaves the panel transition alone', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const panel = fakeEl();
    panel.style.transition = 'keep';
    slideOut(panel, null, { settleMs: 100 });
    assert.equal(panel.style.transform, 'translateY(100%)');
    t.mock.timers.tick(100);
    assert.equal(panel.style.transition, 'keep');
    assert.equal(panel.style.transform, '');
});

test('slideOut with a transition (the animated close button): sets it, fades, clears it all after settling', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const panel = fakeEl();
    const backdrop = fakeEl();
    let closed = 0;
    slideOut(panel, backdrop, {
        transition: 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)', settleMs: 420,
        onSettled: () => { closed++; },
    });
    assert.equal(panel.style.transition, 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)');
    assert.equal(backdrop.style.opacity, '0');
    t.mock.timers.tick(419);
    assert.equal(closed, 0);
    t.mock.timers.tick(1);
    assert.equal(closed, 1);
    assert.deepEqual([panel.style.transform, panel.style.transition, backdrop.style.opacity], ['', '', '']);
});

test('slideOut ignores transitionend bubbling up from a child; the panel\'s own ends it', async () => {
    const { slideOut } = await import('../src/components/controllers/drag-dismiss-controller.js');
    const listeners = [];
    const panel = { style: {}, addEventListener: (t, fn) => listeners.push(fn), removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
    let settled = 0;
    slideOut(panel, null, { settleMs: 5, onSettled: () => settled++ }); // checked synchronously, before the 5 ms fallback
    listeners.slice().forEach(fn => fn({ target: { child: true } }));
    assert.equal(settled, 0, 'a child transition does not finish the slide');
    listeners.slice().forEach(fn => fn({ target: panel }));
    assert.equal(settled, 1, 'the panel\'s own transition does');
});

test('second finger (B19): its pointerdown does not restart the drag; its moves and release are ignored', (t) => {
    const { drag, win, panel, host } = appPanel(t);
    drag.start({ clientY: 100, pointerId: 1 });
    drag.start({ clientY: 500, pointerId: 2 }); // second finger lands on the header
    win.fire('pointermove', { clientY: 700, pointerId: 2, preventDefault() {} });
    assert.equal(panel.style.transform, '', 'the second finger does not move the panel');
    win.fire('pointermove', { clientY: 160, pointerId: 1, preventDefault() {} });
    assert.equal(panel.style.transform, 'translateY(60px)', 'the first finger still drags from where it started');
    win.fire('pointerup', { pointerId: 2 });
    assert.equal(drag.dragging, true, 'the second finger lifting does not end it');
    win.fire('pointermove', { clientY: 400, pointerId: 1, preventDefault() {} });
    win.fire('pointerup', { pointerId: 1 });
    assert.equal(drag.dragging, false);
    assert.equal(win.count(), 0);
    t.mock.timers.tick(400);
    assert.equal(host.isOpen, false, '300px with the first finger closes it');
});
