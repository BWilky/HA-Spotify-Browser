import { LitElement, html, css } from "../../lit.js";
import { deviceTypeLabel } from '../../utils.js';
import { playingBarsIcon, refreshIcon, listIcon, closeIcon } from '../common/icons.js';
import { renderDeviceRow, deviceRowStyles, deviceIconFor } from './device-row.js';
import { dialogSheetStyles } from '../../styles/sheet.styles.js';
import '../bottom-sheet.js';

/**
 * "Connect to a device" picker: a bottom sheet on phones, a centered modal on
 * tablet/desktop. Rows are the shared device row (device-row.js), as in the
 * mobile Connect sheet (icon, name, type line, green when active); the footer is a row of text actions — Refresh,
 * Show/Hide network (when the See-all setting allows it) and Manage devices.
 *
 * Driven by the app root (spotify-browser-app), which renders it next to
 * `spotify-popups` and sets its z-index: `devices`, `config`, `readonly`,
 * `showRevealButton`, `visible`. Emits `device-selected`, `refresh-devices`,
 * `toggle-hidden-devices` ({ visible }), `open-manager`, `close-popups`.
 */
export class SpotifyDevicePickerLarge extends LitElement {
    static get styles() {
        // :host, .title and .empty: dialogSheetStyles. Rows: deviceRowStyles.
        return [dialogSheetStyles, deviceRowStyles, css`
            .head {
                display: flex; align-items: center; justify-content: space-between;
                flex-shrink: 0;
                padding-bottom: 6px;
            }
            .x {
                width: 44px; height: 44px;
                background: none; border: none; padding: 0; cursor: pointer;
                color: var(--spf-text-main, #fff);
                display: flex; align-items: center; justify-content: center;
            }
            .x svg { width: 24px; height: 24px; fill: currentColor; }
            /* Phones dismiss with the grip / backdrop, like the Connect sheet. */
            @media (max-width: 768px) { .x { display: none; } }

            .list {
                flex: 1; min-height: 0;
                overflow-y: auto; overflow-x: hidden;
                -webkit-overflow-scrolling: touch;
            }

            .foot {
                flex-shrink: 0;
                display: flex;
                border-top: 1px solid rgba(255,255,255,0.08);
                margin-top: 6px;
            }
            .act {
                flex: 1; min-height: 52px;
                display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
                background: none; border: none; cursor: pointer;
                color: var(--spf-text-sub, #b3b3b3);
                font: inherit; font-size: var(--spf-text-sm, 12px); font-weight: 700;
                text-align: center; padding: 8px 4px;
                -webkit-tap-highlight-color: transparent;
            }
            .act svg { width: 18px; height: 18px; fill: currentColor; }
            .act:active, .act.on { color: #fff; }
            @media (hover: hover) { .act:hover { color: #fff; } }
        `];
    }

    static get properties() {
        return {
            devices: { type: Array },
            config: { type: Object },
            readonly: { type: Boolean },
            showRevealButton: { type: Boolean },
            visible: { type: Boolean },
            _revealed: { type: Boolean, state: true }
        };
    }

    constructor() {
        super();
        this.devices = [];
        this.config = {};
        this.readonly = true;
        this.showRevealButton = false;
        this.visible = false;
        this._revealed = false;
    }

    updated(changed) {
        // The sheet stays mounted and is toggled with `visible`, so the
        // reveal state must not leak into the next open (the list is fetched
        // fresh without hidden devices).
        if (changed.has('visible') && !this.visible) this._revealed = false;
    }

    _eyeIcon(open) {
        return html`<svg viewBox="0 0 24 24"><path d="${open
            ? 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z'
            : 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-4 .7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z'}"/></svg>`;
    }

    _emit(name, detail) {
        this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    }
    _close() { this._emit('close-popups'); }

    _toggleReveal() {
        this._revealed = !this._revealed;
        this._emit('toggle-hidden-devices', { visible: this._revealed });
    }

    _isDefault(d) {
        return !!d.is_default || this.config?.devices?.default === d.id;
    }

    render() {
        const devices = this.devices || [];
        return html`
            <spotify-bottom-sheet desktop-modal close-on-escape .visible=${this.visible} @close=${(e) => { e.stopPropagation(); this._close(); }}>
                <div class="head">
                    <h2 class="title">Connect to a device</h2>
                    <button class="x" aria-label="Close" @click=${this._close}>${closeIcon()}</button>
                </div>

                <div class="list">
                    ${devices.length === 0
                        ? html`<div class="empty">No devices found.<br>Start playback on a device to see it here.</div>`
                        : devices.map(d => renderDeviceRow(d, {
                            active: d.isActive,
                            onSelect: (dev) => this._emit('device-selected', dev),
                            icon: deviceIconFor(d, this.config),
                            subtitle: html`<span>${deviceTypeLabel(d.type)}${this._isDefault(d) ? ' · Default' : ''}</span>`,
                            trailing: d.isActive ? html`<div class="row-now">${playingBarsIcon(18)}</div>` : '',
                        }))}
                </div>

                <div class="foot">
                    <button class="act" @click=${() => this._emit('refresh-devices')}>
                        ${refreshIcon} Refresh
                    </button>
                    ${this.showRevealButton ? html`
                        <button class="act ${this._revealed ? 'on' : ''}" @click=${this._toggleReveal}>
                            ${this._eyeIcon(this._revealed)} ${this._revealed ? 'Hide network' : 'Show network'}
                        </button>` : ''}
                    ${!this.readonly ? html`
                        <button class="act" @click=${() => this._emit('open-manager')}>
                            ${listIcon()} Manage devices
                        </button>` : ''}
                </div>
            </spotify-bottom-sheet>
        `;
    }
}

customElements.define('spotify-popup-devices', SpotifyDevicePickerLarge);
