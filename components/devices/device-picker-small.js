import { LitElement, html, css } from "../../lit.js";

export class SpotifyDevicePickerSmall extends LitElement {
    static get properties() {
        return {
            devices: { type: Array },
            visible: { type: Boolean },
            loading: { type: Boolean }
        };
    }

    static get styles() {
        return css`
             /* --- FLOATING DEVICE LIST --- */
            .floating-volume-container {
                position: absolute;
                top: 100%; /* Drop down below the row */
                margin-top: 4px;
                left: 12px; 
                right: 12px;
                max-height: 240px; /* Increased max height */
                background: rgba(30,30,30,0.95);
                border-radius: 12px;
                overflow: hidden;
                z-index: 200; 
                box-shadow: 0 4px 20px rgba(0,0,0,0.6);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                display: flex;
                flex-direction: column;
                align-items: stretch;
                /* overflow-y handled by inner list */
                padding: 0; /* Padding moved to children */
                opacity: 0;
                transform: translateY(-10px) scale(0.95);
                pointer-events: none;
                transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
            }

            .floating-volume-container.visible {
                opacity: 1;
                transform: translateY(0) scale(1);
                pointer-events: auto;
            }

            .device-list {
                flex: 1;
                overflow-y: auto;
                overflow-x: hidden;
                padding: 8px;
            }

            .device-row {
                display: flex; 
                align-items: center; 
                padding: 12px;
                cursor: pointer; 
                border-radius: 4px; 
                background: transparent;
                transition: background 0.2s;
            }

            .device-row:hover {
                background: rgba(255,255,255,0.1);
            }

            .device-row.active {
                background: rgba(30, 215, 96, 0.2);
            }

            .device-name {
                flex: 1; 
                color: #fff; 
                font-size: 14px;
                font-weight: 500;
            }
            .device-row.active .device-name {
                color: #1ed760;
            }

            .device-icon svg { width: 16px; height: 16px; fill: #1ed760; }
            
            .more-devices-row {
                flex-shrink: 0; /* Prevent shrinking */
                border-top: 1px solid rgba(255,255,255,0.1);
                padding: 12px 16px; /* Match row padding but slightly more side padding */
                color: #b3b3b3;
                background: rgba(0,0,0,0.2); /* Slightly darker bg for footer */
                display: flex;
                align-items: center;
                cursor: pointer;
                transition: color 0.2s, background 0.2s;
            }
            .more-devices-row:hover {
                color: #fff;
                background: rgba(255,255,255,0.1);
            }
            .more-devices-row .device-name {
                color: inherit; /* Inherit hover color */
                font-size: 13px;
            }
            .more-devices-row svg { fill: currentColor; }
        `;
    }

    render() {
        return html`
            <div class="floating-volume-container ${this.visible ? 'visible' : ''}">
                ${this.loading
                ? html`<div style="text-align: center; color: #b3b3b3; padding: 20px;">Scanning...</div>`
                : html`
                    <div class="device-list">
                        ${this.devices.map(device => html`
                            <div class="device-row ${device.isActive ? 'active' : ''}" 
                                 @click=${() => this._selectDevice(device)}>
                                <div class="device-name">
                                    ${device.name}
                                </div>
                                ${device.isActive ? html`<div class="device-icon"><svg viewBox="0 0 24 24"><path d="M10 18l6-6-6-6v12z"/></svg></div>` : ''}
                            </div>
                        `)}
                    </div>
                    
                    <!-- Fixed Footer -->
                    <div class="more-devices-row" @click=${this._openManager}>
                        <div class="device-name">More devices...</div>
                        <div class="device-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24"><path d="M3 17v2h6v-2H3zM3 5v2h18V5H3zm0 6h12v-2H3v2z"/></svg>
                        </div>
                    </div>
                `}
            </div>
        `;
    }

    _selectDevice(device) {
        this.dispatchEvent(new CustomEvent('device-selected', {
            detail: device,
            bubbles: true,
            composed: true
        }));
    }

    _openManager() {
        this.dispatchEvent(new CustomEvent('open-manager', {
            bubbles: true,
            composed: true
        }));
    }
}

customElements.define('spotify-device-picker-small', SpotifyDevicePickerSmall);
