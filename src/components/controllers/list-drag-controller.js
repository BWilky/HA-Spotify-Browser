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
    }

    get active() {
        return this.dragIndex !== null;
    }

    start(e, index, listEl) {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (this.isDraggable && !this.isDraggable(index)) return;
        if (!listEl) return;

        e.currentTarget.setPointerCapture(e.pointerId);
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
        this.dragIndex = null;
        this.dropIndex = null;
        this.dropPosition = null;
        this._rects = [];
        if (e?.target?.releasePointerCapture) {
            try { e.target.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
        }
        if (dropIndex !== null && dragIndex !== dropIndex) {
            this.onDrop(dragIndex, dropIndex, dropPosition);
        }
        this.host.requestUpdate();
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
