import { LitElement, html, css } from "../../lit.js";
import { fireHaptic } from "../../utils.js";
import '../bottom-sheet.js';

/**
 * Spotify-style "create playlist" sheet: a near-full-height bottom sheet with
 * an X close button, a centered "Give your playlist a name" heading, one big
 * underlined name input and a green Create pill — name only, mirroring the
 * mobile app (description/visibility are edited later from the playlist).
 *
 * Driven by the app:
 *   - `visible`     open/close
 *   - `api`         SpotifyApi instance
 *   - `dialogProps` { pendingTrackUri? } — track to add right after creation
 *                   (the add-to-playlist picker's "New playlist" flow)
 * Emits:
 *   - `playlist-created` ({playlist}) — NOT bubbled; the app root owns this
 *     sheet and handles navigation + list refreshes off it
 *   - `show-toast`, `close`
 */
export class SpotifyPlaylistCreateSheet extends LitElement {
    static get properties() {
        return {
            visible: { type: Boolean, reflect: true },
            api: { type: Object },
            dialogProps: { type: Object },
            _name: { type: String, state: true },
            _saving: { type: Boolean, state: true },
        };
    }

    static get styles() {
        return css`
            :host {
                display: contents;
                --spf-sheet-max-h: 96%;
                --spf-sheet-z: 230000; /* above the picker sheet it can be launched from */
            }

            .body {
                flex: 1; min-height: 0;
                display: flex; flex-direction: column;
                align-items: center;
                padding: 0 12px;
            }
            .close-row {
                width: 100%;
                display: flex; justify-content: flex-end;
                flex-shrink: 0;
            }
            .close-btn {
                background: transparent; border: none; cursor: pointer;
                color: var(--spf-text-main, #fff);
                width: 44px; height: 44px;
                display: flex; align-items: center; justify-content: center;
            }
            .close-btn svg { width: 26px; height: 26px; fill: currentColor; }

            .heading {
                margin: 10vh 0 0;
                font-size: var(--spf-text-xl, 22px); font-weight: 900;
                color: var(--spf-text-main, #fff);
                text-align: center;
            }

            .name-input {
                width: min(480px, 90%);
                margin-top: 48px;
                background: transparent;
                border: none;
                border-bottom: 1px solid rgba(255,255,255,0.35);
                color: var(--spf-text-main, #fff);
                font-size: var(--spf-text-hero, 34px); font-weight: 900; font-family: inherit;
                text-align: center;
                padding: 4px 8px 12px;
                outline: none;
                caret-color: var(--spf-brand, #1ed760);
            }
            .name-input::placeholder { color: rgba(255,255,255,0.35); }
            .name-input:focus { border-bottom-color: rgba(255,255,255,0.6); }

            .create-btn {
                margin-top: 44px;
                background: var(--spf-brand, #1ed760);
                color: #000;
                border: none; border-radius: 999px;
                font-size: var(--spf-text-md, 15px); font-weight: 700; font-family: inherit;
                padding: 14px 40px;
                cursor: pointer;
                transition: transform 0.15s ease, opacity 0.15s ease;
            }
            .create-btn:active { transform: scale(0.97); }
            .create-btn:disabled { opacity: 0.4; cursor: default; }

            /* Popup variant (tablet/desktop): compact the phone's airy spacing. */
            @media (min-width: 769px) {
                .body { min-height: 300px; }
                .heading { margin-top: 12px; }
                .name-input { margin-top: 32px; font-size: var(--spf-text-2xl, 26px); }
                .create-btn { margin: 32px 0 8px; }
            }
        `;
    }

    constructor() {
        super();
        this.visible = false;
        this.api = null;
        this.dialogProps = null;
        this._name = '';
        this._saving = false;
    }

    updated(changedProperties) {
        if (changedProperties.has('visible')) {
            clearTimeout(this._focusTimer);
            if (this.visible) {
                this._name = '';
                this._saving = false;
                // Focus AFTER the slide-up settles, and never let focus()
                // scroll ancestors: the input starts below the card wrapper,
                // and a focus-reveal scroll of the overflow:hidden wrapper is
                // what dragged every closed sheet into view.
                this._focusTimer = setTimeout(() => {
                    this.shadowRoot.querySelector('.name-input')?.focus({ preventScroll: true });
                }, 450);
            }
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        clearTimeout(this._focusTimer);
    }

    _close() {
        if (this._saving) return;
        this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
    }

    _toast(message) {
        this.dispatchEvent(new CustomEvent('show-toast', { detail: { message }, bubbles: true, composed: true }));
    }

    async _create() {
        const name = (this._name || '').trim();
        if (!name || this._saving || !this.api) return;
        this._saving = true;
        fireHaptic('light');
        try {
            const res = await this.api.createPlaylist({ name, description: '', isPublic: true, collaborative: false });
            if (!res.success || !res.playlist) {
                this._toast("Couldn't create playlist");
                return;
            }
            const pendingUri = this.dialogProps?.pendingTrackUri;
            if (pendingUri) {
                const addRes = await this.api.addPlaylistItems(res.playlist.id, [pendingUri]);
                this._toast(addRes.success
                    ? `Created "${name}" and added the track`
                    : `Created "${name}" — couldn't add the track`);
            } else {
                this._toast(`Created "${name}"`);
            }
            this.dispatchEvent(new CustomEvent('playlist-created', { detail: { playlist: res.playlist } }));
        } finally {
            this._saving = false;
        }
    }

    render() {
        return html`
            <spotify-bottom-sheet .visible=${this.visible} desktop-modal>
                <div class="body">
                    <div class="close-row">
                        <button class="close-btn" aria-label="Close" @click=${this._close}>
                            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                        </button>
                    </div>
                    <h2 class="heading">Give your playlist a name</h2>
                    <input class="name-input" type="text" maxlength="100"
                        placeholder="My playlist"
                        .value=${this._name}
                        @input=${(e) => { this._name = e.target.value; }}
                        @keydown=${(e) => { if (e.key === 'Enter') this._create(); }} />
                    <button class="create-btn" ?disabled=${!(this._name || '').trim() || this._saving}
                        @click=${this._create}>
                        ${this._saving ? 'Creating…' : 'Create'}
                    </button>
                </div>
            </spotify-bottom-sheet>
        `;
    }
}

customElements.define('spotify-playlist-create-sheet', SpotifyPlaylistCreateSheet);
