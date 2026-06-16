import { LitElement, html, css } from "../lit.js";
import { sharedStyles } from '../styles/shared-styles.js';

class SpotifyReorderDialog extends LitElement {
    static get properties() {
        return {
            items: { type: Array },
            visible: { type: Boolean },
            allowBlur: { type: Boolean },
            _draggedItemIndex: { type: Number, state: true },
            _dropTargetIndex: { type: Number, state: true },
            _dropPosition: { type: String, state: true },
            _confirmDeleteId: { type: String, state: true },
            _showResetConfirm: { type: Boolean, state: true },
            _showUriInput: { type: Boolean, state: true },
            _uriInputValue: { type: String, state: true },
        };
    }

    static get styles() {
        return [
            sharedStyles,
            css`
                :host {
                    display: block;
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    z-index: 200000;
                    pointer-events: none;
                    font-family: var(--spf-font-family, sans-serif);
                }

                /* Backdrop & Container */
                .dialog-backdrop {
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.2s ease;
                }
                
                .dialog-backdrop.visible {
                    opacity: 1;
                    pointer-events: auto;
                }

                .dialog-backdrop.blur {
                    background: rgba(0, 0, 0, 0.7);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                }

                .dialog-content {
                    background: var(--spf-bg-alt, #181818);
                    border-radius: 12px;
                    width: 90%;
                    max-width: 500px;
                    max-height: 80vh;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 25px 60px rgba(0,0,0,0.8);
                    border: 1px solid rgba(255,255,255,0.1);
                    position: relative;
                    overflow: hidden;
                }

                /* Header */
                .dialog-header {
                    padding: 20px;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .dialog-title {
                    margin: 0;
                    font-size: 1.2rem;
                    font-weight: bold;
                    color: #fff;
                }

                /* Body & List */
                .dialog-body {
                    flex: 1;
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
                .item-title { font-size: 0.95rem; color: #fff; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .item-subtitle { font-size: 0.8rem; color: #b3b3b3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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

                .alert-btn:hover { background: var(--spf-hover-white, rgba(255,255,255,0.1)); }
                .alert-btn.primary { background: var(--spf-brand, #1DB954); border-color: var(--spf-brand, #1DB954); color: black; }
                .alert-btn.primary:hover { background: var(--spf-brand-hover, #1ed760); }
                .alert-btn.danger { background: transparent; border-color: #e91e63; color: #e91e63; }
                .alert-btn.danger:hover { background: rgba(233, 30, 99, 0.1); }
            `
        ];
    }

    constructor() {
        super();
        this.items = [];
        this.visible = false;
        this._draggedItemIndex = null;
        this._dropTargetIndex = null;
        this._cachedRects = [];
    }

    // --- REORDER LOGIC ---

    _handlePointerDown(e, index) {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (e.target.closest('button')) return; // Ignore drag if clicking a button
        // Liked Songs is locked at #0 — it can't be dragged.
        if (this.items[index]?.id === 'user-library') return;

        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        this._draggedItemIndex = index;

        // Take layout snapshot for 120fps comparison
        const list = this.shadowRoot.querySelector('.reorder-list');
        const items = Array.from(list.querySelectorAll('.reorder-item'));
        this._cachedRects = items.map((item, idx) => {
            const rect = item.getBoundingClientRect();
            return {
                index: idx,
                top: rect.top,
                bottom: rect.bottom,
                midpoint: rect.top + (rect.height / 2)
            };
        });
    }

    _handlePointerMove(e) {
        if (this._draggedItemIndex === null) return;
        const pointerY = e.clientY;

        let foundIndex = null;
        let position = null;

        for (const rect of this._cachedRects) {
            if (pointerY >= rect.top && pointerY <= rect.bottom) {
                foundIndex = rect.index;
                position = pointerY < rect.midpoint ? 'before' : 'after';
                break;
            }
        }

        // Only update if target changed to prevent redundant renders
        if (this._dropTargetIndex !== foundIndex || this._dropPosition !== position) {
            this._dropTargetIndex = foundIndex;
            this._dropPosition = position;
        }
    }

    _handlePointerUp(e) {
        if (this._draggedItemIndex === null) return;

        if (this._dropTargetIndex !== null && this._draggedItemIndex !== this._dropTargetIndex) {
            this._reorderItems(this._draggedItemIndex, this._dropTargetIndex, this._dropPosition);
        }

        this._resetDragState(e);
    }

    _resetDragState(e) {
        this._draggedItemIndex = null;
        this._dropTargetIndex = null;
        this._dropPosition = null;
        this._cachedRects = [];
        if (e?.target) e.target.releasePointerCapture(e.pointerId);
    }

    _reorderItems(from, to, pos) {
        const newItems = [...this.items];
        const [movedItem] = newItems.splice(from, 1);
        let targetIdx = (pos === 'after') ? to + 1 : to;
        if (from < targetIdx) targetIdx--;
        // Keep Liked Songs locked at #0 — nothing can be dropped above it.
        const hasLockedFirst = newItems[0]?.id === 'user-library';
        if (hasLockedFirst && targetIdx < 1) targetIdx = 1;
        newItems.splice(targetIdx, 0, movedItem);
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
        return html`
            <div class="dialog-backdrop ${this.visible ? 'visible' : ''} ${this.allowBlur ? 'blur' : ''}"
                 @click=${(e) => { if (e.target === e.currentTarget) this._close() }}>
                
                <div class="dialog-content">
                    <div class="dialog-header">
                        <h2 class="dialog-title">Reorder Pinned Items</h2>
                        <button class="action-btn" @click=${this._close}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                        </button>
                    </div>

                    <div class="dialog-body">
                        ${this.items.length === 0
                ? html`<div style="text-align:center; padding:40px; color:#b3b3b3;">No pinned items found.</div>`
                : html`
                                <ul class="reorder-list" 
                                    @pointermove=${this._handlePointerMove} 
                                    @pointerup=${this._handlePointerUp}
                                    @pointercancel=${this._handlePointerUp}>
                                    ${this.items.map((item, index) => {
                    // Liked Songs is mandatory and locked at #0: not draggable, not removable.
                    const locked = item.id === 'user-library';
                    return html`
                                        <li class="reorder-item ${locked ? 'locked' : ''}
                                            ${this._draggedItemIndex === index ? 'dragging ghost' : ''}
                                            ${this._dropTargetIndex === index && this._dropPosition === 'before' ? 'drop-before' : ''}
                                            ${this._dropTargetIndex === index && this._dropPosition === 'after' ? 'drop-after' : ''}"
                                            @pointerdown=${(e) => this._handlePointerDown(e, index)}
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
                                                <div class="item-subtitle">${locked ? 'Always pinned' : (item.subtitle || '')}</div>
                                            </div>
                                            <div style="display:flex; align-items:center;">
                                                ${locked ? '' : html`
                                                    <button class="action-btn delete" @click=${(e) => this._requestDelete(item.id, e)} title="Remove">
                                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
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
                                    @keydown=${e => e.key === 'Enter' && this._handleAddUri()}
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
            </div>
        `;
    }
}

customElements.define('spotify-reorder-dialog', SpotifyReorderDialog);