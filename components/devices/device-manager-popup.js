import { LitElement, html, css } from "../../lit.js";
import { parseDeviceItems, normalizeDevice, deviceTypeLabel, normalizeRename, reorderList, dragTargetIndex, fireHaptic } from '../../utils.js';
import { deviceTypeIcon, menuIcon, dragHandleIcon, pinIcon } from '../common/icons.js';
import '../bottom-sheet.js';

/**
 * Manage Devices: a tall bottom sheet on phones, a centered modal on
 * tablet/desktop. One flat scroll of Spotify-style sections — Saved devices
 * (drag to reorder, inline rename, "..." row menu), Settings toggles, Other
 * devices on your network (Add), and a remove-all row at the bottom.
 *
 * Driven by the app: `hass`, `deviceManager`, `api`, `visible`.
 * Emits `close-dialog`, `show-alert` (remove-all confirm) and
 * `open-context-menu` (row menu, hosted by the app root).
 */
export class SpotifyDeviceManagerPopup extends LitElement {
    static get styles() {
        return css`
            :host {
                display: contents;
                --spf-sheet-max-h: 96%;
                /* Below the context menu (215000) and alerts/toasts (230000). */
                --spf-sheet-z: 212000;
            }

            /* ---- Header ---- */
            .head {
                display: flex; align-items: center; justify-content: space-between;
                flex-shrink: 0;
                padding-bottom: 4px;
            }
            .title {
                margin: 0;
                font-size: var(--spf-text-xl, 22px); font-weight: 900;
                color: var(--spf-text-main, #fff);
            }
            .done {
                background: none; border: none; cursor: pointer;
                color: var(--spf-text-main, #fff);
                font: inherit; font-size: var(--spf-text-md, 15px); font-weight: 700;
                min-height: 44px; padding: 0 4px; margin-right: -4px;
            }
            .done:active { opacity: 0.6; }

            /* ---- Body ---- */
            .body {
                flex: 1; min-height: 0;
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                padding-bottom: 8px;
            }

            .label {
                display: flex; align-items: center; justify-content: space-between;
                margin: 22px 0 4px;
                font-size: var(--spf-text-xs, 11px); font-weight: 700;
                letter-spacing: 0.08em; text-transform: uppercase;
                color: var(--spf-text-sub, #b3b3b3);
                min-height: 20px;
            }
            .label:first-child { margin-top: 4px; }

            .empty {
                text-align: center;
                color: var(--spf-text-sub, #b3b3b3);
                font-size: var(--spf-text-base, 13.5px);
                padding: 28px 12px;
                line-height: 1.5;
            }

            /* ---- Rows ---- */
            .row {
                display: flex; align-items: center;
                min-height: 60px;
                border-bottom: 1px solid rgba(255,255,255,0.08);
                position: relative;
                transition: transform 0.15s ease;
            }
            .row.dragging {
                transition: none;
                background: #282828;
                box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                border-radius: 8px;
                border-bottom-color: transparent;
                z-index: 1;
            }
            .row.dragging .grip { cursor: grabbing; }
            .grip:active { cursor: grabbing; }
            .grip, .more {
                flex-shrink: 0;
                width: 44px; height: 44px;
                background: none; border: none; padding: 0;
                color: var(--spf-text-sub, #b3b3b3);
                display: flex; align-items: center; justify-content: center;
                cursor: pointer;
                -webkit-tap-highlight-color: transparent;
            }
            .grip { touch-action: none; cursor: grab; margin-left: -10px; }
            .more { margin-right: -12px; }
            @media (hover: hover) { .more:hover { color: #fff; } }
            .grip svg, .more svg { width: 22px; height: 22px; fill: currentColor; }

            .text { flex: 1; min-width: 0; padding: 8px 0; }
            .name {
                font-size: var(--spf-text-md, 15px); font-weight: 700;
                color: var(--spf-text-main, #fff);
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                cursor: text;
            }
            .sub {
                display: flex; align-items: center; gap: 4px;
                margin-top: 2px;
                font-size: var(--spf-text-sm, 12px);
                color: var(--spf-text-sub, #b3b3b3);
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .sub.default { color: var(--spf-brand, #1ed760); }
            .sub svg { width: 12px; height: 12px; fill: currentColor; flex-shrink: 0; }

            .name-input {
                width: 100%; box-sizing: border-box;
                background: transparent;
                border: none; border-bottom: 1px solid rgba(255,255,255,0.35);
                color: var(--spf-text-main, #fff);
                font: inherit; font-size: var(--spf-text-md, 15px); font-weight: 700;
                padding: 0 0 2px; margin: 0;
                outline: none;
                caret-color: var(--spf-brand, #1ed760);
            }
            .name-input:focus { border-bottom-color: var(--spf-brand, #1ed760); }
        `;
    }

    static get properties() {
        return {
            hass: { type: Object },
            deviceManager: { type: Object },
            api: { type: Object },
            visible: { type: Boolean },
            _savedDevices: { type: Array, state: true },
            _liveDevices: { type: Array, state: true },
            _isLoadingLive: { type: Boolean, state: true },
            _settings: { type: Object, state: true },
            _editingId: { type: String, state: true },
            _dragIndex: { type: Number, state: true },
        };
    }

    constructor() {
        super();
        this._savedDevices = [];
        this._liveDevices = [];
        this._isLoadingLive = false;
        this._settings = {};
        this._editingId = null;
        this._dragIndex = null;
    }

    updated(changedProperties) {
        if (changedProperties.has('deviceManager') || (changedProperties.has('visible') && this.visible)) {
            // First load or visibility toggle - force refresh
            this.refreshSaved();
        } else if (changedProperties.has('hass') && this.deviceManager && this.hass) {
            // Check if specific entity changed before overwriting optimistic state
            const entityId = this.deviceManager.storageEntityId;
            const oldHass = changedProperties.get('hass');
            if (oldHass && entityId) {
                const oldState = oldHass.states[entityId];
                const newState = this.hass.states[entityId];
                if (oldState !== newState) {
                    // Only refresh if the validation storage actually changed
                    this.refreshSaved();
                }
            }
        }

        // Re-scan every time the popup opens (a stale shorter list would
        // otherwise stick around from a previous open)
        if (changedProperties.has('visible') && this.visible) {
            this.refreshLive();
        }
        if (changedProperties.has('visible') && !this.visible) {
            this._editingId = null;
        }
    }

    async refreshSaved() {
        if (this.deviceManager) {
            // We update both devices and settings
            this._savedDevices = await this.deviceManager.getDevices();
            this._settings = await this.deviceManager.getSettings();
        }
    }

    async refreshLive() {
        if (!this.api) return;
        this._isLoadingLive = true;
        try {
            const result = await this.api.fetchSpotifyPlus('get_spotify_connect_devices', { refresh: true });
            this._liveDevices = parseDeviceItems(result).map(normalizeDevice);
        } catch (e) {
            console.error("Failed to fetch live devices", e);
        } finally {
            this._isLoadingLive = false;
        }
    }

    /* --- Actions --- */

    async handleToggleSetting(e) {
        const key = e.target.getAttribute('data-key');
        const checked = e.target.checked;
        if (this.deviceManager) {
            await this.deviceManager.updateSetting(key, checked);
            // Rely on HASS update or optimistic state - do not force refresh stale data
        }
    }

    async handleAdd(device) {
        if (!this.deviceManager) return;

        // Optimistic Update
        const newDevice = {
            id: device.id,
            name: device.name,
            type: device.type || 'Speaker',
            is_default: false,
            is_backup: false,
            visible: true
        };

        // Prevent duplicate visual add if clicked multiple times fast
        if (!this._savedDevices.find(d => d.id === device.id)) {
            this._savedDevices = [...this._savedDevices, newDevice];
        }

        await this.deviceManager.add(device);
        // Do not call refreshSaved() immediately; wait for HASS update
    }

    async handleReset() {
        if (!this.deviceManager) return;

        this.dispatchEvent(new CustomEvent('show-alert', {
            detail: {
                title: "Reset Devices",
                message: "This will remove ALL saved devices. This action cannot be undone.",
                confirmText: "Reset All",
                onConfirm: async () => {
                    // Optimistic Update
                    this._savedDevices = [];
                    this.requestUpdate();

                    await this.deviceManager.saveDevices([]); // Clear all
                }
            },
            bubbles: true, composed: true
        }));
    }

    /* --- Row menu --- */

    _openRowMenu(e, d) {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('open-context-menu', {
            detail: {
                header: { name: d.name, subtitle: deviceTypeLabel(d.type), icon: deviceTypeIcon(d.type) },
                items: [
                    { id: 'dm-default', label: d.is_default ? 'Default device' : 'Set as default', icon: 'pin' },
                    { id: 'dm-rename', label: 'Rename', icon: 'pencil' },
                    { id: 'dm-remove', label: 'Remove', icon: 'trash', danger: true },
                ],
                anchor: e.currentTarget.getBoundingClientRect(),
                onAction: (id) => this._onRowAction(id, d),
            },
            bubbles: true, composed: true
        }));
    }

    async _onRowAction(id, d) {
        if (!this.deviceManager) return;
        if (id === 'dm-default') {
            if (d.is_default) return;
            this._savedDevices = this._savedDevices.map(s => ({ ...s, is_default: s.id === d.id }));
            await this.deviceManager.setDefault(d.id);
        } else if (id === 'dm-rename') {
            this._startRename(d);
        } else if (id === 'dm-remove') {
            this._savedDevices = this._savedDevices.filter(s => s.id !== d.id);
            await this.deviceManager.remove(d.id);
        }
    }

    /* --- Inline rename --- */

    async _startRename(d) {
        this._editingId = d.id;
        await this.updateComplete;
        const input = this.shadowRoot.querySelector('.name-input');
        if (input) {
            input.focus({ preventScroll: true });
            input.select();
        }
    }

    async _commitRename(d, raw) {
        if (this._editingId !== d.id) return; // already committed/cancelled
        const name = normalizeRename(raw, d.name);
        this._editingId = null;
        if (!name || !this.deviceManager) return;
        this._savedDevices = this._savedDevices.map(s => s.id === d.id ? { ...s, name } : s);
        await this.deviceManager.rename(d.id, name);
    }

    _renderRenameInput(d) {
        return html`
            <input class="name-input" type="text" maxlength="100" .value=${d.name}
                @keydown=${(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); this._commitRename(d, e.target.value); }
                    else if (e.key === 'Escape') { this._editingId = null; }
                }}
                @blur=${(e) => this._commitRename(d, e.target.value)}>
        `;
    }

    /* --- Drag reorder (pointer events on the grip; works with mouse and finger) --- */

    _rowEls() {
        return [...this.shadowRoot.querySelectorAll('.row[data-index]')];
    }

    _recordMids() {
        this._dragMids = this._rowEls().map(r => {
            const b = r.getBoundingClientRect();
            return b.top + b.height / 2;
        });
    }

    _draggedRowEl() {
        return this._dragIndex == null ? null : this.shadowRoot.querySelector(`.row[data-index="${this._dragIndex}"]`);
    }

    _onGripDown(e, index) {
        if (this._editingId || this._dragIndex != null) return;
        e.preventDefault();
        const grip = e.currentTarget;
        try { grip.setPointerCapture(e.pointerId); } catch (_) { /* unsupported */ }
        this._dragGrip = grip;
        this._dragPointerId = e.pointerId;
        this._dragStartY = e.clientY;
        this._dragIndex = index;
        this._dragMoved = false;
        this._dragStarted = false;
        this._recordMids();
        grip.addEventListener('pointermove', this._onGripMove);
        grip.addEventListener('pointerup', this._onGripUp);
        grip.addEventListener('pointercancel', this._onGripUp);
        fireHaptic('light');
    }

    _onGripMove = async (e) => {
        if (this._dragIndex == null) return;
        e.preventDefault();
        const delta = e.clientY - this._dragStartY;
        if (!this._dragStarted) {
            if (Math.abs(delta) <= 4) return; // tap tolerance: don't jiggle the list
            this._dragStarted = true;
        }
        const row = this._draggedRowEl();
        if (row) row.style.transform = `translateY(${delta}px)`;

        const to = dragTargetIndex(this._dragMids, e.clientY, this._dragIndex);
        if (to !== this._dragIndex) {
            if (row) row.style.transform = '';
            this._savedDevices = reorderList(this._savedDevices, this._dragIndex, to);
            this._dragIndex = to;
            this._dragStartY = e.clientY;
            this._dragMoved = true;
            await this.updateComplete;
            this._recordMids();
        }
    };

    _onGripUp = async () => {
        const grip = this._dragGrip;
        if (grip) {
            grip.removeEventListener('pointermove', this._onGripMove);
            grip.removeEventListener('pointerup', this._onGripUp);
            grip.removeEventListener('pointercancel', this._onGripUp);
            try { grip.releasePointerCapture(this._dragPointerId); } catch (_) { /* already released */ }
        }
        const row = this._draggedRowEl();
        if (row) row.style.transform = '';
        const changed = this._dragMoved;
        this._dragGrip = null;
        this._dragIndex = null;
        this._dragMoved = false;
        if (changed && this.deviceManager) {
            fireHaptic('medium');
            await this.deviceManager.saveDevices(this._savedDevices);
        }
    };

    /* --- Render --- */

    close() {
        this.dispatchEvent(new CustomEvent('close-dialog', { bubbles: true, composed: true }));
    }

    _sectionLabel(text, trailing = '') {
        return html`<div class="label"><span>${text}</span>${trailing}</div>`;
    }

    _renderSaved() {
        return html`
            ${this._sectionLabel('Saved devices')}
            ${this._savedDevices.length === 0
                ? html`<div class="empty">No saved devices yet.<br>Add one from the devices below.</div>`
                : this._savedDevices.map((d, i) => html`
                    <div class="row ${this._dragIndex === i ? 'dragging' : ''}" data-index=${i}>
                        <button class="grip" aria-label="Reorder" @pointerdown=${(e) => this._onGripDown(e, i)}>${dragHandleIcon}</button>
                        <div class="text">
                            ${this._editingId === d.id
                                ? this._renderRenameInput(d)
                                : html`<div class="name" @click=${() => this._startRename(d)}>${d.name}</div>`}
                            <div class="sub ${d.is_default ? 'default' : ''}">
                                ${d.is_default ? html`${pinIcon}<span>Default · </span>` : ''}<span>${deviceTypeLabel(d.type)}</span>
                            </div>
                        </div>
                        <button class="more" aria-label="More" @click=${(e) => this._openRowMenu(e, d)}>${menuIcon}</button>
                    </div>
                `)}
        `;
    }

    _renderSettings() { return ''; }
    _renderNetwork() { return ''; }
    _renderResetRow() { return ''; }

    render() {
        return html`
            <spotify-bottom-sheet desktop-modal .visible=${this.visible} @close=${(e) => { e.stopPropagation(); this.close(); }}>
                <div class="head">
                    <h2 class="title">Manage devices</h2>
                    <button class="done" @click=${this.close}>Done</button>
                </div>
                <div class="body">
                    ${this._renderSaved()}
                    ${this._renderSettings()}
                    ${this._renderNetwork()}
                    ${this._renderResetRow()}
                </div>
            </spotify-bottom-sheet>
        `;
    }
}

customElements.define('spotify-popup-devicemanager', SpotifyDeviceManagerPopup);
