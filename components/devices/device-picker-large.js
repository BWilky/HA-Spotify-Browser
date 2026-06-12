import { LitElement, html, css } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { popupsStyles } from '../../styles/spotify-popups.styles.js';

export class SpotifyDevicePickerLarge extends LitElement {
    static get styles() {
        return [sharedStyles, popupsStyles, css`
            .device-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
                max-height: 50vh;
                overflow-y: auto;
                padding: 10px;
                margin-top: 10px;
            }

            .device-row {
                display: flex;
                align-items: center;
                background: rgba(255,255,255,0.05);
                border-radius: 8px;
                padding: 12px;
                gap: 12px;
                cursor: pointer;
                transition: background 0.2s;
            }

            .device-row:hover {
                background: rgba(255,255,255,0.1);
            }

            .device-row.active {
                background: rgba(30, 215, 96, 0.1); /* Subtle green tint */
                border: 1px solid rgba(30, 215, 96, 0.3);
            }

            .device-info {
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .device-name {
                font-size: 14px;
                font-weight: 500;
                color: var(--spf-text-main);
            }
            
            .device-row.active .device-name {
                color: var(--spf-brand); /* Green Text for active device */
            }

            .device-type {
                font-size: 11px;
                color: var(--spf-text-sub);
                text-transform: uppercase;
            }

            .device-icon svg { width: 24px; height: 24px; fill: currentColor; opacity: 0.7; }
            .device-row.active .device-icon svg { opacity: 1; fill: var(--spf-brand); }

            .manage-btn {
                background: transparent;
                border: 1px solid rgba(255,255,255,0.1);
                color: var(--spf-text-sub);
                font-size: 12px;
                padding: 8px 16px;
                border-radius: 16px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: all 0.2s;
                margin: 0 auto; /* Center */
            }
            .manage-btn:hover {
                background: rgba(255,255,255,0.1);
                color: #fff;
                border-color: rgba(255,255,255,0.2);
            }

            :host {
                display: flex;
                align-items: center;
                justify-content: center;
                position: absolute;
                top: 0; left: 0;
                width: 100%; height: 100%;
                z-index: 210005; /* Slightly higher than backdrop to be safe, but backdrop in parent handles z-index */
                pointer-events: none; /* Let clicks pass through empty areas */
            }

            /* Content needs pointer-events: auto to capturing clicks */
            .popup-content {
                pointer-events: auto;
            }
        `];
    }

    static get properties() {
        return {
            devices: { type: Array },
            config: { type: Object },
            readonly: { type: Boolean },
            showRevealButton: { type: Boolean },
            _revealed: { type: Boolean, state: true }
        };
    }

    constructor() {
        super();
        this.devices = [];
        this.config = {};
        this.readonly = true;
        this.showRevealButton = false;
        this._revealed = false;
    }

    _getDeviceIcon(device) {
        if (!this.config || !this.config.device_playback || !this.config.device_playback.show) return null;

        // Find matching entry in config by ID or Name
        const entry = this.config.device_playback.show.find(e =>
            (typeof e === 'object' && ((e.id && e.id === device.id) || (e.name && e.name === device.name)))
        );

        return entry ? entry.icon : null;
    }

    render() {
        const hasDevices = this.devices && this.devices.length > 0;

        return html`
            <div class="popup-content" @click=${e => e.stopPropagation()}>
                <div class="popup-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
                    <h3 class="popup-title" style="margin:0;">Connect to a device</h3>
                    ${!this.readonly ? html`
                        <button class="icon-btn" style="background:transparent; border:none; color:var(--spf-text-sub); cursor:pointer; padding:4px;" @click=${(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.dispatchEvent(new CustomEvent('open-manager', { bubbles: true, composed: true }));
                }}>
                            <svg style="width:20px;height:20px;" viewBox="0 0 24 24"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L6.2 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.58 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
                        </button>
                    ` : ''}
                </div>
                
                <div class="popup-scroll-content device-list">
                    ${!hasDevices ? html`<div style="opacity:0.6; text-align:center; padding:20px">No devices found.</div>` : ''}

                    ${this.devices.map(d => {
                    const icon = this._getDeviceIcon(d);
                    const isDefault = this.config && ((this.config.device_playback && this.config.device_playback.default === d.id) || (this.config.default_device === d.id));
                    const isActive = d.isActive;

                    return html`
                            <div class="device-row ${isActive ? 'active' : ''}" @click=${() => this.dispatchEvent(new CustomEvent('device-selected', { detail: d, bubbles: true, composed: true }))}>
                                <div class="device-icon">
                                    ${icon ? (icon.startsWith('mdi:') ? html`<ha-icon icon="${icon}"></ha-icon>` : html`<img src="${icon}" style="width:24px;height:24px;">`) : html`<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 6h16v12H4z"/></svg>`}
                                </div>
                                <div class="device-info">
                                    <div class="device-name">
                                        ${d.name}
                                        ${isDefault ? html`<svg style="width:14px;height:14px;fill:var(--spf-text-sub);margin-left:6px;" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>` : ''}
                                    </div>
                                    <div class="device-type">${d.type}</div>
                                </div>
                                ${isActive ? html`<div class="device-active-icon"><svg style="width:20px;height:20px;fill:var(--spf-brand);" viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg></div>` : ''} 
                            </div>
                        `;
                })}
                </div>

                <div class="popup-footer" style="display:flex; gap:12px; margin-top:12px;">
                    <button class="manage-btn" style="flex:1; justify-content:center;" @click=${(e) => {
                e.stopPropagation();
                this.dispatchEvent(new CustomEvent('refresh-devices', { bubbles: true, composed: true }));
            }}>
                        <svg style="width:16px;height:16px;" viewBox="0 0 24 24"><path fill="currentColor" d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                        Refresh
                    </button>

                    ${this.showRevealButton ? html`
                        <button class="manage-btn" style="flex:1; justify-content:center; ${this._revealed ? 'background:rgba(255,255,255,0.1); color:#fff;' : ''}" @click=${(e) => {
                    e.stopPropagation();
                    this._revealed = !this._revealed;
                    this.dispatchEvent(new CustomEvent('toggle-hidden-devices', {
                        detail: { visible: this._revealed },
                        bubbles: true,
                        composed: true
                    }));
                }}>
                            <svg style="width:16px;height:16px;" viewBox="0 0 24 24"><path fill="currentColor" d="${this._revealed ? 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z' : 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-4 .7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z'}"/></svg>
                            ${this._revealed ? 'Hide Network' : 'Show Network'}
                        </button>
                    ` : ''}
                </div>

                <div style="display:flex; flex-direction:column; gap:12px; margin-top:12px;">
                    <button class="popup-close-btn" @click=${() => this.dispatchEvent(new CustomEvent('close-popups', { bubbles: true, composed: true }))}>Close</button>
                </div>
            </div>
        `;
    }
}

customElements.define('spotify-popup-devices', SpotifyDevicePickerLarge);
