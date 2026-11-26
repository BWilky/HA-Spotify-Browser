import { LitElement, html, css } from "../../lit.js";
import { fireHaptic } from "../../utils.js";
import { personIcon } from '../common/icons.js';
import { sheetStyles } from '../../styles/sheet.styles.js';
import '../bottom-sheet.js';

/**
 * Account switcher bottom sheet. Lists the configured Spotify accounts; the
 * active one carries a "Current" badge. Tapping any other row switches account.
 *
 * Driven by the app:
 *   - `accounts`     [{ entity, name, image }]
 *   - `activeEntity` the entity currently in use
 *   - `currentImage` live profile picture for the active account (fallback when
 *                    that account has no configured `image`)
 * Emits:
 *   - `account-selected` (account) — switch to this account
 *   - `close`                      — dismiss the sheet
 */
export class SpotifyAccountPanel extends LitElement {
    static get properties() {
        return {
            visible: { type: Boolean, reflect: true },
            accounts: { type: Array },
            activeEntity: { type: String },
            currentImage: { type: String },
        };
    }

    static get styles() {
        // :host, .title and .empty: sheetStyles.
        return [sheetStyles, css`
            .list {
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                flex: 1; min-height: 0;
            }
            .row {
                display: flex; align-items: center; gap: 16px;
                padding: 12px 4px;
                cursor: pointer;
            }
            .av {
                width: 48px; height: 48px; border-radius: 50%; flex-shrink: 0;
                background-size: cover; background-position: center;
                background-color: #333;
                display: flex; align-items: center; justify-content: center;
                color: rgba(255,255,255,0.85);
            }
            .av svg { width: 28px; height: 28px; fill: currentColor; }
            .row-text { min-width: 0; flex: 1; }
            .row-name {
                font-size: var(--spf-text-lg, 17px); font-weight: 700; color: #fff;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .row.active .row-name { color: var(--spf-brand, #1ed760); }
            .badge {
                flex-shrink: 0;
                font-size: var(--spf-text-sm, 12px); font-weight: 700;
                color: #000; background: var(--spf-brand, #1ed760);
                padding: 3px 10px; border-radius: 999px;
            }
        `];
    }

    constructor() {
        super();
        this.visible = false;
        this.accounts = [];
        this.activeEntity = '';
        this.currentImage = '';
    }

    _imageFor(acc, isActive) {
        return acc.image || (isActive ? this.currentImage : '') || '';
    }

    _close() { this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true })); }

    _select(acc, isActive) {
        if (isActive) { this._close(); return; }
        fireHaptic('medium');
        this.dispatchEvent(new CustomEvent('account-selected', { detail: acc, bubbles: true, composed: true }));
    }

    render() {
        const accounts = this.accounts || [];
        return html`
            <spotify-bottom-sheet .visible=${this.visible}>
                <h2 class="title">Switch account</h2>
                <div class="list">
                    ${accounts.length ? accounts.map(acc => {
                        const isActive = acc.entity === this.activeEntity;
                        const img = this._imageFor(acc, isActive);
                        return html`
                            <div class="row ${isActive ? 'active' : ''}" @click=${() => this._select(acc, isActive)}>
                                <div class="av" style=${img ? `background-image: url('${img}')` : ''}>
                                    ${img ? '' : personIcon}
                                </div>
                                <div class="row-text">
                                    <div class="row-name">${acc.name || acc.entity}</div>
                                </div>
                                ${isActive ? html`<span class="badge">Current</span>` : ''}
                            </div>`;
                    }) : html`<div class="empty">No accounts configured.</div>`}
                </div>
            </spotify-bottom-sheet>
        `;
    }
}

customElements.define('spotify-account-panel', SpotifyAccountPanel);
