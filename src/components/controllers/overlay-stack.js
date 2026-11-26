/**
 * One stack of open overlays (sheets, dialogs, popovers) so Escape closes
 * only the TOP surface.
 *
 * Each overlay pushes an entry when it opens and removes it when it closes or
 * leaves the DOM. A single window `keydown` listener (bubble phase, so
 * handlers inside an overlay run first and can claim Escape with
 * preventDefault) exists only while the stack is non-empty. On Escape it asks
 * the top entry to close; nothing underneath reacts.
 *
 * Entry shape: { close(event) } — return `false` to decline (e.g. a sheet
 * that opted out of Escape). A declining top entry still shields the
 * overlays below it: Escape then does nothing at all.
 *
 * Pure: no DOM assumptions beyond an EventTarget-like `target` with
 * addEventListener/removeEventListener, so it is unit-testable under node.
 */
export function createOverlayStack(target) {
    const entries = [];
    let listening = false;

    const onKeyDown = (e) => {
        if (e.key !== 'Escape') return;
        // IME composition: Escape cancels the composition, not the overlay.
        if (e.isComposing || e.keyCode === 229) return;
        // Something inside the overlay (an inline rename field…) already
        // handled this Escape.
        if (e.defaultPrevented) return;
        const top = entries[entries.length - 1];
        if (!top) return;
        if (top.close(e) !== false) e.preventDefault();
    };

    const sync = () => {
        if (!target) return;
        if (entries.length && !listening) {
            target.addEventListener('keydown', onKeyDown);
            listening = true;
        } else if (!entries.length && listening) {
            target.removeEventListener('keydown', onKeyDown);
            listening = false;
        }
    };

    return {
        /** Add (or move to the top, if already open) an entry. */
        push(entry) {
            const i = entries.indexOf(entry);
            if (i !== -1) entries.splice(i, 1);
            entries.push(entry);
            sync();
            return entry;
        },
        /** Remove an entry wherever it sits; a no-op if absent. */
        remove(entry) {
            const i = entries.indexOf(entry);
            if (i !== -1) entries.splice(i, 1);
            sync();
        },
        top() { return entries[entries.length - 1] || null; },
        get size() { return entries.length; },
        get listening() { return listening; },
        /** Exposed for tests. */
        _onKeyDown: onKeyDown,
    };
}

/** The app-wide stack, bound to `window` (null under node). */
export const overlayStack = createOverlayStack(typeof window !== 'undefined' ? window : null);

/**
 * Register a non-sheet overlay (e.g. the context menu's desktop popover).
 * Returns the unregister function; calling it more than once is harmless.
 */
export function registerOverlay(onClose, stack = overlayStack) {
    const entry = { close: onClose };
    stack.push(entry);
    return () => stack.remove(entry);
}
