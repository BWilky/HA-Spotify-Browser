import { css } from "../lit.js";

export const popupsStyles = css`
    /*
     * Stacking. The host covers the app but deliberately has NO z-index of its
     * own, so it forms no stacking context: the alert and the toasts are two
     * separate layers of the app's stack, and the desktop device picker —
     * rendered by the app root, not in here — sits between them:
     *
     *   241000  toasts          (status messages stay readable over anything)
     *   240000  alert backdrop  (always on top: over the device picker at
     *                            229500, the playlist create sheet at 230000,
     *                            the device manager, every default sheet and
     *                            the context menu at 215000)
     *
     * Keep the numbers together when changing one.
     */
    :host {
        /* OVERRIDE shared-styles 0x0 */
        display: block;
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        z-index: auto;
        pointer-events: none; /* Let clicks pass through empty areas */
    }
    .popup-backdrop { z-index: 240000; }
    .toast-container { z-index: 241000; }

    /* --- Reusable Alert Modal --- */
    .alert-content {
        background: var(--spf-bg-card); border: 1px solid var(--spf-border);
        border-radius: 12px; width: 85%; max-width: 320px;
        padding: 24px; text-align: center;
        box-shadow: 0 12px 40px rgba(0,0,0,0.8);
        transform: scale(0.9); transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .alert-content.mini { max-width: 260px; padding: 20px; }
    .alert-content.medium { max-width: 320px; }
    .alert-content.large { max-width: 480px; }
    .popup-backdrop.visible .alert-content { transform: scale(1); }

    .alert-title { font-size: var(--spf-text-lg, 17px); font-weight: 700; color: var(--spf-text-main); margin-bottom: 8px; }
    .alert-message { font-size: var(--spf-text-base, 13.5px); color: var(--spf-text-sub); line-height: 1.5; margin-bottom: 24px; }

    .alert-btn {
        background: transparent; border: 1px solid var(--spf-border);
        color: var(--spf-text-main); padding: 12px; border-radius: 24px;
        font-size: var(--spf-text-base, 13.5px); font-weight: 700; cursor: pointer;
        text-transform: uppercase; letter-spacing: 1px;
        transition: background 0.2s;
    }
    .alert-btn:hover { background: var(--spf-hover-white); }
    .alert-btn.primary { background: var(--spf-brand); border-color: var(--spf-brand); color: black; }
    .alert-btn.primary:hover { background: var(--spf-brand-hover); }

`;
