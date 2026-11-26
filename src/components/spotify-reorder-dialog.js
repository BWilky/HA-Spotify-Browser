import { LitElement, html, css } from "../lit.js";
import { sharedStyles } from '../styles/shared-styles.js';
import { trashIcon, closeIcon } from './common/icons.js';
import './bottom-sheet.js';
import { ListDragController } from './controllers/list-drag-controller.js';

/** Liked Songs and config pins are locked: not draggable, not removable. */
const isLocked = (item) => !!item?.fixed || item?.id === 'user-library';

/**
 * Pinned-items reorder dialog. Built on <spotify-bottom-sheet desktop-modal>
 * (shared backdrop, transitions, Escape via the overlay stack; a draggable
 * sheet on phones, a centred card at >=769px) and ListDragController for the
 * row drag. Row drags never dismiss the sheet: the sheet only starts a
 * dismiss drag from its own grip area, never from slotted content.
 *
 * Props: .items, .visible, .allowBlur
 * Events (non-bubbling unless noted): close, reorder (detail: items),
 *   delete-item (detail: id), add-custom-uri (detail: uri),
 *   reset-pinned-items, show-alert (bubbles, composed).
 */
class SpotifyReorderDialog extends LitElement {
    static get properties() {
        return {
            items: { type: Array },
            visible: { type: Boolean },
            allowBlur: { type: Boolean },
            _showUriInput: { type: Boolean, state: true },
            _uriInputValue: { type: String, state: true },
        };
    }

    static get styles() {
        return [
            sharedStyles,
            css`
                /* No box of its own (sharedStyles' :host is a 0x0 absolute
                   z-index box): the sheet is the overlay, stacked as before. */
                :host {
                    display: contents;
                    --spf-sheet-z: 200000;
                    --spf-sheet-modal-w: 500px;
                    --spf-sheet-backdrop: rgba(0, 0, 0, 0.9);
                    /* Header/list/footer bring their own full-bleed spacing. */
                    --spf-sheet-pad-x: 0px;
                    --spf-sheet-pad-bottom: 0px;
                }
                @media (min-width: 769px) {
                    :host { --spf-sheet-pad-top: 0px; }
                }
                spotify-bottom-sheet.blur {
                    --spf-sheet-backdrop: rgba(0, 0, 0, 0.7);
                    --spf-sheet-backdrop-filter: blur(12px);
                }

                .dialog-content {
                    display: flex;
                    flex-direction: column;
                    flex: 1;
                    min-height: 0;
                }

                /* Header */
                .dialog-header {
                    padding: 20px;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                /* Phones: the sheet's grip already spaces the top. */
                @media (max-width: 768px) {
                    .dialog-header { padding-top: 4px; }
                }

                .dialog-title {
                    margin: 0;
                    font-size: var(--spf-text-lg, 17px);
                    font-weight: bold;
                    color: #fff;
                }

                /* Body & List */
                .dialog-body {
                    flex: 1;
                    min-height: 0;
                    overflow-y: auto;
                    padding: 10px 0;
                    -webkit-overflow-scrolling: touch;
                }

                .reorder-list {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                    position: relative;
                }

                .reorder-item {
                    display: flex;
                    align-items: center;
                    padding: 10px 16px;
                    background: transparent;
                    border-bottom: 1px solid rgba(255,255,255,0.05);
                    cursor: grab;
                    user-select: none;
                    touch-action: none; 
                    position: relative;
                    transition: background 0.2s;
                    z-index: 1;
                }

                /* Liked Songs row: locked at the top, not draggable. */
                .reorder-item.locked { cursor: default; }
                .reorder-item.locked .handle { opacity: 0.45; }

                /* GHOST & FLOAT LOGIC */
                .reorder-item.dragging {
                    z-index: 100;
                    background: #282828 !important;
                    transform: scale(1.05);
                    box-shadow: 0 15px 40px rgba(0,0,0,0.7);
                    cursor: grabbing;
                    border-radius: 8px;
                    border-bottom: none;
                }

                .reorder-item.ghost {
                    opacity: 0.2;
                    background: rgba(255, 255, 255, 0.05);
                }

                /* Drop Indicators */
                .reorder-item.drop-before::before {
                    content: '';
                    position: absolute;
                    top: -1px; left: 0; right: 0;
                    height: 3px;
                    background: var(--spf-brand, #1DB954);
                    z-index: 10;
                }
                
                .reorder-item.drop-after::after {
                    content: '';
                    position: absolute;
                    bottom: -1px; left: 0; right: 0;
                    height: 3px;
                    background: var(--spf-brand, #1DB954);
                    z-index: 10;
                }

                /* Item Content */
                .handle { color: #b3b3b3; margin-right: 12px; display: flex; }
                .item-thumb {
                    width: 44px; height: 44px;
                    border-radius: 4px;
                    background-size: cover;
                    background-position: center;
                    margin-right: 12px;
                    background-color: #282828;
                    flex-shrink: 0;
                }
                .item-info { flex: 1; min-width: 0; }
                .item-title { font-size: var(--spf-text-md, 15px); color: #fff; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .item-subtitle { font-size: var(--spf-text-sm, 12px); color: #b3b3b3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

                /* Action Buttons */
                .action-btn {
                    background: none; border: none; color: #b3b3b3;
                    cursor: pointer; padding: 8px; border-radius: 50%;
                    transition: 0.2s;
                    display: flex;
                }
                .action-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
                .action-btn.delete:hover { color: #e91e63; background: rgba(233, 30, 99, 0.1); }

                /* Footer */
                .dialog-footer {
                    padding: 16px 20px;
                    border-top: 1px solid rgba(255,255,255,0.1);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .btn-base {
                    border: none;
                    padding: 10px 24px;
                    border-radius: 24px;
                    font-weight: bold;
                    cursor: pointer;
                    transition: transform 0.1s, background 0.2s;
                }

                .library-toggle-btn {
                    background: transparent;
                    color: #fff;
                    border: 1px solid rgba(255,255,255,0.3);
                }

                .library-toggle-btn.active {
                    background: var(--spf-brand, #1DB954);
                    border-color: var(--spf-brand, #1DB954);
                    color: #000;
                }

                .close-btn { background: #fff; color: #000; }
                .close-btn:hover { transform: scale(1.04); }
            `
        ];
    }

    constructor() {
        super();
        this.items = [];
        this.visible = false;
        this._drag = new ListDragController(this, {
            itemSelector: '.reorder-item',
            isDraggable: (index) => !isLocked(this.items[index]),
            onDrop: (from, to, pos) => this._reorderItems(from, to, pos),
        });
    }

    // --- REORDER LOGIC ---

    _onRowPointerDown(e, index) {
        if (e.target.closest('button')) return; // Ignore drag if clicking a button
        this._drag.start(e, index, this.shadowRoot.querySelector('.reorder-list'));
    }

    _reorderItems(from, to, pos) {
        let newItems = ListDragController.applyMove(this.items, from, to, pos);
        // Keep Liked Songs and config pins locked at the top — nothing can be
        // dropped among them: clamp below the leading locked run (counted
        // without the moved row, which is never locked).
        const rest = [...this.items];
        const [movedItem] = rest.splice(from, 1);
        let lockedCount = 0;
        while (lockedCount < rest.length && isLocked(rest[lockedCount])) lockedCount++;
        if (newItems.indexOf(movedItem) < lockedCount) {
            rest.splice(lockedCount, 0, movedItem);
            newItems = rest;
        }
        this.items = newItems;
        this._dispatchUpdate();
    }

    // --- CUSTOM URI ---

    _handleAddUri() {
        if (!this._uriInputValue) return;
        this.dispatchEvent(new CustomEvent('add-custom-uri', { detail: this._uriInputValue }));
        this._showUriInput = false;
        this._uriInputValue = '';
    }

    _onUriKeyDown(e) {
        if (e.key === 'Enter') this._handleAddUri();
        // Escape in the URI field cancels the field, not the dialog
        // (preventDefault tells the overlay stack it was handled).
        else if (e.key === 'Escape' && !e.isComposing) {
            e.preventDefault();
            this._showUriInput = false;
        }
    }

    /* --- ACTIONS --- */
    _requestDelete(id, e) {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        this.dispatchEvent(new CustomEvent('show-alert', {
            detail: {
                title: 'Remove item?',
                message: 'This will remove the item from your pinned list.',
                confirmText: 'Delete',
                cancelText: 'Cancel',
                size: 'mini',
                onConfirm: () => this.dispatchEvent(new CustomEvent('delete-item', { detail: id }))
            },
            bubbles: true, composed: true
        }));
    }

    _confirmReset() {
        this.dispatchEvent(new CustomEvent('show-alert', {
            detail: {
                title: 'Reset Everything?',
                message: 'This will remove ALL pinned items and restore the default state.',
                confirmText: 'Reset',
                cancelText: 'Cancel',
                size: 'medium',
                onConfirm: () => this.dispatchEvent(new CustomEvent('reset-pinned-items'))
            },
            bubbles: true, composed: true
        }));
    }

    _dispatchUpdate() {
        // Send Items instead of IDs so PinnedItemsManager can persist properties
        this.dispatchEvent(new CustomEvent('reorder', { detail: this.items }));
    }

    _close() { this.dispatchEvent(new CustomEvent('close')); }

    render() {
        // The sheet's own `close` (backdrop, Escape, drag-dismiss) bubbles and
        // is composed; swallow it and emit this dialog's plain `close`.
        return html`
            <spotify-bottom-sheet desktop-modal class=${this.allowBlur ? 'blur' : ''} .visible=${this.visible}
                @close=${(e) => { e.stopPropagation(); this._close(); }}>
                <div class="dialog-content">
                    <div class="dialog-header">
                        <h2 class="dialog-title">Reorder Pinned Items</h2>
                        <button class="action-btn" @click=${this._close}>
                            ${closeIcon(24)}
                        </button>
                    </div>

                    <div class="dialog-body">
                        ${this.items.length === 0
                ? html`<div style="text-align:center; padding:40px; color:#b3b3b3;">No pinned items found.</div>`
                : html`
                                <ul class="reorder-list"
                                    @pointermove=${(e) => this._drag.move(e)}
                                    @pointerup=${(e) => this._drag.end(e)}
                                    @pointercancel=${(e) => this._drag.end(e)}>
                                    ${this.items.map((item, index) => {
                    const locked = isLocked(item);
                    const lockedLabel = item.id === 'user-library' ? 'Always pinned' : 'Pinned in card config';
                    return html`
                                        <li class="reorder-item ${locked ? 'locked' : ''} ${this._drag.rowClass(index)}"
                                            @pointerdown=${(e) => this._onRowPointerDown(e, index)}
                                        >
                                            <div class="handle">
                                                ${locked
                            ? html`<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10z"/></svg>`
                            : html`<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`
                        }
                                            </div>
                                            <div class="item-thumb" style="background-image: url('${item.image || ''}')"></div>
                                            <div class="item-info">
                                                <div class="item-title">${item.title || item.name || '(Untitled Item)'}</div>
                                                <div class="item-subtitle">${locked ? lockedLabel : (item.subtitle || '')}</div>
                                            </div>
                                            <div style="display:flex; align-items:center;">
                                                ${locked ? '' : html`
                                                    <button class="action-btn delete" @click=${(e) => this._requestDelete(item.id, e)} title="Remove">
                                                        ${trashIcon}
                                                    </button>
                                                `}
                                            </div>
                                        </li>
                                    `;
                })}
                                </ul>
                            `
            }
                    </div>

                    <div class="dialog-footer">
                        ${this._showUriInput ? html`
                            <div style="display:flex; width:100%; gap:8px;">
                                <input type="text" placeholder="Spotify URI (spotify:type:id)" 
                                    style="flex:1; background:rgba(255,255,255,0.1); border:none; border-radius:4px; padding:0 12px; color:#fff; height:40px;"
                                    .value=${this._uriInputValue || ''}
                                    @input=${e => this._uriInputValue = e.target.value}
                                    @keydown=${this._onUriKeyDown}
                                >
                                <button class="btn-base" style="background:var(--spf-brand); color:#000; padding:0 16px;" @click=${this._handleAddUri}>Add</button>
                                <button class="btn-base" style="background:transparent; color:#fff; padding:0 16px;" @click=${() => this._showUriInput = false}>Cancel</button>
                            </div>
                        ` : html`
                            <div style="display:flex; gap:8px;">
                                <button class="btn-base library-toggle-btn" @click=${() => this._showUriInput = true}>
                                    + Add Item
                                </button>
                                <button class="btn-base library-toggle-btn" style="border-color: #ffffff;" @click=${this._confirmReset}>
                                    Reset
                                </button>
                            </div>
                            <button class="btn-base close-btn" @click=${this._close}>Done</button>
                        `}
                    </div>
                </div>
            </spotify-bottom-sheet>
        `;
    }
}

customElements.define('spotify-reorder-dialog', SpotifyReorderDialog);