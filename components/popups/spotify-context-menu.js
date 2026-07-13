import { LitElement, html, css, svg } from "../../lit.js";
import '../bottom-sheet.js';
import { heartToggleIcon } from '../common/icons.js';

/**
 * Menu glyphs: a local thin-stroke set mirroring the Spotify app's menu
 * iconography (circled +/-, list-with-plus, stacked queue bars). Sized by
 * CSS (.menu-item svg), coloured via currentColor. Only this component
 * consumes these — the filled icons in common/icons.js are untouched.
 */
const stroke = (paths) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

/** Icon lookup for data-driven menu items ({ icon: '<key>' }). */
export const MENU_ICONS = {
    'play': stroke(svg`<path d="M8 5.5v13l11-6.5z"/>`),
    // Add to Queue: list lines with a plus (Spotify's add-to-queue glyph).
    'queue': stroke(svg`<path d="M5 3.5v5M2.5 6h5M11 6h10.5M3.5 12h18M3.5 18h18"/>`),
    // Go to Queue: two stacked wide bars.
    'queue-list': stroke(svg`<rect x="4" y="6" width="16" height="3.6" rx="1.8"/><rect x="4" y="14.4" width="16" height="3.6" rx="1.8"/>`),
    'artist': stroke(svg`<circle cx="12" cy="8" r="3.6"/><path d="M4.8 19.5c1.3-3.1 4-4.7 7.2-4.7s5.9 1.6 7.2 4.7"/>`),
    'playlist': stroke(svg`<path d="M12 17V5.5L19 4v11.5"/><circle cx="9.2" cy="17" r="2.8"/><circle cx="16.2" cy="15.5" r="2.8"/>`),
    'album': stroke(svg`<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/>`),
    'playlist-add': stroke(svg`<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>`),
    'pencil': stroke(svg`<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 7.5l3 3"/>`),
    'trash': stroke(svg`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>`),
    'minus-circle': stroke(svg`<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>`),
    'plus': stroke(svg`<path d="M12 5v14M5 12h14"/>`),
    'heart': heartToggleIcon(false),
    'heart-filled': heartToggleIcon(true),
    'pin': stroke(svg`<path d="M12 21.5S5 14.6 5 9.5a7 7 0 0 1 14 0c0 5.1-7 12-7 12z"/><circle cx="12" cy="9.5" r="2.4"/>`),
    'drag-handle': stroke(svg`<path d="M4 9.5h16M4 14.5h16"/>`),
    'lock': stroke(svg`<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>`),
    'people': stroke(svg`<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c1.1-2.6 3-4 5.5-4s4.4 1.4 5.5 4"/><circle cx="16.8" cy="9.5" r="2.4"/><path d="M16.5 15.2c2 .3 3.4 1.5 4.2 3.4"/>`),
};

/**
 * Universal context menu, used by every "..." trigger in the app.
 *
 * - Mobile (<769px): a <spotify-bottom-sheet> with a media header row and
 *   icon+label rows (Spotify-app style).
 * - Tablet/desktop (>=769px): a touch-friendly popover anchored to the
 *   clicked trigger, flipped/clamped to stay fully on screen.
 *
 * Controlled by the app root:
 *   .visible  Boolean
 *   .header   { image, name, subtitle }
 *   .items    [{ id, label, icon, danger? }]
 *   .anchor   { left, top, right, bottom } — trigger's viewport rect
 * Emits `action` (detail: item id) and `close`.
 */
class SpotifyContextMenu extends LitElement {
    static get properties() {
        return {
            visible: { type: Boolean, reflect: true },
            header: { type: Object },
            items: { type: Array },
            anchor: { type: Object },
        };
    }

    static get styles() {
        // No sharedStyles: its :host rule is 0x0 absolute (overlay gotcha).
        return css`
            :host { display: contents; }

            /* ---- Shared item rows (sheet + popover) ----
               Metrics measured off the Spotify iOS app at 3x: ~13px labels
               (regular), ~22px thin-stroke icons, ~56px row pitch, 46px header
               art, wrapping header text. */
            .menu-header {
                display: flex; align-items: center; gap: 13px;
                padding: 4px 4px 12px;
                border-bottom: 1px solid rgba(255,255,255,0.1);
                margin-bottom: 6px;
            }
            .menu-art {
                width: 46px; height: 46px; border-radius: 4px; flex: 0 0 auto;
                background-size: cover; background-position: center;
                background-color: #333;
            }
            .menu-info { min-width: 0; }
            .menu-name {
                color: #fff; font-size: var(--spf-text-base, 13.5px); font-weight: 700; line-height: 1.35;
                display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
                overflow: hidden;
            }
            .menu-sub {
                color: rgba(255,255,255,0.6); font-size: var(--spf-text-base, 13.5px); margin-top: 2px; line-height: 1.35;
                display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
                overflow: hidden;
            }
            .menu-item {
                display: flex; align-items: center; gap: 15px;
                width: 100%; min-height: 56px; padding: 4px 4px;
                background: none; border: none; cursor: pointer;
                color: #fff; font-size: var(--spf-text-base, 13.5px); font-weight: 400; font-family: inherit; text-align: left;
            }
            .menu-item svg { flex: 0 0 auto; width: 22px; height: 22px; color: rgba(255,255,255,0.8); }
            .menu-item.danger, .menu-item.danger svg { color: #f15e6c; }
            @media (hover: hover) {
                .menu-item:hover { color: var(--spf-brand, #1ed760); }
                .menu-item:hover svg { color: var(--spf-brand, #1ed760); }
                .menu-item.danger:hover, .menu-item.danger:hover svg { color: #ff8b96; }
            }
            .menu-list { overflow-y: auto; min-height: 0; }

            /* ---- Desktop/tablet anchored popover ---- */
            .pop-overlay {
                position: fixed; inset: 0;
                z-index: var(--spf-sheet-z, 215000);
            }
            .menu-card {
                position: fixed;
                width: 270px;
                max-height: calc(100vh - 16px);
                display: flex; flex-direction: column;
                box-sizing: border-box;
                padding: 12px 14px;
                background: #282828;
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 12px;
                box-shadow: 0 16px 50px rgba(0,0,0,0.7);
                opacity: 0;
                transform: scale(0.95);
                transition: opacity 0.15s ease, transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .menu-card.placed { opacity: 1; transform: scale(1); }
            /* Popover keeps the same visual language, slightly compact. */
            .menu-card .menu-item { min-height: 42px; font-size: var(--spf-text-base, 13.5px); gap: 14px; border-radius: 6px; padding: 4px 8px; }
            .menu-card .menu-item svg { width: 20px; height: 20px; }
            .menu-card .menu-art { width: 40px; height: 40px; }
            .menu-card .menu-name { font-size: var(--spf-text-base, 13.5px); }
            .menu-card .menu-sub { font-size: var(--spf-text-sm, 12px); }
            @media (hover: hover) { .menu-card .menu-item:hover { background: rgba(255,255,255,0.08); } }
        `;
    }

    constructor() {
        super();
        this.visible = false;
        this.header = null;
        this.items = [];
        this.anchor = null;
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    get _isDesktop() {
        return typeof window !== 'undefined' && window.matchMedia('(min-width: 769px)').matches;
    }

    updated(changed) {
        if (changed.has('visible')) {
            if (this.visible) {
                window.addEventListener('keydown', this._onKeyDown);
                if (this._isDesktop) this._placePopover();
            } else {
                window.removeEventListener('keydown', this._onKeyDown);
            }
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('keydown', this._onKeyDown);
    }

    _onKeyDown(e) {
        if (e.key === 'Escape') this._close();
    }

    _close() {
        this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
    }

    _pick(id) {
        this.dispatchEvent(new CustomEvent('action', { detail: id, bubbles: true, composed: true }));
    }

    /** Anchor the popover to the trigger, flipping/clamping to stay on screen. */
    _placePopover() {
        const card = this.renderRoot.querySelector('.menu-card');
        if (!card) return;
        card.classList.remove('placed');
        const a = this.anchor;
        const vw = window.innerWidth, vh = window.innerHeight;
        // Card must be laid out to measure; it's invisible (opacity 0) until placed.
        const w = card.offsetWidth, h = card.offsetHeight;
        const ax = a ? a.left : (vw - w) / 2;
        let x = Math.min(Math.max(8, ax), vw - w - 8);
        let y = a ? a.bottom + 6 : (vh - h) / 2;
        if (y + h > vh - 8) y = (a ? a.top : vh) - h - 6;   // flip above
        y = Math.min(Math.max(8, y), vh - h - 8);           // clamp on screen
        card.style.left = `${x}px`;
        card.style.top = `${y}px`;
        // Scale in from the corner nearest the trigger.
        card.style.transformOrigin = a && a.top > y ? 'top left' : 'bottom left';
        requestAnimationFrame(() => card.classList.add('placed'));
    }

    _renderHeader() {
        const h = this.header;
        if (!h) return '';
        return html`
            <div class="menu-header">
                <div class="menu-art" style="${h.image ? `background-image: url('${h.image}')` : ''}"></div>
                <div class="menu-info">
                    <div class="menu-name">${h.name || ''}</div>
                    ${h.subtitle ? html`<div class="menu-sub">${h.subtitle}</div>` : ''}
                </div>
            </div>
        `;
    }

    _renderItems() {
        return html`
            <div class="menu-list">
                ${(this.items || []).map(item => html`
                    <button class="menu-item ${item.danger ? 'danger' : ''}" @click=${() => this._pick(item.id)}>
                        ${MENU_ICONS[item.icon] || ''}
                        ${item.label}
                    </button>
                `)}
            </div>
        `;
    }

    render() {
        if (this._isDesktop) {
            if (!this.visible) return '';
            return html`
                <div class="pop-overlay" @click=${(e) => { if (e.target === e.currentTarget) this._close(); }}>
                    <div class="menu-card" role="menu">
                        ${this._renderHeader()}
                        ${this._renderItems()}
                    </div>
                </div>
            `;
        }
        return html`
            <spotify-bottom-sheet .visible=${this.visible} @close=${(e) => { e.stopPropagation(); this._close(); }}>
                ${this._renderHeader()}
                ${this._renderItems()}
            </spotify-bottom-sheet>
        `;
    }
}

customElements.define('spotify-context-menu', SpotifyContextMenu);
