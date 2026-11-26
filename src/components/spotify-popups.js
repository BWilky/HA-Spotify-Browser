import { LitElement, html, css } from "../lit.js";
import { sharedStyles } from '../styles/shared-styles.js';
import { popupsStyles } from './spotify-popups.styles.js';
import { registerOverlay } from './controllers/overlay-stack.js';

/**
 * The app's transient feedback layer: toasts and the one alert / confirm
 * dialog. Nothing is passed in as content — the app root calls `showToast` /
 * `showAlert` (its `_toast` / `_alert` are the only callers).
 *
 * Property: `blur` (backdrop blur behind the alert; the app's animation
 * setting).
 *
 * While an alert is up it sits in the shared overlay stack, so Escape
 * dismisses the alert (the same as its Cancel button) instead of closing a
 * sheet underneath it.
 */
class SpotifyPopups extends LitElement {
    static get properties() {
        return {
            blur: { type: Boolean },
            _toasts: { type: Array },
            _alert: { type: Object }, // { title, message, confirmText, cancelText, onConfirm, size }
        };
    }

    static get styles() {
        return [sharedStyles, css`
            /* Rules that sat in sharedStyles but can only match in this
               element's shadow root (alert dialog and toasts, with the toast
               @keyframes). Kept between sharedStyles and popupsStyles: their
               place in the cascade before they moved. */
            /* --- Generic Popup & Dialog --- */
            .popup-backdrop {
                position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
                z-index: 200000; /* Must be > header (100002) */
                display: none; align-items: center; justify-content: center;
                opacity: 0; pointer-events: none; transition: opacity 0.3s;
            }
            .popup-backdrop.visible { opacity: 1; pointer-events: auto; display: flex; }

            .popup-backdrop.no-blur {
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                background: rgba(0,0,0,0.9); /* Darker overlay if no glass */
            }

            .popup-content {
                background: var(--spf-bg); width: 90%; max-width: 400px;
                border-radius: 16px; padding: 24px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.8);
                display: flex; flex-direction: column; gap: 16px;
                position: relative;
            }
            .popup-title { margin: 0; font-size: var(--spf-text-lg, 17px); font-weight: 700; text-align: center; color: var(--spf-text-main); }
            .popup-scroll-content { max-height: 300px; overflow-y: auto; }
            .popup-close-btn { background: transparent; border: none; color: var(--spf-text-main); font-weight: 700; padding: 12px; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; align-self: center; }

            /* Alert / Confirm Specifics */
            .alert-dialog { max-width: 320px; text-align: center; }
            .alert-buttons { display: flex; gap: 12px; justify-content: center; margin-top: 8px; }
            .alert-btn { flex: 1; padding: 10px; border-radius: 20px; border: 1px solid var(--spf-border); background: transparent; color: var(--spf-text-main); cursor: pointer; font-weight: 700; }
            .alert-btn.primary { background: var(--spf-brand); color: black; border: none; }

            /* --- Toast Notification --- */
            .toast-container {
                position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
                display: flex; flex-direction: column; gap: 8px; z-index: 300; pointer-events: none;
                width: 90%; max-width: 400px;
            }
            .toast-message {
                background: var(--spf-bg-card-hover); color: var(--spf-text-main);
                padding: 12px 16px; border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                font-size: var(--spf-text-base, 13.5px); text-align: center;
                opacity: 0; transform: translateY(20px);
                animation: toastEnter 0.3s forwards;
            }
            .toast-message.hiding { animation: toastExit 0.3s forwards; }

            @keyframes toastEnter { to { opacity: 1; transform: translateY(0); } }
            @keyframes toastExit { to { opacity: 0; transform: translateY(-10px); } }
        `, popupsStyles];
    }

    constructor() {
        super();
        this.blur = true;
        this._toasts = [];
        this._alert = null;
        this._toastSeq = 0;
        this._unregisterAlert = null;
    }

    connectedCallback() {
        super.connectedCallback();
        this._syncAlertOverlay();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._syncAlertOverlay();
    }

    /* --- Public Methods --- */
    showToast(message, duration = 3000) {
        const id = ++this._toastSeq;
        this._toasts = [...this._toasts, { id, message, hiding: false }];
        setTimeout(() => this._hideToast(id), duration);
    }

    showAlert(title, message, onConfirm, confirmText = 'OK', cancelText = 'Cancel', size = 'medium') {
        this._alert = { title, message, onConfirm, confirmText, cancelText, size };
        // A second alert replaces the first; re-registering also puts the
        // alert back on top of anything opened since.
        this._syncAlertOverlay(true);
    }

    _hideToast(id) {
        if (!this._toasts.some(t => t.id === id)) return;
        this._toasts = this._toasts.map(t => t.id === id ? { ...t, hiding: true } : t);
        setTimeout(() => {
            this._toasts = this._toasts.filter(t => t.id !== id);
        }, 300);
    }

    /** Cancel button, and Escape (through the overlay stack). */
    _closeAlert() {
        this._alert = null;
        this._syncAlertOverlay();
    }

    _confirmAlert() {
        if (this._alert && this._alert.onConfirm) this._alert.onConfirm();
        this._closeAlert();
    }

    /**
     * In the overlay stack exactly while an alert is shown and this element is
     * in the document. `renew` drops the current registration first, so a new
     * alert never leaves a stale entry behind.
     */
    _syncAlertOverlay(renew = false) {
        const wanted = !!this._alert && this.isConnected;
        if (this._unregisterAlert && (renew || !wanted)) {
            this._unregisterAlert();
            this._unregisterAlert = null;
        }
        if (wanted && !this._unregisterAlert) {
            this._unregisterAlert = registerOverlay(() => this._closeAlert());
        }
    }

    render() {
        return html`
            <div>
                ${this.renderAlert()}
                ${this.renderToasts()}
            </div>
        `;
    }

    renderAlert() {
        if (!this._alert) return '';
        const content = html`
            <div class="popup-content alert-dialog alert-content ${this._alert.size || 'medium'}">
                <h3 class="popup-title alert-title">${this._alert.title}</h3>
                <div class="alert-message">${this._alert.message}</div>
                <div class="alert-buttons">
                    ${this._alert.cancelText ? html`<button class="alert-btn" @click=${this._closeAlert}>${this._alert.cancelText}</button>` : ''}
                    <button class="alert-btn primary" @click=${this._confirmAlert}>${this._alert.confirmText}</button>
                </div>
            </div>
        `;
        return html`
            <div class="popup-backdrop visible ${!this.blur ? 'no-blur' : ''}">
                ${content}
            </div>
        `;
    }

    renderToasts() {
        if (this._toasts.length === 0) return '';
        return html`
            <div class="toast-container">
                ${this._toasts.map(t => html`
                    <div class="toast-message ${t.hiding ? 'hiding' : ''}">${t.message}</div>
                `)}
            </div>
        `;
    }
}

customElements.define('spotify-popups', SpotifyPopups);
