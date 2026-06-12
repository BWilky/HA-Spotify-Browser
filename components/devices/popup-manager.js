import { LitElement, html, css } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { popupsStyles } from '../../styles/spotify-popups.styles.js';
import { parseDeviceItems, normalizeDevice } from '../../utils.js';

export class SpotifyPopupDeviceManager extends LitElement {
    static get styles() {
        return [sharedStyles, popupsStyles, css`
            :host {
                display: block;
                position: absolute;
                top: 0; left: 0;
                width: 100%; height: 100%;
                z-index: 220000;
                pointer-events: none;
            }

            .device-popup-backdrop {
                position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
                display: none; align-items: center; justify-content: center;
                opacity: 0; transition: opacity 0.3s;
                pointer-events: auto; /* Backdrop captures clicks */
            }
            .device-popup-backdrop.visible { opacity: 1; display: flex; }

            .popup-content {
                width: 90vw;
                max-width: 1000px; /* Wider */
                height: 85vh; /* Taller fixed height */
                max-height: 900px;
                display: flex;
                flex-direction: column;
                pointer-events: auto;
                padding: 0;
                overflow: hidden;
            }

            .manager-body {
                display: flex;
                flex: 1;
                min-height: 0;
                overflow: hidden;
                padding: 24px;
                gap: 24px; /* Gap between columns */
                background: transparent;
            }

            .column {
                flex: 1;
                display: flex;
                flex-direction: column;
                padding: 16px;
                min-width: 0;
                border-right: none; /* Remove border */
                background: var(--spf-bg-card); /* Card background */
                border-radius: 12px; /* Radius */
                border: 1px solid var(--spf-border);
            }
            .column:last-child {
                background: rgba(255,255,255,0.03); /* Slightly different shade for Live */
            }

            .col-header {
                display: flex; align-items: center; justify-content: space-between;
                margin-bottom: 16px;
                flex-shrink: 0;
                padding-bottom: 12px;
                border-bottom: 1px solid var(--spf-border-subtle);
            }
            .col-title { font-size: 16px; font-weight: 700; color: var(--spf-text-main); text-transform: uppercase; letter-spacing: 0.5px; }
            
            .refresh-btn, .reset-btn {
                background: transparent; border: none; 
                cursor: pointer; display: flex; align-items: center; justify-content: center;
                border-radius: 4px; padding: 6px;
                transition: background 0.2s;
            }
            .refresh-btn { color: var(--spf-brand); }
            .refresh-btn:hover { background: rgba(30,215,96,0.1); }
            
            .reset-btn { color: var(--spf-text-sub); font-size: 11px; font-weight: 600; text-transform: uppercase; gap:4px; }
            .reset-btn:hover { color: #ff5555; background: rgba(255,85,85,0.1); }
            
            .refresh-btn svg, .reset-btn svg { width: 18px; height: 18px; }
            .refresh-btn.spinning svg { animation: spin 1s linear infinite; }
            @keyframes spin { 100% { transform: rotate(360deg); } }

            .device-list {
                flex: 1;
                overflow-y: auto;
                display: flex; flex-direction: column; gap: 8px;
                padding-right: 4px; 
            }

            /* --- Row Styling --- */
            .manager-row {
                display: grid;
                grid-template-columns: 40px 1fr auto;
                gap: 12px;
                align-items: center;
                padding: 10px;
                border-radius: 6px;
                background: rgba(255,255,255,0.02);
                border: 1px solid transparent;
                transition: background 0.2s;
            }
            .manager-row:hover { background: rgba(255,255,255,0.06); }
            
            /* Dragging Styles */
            .manager-row[draggable="true"] { cursor: grab; }
            .manager-row.dragging { opacity: 0.5; background: rgba(255,255,255,0.1); border: 1px dashed rgba(255,255,255,0.3); }
            .manager-row.drag-over { border-top: 2px solid var(--spf-brand); }
            
            .row-icon { display: flex; align-items: center; justify-content: center; opacity: 0.7; }
            .row-icon svg { width: 20px; height: 20px; fill: currentColor; }

            .row-info { display: flex; flex-direction: column; overflow: hidden; }
            .row-name { font-weight: 600; color: var(--spf-text-main); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .row-type { font-size: 11px; color: var(--spf-text-sub); text-transform: uppercase; margin-top: 2px; }

            .row-actions { display: flex; gap: 4px; align-items: center; }

            .icon-btn {
                background: transparent; border: none; color: var(--spf-text-sub);
                width: 28px; height: 28px; border-radius: 4px;
                display: flex; align-items: center; justify-content: center;
                cursor: pointer; transition: all 0.2s;
            }
            .icon-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
            .icon-btn.add:hover { color: var(--spf-brand); background: rgba(30,215,96,0.1); }
            .icon-btn.delete:hover { color: #ff5555; background: rgba(255,85,85,0.1); }
            .icon-btn.active-default { color: var(--spf-brand); opacity: 1; }
            .icon-btn svg { width: 16px; height: 16px; fill: currentColor; }

            .toolbar {
                padding: 16px;
                border-top: 1px solid var(--spf-border);
                display: flex; justify-content: flex-end;
                background: var(--spf-bg);
            }
            
            .header-bar {
                padding: 20px 24px; 
                border-bottom: 1px solid var(--spf-border);
                display: flex; align-items: center; justify-content: space-between;
                background: var(--spf-bg); /* Opaque header */
            }
            /* Toggle Switch */
            .setting-row {
                display: flex; align-items: center; justify-content: space-between;
                padding: 12px; background: rgba(255,255,255,0.05);
                border-radius: 8px; margin-top: auto; /* Push to bottom */
            }
            .setting-label { font-size: 14px; font-weight: 600; color: var(--spf-text-main); }
            .setting-desc { font-size: 11px; color: var(--spf-text-sub); margin-top: 2px; }
            
            .switch { position: relative; display: inline-block; width: 36px; height: 20px; }
            .switch input { opacity: 0; width: 0; height: 0; }
            .slider {
                position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
                background-color: #535353; transition: .4s; border-radius: 20px;
            }
            .slider:before {
                position: absolute; content: ""; height: 16px; width: 16px; left: 2px; bottom: 2px;
                background-color: white; transition: .4s; border-radius: 50%;
            }
            input:checked + .slider { background-color: var(--spf-brand); }
            input:checked + .slider:before { transform: translateX(16px); }
        `];
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
            _settings: { type: Object, state: true }
        };
    }

    constructor() {
        super();
        this._savedDevices = [];
        this._liveDevices = [];
        this._isLoadingLive = false;
        this._settings = {};
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

        if (changedProperties.has('visible') && this.visible && !this._liveDevices.length) {
            this.refreshLive();
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

    /* --- Icons --- */
    _getIconForType(type) {
        if (!type) return html`<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>`;

        const t = type.toLowerCase();
        if (t === 'computer') return html`<svg viewBox="0 0 24 24"><path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>`;
        if (t === 'smartphone' || t === 'phone') return html`<svg viewBox="0 0 24 24"><path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/></svg>`;
        if (t === 'tablet') return html`<svg viewBox="0 0 24 24"><path d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-2 14H5V6h14v12z"/></svg>`;
        if (t === 'castaudio' || t === 'speaker') return html`<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>`;
        if (t === 'tv') return html`<svg viewBox="0 0 24 24"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L22 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>`;
        if (t === 'avr' || t === 'stb' || t === 'audiodongle') return html`<svg viewBox="0 0 24 24"><path d="M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zm6 0h-2V5h2v2zm6 0h-2V5h2v2z"/></svg>`;

        // Default Speaker
        return html`<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>`;
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

    async handleRemove(id) {
        if (!this.deviceManager) return;

        this.dispatchEvent(new CustomEvent('show-alert', {
            detail: {
                title: "Remove Device",
                message: "Are you sure you want to remove this device from your saved list?",
                confirmText: "Remove",
                onConfirm: async () => {
                    // Optimistic Update
                    this._savedDevices = this._savedDevices.filter(d => d.id !== id);
                    this.requestUpdate();

                    await this.deviceManager.remove(id);
                }
            },
            bubbles: true, composed: true
        }));
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

    async handleRename(id, oldName) {
        // Keeping prompt for now as requested fix focused on confirmation alerts
        const newName = prompt("Enter new name:", oldName);
        if (newName && newName !== oldName) {
            await this.deviceManager.rename(id, newName);
            this.refreshSaved();
        }
    }

    async handleSetDefault(id) {
        await this.deviceManager.setDefault(id);
        this.refreshSaved();
    }

    /* --- Drag and Drop --- */

    handleDragStart(e, index) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index);
        // Add class for styling
        e.target.classList.add('dragging');
        this._dragSourceIndex = index;
    }

    handleDragEnd(e) {
        e.target.classList.remove('dragging');
        this.shadowRoot.querySelectorAll('.manager-row').forEach(el => el.classList.remove('drag-over'));
        this._dragSourceIndex = null;
    }

    handleDragOver(e) {
        if (e.preventDefault) e.preventDefault(); // Necessary for allow drop
        e.dataTransfer.dropEffect = 'move';
        return false;
    }

    handleDragEnter(e) {
        // Visual feedback
        e.preventDefault();
        const targetRow = e.target.closest('.manager-row');
        if (targetRow && !targetRow.classList.contains('dragging')) {
            targetRow.classList.add('drag-over');
        }
    }

    handleDragLeave(e) {
        const targetRow = e.target.closest('.manager-row');
        if (targetRow) {
            targetRow.classList.remove('drag-over');
        }
    }

    async handleDrop(e, targetIndex) {
        e.stopPropagation();
        e.preventDefault();

        // Remove visual feedback
        this.shadowRoot.querySelectorAll('.manager-row').forEach(el => el.classList.remove('drag-over'));

        const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'));

        if (sourceIndex !== targetIndex && !isNaN(sourceIndex)) {
            // Reorder Array
            const newSaved = [...this._savedDevices];
            const [movedItem] = newSaved.splice(sourceIndex, 1);
            newSaved.splice(targetIndex, 0, movedItem);

            // Optimistic Update
            this._savedDevices = newSaved;
            this.requestUpdate();

            // Persist
            if (this.deviceManager) {
                await this.deviceManager.saveDevices(newSaved);
            }
        }

        return false;
    }

    close() {
        this.dispatchEvent(new CustomEvent('close-dialog', { bubbles: true, composed: true }));
    }

    render() {
        return html`
            <div class="device-popup-backdrop ${this.visible ? 'visible' : ''}" @click=${this.close}>
                <div class="popup-content" @click=${e => e.stopPropagation()}>
                    <!-- Header -->
                    <div class="header-bar">
                        <h2 class="header-title">Manage Devices</h2>
                        <button class="popup-close-btn" style="width:auto; padding:4px 8px; margin:0;" @click=${this.close}>Done</button>
                    </div>

                    <!-- Body -->
                    <div class="manager-body">
                        <!-- Left Column: Saved Devices -->
                        <div class="column">
                            <div class="col-header">
                                <span class="col-title">Saved Devices</span>
                                <button class="reset-btn" @click=${this.handleReset} title="Remove All Saved Devices">
                                    <svg viewBox="0 0 24 24"><path fill="currentColor" d="M19.36 2.72l1.42 1.42L5.14 19.8 3.72 18.38 19.36 2.72zM5.93 2.72l15.56 15.55-1.42 1.42L4.51 4.14 5.93 2.72z"/></svg> 
                                    Reset
                                </button>
                            </div>
                            
                            <div class="device-list">
                                ${this._savedDevices.length === 0 ? html`<div style="opacity:0.5; text-align:center; padding:20px 0; font-size:13px;">No saved devices.<br>Add from the Live list.</div>` : ''}
                                ${this._savedDevices.map((d, index) => html`
                                    <div class="manager-row" 
                                         draggable="true"
                                         @dragstart=${(e) => this.handleDragStart(e, index)}
                                         @dragend=${this.handleDragEnd}
                                         @dragover=${this.handleDragOver}
                                         @dragenter=${this.handleDragEnter}
                                         @dragleave=${this.handleDragLeave}
                                         @drop=${(e) => this.handleDrop(e, index)}>
                                        <div class="row-icon" style="cursor:grab; opacity:0.6;">
                                            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                                        </div>
                                        <div class="row-info">
                                            <span class="row-name">${d.name}</span>
                                            <span class="row-type">${d.type}</span>
                                        </div>
                                        <div class="row-actions">
                                            <!-- Default Toggle -->
                                            <button class="icon-btn ${d.is_default ? 'active-default' : ''}" 
                                                    title="${d.is_default ? 'Default Device' : 'Set as Default'}"
                                                    @click=${() => this.handleSetDefault(d.id)}>
                                                <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                                            </button>
                                            
                                            <!-- Rename -->
                                            <button class="icon-btn" title="Rename" @click=${() => this.handleRename(d.id, d.name)}>
                                                <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                                            </button>

                                            <!-- Delete -->
                                            <button class="icon-btn delete" title="Remove" @click=${() => this.handleRemove(d.id)}>
                                                <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                                            </button>
                                        </div>
                                    </div>
                                `)}
                            </div>

                            <!-- Settings Footer -->
                            <div class="setting-row">
                                <div>
                                    <div class="setting-label">Hide Connect Devices</div>
                                    <div class="setting-desc">Hides all other devices on the network</div>
                                </div>
                                <label class="switch">
                                    <input type="checkbox" data-key="hide_connect_devices" 
                                           .checked=${this._settings?.hide_connect_devices === true} 
                                           @change=${this.handleToggleSetting}>
                                    <span class="slider"></span>
                                </label>
                            </div>

                                <div class="setting-row" style="margin-top: 8px; margin-left: 12px; border-left: 2px solid ${this._settings?.hide_connect_devices ? 'var(--spf-brand)' : 'var(--spf-border)'}; opacity: ${this._settings?.hide_connect_devices ? '0.9' : '0.4'}; pointer-events: ${this._settings?.hide_connect_devices ? 'auto' : 'none'};">
                                    <div>
                                        <div class="setting-label">See All</div>
                                        <div class="setting-desc">Displays a button to scan for all network devices</div>
                                    </div>
                                    <label class="switch">
                                        <input type="checkbox" data-key="see_all_devices" 
                                               .checked=${this._settings?.see_all_devices === true} 
                                               .disabled=${!this._settings?.hide_connect_devices}
                                               @change=${this.handleToggleSetting}>
                                        <span class="slider"></span>
                                    </label>
                                </div>

                            <div class="setting-row" style="margin-top: 8px;">
                                <div>
                                    <div class="setting-label">Hide if Offline</div>
                                    <div class="setting-desc">Hides saved devices that are not active</div>
                                </div>
                                <label class="switch">
                                    <input type="checkbox" data-key="hide_offline_devices" 
                                           .checked=${this._settings?.hide_offline_devices === true} 
                                           @change=${this.handleToggleSetting}>
                                    <span class="slider"></span>
                                </label>
                            </div>
                        </div>

                        <!-- Right Column: Live Devices -->
                        <div class="column">
                            <div class="col-header">
                                <span class="col-title">Live Devices</span>
                                <button class="refresh-btn ${this._isLoadingLive ? 'spinning' : ''}" @click=${this.refreshLive} title="Refresh Live Devices">
                                    <svg viewBox="0 0 24 24"><path fill="currentColor" d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                                </button>
                            </div>

                            <div class="device-list">
                                ${this._liveDevices.length === 0 && !this._isLoadingLive ? html`<div style="opacity:0.5; text-align:center; padding:20px 0; font-size:13px;">No devices found nearby.<br>Start playback on a device to see it here.</div>` : ''}
                                
                                ${this._liveDevices.map(d => {
            const isAlreadySaved = this._savedDevices.find(s => s.id === d.id);
            return html`
                                        <div class="manager-row" style="opacity: ${isAlreadySaved ? '0.5' : '1'}">
                                            <div class="row-icon">
                                            ${this._getIconForType(d.type)}
                                        </div>
                                            <div class="row-info">
                                                <span class="row-name">${d.name}</span>
                                                <span class="row-type">${d.type}</span>
                                            </div>
                                            <div class="row-actions">
                                                ${!isAlreadySaved ? html`
                                                    <button class="icon-btn add" title="Add to Saved" @click=${() => this.handleAdd(d)}>
                                                        <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                                                    </button>
                                                ` : html`<span style="font-size:10px; opacity:0.6; padding:0 8px;">Saved</span>`}
                                            </div>
                                        </div>
                                    `;
        })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

customElements.define('spotify-popup-devicemanager', SpotifyPopupDeviceManager);
