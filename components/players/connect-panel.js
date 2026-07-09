import { LitElement, html, css } from "../../lit.js";
import { fireHaptic } from "../../utils.js";
import { deviceTypeIcon } from '../common/icons.js';
import '../bottom-sheet.js';

/**
 * Mobile "Connect" bottom sheet, styled after the Spotify app's device picker.
 * Slides up from the mini-player's device icon. Shows the active device with a
 * volume slider at the top, then the list of available Spotify Connect devices.
 *
 * Driven by the app: `devices` (merged saved + live), `state` (PlayerController
 * state, for the active device + volume + now-playing line). Emits:
 *   - `close`          — dismiss the sheet
 *   - `device-selected`(device) — transfer playback to a device
 *   - `volume-change`  (0..1)   — set the active device volume
 *   - `open-manager`            — open the full device manager
 */
export class SpotifyConnectPanel extends LitElement {
    static get properties() {
        return {
            visible: { type: Boolean, reflect: true },
            devices: { type: Array },
            state: { type: Object },
            loading: { type: Boolean },
        };
    }

    static get styles() {
        return css`
            :host { display: contents; }

            .title { font-size: 26px; font-weight: 800; margin: 0 0 18px; flex-shrink: 0; }

            /* --- Active device card --- */
            .card {
                background: #2a2a2a;
                border-radius: 12px;
                padding: 16px;
                flex-shrink: 0;
            }
            .card-top { display: flex; align-items: center; gap: 12px; }
            .card-name {
                flex: 1; min-width: 0;
                font-size: 22px; font-weight: 800;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .spk {
                flex-shrink: 0;
                width: 40px; height: 40px;
                color: var(--spf-brand, #1ed760);
            }
            .spk svg { width: 100%; height: 100%; }

            .card-sub {
                display: flex; align-items: center; gap: 8px;
                margin-top: 6px;
                color: var(--spf-brand, #1ed760);
                font-size: 14px; font-weight: 600;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .card-sub svg { width: 16px; height: 16px; flex-shrink: 0; fill: currentColor; }
            .card-sub span { overflow: hidden; text-overflow: ellipsis; }

            .vol-row { display: flex; align-items: center; gap: 12px; margin-top: 18px; }
            .vol-row svg { width: 22px; height: 22px; fill: rgba(255,255,255,0.8); flex-shrink: 0; }

            input[type="range"] {
                -webkit-appearance: none; appearance: none;
                flex: 1; height: 6px; border-radius: 3px;
                background: #4d4d4d; outline: none; margin: 0; cursor: pointer;
            }
            input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none; appearance: none;
                width: 16px; height: 16px; border-radius: 50%;
                background: #fff; border: none; cursor: pointer;
            }
            input[type="range"]::-moz-range-thumb {
                width: 16px; height: 16px; border-radius: 50%;
                background: #fff; border: none; cursor: pointer;
            }

            /* --- Device list --- */
            .list {
                margin-top: 8px;
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                flex: 1; min-height: 0;
            }
            .row {
                display: flex; align-items: center; gap: 16px;
                padding: 14px 4px;
                cursor: pointer;
            }
            .row-ic {
                width: 26px; height: 26px; flex-shrink: 0;
                color: rgba(255,255,255,0.85);
                display: flex; align-items: center; justify-content: center;
            }
            .row.active .row-ic { color: var(--spf-brand, #1ed760); }
            .row-ic svg { width: 100%; height: 100%; fill: currentColor; }
            .row-text { min-width: 0; flex: 1; }
            .row-name {
                font-size: 16px; font-weight: 600; color: #fff;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .row.active .row-name { color: var(--spf-brand, #1ed760); }
            .row-type {
                display: flex; align-items: center; gap: 6px;
                font-size: 13px; color: var(--spf-text-sub, #b3b3b3); margin-top: 2px;
            }
            .row-type svg { width: 14px; height: 14px; fill: currentColor; }

            .empty { text-align: center; color: var(--spf-text-sub, #b3b3b3); padding: 28px 0; font-size: 14px; }

            .more {
                display: flex; align-items: center; justify-content: center; gap: 8px;
                margin-top: 6px; padding: 14px;
                color: var(--spf-text-sub, #b3b3b3); font-size: 14px; font-weight: 600;
                background: none; border: none; cursor: pointer; width: 100%;
                border-top: 1px solid rgba(255,255,255,0.08);
            }
            .more svg { width: 18px; height: 18px; fill: currentColor; }
        `;
    }

    constructor() {
        super();
        this.visible = false;
        this.devices = [];
        this.loading = false;
        this._volDragging = false;
    }

    updated() {
        // Sync the slider from player state, but never while the user is dragging
        // (a background hass update would otherwise snap the thumb back).
        if (this.visible && !this._volDragging) {
            const el = this.shadowRoot.getElementById('vol-slider');
            if (el) {
                const v = Math.round(this.state?.volume ?? 0);
                el.value = String(v);
                this._sliderFill(el, v);
            }
        }
    }

    /* --- SVG icons --- */
    _speakerOutline() {
        return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="6" y="2" width="12" height="20" rx="2.5"/>
            <circle cx="12" cy="6.5" r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="12" cy="14.5" r="3.2"/>
        </svg>`;
    }
    _iconForType(type) {
        return deviceTypeIcon(type);
    }
    _castIcon() {
        return html`<svg viewBox="0 0 24 24"><path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>`;
    }
    _barsIcon() {
        return html`<svg viewBox="0 0 24 24"><rect x="3" y="10" width="4" height="11" rx="1"/><rect x="10" y="5" width="4" height="16" rx="1"/><rect x="17" y="13" width="4" height="8" rx="1"/></svg>`;
    }
    _volLow() { return html`<svg viewBox="0 0 24 24"><path d="M7 9v6h4l5 5V4l-5 5H7z"/></svg>`; }
    _volHigh() { return html`<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05A4.5 4.5 0 0016.5 12zM14 3.23v2.06a7 7 0 010 13.42v2.06a9 9 0 000-17.54z"/></svg>`; }

    _activeDevice() {
        const name = this.state?.activeDevice;
        if (name) {
            const match = (this.devices || []).find(d => d.name === name);
            return { name, type: match?.type || 'Speaker', id: match?.id };
        }
        const act = (this.devices || []).find(d => d.isActive);
        return act ? { name: act.name, type: act.type, id: act.id } : null;
    }

    _nowPlayingLine() {
        const t = this.state?.track;
        if (!t) return '';
        const artist = t.artists?.map(a => a.name).join(', ') || '';
        return artist ? `${t.name} — ${artist}` : t.name;
    }

    _sliderFill(el, v) {
        el.style.background = `linear-gradient(to right, var(--spf-brand, #1ed760) ${v}%, #4d4d4d ${v}%)`;
    }

    _onVolInput(e) {
        this._volDragging = true;
        const v = Number(e.target.value);
        this._sliderFill(e.target, v);
        if (this._volTimer) clearTimeout(this._volTimer);
        this._volTimer = setTimeout(() => {
            this.dispatchEvent(new CustomEvent('volume-change', {
                detail: v / 100, bubbles: true, composed: true
            }));
        }, 120);
    }

    _onVolCommit(e) {
        this._volDragging = false;
        const v = Number(e.target.value);
        if (this._volTimer) clearTimeout(this._volTimer);
        this.dispatchEvent(new CustomEvent('volume-change', {
            detail: v / 100, bubbles: true, composed: true
        }));
    }

    _select(device) {
        if (device.isActive || device.name === this.state?.activeDevice) { this._close(); return; }
        fireHaptic('medium');
        this.dispatchEvent(new CustomEvent('device-selected', { detail: device, bubbles: true, composed: true }));
    }

    _close() { this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true })); }
    _openManager() { this.dispatchEvent(new CustomEvent('open-manager', { bubbles: true, composed: true })); }

    render() {
        const active = this._activeDevice();
        const vol = Math.round(this.state?.volume ?? 0);
        const nowLine = this._nowPlayingLine();
        // The active device is shown in the card above; don't repeat it in the list.
        const listDevices = (this.devices || []).filter(
            d => !(d.isActive || (active && d.name === active.name))
        );

        return html`
            <spotify-bottom-sheet .visible=${this.visible}>
                <h2 class="title">Connect</h2>

                ${active ? html`
                    <div class="card">
                        <div class="card-top">
                            <div class="card-name">${active.name}</div>
                            <div class="spk">${this._speakerOutline()}</div>
                        </div>
                        ${nowLine ? html`
                            <div class="card-sub">${this._barsIcon()}<span>${nowLine}</span></div>
                        ` : ''}
                        <div class="vol-row">
                            ${this._volLow()}
                            <input id="vol-slider" type="range" min="0" max="100" value=${String(vol)}
                                   style="background: linear-gradient(to right, var(--spf-brand, #1ed760) ${vol}%, #4d4d4d ${vol}%);"
                                   @input=${this._onVolInput} @change=${this._onVolCommit}>
                            ${this._volHigh()}
                        </div>
                    </div>
                ` : ''}

                <div class="list">
                    ${this.loading && listDevices.length === 0
                ? html`<div class="empty">Scanning for devices…</div>`
                : (listDevices.length
                    ? listDevices.map(d => html`
                                <div class="row" @click=${() => this._select(d)}>
                                    <div class="row-ic">${this._iconForType(d.type)}</div>
                                    <div class="row-text">
                                        <div class="row-name">${d.name}</div>
                                        <div class="row-type">${this._castIcon()} ${d.type || 'Spotify Connect'}</div>
                                    </div>
                                </div>`)
                    : html`<div class="empty">No other devices found.</div>`)}

                    <button class="more" @click=${this._openManager}>
                        <svg viewBox="0 0 24 24"><path d="M3 17v2h6v-2H3zM3 5v2h18V5H3zm0 6h12v-2H3v2z"/></svg>
                        Manage devices
                    </button>
                </div>
            </spotify-bottom-sheet>
        `;
    }
}

customElements.define('spotify-connect-panel', SpotifyConnectPanel);
