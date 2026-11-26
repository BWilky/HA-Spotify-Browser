import { LitElement, html, css } from "../../lit.js";
import { fireHaptic, stepVolume } from "../../utils.js";
import { listIcon } from '../common/icons.js';
import { PlayerStateController } from '../controllers/player-state-controller.js';
import { VolumeController } from '../controllers/volume-controller.js';
import { renderDeviceRow, deviceRowStyles, deviceIconFor } from '../devices/device-row.js';
import '../bottom-sheet.js';

/**
 * Mobile "Connect" bottom sheet, styled after the Spotify app's device picker.
 * Slides up from the mini-player's device icon. Shows the active device with a
 * volume slider at the top, then the list of available Spotify Connect devices.
 *
 * Driven by the app: `devices` (merged saved + live) and `playerController`.
 * The player state (active device, volume, now-playing line) is read through a
 * PlayerStateController, which re-renders the sheet only while it is visible;
 * the card config (custom device icons, devices.volume.rate_control /
 * .optimistic) is read off `playerController.config`. Emits:
 *   - `close`          — dismiss the sheet
 *   - `device-selected`(device) — transfer playback to a device
 *   - `volume-change`  (0..1)   — set the active device volume (slider, or a
 *                                 tap on the -/+ icons, which move by `volumeStep` %);
 *                                 rate-limited and held optimistically by the
 *                                 shared VolumeController, final level sent on release
 *   - `open-manager`            — open the full device manager
 */
export class SpotifyConnectPanel extends LitElement {
    static get properties() {
        return {
            visible: { type: Boolean, reflect: true },
            devices: { type: Array },
            playerController: { attribute: false },
            loading: { type: Boolean },
            volumeStep: { type: Number },
        };
    }

    static get styles() {
        return [deviceRowStyles, css`
            :host { display: contents; }

            .title { font-size: var(--spf-text-2xl, 26px); font-weight: 900; margin: 0 0 18px; flex-shrink: 0; }

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
                font-size: var(--spf-text-xl, 22px); font-weight: 900;
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
                font-size: var(--spf-text-base, 13.5px); font-weight: 700;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .card-sub svg { width: 16px; height: 16px; flex-shrink: 0; fill: currentColor; }
            .card-sub span { overflow: hidden; text-overflow: ellipsis; }

            .vol-row { display: flex; align-items: center; gap: 12px; margin-top: 18px; }
            .vol-row svg { width: 22px; height: 22px; fill: rgba(255,255,255,0.8); flex-shrink: 0; }
            /* The -/+ icons are tap targets: one tap nudges the volume by volumeStep. */
            .vol-btn {
                background: none; border: none; padding: 8px; margin: -8px; cursor: pointer;
                display: flex; align-items: center; justify-content: center; border-radius: 50%;
                color: inherit; -webkit-tap-highlight-color: transparent; flex-shrink: 0;
            }
            .vol-btn:active { background: rgba(255,255,255,0.12); }
            .vol-btn:active svg { fill: var(--spf-brand, #1ed760); }
            .vol-row.disabled .vol-btn { cursor: default; pointer-events: none; }

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

            .vol-row.disabled input[type="range"] { opacity: 0.4; cursor: default; }
            .vol-row.disabled input[type="range"]::-webkit-slider-thumb { cursor: default; }
            .vol-row.disabled input[type="range"]::-moz-range-thumb { cursor: default; }
            .vol-hint {
                margin-top: 8px;
                font-size: var(--spf-text-sm, 12px);
                color: var(--spf-text-sub, #b3b3b3);
                text-align: center;
            }

            /* --- Device list --- */
            .list {
                margin-top: 8px;
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                flex: 1; min-height: 0;
            }
            /* Device rows: deviceRowStyles (shared with the device picker). */

            .empty { text-align: center; color: var(--spf-text-sub, #b3b3b3); padding: 28px 0; font-size: var(--spf-text-base, 13.5px); }

            .more {
                display: flex; align-items: center; justify-content: center; gap: 8px;
                margin-top: 6px; padding: 14px;
                color: var(--spf-text-sub, #b3b3b3); font-size: var(--spf-text-base, 13.5px); font-weight: 700;
                background: none; border: none; cursor: pointer; width: 100%;
                border-top: 1px solid rgba(255,255,255,0.08);
            }
            .more svg { width: 18px; height: 18px; fill: currentColor; }
        `];
    }

    constructor() {
        super();
        this.visible = false;
        this.devices = [];
        this.loading = false;
        this.volumeStep = 2;
        this._volDragging = false;
        // Player state, re-rendering only while the sheet is open; opening it
        // (`visible`) renders with the current state, so nothing that changed
        // while it was hidden is missed.
        this._player = new PlayerStateController(this, { isActive: () => this.visible });
        // Rate limiting + optimistic hold after the user sets a level (Spotify
        // can report a Cast speaker's old volume for a beat after a volume_set,
        // so without the hold the thumb snaps back and then forward). Honours
        // devices.volume.rate_control / .optimistic, as the sidebar does.
        this._vol = new VolumeController(this, {
            send: (pct) => this.dispatchEvent(new CustomEvent('volume-change', {
                detail: pct / 100, bubbles: true, composed: true
            })),
            getConfig: () => this._config()?.devices?.volume,
        });
    }

    /** Card config, carried by the PlayerController (updateConfig). */
    _config() {
        return this.playerController?.config || null;
    }

    get _state() {
        return this._player.state;
    }

    _displayedVolume() {
        return Math.round(this._vol.displayed(this._state?.volume ?? 0));
    }

    updated() {
        // Sync the slider from player state, but never while the user is dragging
        // (a background hass update would otherwise snap the thumb back). After a
        // change, keep showing the user's value while the optimistic hold lasts.
        if (this.visible && !this._volDragging) {
            const el = this.shadowRoot.getElementById('vol-slider');
            if (el) {
                const volume = this._displayedVolume();
                el.value = String(volume);
                this._sliderFill(el, volume);
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
    _barsIcon() {
        return html`<svg viewBox="0 0 24 24"><rect x="3" y="10" width="4" height="11" rx="1"/><rect x="10" y="5" width="4" height="16" rx="1"/><rect x="17" y="13" width="4" height="8" rx="1"/></svg>`;
    }
    _volLow() { return html`<svg viewBox="0 0 24 24"><path d="M7 9v6h4l5 5V4l-5 5H7z"/></svg>`; }
    _volHigh() { return html`<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05A4.5 4.5 0 0016.5 12zM14 3.23v2.06a7 7 0 010 13.42v2.06a9 9 0 000-17.54z"/></svg>`; }

    _activeDevice() {
        const name = this._state?.activeDevice;
        if (name) {
            const match = (this.devices || []).find(d => d.name === name);
            return { name, type: match?.type || 'Speaker', id: match?.id, supportsVolume: match?.supportsVolume };
        }
        const act = (this.devices || []).find(d => d.isActive);
        return act ? { name: act.name, type: act.type, id: act.id, supportsVolume: act.supportsVolume } : null;
    }

    _nowPlayingLine() {
        const t = this._state?.track;
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
        this._vol.input(v);
    }

    /** Tap on the -/+ icon: nudge by volumeStep, update the slider now, emit the new level. */
    _onVolStep(direction) {
        const el = this.shadowRoot.getElementById('vol-slider');
        const current = el ? Number(el.value) : this._displayedVolume();
        const next = stepVolume(current, direction, this.volumeStep);
        if (next === Math.round(current)) return;
        fireHaptic('light');
        if (el) { el.value = String(next); this._sliderFill(el, next); }
        // Rate-limited like a drag (rapid taps coalesce; the last one is always
        // sent), held at the tapped value while the player state catches up.
        this._vol.input(next);
    }

    /** Release: send the final level now (drops a pending rate-limited send). */
    _onVolCommit(e) {
        this._volDragging = false;
        this._vol.commit(Number(e.target.value));
    }

    _select(device) {
        if (device.isActive || device.name === this._state?.activeDevice) { this._close(); return; }
        fireHaptic('medium');
        this.dispatchEvent(new CustomEvent('device-selected', { detail: device, bubbles: true, composed: true }));
    }

    _close() { this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true })); }
    _openManager() { this.dispatchEvent(new CustomEvent('open-manager', { bubbles: true, composed: true })); }

    render() {
        const active = this._activeDevice();
        const volDisabled = active?.supportsVolume === false;
        const vol = this._displayedVolume();
        const nowLine = this._nowPlayingLine();
        const config = this._config();
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
                        <div class="vol-row ${volDisabled ? 'disabled' : ''}">
                            <button class="vol-btn" aria-label="Volume down" ?disabled=${volDisabled}
                                    @click=${() => this._onVolStep(-1)}>${this._volLow()}</button>
                            <input id="vol-slider" type="range" min="0" max="100" value=${String(vol)}
                                   ?disabled=${volDisabled}
                                   style="background: linear-gradient(to right, var(--spf-brand, #1ed760) ${vol}%, #4d4d4d ${vol}%);"
                                   @input=${this._onVolInput} @change=${this._onVolCommit}>
                            <button class="vol-btn" aria-label="Volume up" ?disabled=${volDisabled}
                                    @click=${() => this._onVolStep(+1)}>${this._volHigh()}</button>
                        </div>
                        ${volDisabled ? html`<div class="vol-hint">Volume is controlled on the device</div>` : ''}
                    </div>
                ` : ''}

                <div class="list">
                    ${this.loading && listDevices.length === 0
                ? html`<div class="empty">Scanning for devices…</div>`
                : (listDevices.length
                    ? listDevices.map(d => renderDeviceRow(d, {
                        onSelect: (dev) => this._select(dev),
                        icon: deviceIconFor(d, config),
                        subtitle: html`${d.type || 'Spotify Connect'}`,
                    }))
                    : html`<div class="empty">No other devices found.</div>`)}

                    <button class="more" @click=${this._openManager}>
                        ${listIcon()}
                        Manage devices
                    </button>
                </div>
            </spotify-bottom-sheet>
        `;
    }
}

customElements.define('spotify-connect-panel', SpotifyConnectPanel);
