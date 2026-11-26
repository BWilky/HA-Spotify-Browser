/**
 * Lit ReactiveController for "drag down to dismiss" on a bottom panel: one
 * behaviour for the mobile app panel (spotify-browser-app) and every
 * <spotify-bottom-sheet>.
 *
 *   - pointerdown on the handle starts a drag (unless `canStart()` says no);
 *     pointermove / pointerup / pointercancel listeners go on the window only
 *     for the length of the drag and are removed on release and on
 *     hostDisconnected (removed mid-drag).
 *   - The panel follows the finger downwards (translateY, never above its
 *     rest position, transition off) and the backdrop fades with distance:
 *     opacity = max(0, 1 - delta / fadeDistance).
 *   - On release the panel gets `releaseTransition`, then: past `threshold`
 *     -> `onDismiss(ctx)`; otherwise it snaps back (inline transform and
 *     backdrop opacity cleared, so the CSS takes over) and
 *     `onSnapBack(ctx)` runs for anything extra.
 *
 * `threshold` and `fadeDistance` are a number of pixels or a function of the
 * panel's height (`offsetHeight`, 500 when it has none); the height is only
 * read when one of them is a function.
 *
 *   this._drag = new DragDismissController(this, {
 *       getPanel: () => this.shadowRoot.querySelector('.sheet'),
 *       getBackdrop: () => this.shadowRoot.querySelector('.backdrop'),
 *       threshold: (h) => Math.min(140, h * 0.3),
 *       onDismiss: ({ panel, backdrop }) => slideOut(panel, backdrop, { settleMs: 420, ... }),
 *   });
 *   handle: @pointerdown=${this._drag.start}
 *
 * `slideOut()` (below) is the "slide the rest of the way down, then close"
 * sequence, also usable without a drag (an animated close button).
 */

/** Panel height used when it has none (not laid out). */
export const FALLBACK_PANEL_HEIGHT = 500;

/**
 * @typedef {object} DragDismissContext
 * @property {HTMLElement} panel
 * @property {HTMLElement|null} backdrop
 * @property {number} delta  how far down the panel was dragged (px, >= 0)
 */

/**
 * @typedef {object} DragDismissOptions
 * @property {() => (HTMLElement|null|undefined)} getPanel  the element that follows the finger (read on pointerdown)
 * @property {() => (HTMLElement|null|undefined)} [getBackdrop]  faded with distance (read on pointerdown)
 * @property {() => boolean} [canStart]  false: ignore this pointerdown (e.g. desktop layout)
 * @property {number | ((panelHeight: number) => number)} [threshold]  dismiss when dragged further than this (px)
 * @property {number | ((panelHeight: number) => number)} [fadeDistance]  backdrop is transparent at this distance (px)
 * @property {boolean} [preventDefault]  call preventDefault() on each pointermove
 * @property {string} [releaseTransition]  the panel's inline `transition` on release ('' = back to the CSS one)
 * @property {(ctx: DragDismissContext) => void} [onDismiss]
 * @property {(ctx: DragDismissContext) => void} [onSnapBack]  after the inline transform / opacity are cleared
 * @property {Pick<EventTarget, 'addEventListener'|'removeEventListener'>} [eventTarget]  where move/up listeners go (default: window)
 */

export class DragDismissController {
    /**
     * @param {{addController?: (c: object) => void}} host
     * @param {DragDismissOptions} options
     */
    constructor(host, {
        getPanel,
        getBackdrop = () => null,
        canStart = () => true,
        threshold = 140,
        fadeDistance = FALLBACK_PANEL_HEIGHT,
        preventDefault = false,
        releaseTransition = '',
        onDismiss,
        onSnapBack,
        eventTarget,
    }) {
        this.host = host;
        this._getPanel = getPanel;
        this._getBackdrop = getBackdrop;
        this._canStart = canStart;
        this.threshold = threshold;
        this.fadeDistance = fadeDistance;
        this.preventDefault = preventDefault;
        this.releaseTransition = releaseTransition;
        this._onDismiss = onDismiss;
        this._onSnapBack = onSnapBack;
        this._eventTarget = eventTarget;
        /** @type {Pick<EventTarget, 'addEventListener'|'removeEventListener'>|null} */
        this._listeningOn = null;
        /** @type {HTMLElement|null} */
        this._panel = null;
        /** @type {HTMLElement|null} */
        this._backdrop = null;
        this._startY = 0;
        /** How far down the current (or last) drag went, px. */
        this.delta = 0;
        this.dragging = false;
        // Bound once: used as template listeners and for add/removeEventListener.
        this.start = this.start.bind(this);
        this._move = this._move.bind(this);
        this._end = this._end.bind(this);
        host.addController?.(this);
    }

    /**
     * pointerdown handler for the drag handle.
     * @param {Pick<PointerEvent, 'clientY'>} e
     */
    start(e) {
        if (!this._canStart()) return;
        const panel = this._getPanel() || null;
        if (!panel) return;
        this._panel = panel;
        this._backdrop = this._getBackdrop() || null;
        this._startY = e.clientY;
        this.delta = 0;
        this.dragging = true;
        panel.style.transition = 'none';
        const target = this._eventTarget || window;
        this._listeningOn = target;
        target.addEventListener('pointermove', this._move, { passive: false });
        target.addEventListener('pointerup', this._end);
        target.addEventListener('pointercancel', this._end);
    }

    /** Drop an in-progress drag without dismissing or touching the panel. */
    cancel() {
        this.dragging = false;
        this._removeListeners();
    }

    hostDisconnected() {
        // Removed mid-drag: drop the window listeners added in start().
        this.cancel();
    }

    /** @param {PointerEvent} e */
    _move(e) {
        if (!this.dragging || !this._panel) return;
        if (this.preventDefault) e.preventDefault();
        this.delta = Math.max(0, e.clientY - this._startY);
        this._panel.style.transform = `translateY(${this.delta}px)`;
        if (this._backdrop) {
            const distance = this._resolve(this.fadeDistance);
            this._backdrop.style.opacity = String(Math.max(0, 1 - this.delta / distance));
        }
    }

    _end() {
        if (!this.dragging) return;
        this.dragging = false;
        this._removeListeners();

        const panel = this._panel;
        const backdrop = this._backdrop;
        if (!panel) return;
        const threshold = this._resolve(this.threshold);
        panel.style.transition = this.releaseTransition;
        const ctx = { panel, backdrop, delta: this.delta };

        if (this.delta > threshold) {
            this._onDismiss?.(ctx);
        } else {
            panel.style.transform = '';
            if (backdrop) backdrop.style.opacity = '';
            this._onSnapBack?.(ctx);
        }
    }

    _removeListeners() {
        const target = this._listeningOn;
        if (!target) return;
        this._listeningOn = null;
        target.removeEventListener('pointermove', this._move);
        target.removeEventListener('pointerup', this._end);
        target.removeEventListener('pointercancel', this._end);
    }

    /** @param {number | ((panelHeight: number) => number)} value */
    _resolve(value) {
        if (typeof value !== 'function') return value;
        return value(this._panel?.offsetHeight || FALLBACK_PANEL_HEIGHT);
    }
}

/**
 * Slide `panel` the rest of the way off the bottom, then clear the inline
 * styles so the CSS (the closed state) takes over.
 *
 * @param {HTMLElement} panel
 * @param {HTMLElement|null} backdrop
 * @param {object} options
 * @param {number} options.settleMs  when to clean up at the latest
 * @param {string} [options.transition]  set on the panel first and cleared at the end; omitted: left alone
 * @param {boolean} [options.fadeBackdrop]  set the backdrop's opacity to 0 now (default true)
 * @param {boolean} [options.waitForTransitionEnd]  clean up on the panel's transitionend if it comes first (default true)
 * @param {() => void} [options.onStart]  right after the slide starts (e.g. tell the parent to close)
 * @param {() => void} [options.onSettled]  when the slide is over, before the styles are cleared
 */
export function slideOut(panel, backdrop, {
    settleMs,
    transition,
    fadeBackdrop = true,
    waitForTransitionEnd = true,
    onStart,
    onSettled,
}) {
    if (transition !== undefined) panel.style.transition = transition;
    panel.style.transform = 'translateY(100%)';
    if (fadeBackdrop && backdrop) backdrop.style.opacity = '0';
    onStart?.();

    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        onSettled?.();
        panel.style.transform = '';
        if (transition !== undefined) panel.style.transition = '';
        if (backdrop) backdrop.style.opacity = '';
    };
    if (waitForTransitionEnd) {
        // transitionend bubbles: a child's transition ending during the slide
        // must not finish it early. Only the panel's own transform counts.
        const onEnd = (e) => {
            if (e.target !== panel) return;
            panel.removeEventListener('transitionend', onEnd);
            finish();
        };
        panel.addEventListener('transitionend', onEnd);
        setTimeout(() => panel.removeEventListener('transitionend', onEnd), settleMs);
    }
    setTimeout(finish, settleMs);
}
