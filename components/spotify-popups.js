
import { LitElement, html } from "../lit.js";
import { sharedStyles } from '../styles/shared-styles.js';
import { popupsStyles } from '../styles/spotify-popups.styles.js';
import './devices/index.js';

class SpotifyPopups extends LitElement {
    static get properties() {
        return {
            devices: { type: Array },
            config: { type: Object },
            deviceVisible: { type: Boolean },
            canManageDevices: { type: Boolean },
            showRevealButton: { type: Boolean }, // New Prop

            // New Props
            blur: { type: Boolean },
            _toasts: { type: Array },
            _alert: { type: Object }, // { title, message, confirmText, cancelText, onConfirm, size }
        };
    }

    static get styles() {
        return [sharedStyles, popupsStyles];
    }

    constructor() {
        super();
        this.devices = [];
        this.config = {};
        this.deviceVisible = false;
        this.canManageDevices = false;
        this.showRevealButton = false;
        this.blur = true;
        this._toasts = [];
        this._alert = null;
    }

    /* --- Public Methods --- */
    showToast(message, duration = 3000) {
        const id = Date.now();
        this._toasts = [...this._toasts, { id, message, hiding: false }];
        this.requestUpdate();
        setTimeout(() => this._hideToast(id), duration);
    }

    showAlert(title, message, onConfirm, confirmText = 'OK', cancelText = 'Cancel', size = 'medium') {
        this._alert = { title, message, onConfirm, confirmText, cancelText, size };
        this.requestUpdate();
    }

    _hideToast(id) {
        const index = this._toasts.findIndex(t => t.id === id);
        if (index > -1) {
            this._toasts[index].hiding = true;
            this.requestUpdate();
            setTimeout(() => {
                this._toasts = this._toasts.filter(t => t.id !== id);
                this.requestUpdate();
            }, 300);
        }
    }

    _closeAlert() {
        this._alert = null;
        this.requestUpdate();
    }

    _confirmAlert() {
        if (this._alert && this._alert.onConfirm) this._alert.onConfirm();
        this._closeAlert();
    }

    render() {
        return html`
            <div @click=${(e) => {
                // Only close if clicking generic backdrop, specific modals handle their own clicks
                if (e.target.classList.contains('popup-backdrop')) this.dispatchEvent(new CustomEvent('close-popups'));
            }}>
                ${this.renderDevicePopup()}
                ${this.renderAlert()}
                ${this.renderToasts()}
            </div>
        `;
    }

    /* --- Generic Render Helpers --- */
    _renderBackdrop(visible, content) {
        return html`
            <div class="popup-backdrop ${visible ? 'visible' : ''} ${!this.blur ? 'no-blur' : ''}">
                ${content}
            </div>
        `;
    }

    /* --- Specific Popups --- */
    renderDevicePopup() {
        if (!this.deviceVisible) return '';
        const content = html`
            <spotify-popup-devices
                .devices=${this.devices}
                .config=${this.config}
                .readonly=${!this.canManageDevices}
                .showRevealButton=${this.showRevealButton}
                @close-popups=${() => this.dispatchEvent(new CustomEvent('close-popups'))}
            ></spotify-popup-devices>
        `;
        return this._renderBackdrop(true, content);
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
        return this._renderBackdrop(true, content);
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
