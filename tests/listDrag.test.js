import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definedElement } from './helpers/elements.js';
import { ListDragController } from '../src/components/controllers/list-drag-controller.js';
import '../src/components/devices/device-manager-popup.js';

// Plain objects stand in for the DOM (no DOM under node --test).

function fakeTarget(extra = {}) {
    const listeners = new Map(); // type -> Set(fn)
    return Object.assign({
        listeners,
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(fn);
        },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        count() { let n = 0; for (const s of listeners.values()) n += s.size; return n; },
        fire(type, ev = {}) { for (const fn of [...(listeners.get(type) || [])]) fn(ev); },
    }, extra);
}

/** Three 50px rows at y = 0, 50, 100. */
function fakeList() {
    const rows = [0, 50, 100].map(top => ({ getBoundingClientRect: () => ({ top, bottom: top + 50, height: 50 }) }));
    return { querySelectorAll: () => rows };
}

function setup({ captureThrows = false } = {}) {
    const doc = fakeTarget();
    const handle = fakeTarget({
        ownerDocument: doc,
        captured: [],
        setPointerCapture(id) {
            if (captureThrows) throw new Error('NotFoundError: no active pointer');
            this.captured.push(id);
        },
    });
    const drops = [];
    const host = { updates: 0, controllers: [], requestUpdate() { this.updates++; }, addController(c) { this.controllers.push(c); } };
    const drag = new ListDragController(host, { itemSelector: '.row', onDrop: (...a) => drops.push(a) });
    const down = (extra = {}) => drag.start({ button: 0, pointerType: 'touch', pointerId: 7, currentTarget: handle, ...extra }, 0, fakeList());
    return { drag, handle, doc, drops, host, down };
}

test('ListDragController: a normal drag still drops on the list release, and stops watching', () => {
    const { drag, handle, doc, drops, down } = setup();
    down();
    assert.deepEqual(handle.captured, [7]);
    assert.equal(drag.active, true);
    assert.equal(handle.count(), 1, 'lostpointercapture on the handle');
    assert.deepEqual([...doc.listeners.keys()].sort(), ['lostpointercapture', 'pointercancel', 'pointerup']);
    drag.move({ clientY: 130 });
    drag.end({ pointerId: 7, target: handle }); // the list's @pointerup runs first...
    assert.deepEqual(drops, [[0, 2, 'after']]);
    assert.equal(handle.count() + doc.count(), 0);
    doc.fire('pointerup', { pointerId: 7 }); // ...so the bubbled copy has nothing left to do
    handle.fire('lostpointercapture', { pointerId: 7 });
    assert.deepEqual(drops, [[0, 2, 'after']]);
});

test('ListDragController: releasing outside the rows still drops nothing', () => {
    const { drag, drops, down } = setup();
    down();
    drag.move({ clientY: 400 });
    drag.end({ pointerId: 7 });
    assert.deepEqual(drops, []);
    assert.equal(drag.active, false);
});

test('ListDragController: setPointerCapture throwing (pointer already gone) starts no drag', () => {
    const { drag, handle, doc, host, down } = setup({ captureThrows: true });
    assert.doesNotThrow(() => down());
    assert.equal(drag.active, false);
    assert.equal(host.updates, 0);
    assert.equal(handle.count() + doc.count(), 0);
});

test('ListDragController: lost capture on the handle ends the drag without a drop', () => {
    const { drag, handle, doc, drops, host, down } = setup();
    down();
    drag.move({ clientY: 120 });
    const updates = host.updates;
    handle.fire('lostpointercapture', { pointerId: 7 });
    assert.equal(drag.active, false);
    assert.equal(drag.rowClass(2), '', 'drop indicator cleared');
    assert.ok(host.updates > updates, 're-rendered');
    assert.deepEqual(drops, []);
    assert.equal(handle.count() + doc.count(), 0);
    drag.end({ pointerId: 7 }); // a late list pointerup does nothing
    assert.deepEqual(drops, []);
});

test('ListDragController: handle re-rendered away — a release the list never sees ends the drag (document lostpointercapture / pointerup / pointercancel)', () => {
    for (const type of ['lostpointercapture', 'pointerup', 'pointercancel']) {
        const { drag, doc, drops, down } = setup();
        down();
        drag.move({ clientY: 120 });
        doc.fire(type, { pointerId: 8 }); // another pointer: ignored
        assert.equal(drag.active, true, `${type} of another pointer`);
        doc.fire(type, { pointerId: 7 });
        assert.equal(drag.active, false, type);
        assert.deepEqual(drops, [], type);
        assert.equal(doc.count(), 0, type);
    }
});

test('ListDragController: host disconnect mid-drag drops the drag and the document listeners', () => {
    const { drag, handle, doc, host, down } = setup();
    assert.equal(host.controllers[0], drag);
    down();
    drag.hostDisconnected();
    assert.equal(drag.active, false);
    assert.equal(handle.count() + doc.count(), 0);
});

test('ListDragController: a secondary mouse button starts no drag (unchanged)', () => {
    const { drag, handle, down } = setup();
    down({ pointerType: 'mouse', button: 2 });
    assert.equal(drag.active, false);
    assert.deepEqual(handle.captured, []);
});

test('device manager: only the primary button starts a grip drag', () => {
    globalThis.window.dispatchEvent ??= () => true; // fireHaptic
    const Popup = definedElement('spotify-popup-devicemanager');
    const make = () => {
        const el = Object.create(Popup.prototype);
        el._editingId = null;
        el._dragIndex = null;
        el._savedDevices = [{ id: 'a' }, { id: 'b' }];
        el._recordMids = () => {};
        return el;
    };
    const grip = () => fakeTarget({ setPointerCapture() {}, releasePointerCapture() {} });
    const ev = (extra) => ({ pointerId: 1, clientY: 10, preventDefault() {}, currentTarget: grip(), ...extra });

    const right = make();
    right._onGripDown(ev({ pointerType: 'mouse', button: 2 }), 0);
    assert.equal(right._dragIndex, null, 'right click');

    const middle = make();
    middle._onGripDown(ev({ pointerType: 'mouse', button: 1 }), 0);
    assert.equal(middle._dragIndex, null, 'middle click');

    const left = make();
    left._onGripDown(ev({ pointerType: 'mouse', button: 0 }), 1);
    assert.equal(left._dragIndex, 1, 'left click');

    const finger = make();
    finger._onGripDown(ev({ pointerType: 'touch', button: 0 }), 0);
    assert.equal(finger._dragIndex, 0, 'touch');
});
