import { LitElement, html, css, repeat } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { fireHaptic, pickImage, IMG_THUMB } from '../../utils.js';
import { playIcon, reorderLinesIcon, minusCircleIcon } from '../common/icons.js';
import { ListDragController } from '../controllers/list-drag-controller.js';
import { planPlaylistEdit } from '../controllers/playlist-edit-plan.js';

/**
 * Spotify-style playlist edit mode: drag-reorder, remove, rename/description,
 * batch save. One element instance is one edit session — the playlist view
 * creates a fresh one each time edit mode is entered.
 *
 * It renders in normal flow and does not scroll itself: the host view's scroll
 * container is the scroller, and the edit bar sticks to its top.
 *
 * Properties (set by the playlist view from its `data`):
 *   - `playlistId`, `name`, `description`, `snapshotId`, `isPublic`
 *     (`data.public`, unconverted), `collaborative`
 *   - `tracks` — `data.tracks`; its `items` seed the working list once, when
 *     the session starts, and the object is spread into the saved patch
 *   - `api`
 *
 * Events:
 *   - `done` ({saved}) — not bubbling; the session is over (saved, cancelled,
 *     or failed) and the view should leave edit mode. Fired BEFORE the toast /
 *     `playlist-changed` that go with it.
 *   - `show-toast` ({message}) — bubbles, composed
 *   - `playlist-changed` ({playlistId, action: 'items', patch?}) — bubbles,
 *     composed; `patch` is the exact saved state, absent when a save failed
 *     midway and the playlist must be refetched
 */
export class SpotifyPlaylistEditor extends LitElement {
    static get properties() {
        return {
            api: { type: Object },
            playlistId: { type: String },
            name: { type: String },
            description: { type: String },
            snapshotId: { type: String },
            isPublic: { attribute: false },
            collaborative: { attribute: false },
            tracks: { type: Object },
            _workingItems: { type: Array, state: true },    // edit list: [{key, item}]
            _editName: { type: String, state: true },       // name field
            _editDescription: { type: String, state: true },// description field
            _saving: { type: Boolean, state: true }         // save in flight
        };
    }

    static get styles() {
        return [
            // For the rules edit-mode markup relies on: form controls inherit
            // the app typeface, text fields stay selectable, .art-fallback,
            // and the app scrollbar treatment (description textarea).
            sharedStyles,
            css`
                /* sharedStyles' :host is the app shell's (absolute, 0x0,
                   z-index 9999); this element is a plain block in the view's
                   scroll container. */
                :host {
                    display: block !important;
                    position: static !important;
                    width: auto !important;
                    height: auto !important;
                    z-index: auto !important;
                }

                .edit-bar {
                    position: sticky; top: 0; z-index: 20;
                    display: flex; align-items: center; justify-content: space-between;
                    gap: 12px;
                    padding: calc(var(--spf-safe-top, 0px) + 12px) 16px 12px;
                    background: var(--spf-bg);
                    border-bottom: 1px solid var(--spf-border-subtle, rgba(255,255,255,0.08));
                }
                .edit-bar-title { font-size: var(--spf-text-md, 15px); font-weight: 700; color: var(--spf-text-main); }
                .edit-bar-btn {
                    background: transparent; border: none; color: var(--spf-text-sub);
                    font-size: var(--spf-text-md, 15px); font-weight: 700; cursor: pointer; padding: 8px;
                }
                .edit-bar-btn.save { color: var(--spf-brand, #1DB954); font-weight: 700; }
                .edit-bar-btn:disabled { opacity: 0.5; cursor: default; }

                .edit-fields {
                    display: flex; flex-direction: column; gap: 14px;
                    padding: 18px 16px 8px;
                }
                .edit-name-input {
                    background: transparent;
                    border: none;
                    border-bottom: 1px solid rgba(255,255,255,0.25);
                    color: var(--spf-text-main);
                    font-size: var(--spf-text-xl, 22px); font-weight: 900; font-family: inherit;
                    padding: 2px 2px 10px;
                    outline: none;
                    caret-color: var(--spf-brand, #1ed760);
                }
                .edit-name-input:focus { border-bottom-color: rgba(255,255,255,0.55); }
                .edit-desc-input {
                    background: transparent;
                    border: none;
                    border-bottom: 1px solid rgba(255,255,255,0.15);
                    color: var(--spf-text-sub);
                    font-size: var(--spf-text-base, 13.5px); font-family: inherit;
                    padding: 2px 2px 8px;
                    outline: none; resize: none;
                    caret-color: var(--spf-brand, #1ed760);
                }
                .edit-desc-input:focus { border-bottom-color: rgba(255,255,255,0.45); color: var(--spf-text-main); }
                .edit-name-input::placeholder, .edit-desc-input::placeholder { color: rgba(255,255,255,0.3); }

                .edit-list { padding: 8px 8px 120px; }
                .edit-row {
                    display: flex; align-items: center; gap: 14px;
                    padding: 9px 8px;
                    position: relative;
                    user-select: none;
                    background: var(--spf-bg);
                    z-index: 1;
                }
                .edit-row.dragging {
                    z-index: 100;
                    background: #282828 !important;
                    transform: scale(1.02);
                    box-shadow: 0 15px 40px rgba(0,0,0,0.7);
                    border-radius: 8px;
                    border-bottom: none;
                    cursor: grabbing;
                }
                .edit-row.ghost { opacity: 0.35; }
                .edit-row.drop-before::before {
                    content: ''; position: absolute; top: -1px; left: 0; right: 0;
                    height: 3px; background: var(--spf-brand, #1DB954); z-index: 10;
                }
                .edit-row.drop-after::after {
                    content: ''; position: absolute; bottom: -1px; left: 0; right: 0;
                    height: 3px; background: var(--spf-brand, #1DB954); z-index: 10;
                }
                .edit-remove {
                    background: transparent; border: none;
                    color: var(--spf-text-sub);
                    cursor: pointer; display: flex; padding: 4px; flex-shrink: 0;
                }
                .edit-remove:hover { color: var(--spf-text-main); }
                .edit-remove svg { width: 26px; height: 26px; fill: currentColor; }
                .edit-art {
                    width: 56px; height: 56px; border-radius: 4px; flex-shrink: 0;
                    background-size: cover; background-position: center; background-color: #333;
                    position: relative;
                    display: flex; align-items: center; justify-content: center;
                }
                .edit-art-play {
                    display: flex; color: #fff;
                    filter: drop-shadow(0 1px 3px rgba(0,0,0,0.7));
                }
                .edit-text { flex: 1; min-width: 0; }
                .edit-name {
                    font-size: var(--spf-text-md, 15px); font-weight: 700; color: var(--spf-text-main);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .edit-artist {
                    font-size: var(--spf-text-base, 13.5px); color: var(--spf-text-sub); margin-top: 3px;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .edit-handle {
                    color: var(--spf-text-sub); cursor: grab; touch-action: none;
                    padding: 10px 4px; display: flex; flex-shrink: 0;
                }
                .edit-handle:hover { color: var(--spf-text-main); }
                .edit-handle svg { fill: currentColor; }
                .edit-empty { text-align: center; color: var(--spf-text-sub); padding: 40px 16px; }
            `
        ];
    }

    constructor() {
        super();
        this._workingItems = null;
        this._origItems = null;   // snapshot of the pre-edit list
        this._saving = false;
        this._drag = new ListDragController(this, {
            itemSelector: '.edit-row',
            onDrop: (from, to, pos) => {
                fireHaptic('light');
                this._workingItems = ListDragController.applyMove(this._workingItems, from, to, pos);
            }
        });
    }

    willUpdate() {
        // Seed the session once, from the playlist as it is when edit mode
        // opens; later swaps of the view's data must not reset unsaved edits.
        if (this._origItems) return;
        // Keys include the original index so duplicate tracks stay distinct.
        this._origItems = (this.tracks?.items || [])
            .map((item, i) => ({ key: `${(item?.track || item)?.uri || 'na'}:${i}`, item }));
        this._workingItems = [...this._origItems];
        this._editName = this.name || '';
        this._editDescription = this.description || '';
    }

    _toast(message) {
        this.dispatchEvent(new CustomEvent('show-toast', {
            detail: { message },
            bubbles: true,
            composed: true
        }));
    }

    /** End the session; the view leaves edit mode synchronously in its handler. */
    _done(saved) {
        this.dispatchEvent(new CustomEvent('done', { detail: { saved } }));
    }

    _cancel() {
        if (this._saving) return;
        this._done(false);
    }

    _removeWorkingItem(index) {
        fireHaptic('light');
        const next = [...this._workingItems];
        next.splice(index, 1);
        this._workingItems = next;
    }

    /**
     * Batch-save the edit session: the details change (if any), then the item
     * operations planned by planPlaylistEdit, threading the snapshot id
     * through every call. Any mid-sequence failure abandons ship and has the
     * playlist refetched.
     */
    async _saveEdits() {
        if (this._saving || !this.api || !this.playlistId) return;
        const orig = this._origItems || [];
        const fin = this._workingItems || [];

        const newName = (this._editName || '').trim();
        if (!newName) {
            this._toast('Playlist name can\'t be empty');
            return;
        }
        const newDescription = (this._editDescription || '').trim();
        const detailsChanged = newName !== (this.name || '')
            || newDescription !== (this.description || '').trim();
        const plan = planPlaylistEdit(orig, fin);

        // Nothing changed — just leave edit mode.
        if (!detailsChanged && !plan.tracksChanged) {
            this._cancel();
            return;
        }

        if (plan.blocked) {
            this._toast("Spotify can't remove a single copy of a duplicated song in playlists over 100 tracks — remove all copies instead.");
            return;
        }

        this._saving = true;
        try {
            let snapshotId = this.snapshotId || null;

            if (detailsChanged) {
                const res = await this.api.changePlaylistDetails(this.playlistId, {
                    name: newName,
                    description: newDescription,
                    isPublic: this.isPublic !== false,
                    collaborative: !!this.collaborative
                });
                if (!res.success) throw res.error || new Error('details change failed');
            }

            for (const op of plan.ops) {
                let res;
                if (op.op === 'replace') {
                    res = await this.api.replacePlaylistItems(this.playlistId, op.uris);
                    if (!res.success) throw res.error || new Error('replace failed');
                } else if (op.op === 'remove') {
                    res = await this.api.removePlaylistItems(this.playlistId, op.uris, snapshotId);
                    if (!res.success) throw res.error || new Error('remove failed');
                } else if (op.op === 'reorder') {
                    res = await this.api.reorderPlaylistItems(this.playlistId, op.rangeStart, op.insertBefore, op.rangeLength, snapshotId);
                    if (!res.success) throw res.error || new Error('reorder failed');
                } else {
                    throw new Error(op.message);
                }
                snapshotId = res.snapshotId || snapshotId;
            }

            // The final state is fully known — patch it straight into the view
            // and the caches instead of refetching.
            const items = fin.map(e => e.item);
            const patch = {
                name: newName,
                description: newDescription,
                tracks: { ...this.tracks, items, total: items.length },
                snapshotId,
                tracksComplete: true
            };
            this._done(true);
            this._toast('Playlist updated');
            this.dispatchEvent(new CustomEvent('playlist-changed', {
                detail: { playlistId: this.playlistId, action: 'items', patch },
                bubbles: true,
                composed: true
            }));
        } catch (e) {
            console.error('[PlaylistView] Save edits failed:', e);
            this._done(false);
            this._toast("Couldn't save all changes — reloading playlist");
            this.dispatchEvent(new CustomEvent('playlist-changed', {
                detail: { playlistId: this.playlistId, action: 'items' },
                bubbles: true,
                composed: true
            }));
        } finally {
            this._saving = false;
        }
    }

    render() {
        const items = this._workingItems || [];
        return html`
            <div class="edit-bar">
                <button class="edit-bar-btn" @click=${this._cancel} ?disabled=${this._saving}>Cancel</button>
                <div class="edit-bar-title">Edit playlist</div>
                <button class="edit-bar-btn save" @click=${this._saveEdits} ?disabled=${this._saving}>
                    ${this._saving ? 'Saving…' : 'Save'}
                </button>
            </div>
            <div class="edit-fields">
                <input class="edit-name-input" type="text" maxlength="100"
                    placeholder="Playlist name"
                    .value=${this._editName || ''}
                    ?disabled=${this._saving}
                    @input=${(e) => { this._editName = e.target.value; }} />
                <textarea class="edit-desc-input" maxlength="300" rows="2"
                    placeholder="Add a description"
                    .value=${this._editDescription || ''}
                    ?disabled=${this._saving}
                    @input=${(e) => { this._editDescription = e.target.value; }}></textarea>
            </div>
            <div class="track-list edit-list"
                 @pointermove=${(e) => this._drag.move(e)}
                 @pointerup=${(e) => this._drag.end(e)}
                 @pointercancel=${(e) => this._drag.end(e)}>
                ${repeat(items, (entry) => entry.key, (entry, index) => this._renderEditRow(entry, index))}
                ${items.length === 0 ? html`<div class="edit-empty">All tracks removed — Save to clear the playlist.</div>` : ''}
            </div>
        `;
    }

    _renderEditRow(entry, index) {
        const track = entry.item?.track || entry.item;
        const images = track?.album?.images;
        const artUrl = (images && (pickImage(images, IMG_THUMB) || images[images.length - 1]?.url)) || '';
        return html`
            <div class="edit-row ${this._drag.rowClass(index)}">
                <button class="edit-remove" title="Remove" ?disabled=${this._saving}
                    @click=${() => this._removeWorkingItem(index)}>
                    ${minusCircleIcon}
                </button>
                <div class="edit-art ${artUrl ? '' : 'art-fallback'}" style="${artUrl ? `background-image:url('${artUrl}')` : ''}">
                    ${artUrl ? html`<div class="edit-art-play">${playIcon(22)}</div>` : ''}
                </div>
                <div class="edit-text">
                    <div class="edit-name">${track?.name}</div>
                    <div class="edit-artist">${(track?.artists || []).map(a => a.name).join(', ')}</div>
                </div>
                <div class="edit-handle"
                    @pointerdown=${(e) => this._drag.start(e, index, this.shadowRoot.querySelector('.edit-list'))}>
                    ${reorderLinesIcon}
                </div>
            </div>
        `;
    }
}

customElements.define('spotify-playlist-editor', SpotifyPlaylistEditor);
