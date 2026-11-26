/**
 * Pointer-drag list reordering, extracted from the pinned-items reorder
 * dialog's proven mechanics: pointer capture on the drag handle, a one-time
 * layout snapshot of every row's rect (no reflow per pointermove), midpoint
 * hit-testing for before/after drop indicators, splice on release.
 *
 * Host wiring:
 *   - row/handle:  @pointerdown=${(e) => ctrl.start(e, index, listEl)}
 *   - list:        @pointermove=${(e) => ctrl.move(e)}
 *                  @pointerup / @pointercancel=${(e) => ctrl.end(e)}
 *   - row classes: ctrl.rowClass(index) -> 'dragging ghost' / 'drop-before' / …
 *   - CSS:         the handle (or row) needs `touch-action: none`
 *
 * The controller calls host.requestUpdate() when its visual state changes and
 * onDrop(from, to, position) once per completed drag.
 *
 * A drag whose pointer capture is lost before the list sees the release (the
 * handle was re-rendered away, so pointerup lands elsewhere) is dropped with
 * no move. Browsers differ: Chromium fires no lostpointercapture for a
 * removed handle (only a pointerup on whatever is under the pointer); the
 * spec has lostpointercapture fired at the document. So while a drag
 * runs the controller also watches the handle and its document for
 * lostpointercapture / pointerup / pointercancel of that pointer; the list's
 * own pointerup handler runs first in the normal case, so these only act
 * when it never got the release.
 */
export class ListDragController {
    constructor(host, { itemSelector, onDrop, isDraggable = null }) {
        this.host = host;
        this.itemSelector = itemSelector;
        this.onDrop = onDrop;
        this.isDraggable = isDraggable;
        this.dragIndex = null;
        this.dropIndex = null;
        this.dropPosition = null;
        this._rects = [];
        this._watch = null; // { handle, doc, pointerId } while a drag runs
        this._onLostRelease = this._onLostRelease.bind(this);
        host.addController?.(this);
    }

    get active() {
        return this.dragIndex !== null;
    }

    start(e, index, listEl) {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (this.isDraggable && !this.isDraggable(index)) return;
        if (!listEl) return;

        const handle = e.currentTarget;
        try {
            handle.setPointerCapture(e.pointerId);
        } catch (_) {
            return; // the pointer is already gone: no release would ever end this drag
        }
        this._watchRelease(handle, e.pointerId);
        this.dragIndex = index;

        // Layout snapshot up front: O(1) hit-testing per pointermove.
        const items = Array.from(listEl.querySelectorAll(this.itemSelector));
        this._rects = items.map((item, idx) => {
            const rect = item.getBoundingClientRect();
            return { index: idx, top: rect.top, bottom: rect.bottom, midpoint: rect.top + rect.height / 2 };
        });
        this.host.requestUpdate();
    }

    move(e) {
        if (this.dragIndex === null) return;
        const y = e.clientY;
        let found = null;
        let pos = null;
        for (const r of this._rects) {
            if (y >= r.top && y <= r.bottom) {
                found = r.index;
                pos = y < r.midpoint ? 'before' : 'after';
                break;
            }
        }
        if (this.dropIndex !== found || this.dropPosition !== pos) {
            this.dropIndex = found;
            this.dropPosition = pos;
            this.host.requestUpdate();
        }
    }

    end(e) {
        if (this.dragIndex === null) return;
        const { dragIndex, dropIndex, dropPosition } = this;
        this._reset();
        if (e?.target?.releasePointerCapture) {
            try { e.target.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
        }
        if (dropIndex !== null && dragIndex !== dropIndex) {
            this.onDrop(dragIndex, dropIndex, dropPosition);
        }
        this.host.requestUpdate();
    }

    /** Drop an in-progress drag without moving anything. */
    cancel() {
        if (this.dragIndex === null) return;
        this._reset();
        this.host.requestUpdate();
    }

    hostDisconnected() {
        this._reset(); // removed mid-drag: drop the drag and the document listeners
    }

    _reset() {
        this.dragIndex = null;
        this.dropIndex = null;
        this.dropPosition = null;
        this._rects = [];
        this._unwatchRelease();
    }

    _watchRelease(handle, pointerId) {
        this._unwatchRelease();
        const doc = handle.ownerDocument || null;
        this._watch = { handle, doc, pointerId };
        handle.addEventListener('lostpointercapture', this._onLostRelease);
        for (const type of ['lostpointercapture', 'pointerup', 'pointercancel']) {
            doc?.addEventListener(type, this._onLostRelease);
        }
    }

    _unwatchRelease() {
        const w = this._watch;
        if (!w) return;
        this._watch = null;
        w.handle.removeEventListener('lostpointercapture', this._onLostRelease);
        for (const type of ['lostpointercapture', 'pointerup', 'pointercancel']) {
            w.doc?.removeEventListener(type, this._onLostRelease);
        }
    }

    /** The drag's pointer was released or lost its capture and the list never saw it. */
    _onLostRelease(e) {
        if (!this._watch || e.pointerId !== this._watch.pointerId) return;
        this.cancel();
    }

    /** CSS classes for row `index` given the current drag state. */
    rowClass(index) {
        if (this.dragIndex === index) return 'dragging ghost';
        if (this.dropIndex === index && this.dropPosition === 'before') return 'drop-before';
        if (this.dropIndex === index && this.dropPosition === 'after') return 'drop-after';
        return '';
    }

    /** Apply a completed (from, to, position) move to an array — returns a new array. */
    static applyMove(arr, from, to, position) {
        const next = [...arr];
        const [moved] = next.splice(from, 1);
        let targetIdx = (position === 'after') ? to + 1 : to;
        if (from < targetIdx) targetIdx--;
        next.splice(targetIdx, 0, moved);
        return next;
    }
}
