import { LitElement, html, css } from "../lit.js";

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
                background: rgba(0,0,0,0.5);
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
                max-height: var(--spf-sheet-max-h, 88%);
                display: flex; flex-direction: column;
                background: #181818;
                border-radius: 16px 16px 0 0;
                box-sizing: border-box;
                padding: 8px 20px calc(20px + var(--spf-safe-bottom, 0px));
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
                    width: min(480px, 92%);
                    max-height: min(var(--spf-sheet-max-h, 88%), 85%);
                    border-radius: 16px;
                    padding: 8px 20px 20px;
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
        this._onDown = this._onDown.bind(this);
        this._onMove = this._onMove.bind(this);
        this._onUp = this._onUp.bind(this);
    }

    /** True when the >=769px popup variant is active (no drag-dismiss). */
    get _isModal() {
        return this.desktopModal && typeof window !== 'undefined'
            && window.matchMedia('(min-width: 769px)').matches;
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        // If removed mid-drag, drop the window listeners added in _onDown.
        this._dragging = false;
        window.removeEventListener('pointermove', this._onMove);
        window.removeEventListener('pointerup', this._onUp);
        window.removeEventListener('pointercancel', this._onUp);
    }

    _close() { this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true })); }

    _onDown(e) {
        if (this._isModal) return; // popup variant: no drag-dismiss
        this._sheet = this.shadowRoot.querySelector('.sheet');
        this._backdrop = this.shadowRoot.querySelector('.backdrop');
        if (!this._sheet) return;
        this._startY = e.clientY;
        this._delta = 0;
        this._dragging = true;
        this._sheet.style.transition = 'none';
        window.addEventListener('pointermove', this._onMove, { passive: false });
        window.addEventListener('pointerup', this._onUp);
        window.addEventListener('pointercancel', this._onUp);
    }

    _onMove(e) {
        if (!this._dragging || !this._sheet) return;
        e.preventDefault();
        this._delta = Math.max(0, e.clientY - this._startY);
        this._sheet.style.transform = `translateY(${this._delta}px)`;
        if (this._backdrop) {
            const h = this._sheet.offsetHeight || 500;
            this._backdrop.style.opacity = String(Math.max(0, 1 - this._delta / h));
        }
    }

    _onUp() {
        if (!this._dragging) return;
        this._dragging = false;
        window.removeEventListener('pointermove', this._onMove);
        window.removeEventListener('pointerup', this._onUp);
        window.removeEventListener('pointercancel', this._onUp);

        const sheet = this._sheet;
        const backdrop = this._backdrop;
        if (!sheet) return;
        const h = sheet.offsetHeight || 500;
        sheet.style.transition = ''; // restore the CSS spring

        if (this._delta > Math.min(140, h * 0.3)) {
            // Past threshold: finish sliding out, then ask the parent to close.
            sheet.style.transform = 'translateY(100%)';
            if (backdrop) backdrop.style.opacity = '0';
            this._close();
            setTimeout(() => {
                sheet.style.transform = '';
                if (backdrop) backdrop.style.opacity = '';
            }, 420);
        } else {
            // Snap back open.
            sheet.style.transform = '';
            if (backdrop) backdrop.style.opacity = '';
        }
    }

    render() {
        return html`
            <div class="backdrop" @click=${this._close}></div>
            <div class="sheet" role="dialog" aria-modal="true">
                <div class="grip-area" @pointerdown=${this._onDown}>
                    <div class="grip"></div>
                </div>
                <div class="content"><slot></slot></div>
            </div>
        `;
    }
}

customElements.define('spotify-bottom-sheet', SpotifyBottomSheet);
