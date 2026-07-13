import { LitElement, html, css } from "../../lit.js";
import { fireHaptic, getPlaylistSort, setPlaylistSort } from "../../utils.js";
import { artFallbackStyles } from '../../styles/shared-styles.js';
import '../bottom-sheet.js';

/**
 * Spotify-style "Add to playlist" sheet: near-full-height, multi-select.
 * Header (Cancel / Add to playlist), a white "New playlist" pill, a
 * "Find playlist" filter, then Liked Songs + the current account's OWN
 * playlists with selection circles. A floating green Done applies everything
 * at once: liked-state toggle via track favorites, adds to each selected
 * playlist with an "already added" duplicate check.
 *
 * Driven by the app:
 *   - `visible`  open/close
 *   - `api`      SpotifyApi instance
 *   - `track`    { uri, id, name, artist, image } — the track being added
 * Emits:
 *   - `open-playlist-dialog` ({mode:'create', pendingTrackUri}) — "New playlist"
 *   - `playlist-changed` ({playlistId, action:'items'}) — per successful add
 *   - `show-toast` / `show-alert` — feedback via the app-root popups
 *   - `close`
 */
export class SpotifyPlaylistPicker extends LitElement {
    // Above this size the "already added?" pre-check is skipped (it pages the
    // playlist 50 tracks per call — unbounded checks would hammer the API).
    static DEDUPE_CHECK_CAP = 500;

    static get properties() {
        return {
            visible: { type: Boolean, reflect: true },
            api: { type: Object },
            track: { type: Object },
            _playlists: { type: Array, state: true },
            _loading: { type: Boolean, state: true },
            _busy: { type: Boolean, state: true },
            _filter: { type: String, state: true },
            _selected: { type: Object, state: true },       // Set of playlist ids
            _likedSelected: { type: Boolean, state: true },
        };
    }

    static get styles() {
        return [artFallbackStyles, css`
            :host {
                display: contents;
                --spf-sheet-max-h: 96%;
            }

            .hdr {
                position: relative; flex-shrink: 0;
                display: flex; align-items: center; justify-content: center;
                padding: 2px 0 14px;
            }
            .hdr-cancel {
                position: absolute; left: 0;
                background: transparent; border: none; cursor: pointer;
                color: var(--spf-text-main, #fff);
                font-size: var(--spf-text-md, 15px); font-weight: 700; font-family: inherit;
                padding: 6px 4px;
            }
            .hdr-title { font-size: var(--spf-text-lg, 17px); font-weight: 900; color: var(--spf-text-main, #fff); }

            .newpl-row { display: flex; justify-content: center; flex-shrink: 0; margin: 2px 0 18px; }
            .newpl {
                background: #fff; color: #000;
                border: none; border-radius: 999px;
                font-size: var(--spf-text-md, 15px); font-weight: 700; font-family: inherit;
                padding: 13px 30px; cursor: pointer;
                transition: transform 0.15s ease;
            }
            .newpl:active { transform: scale(0.97); }

            .search {
                flex-shrink: 0;
                display: flex; align-items: center; gap: 10px;
                background: var(--spf-bg-card-hover, #2a2a2a);
                border-radius: 8px;
                padding: 11px 12px;
                margin-bottom: 14px;
            }
            .search svg { width: 18px; height: 18px; flex-shrink: 0; stroke: var(--spf-text-sub, #b3b3b3); }
            .search input {
                flex: 1; min-width: 0;
                background: transparent; border: none; outline: none;
                color: var(--spf-text-main, #fff);
                font-size: var(--spf-text-md, 15px); font-family: inherit;
            }
            .search input::placeholder { color: var(--spf-text-sub, #b3b3b3); }

            .list-label {
                flex-shrink: 0;
                display: flex; align-items: center; gap: 8px;
                background: none; border: none; cursor: pointer;
                font-size: var(--spf-text-base, 13.5px); font-weight: 700; font-family: inherit;
                color: var(--spf-text-main, #fff);
                padding: 2px 0 8px;
            }
            .list-label svg { color: var(--spf-text-sub, #b3b3b3); flex-shrink: 0; }

            .list {
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                flex: 1; min-height: 0;
                padding-bottom: 96px; /* keep last rows clear of the Done pill */
            }
            .row {
                display: flex; align-items: center; gap: 14px;
                padding: 9px 2px;
                cursor: pointer;
                border-radius: 6px;
            }
            .row:hover { background: var(--spf-hover-white, rgba(255,255,255,0.08)); }
            .row.busy { opacity: 0.5; pointer-events: none; }
            .art {
                width: 52px; height: 52px; border-radius: 4px; flex-shrink: 0;
                background-size: cover; background-position: center;
                background-color: #333;
                display: flex; align-items: center; justify-content: center;
            }
            .art.liked { background: linear-gradient(135deg, #4733f0, #8fb5f5); }
            .art.liked svg { width: 22px; height: 22px; fill: #fff; }
            .row-text { min-width: 0; flex: 1; }
            .row-name {
                font-size: var(--spf-text-md, 15px); font-weight: 700; color: var(--spf-text-main, #fff);
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .row-sub { font-size: var(--spf-text-base, 13.5px); color: var(--spf-text-sub, #b3b3b3); margin-top: 2px; }

            .sel {
                flex-shrink: 0;
                width: 26px; height: 26px; border-radius: 50%;
                border: 1.5px solid var(--spf-text-sub, #b3b3b3);
                box-sizing: border-box;
                display: flex; align-items: center; justify-content: center;
            }
            .row.selected .sel {
                background: var(--spf-brand, #1ed760);
                border-color: var(--spf-brand, #1ed760);
            }
            .sel svg { width: 15px; height: 15px; fill: #000; display: none; }
            .row.selected .sel svg { display: block; }

            .empty, .loading-row {
                text-align: center; color: var(--spf-text-sub, #b3b3b3);
                padding: 28px 0; font-size: var(--spf-text-base, 13.5px);
            }

            /* Floating Done pill (absolute against the sheet panel). */
            .done-wrap {
                position: absolute;
                left: 0; right: 0;
                bottom: calc(22px + var(--spf-safe-bottom, 0px));
                display: flex; justify-content: center;
                pointer-events: none;
            }
            .done-btn {
                pointer-events: auto;
                background: var(--spf-brand, #1ed760); color: #000;
                border: none; border-radius: 999px;
                font-size: var(--spf-text-md, 15px); font-weight: 700; font-family: inherit;
                padding: 14px 44px; cursor: pointer;
                box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                transition: transform 0.15s ease, opacity 0.15s ease;
            }
            .done-btn:active { transform: scale(0.97); }
            .done-btn:disabled { opacity: 0.4; cursor: default; }

            /* Popup variant (tablet/desktop): keep the dialog comfortably tall
               even with only a couple of playlists. */
            @media (min-width: 769px) {
                .list { min-height: 320px; }
            }
        `];
    }

    constructor() {
        super();
        this.visible = false;
        this.api = null;
        this.track = null;
        this._playlists = [];
        this._loading = false;
        this._busy = false;
        this._filter = '';
        this._selected = new Set();
        this._likedSelected = false;
        this._likedInitial = false;
        this._likedKnown = false;
    }

    updated(changedProperties) {
        if (changedProperties.has('visible') && this.visible) {
            this._busy = false;
            this._filter = '';
            this._selected = new Set();
            this._likedSelected = false;
            this._likedInitial = false;
            this._likedKnown = false;
            this._loadPlaylists();
            this._loadLikedState();
        }
    }

    async _loadPlaylists() {
        if (!this.api) return;
        this._loading = true;
        try {
            this._playlists = await this.api.getCurrentUserOwnedPlaylists();
        } catch (e) {
            console.warn('[PlaylistPicker] load failed:', e);
            this._playlists = [];
        } finally {
            this._loading = false;
        }
    }

    /** Pre-check the Liked Songs row when the track is already saved. */
    async _loadLikedState() {
        const id = this.track?.id;
        if (!id || !this.api) return;
        try {
            const liked = await this.api.checkTrackFavorites(id);
            if (typeof liked === 'boolean') {
                this._likedInitial = liked;
                this._likedSelected = liked;
                this._likedKnown = true;
                this.requestUpdate();
            }
        } catch (e) { /* leave unchecked */ }
    }

    _close() {
        this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
    }

    _toast(message) {
        this.dispatchEvent(new CustomEvent('show-toast', { detail: { message }, bubbles: true, composed: true }));
    }

    _dispatchChanged(playlistId) {
        this.dispatchEvent(new CustomEvent('playlist-changed', {
            detail: { playlistId, action: 'items' },
            bubbles: true, composed: true
        }));
    }

    _newPlaylist() {
        fireHaptic('light');
        this.dispatchEvent(new CustomEvent('open-playlist-dialog', {
            detail: { mode: 'create', pendingTrackUri: this.track?.uri },
            bubbles: true, composed: true
        }));
    }

    _togglePlaylist(id) {
        if (this._busy) return;
        fireHaptic('light');
        const next = new Set(this._selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        this._selected = next;
    }

    _toggleLiked() {
        if (this._busy) return;
        fireHaptic('light');
        this._likedSelected = !this._likedSelected;
    }

    /** Flip Recents <-> A–Z (shared preference with the Library) and refetch. */
    _toggleSort() {
        if (this._busy || this._loading) return;
        setPlaylistSort(getPlaylistSort() === 'alpha' ? 'recents' : 'alpha');
        this._loadPlaylists();
        this.requestUpdate();
    }

    get _hasChanges() {
        return this._selected.size > 0 || this._likedSelected !== this._likedInitial;
    }

    async _done() {
        if (this._busy || !this.api) return;
        const uri = this.track?.uri;
        const targets = (this._playlists || []).filter(p => this._selected.has(p.id));
        const likedChanged = this._likedSelected !== this._likedInitial;
        if (!likedChanged && targets.length === 0) { this._close(); return; }

        this._busy = true;
        fireHaptic('light');
        try {
            let added = 0;
            let removedFromLiked = false;

            if (likedChanged && this.track?.id) {
                const res = this._likedSelected
                    ? await this.api.saveTrackFavorites(this.track.id)
                    : await this.api.removeTrackFavorites(this.track.id);
                if (res.success) {
                    if (this._likedSelected) added++;
                    else removedFromLiked = true;
                }
            }

            const dupes = [];
            for (const pl of targets) {
                if (!uri) break;
                if (await this._playlistContains(pl, uri)) {
                    dupes.push(pl);
                    continue;
                }
                const res = await this.api.addPlaylistItems(pl.id, [uri]);
                if (res.success) {
                    added++;
                    this._dispatchChanged(pl.id);
                }
            }

            const summary = (n) => n === 1 ? 'Added to 1 playlist' : `Added to ${n} playlists`;

            if (dupes.length) {
                const names = dupes.map(p => `"${p.name}"`).join(', ');
                if (added) this._toast(summary(added));
                this._close();
                this.dispatchEvent(new CustomEvent('show-alert', {
                    detail: {
                        title: 'Already added',
                        message: `"${this.track?.name}" is already in ${names}. Add it anyway?`,
                        confirmText: 'Add Anyway',
                        onConfirm: async () => {
                            let extra = 0;
                            for (const pl of dupes) {
                                const res = await this.api.addPlaylistItems(pl.id, [uri]);
                                if (res.success) {
                                    extra++;
                                    this._dispatchChanged(pl.id);
                                }
                            }
                            if (extra) this._toast(summary(extra));
                        }
                    },
                    bubbles: true, composed: true
                }));
                return;
            }

            if (added) this._toast(summary(added));
            else if (removedFromLiked) this._toast('Removed from Liked Songs');
            this._close();
        } finally {
            this._busy = false;
        }
    }

    /**
     * Does the playlist already contain this URI? Pages 50 at a time with a
     * minimal fields filter; NEVER trusts `total` from a fields-filtered call
     * (Spotify caps it at <=50) — stops on a short page or missing `next`.
     */
    async _playlistContains(playlist, uri) {
        const knownTotal = playlist?.tracks?.total || 0;
        if (knownTotal > SpotifyPlaylistPicker.DEDUPE_CHECK_CAP) return false;
        let offset = 0;
        while (offset < SpotifyPlaylistPicker.DEDUPE_CHECK_CAP) {
            const page = await this.api.getPlaylistItemsPage(playlist.id, offset, 50, 'items(track(uri)),next');
            const items = page?.items || [];
            if (items.some(it => (it?.track || it)?.uri === uri)) return true;
            if (items.length < 50 || !page?.next) return false;
            offset += items.length;
        }
        return false;
    }

    _checkSvg() {
        return html`<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
    }

    render() {
        const q = (this._filter || '').trim().toLowerCase();
        const playlists = (this._playlists || []).filter(pl => !q || (pl.name || '').toLowerCase().includes(q));
        const showLiked = !!this.track?.id && (!q || 'liked songs'.includes(q));

        return html`
            <spotify-bottom-sheet .visible=${this.visible} desktop-modal>
                <div class="hdr">
                    <button class="hdr-cancel" @click=${this._close}>Cancel</button>
                    <div class="hdr-title">Add to playlist</div>
                </div>

                <div class="newpl-row">
                    <button class="newpl" @click=${this._newPlaylist}>New playlist</button>
                </div>

                <div class="search">
                    <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                    <input type="text" placeholder="Find playlist"
                        .value=${this._filter}
                        @input=${(e) => { this._filter = e.target.value; }} />
                </div>

                <button class="list-label" @click=${this._toggleSort} title="Change sort order">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v14m0 0l-3-3m3 3l3-3M17 20V6m0 0l-3 3m3-3l3 3"/></svg>
                    ${getPlaylistSort() === 'alpha' ? 'A–Z' : 'Recents'}
                </button>

                <div class="list">
                    ${showLiked ? html`
                        <div class="row ${this._likedSelected ? 'selected' : ''} ${this._busy ? 'busy' : ''}" @click=${this._toggleLiked}>
                            <div class="art liked">
                                <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                            </div>
                            <div class="row-text">
                                <div class="row-name">Liked Songs</div>
                                <div class="row-sub">Playlist</div>
                            </div>
                            <div class="sel">${this._checkSvg()}</div>
                        </div>
                    ` : ''}
                    ${this._loading
                        ? html`<div class="loading-row">Loading your playlists…</div>`
                        : playlists.map(pl => html`
                            <div class="row ${this._selected.has(pl.id) ? 'selected' : ''} ${this._busy ? 'busy' : ''}"
                                 @click=${() => this._togglePlaylist(pl.id)}>
                                <div class="art ${pl.images?.[0]?.url ? '' : 'art-fallback'}" style=${pl.images?.[0]?.url ? `background-image: url('${pl.images[0].url}')` : ''}></div>
                                <div class="row-text">
                                    <div class="row-name">${pl.name}</div>
                                    <div class="row-sub">${pl.tracks?.total ?? 0} songs</div>
                                </div>
                                <div class="sel">${this._checkSvg()}</div>
                            </div>
                        `)}
                    ${!this._loading && playlists.length === 0 && !showLiked
                        ? html`<div class="empty">${q ? 'No playlists match.' : 'No playlists you can add to yet.'}</div>` : ''}
                </div>

                <div class="done-wrap">
                    <button class="done-btn" ?disabled=${!this._hasChanges || this._busy} @click=${this._done}>
                        ${this._busy ? 'Adding…' : 'Done'}
                    </button>
                </div>
            </spotify-bottom-sheet>
        `;
    }
}

customElements.define('spotify-playlist-picker', SpotifyPlaylistPicker);
