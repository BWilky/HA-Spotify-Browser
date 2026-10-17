import { LitElement, html, css } from "../../lit.js";
import { deviceTypeLabel } from '../../utils.js';
import { deviceTypeIcon, playingBarsIcon } from '../common/icons.js';
import '../bottom-sheet.js';

/**
 * "Connect to a device" picker: a bottom sheet on phones, a centered modal on
 * tablet/desktop. Rows match the mobile Connect sheet (icon, name, type line,
 * green when active); the footer is a row of text actions — Refresh,
 * Show/Hide network (when the See-all setting allows it) and Manage devices.
 *
 * Driven by `spotify-popups`: `devices`, `config`, `readonly`,
 * `showRevealButton`, `visible`. Emits `device-selected`, `refresh-devices`,
 * `toggle-hidden-devices` ({ visible }), `open-manager`, `close-popups`.
 */
export class SpotifyDevicePickerLarge extends LitElement {
    static get styles() {
        return css`
            :host { display: contents; }

            .head {
                display: flex; align-items: center; justify-content: space-between;
                flex-shrink: 0;
                padding-bottom: 6px;
            }
            .title {
                margin: 0;
                font-size: var(--spf-text-xl, 22px); font-weight: 900;
                color: var(--spf-text-main, #fff);
            }
            .x {
                width: 44px; height: 44px; margin-right: -12px;
                background: none; border: none; padding: 0; cursor: pointer;
                color: var(--spf-text-main, #fff);
                display: flex; align-items: center; justify-content: center;
            }
            .x svg { width: 24px; height: 24px; fill: currentColor; }
            /* Phones dismiss with the grip / backdrop, like the Connect sheet. */
            @media (max-width: 768px) { .x { display: none; } }

            .list {
                flex: 1; min-height: 0;
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
            }
            .row {
                display: flex; align-items: center; gap: 16px;
                padding: 14px 4px;
                cursor: pointer;
                -webkit-tap-highlight-color: transparent;
            }
            .row:active { background: rgba(255,255,255,0.06); }
            .row-ic {
                width: 26px; height: 26px; flex-shrink: 0;
                color: rgba(255,255,255,0.85);
                display: flex; align-items: center; justify-content: center;
            }
            .row-ic svg, .row-ic img { width: 100%; height: 100%; fill: currentColor; }
            .row-ic ha-icon { --mdc-icon-size: 26px; }
            .row.active .row-ic { color: var(--spf-brand, #1ed760); }
            .row-text { min-width: 0; flex: 1; }
            .row-name {
                font-size: var(--spf-text-md, 15px); font-weight: 700; color: #fff;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .row.active .row-name { color: var(--spf-brand, #1ed760); }
            .row-type {
                display: flex; align-items: center; gap: 6px;
                font-size: var(--spf-text-base, 13.5px); color: var(--spf-text-sub, #b3b3b3); margin-top: 2px;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .row-type svg { width: 14px; height: 14px; fill: currentColor; flex-shrink: 0; }
            .row-now { flex-shrink: 0; color: var(--spf-brand, #1ed760); display: flex; }

            .empty {
                text-align: center; color: var(--spf-text-sub, #b3b3b3);
                padding: 28px 12px; font-size: var(--spf-text-base, 13.5px); line-height: 1.5;
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
        `;
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

    _getDeviceIcon(device) {
        const icons = this.config?.devices?.icons;
        if (!icons || !icons.length) return null;
        const entry = icons.find(e =>
            (e.id && e.id === device.id) || (e.name && e.name === device.name)
        );
        return entry ? entry.icon : null;
    }

    _renderIcon(d) {
        const icon = this._getDeviceIcon(d);
        if (icon) {
            return icon.startsWith('mdi:')
                ? html`<ha-icon icon="${icon}"></ha-icon>`
                : html`<img src="${icon}" alt="">`;
        }
        return deviceTypeIcon(d.type);
    }

    _castIcon() {
        return html`<svg viewBox="0 0 24 24"><path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>`;
    }
    _refreshIcon() {
        return html`<svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`;
    }
    _eyeIcon(open) {
        return html`<svg viewBox="0 0 24 24"><path d="${open
            ? 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z'
            : 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-4 .7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z'}"/></svg>`;
    }
    _listIcon() {
        return html`<svg viewBox="0 0 24 24"><path d="M3 17v2h6v-2H3zM3 5v2h18V5H3zm0 6h12v-2H3v2z"/></svg>`;
    }
    _xIcon() {
        return html`<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
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
            <spotify-bottom-sheet desktop-modal .visible=${this.visible} @close=${(e) => { e.stopPropagation(); this._close(); }}>
                <div class="head">
                    <h2 class="title">Connect to a device</h2>
                    <button class="x" aria-label="Close" @click=${this._close}>${this._xIcon()}</button>
                </div>

                <div class="list">
                    ${devices.length === 0
                        ? html`<div class="empty">No devices found.<br>Start playback on a device to see it here.</div>`
                        : devices.map(d => html`
                            <div class="row ${d.isActive ? 'active' : ''}" @click=${() => this._emit('device-selected', d)}>
                                <div class="row-ic">${this._renderIcon(d)}</div>
                                <div class="row-text">
                                    <div class="row-name">${d.name}</div>
                                    <div class="row-type">
                                        ${this._castIcon()}
                                        <span>${deviceTypeLabel(d.type)}${this._isDefault(d) ? ' · Default' : ''}</span>
                                    </div>
                                </div>
                                ${d.isActive ? html`<div class="row-now">${playingBarsIcon(18)}</div>` : ''}
                            </div>`)}
                </div>

                <div class="foot">
                    <button class="act" @click=${() => this._emit('refresh-devices')}>
                        ${this._refreshIcon()} Refresh
                    </button>
                    ${this.showRevealButton ? html`
                        <button class="act ${this._revealed ? 'on' : ''}" @click=${this._toggleReveal}>
                            ${this._eyeIcon(this._revealed)} ${this._revealed ? 'Hide network' : 'Show network'}
                        </button>` : ''}
                    ${!this.readonly ? html`
                        <button class="act" @click=${() => this._emit('open-manager')}>
                            ${this._listIcon()} Manage devices
                        </button>` : ''}
                </div>
            </spotify-bottom-sheet>
        `;
    }
}

customElements.define('spotify-popup-devices', SpotifyDevicePickerLarge);
