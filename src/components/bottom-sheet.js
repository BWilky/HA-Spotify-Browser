import { LitElement, html, css } from "../lit.js";
import { overlayStack } from "./controllers/overlay-stack.js";
import { DragDismissController, slideOut } from "./controllers/drag-dismiss-controller.js";

/**
 * Reusable mobile bottom sheet: a backdrop + a panel that slides up from the
 * bottom with a grab handle. Drag the handle down to dismiss. Content is
 * projected via the default slot, so callers only supply their own markup.
 *
 * Usage:
 *   <spotify-bottom-sheet .visible=${open} @close=${() => open = false}>
 *     ...your content (becomes flex children; give a scroll region flex:1)...
 *   </spotify-bottom-sheet>
 *
 * Knobs (CSS custom properties on the host):
 *   --spf-sheet-z       z-index (default 215000)
 *   --spf-sheet-max-h   max height (default 88%)
 *   --spf-sheet-backdrop         backdrop background (default rgba(0,0,0,0.5))
 *   --spf-sheet-backdrop-filter  backdrop-filter (default none)
 *   --spf-sheet-modal-w          desktop-modal card width (default 480px)
 *   --spf-sheet-pad-top / -pad-x / -pad-bottom
 *                                panel padding (defaults 8px / 20px / 20px;
 *                                the bottom safe-area inset is always added
 *                                on the sheet variant)
 *
 * Escape: ON by default. While visible the sheet sits in the shared overlay
 * stack (controllers/overlay-stack.js); Escape closes only the top overlay,
 * so stacked sheets no longer all close at once. Opt out with the
 * `no-escape` attribute / `noEscape` property (the sheet still shields the
 * overlays beneath it from Escape). The older `closeOnEscape` property /
 * `close-on-escape` attribute is kept for compatibility: it now defaults to
 * true, the attribute is a harmless no-op, and `.closeOnEscape=${false}`
 * also opts out. Escape that something inside the sheet already handled
 * (preventDefault) or that ends an IME composition is ignored.
 *
 * `desktopModal` (attribute `desktop-modal`): at >=769px the panel renders as
 * a centered popup card (fade/scale, no grip, no drag-dismiss) instead of a
 * bottom sheet — for surfaces that should be sheets on phones but dialogs on
 * tablet/desktop. Below the breakpoint it behaves like a normal sheet.
 *
 * Emits `close` on backdrop tap or a drag past the dismiss threshold.
 */
export class SpotifyBottomSheet extends LitElement {
    static get properties() {
        return {
            visible: { type: Boolean, reflect: true },
            desktopModal: { type: Boolean, reflect: true, attribute: 'desktop-modal' },
            closeOnEscape: { type: Boolean, attribute: 'close-on-escape' },
            noEscape: { type: Boolean, attribute: 'no-escape' },
        };
    }

    static get styles() {
        return css`
            :host {
                position: fixed; inset: 0;
                z-index: var(--spf-sheet-z, 215000);
                pointer-events: none;
            }
            :host([visible]) { pointer-events: auto; }

            .backdrop {
                position: absolute; inset: 0;
                background: var(--spf-sheet-backdrop, rgba(0,0,0,0.5));
                backdrop-filter: var(--spf-sheet-backdrop-filter, none);
                -webkit-backdrop-filter: var(--spf-sheet-backdrop-filter, none);
                opacity: 0; visibility: hidden;
                transition: opacity 0.32s ease, visibility 0s linear 0.35s;
            }
            :host([visible]) .backdrop {
                opacity: 1; visibility: visible;
                transition: opacity 0.32s ease;
            }

            /* Closed panels hide via translateY(100%) below the wrapper — but
               translated content is still painted, and a programmatic scroll
               of an overflow:hidden ancestor (e.g. focus() revealing an input)
               can drag it into view. visibility:hidden (delayed so the
               slide-out still animates) makes closed sheets unrevealable. */
            .sheet {
                position: absolute; left: 0; right: 0; bottom: 0;
                /* Never climb into the top safe area (notch / Dynamic Island):
                   leave the inset plus 24px of breathing room above the sheet. */
                max-height: min(var(--spf-sheet-max-h, 88%), calc(100% - var(--spf-safe-top, 0px) - 24px));
                display: flex; flex-direction: column;
                background: #181818;
                border-radius: 16px 16px 0 0;
                box-sizing: border-box;
                padding: var(--spf-sheet-pad-top, 8px) var(--spf-sheet-pad-x, 20px)
                    calc(var(--spf-sheet-pad-bottom, 20px) + var(--spf-safe-bottom, 0px));
                color: #fff;
                box-shadow: 0 -8px 40px rgba(0,0,0,0.5);
                transform: translateY(100%);
                visibility: hidden;
                transition: transform 0.42s cubic-bezier(0.16, 1, 0.3, 1), visibility 0s linear 0.45s;
                will-change: transform;
            }
            :host([visible]) .sheet {
                transform: translateY(0);
                visibility: visible;
                transition: transform 0.42s cubic-bezier(0.16, 1, 0.3, 1);
            }

            /* ---- Desktop/tablet popup variant (opt-in via desktop-modal) ---- */
            @media (min-width: 769px) {
                :host([desktop-modal]) .sheet {
                    left: 50%; right: auto; bottom: auto; top: 50%;
                    width: min(var(--spf-sheet-modal-w, 480px), 92%);
                    max-height: min(var(--spf-sheet-max-h, 88%), 85%);
                    border-radius: 16px;
                    padding: var(--spf-sheet-pad-top, 8px) var(--spf-sheet-pad-x, 20px) var(--spf-sheet-pad-bottom, 20px);
                    box-shadow: 0 25px 60px rgba(0,0,0,0.8);
                    border: 1px solid rgba(255,255,255,0.1);
                    transform: translate(-50%, -48%) scale(0.97);
                    opacity: 0;
                    transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease, visibility 0s linear 0.3s;
                }
                :host([desktop-modal][visible]) .sheet {
                    transform: translate(-50%, -50%) scale(1);
                    opacity: 1;
                    transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
                }
                :host([desktop-modal]) .grip-area { display: none; }
            }

            .grip-area {
                flex-shrink: 0;
                display: flex; justify-content: center;
                padding: 6px 0 14px;
                cursor: grab;
                touch-action: none; /* let us own the vertical drag */
            }
            .grip-area:active { cursor: grabbing; }
            .grip {
                width: 36px; height: 4px; border-radius: 3px;
                background: rgba(255,255,255,0.3);
            }

            .content {
                display: flex; flex-direction: column;
                flex: 1; min-height: 0;
                overflow: hidden;
            }
        `;
    }

    constructor() {
        super();
        this.visible = false;
        this.desktopModal = false;
        this.closeOnEscape = true;
        this.noEscape = false;
        // Stable identity: re-opening moves this same entry to the top.
        this._overlayEntry = {
            close: () => {
                if (this.noEscape || !this.closeOnEscape) return false;
                this._close();
            },
        };
        // Drag the grip down: past min(140px, 30% of the sheet) it slides out
        // and asks the parent to close; otherwise it springs back.
        this._drag = new DragDismissController(this, {
            canStart: () => !this._isModal, // popup variant: no drag-dismiss
            getPanel: () => this.shadowRoot.querySelector('.sheet'),
            getBackdrop: () => this.shadowRoot.querySelector('.backdrop'),
            threshold: (h) => Math.min(140, h * 0.3),
            fadeDistance: (h) => h,
            preventDefault: true,
            releaseTransition: '', // restore the CSS spring
            // Close at once; clear the inline styles once the slide is done.
            onDismiss: ({ panel, backdrop }) => slideOut(panel, backdrop, {
                settleMs: 420,
                waitForTransitionEnd: false,
                onStart: () => this._close(),
            }),
        });
    }

    /** True when the >=769px popup variant is active (no drag-dismiss). */
    get _isModal() {
        return this.desktopModal && typeof window !== 'undefined'
            && window.matchMedia('(min-width: 769px)').matches;
    }

    updated(changed) {
        if (changed.has('visible')) this._syncOverlay();
    }

    /** In the overlay stack exactly while visible and connected. */
    _syncOverlay() {
        if (this.visible && this.isConnected) {
            if (!this._inStack) { overlayStack.push(this._overlayEntry); this._inStack = true; }
        } else if (this._inStack) {
            overlayStack.remove(this._overlayEntry);
            this._inStack = false;
        }
    }

    connectedCallback() {
        super.connectedCallback();
        // Moved in the DOM while open: re-register (disconnect removed it).
        if (this.hasUpdated) this._syncOverlay();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._syncOverlay();
        // A drag in progress is dropped by the DragDismissController.
    }

    _close() { this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true })); }

    render() {
        return html`
            <div class="backdrop" @click=${this._close}></div>
            <div class="sheet" role="dialog" aria-modal="true">
                <div class="grip-area" @pointerdown=${this._drag.start}>
                    <div class="grip"></div>
                </div>
                <div class="content"><slot></slot></div>
            </div>
        `;
    }
}

customElements.define('spotify-bottom-sheet', SpotifyBottomSheet);
