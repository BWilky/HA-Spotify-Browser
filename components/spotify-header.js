
import { LitElement, html, css } from "../lit.js";
import { sharedStyles } from '../styles/shared-styles.js';
import { headerStyles } from './spotify-header.styles.js';

class SpotifyHeader extends LitElement {
    static get properties() {
        return {
            backButtonVisible: { type: Boolean },
            centerTitle: { type: String },
            titleOpacity: { type: Number },
            searchVisible: { type: Boolean },
            menuVisible: { type: Boolean },
            transparent: { type: Boolean },
            scrollAlpha: { type: Number },
            searchQuery: { type: String },
            minimal: { type: Boolean }, // Mobile: strip chrome to back + title + drag handle
            avatarVisible: { type: Boolean, reflect: true }, // Account avatar (home only)
            avatarUrl: { type: String },
            avatarSwitchable: { type: Boolean }, // >1 account -> tap opens switcher
        };
    }

    static get styles() {
        return [sharedStyles, css`
            /* Rules that sat in sharedStyles but can only match in this
               element's shadow root (header bar, nav buttons, search box,
               menu). Kept between sharedStyles and headerStyles: their place
               in the cascade before they moved. */
            @media (max-width: 768px) {
                .search-container.active { width: auto !important; flex: 1; margin-right: 8px; }
                .header { padding: var(--spf-safe-top, 0px) 12px 0 12px !important; }
                .header-left, .header-right { gap: 8px !important; }
            }

            /* --- Header --- */
            .header {
                position: absolute; top: 0; left: 0; right: 0;
                height: calc(64px + var(--spf-safe-top));
                padding-top: var(--spf-safe-top);
                display: flex; justify-content: space-between; align-items: center;
                padding-left: 24px; padding-right: 24px; padding-bottom: 0;
                background: rgba(18, 18, 18, 1);
                z-index: 110;
                transition: border-bottom 0.3s ease;
                box-sizing: border-box;
            }

            .header-center-title {
                position: absolute; left: 50%; transform: translateX(-50%);
                font-weight: 700; font-size: var(--spf-text-lg, 17px); color: var(--spf-text-main);
                opacity: 0; transition: opacity 0.2s ease;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                max-width: 40%; pointer-events: none; z-index: 120;
            }

            .header-left, .header-right { display: flex; align-items: center; gap: 16px; }
            .spotify-logo { width: 32px; height: 32px; fill: var(--spf-text-main); }

            .nav-btn {
                background: var(--spf-btn-bg); border: none; color: var(--spf-text-main);
                width: 32px; height: 32px; border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                cursor: pointer; transition: background 0.2s; flex-shrink: 0;
            }
            @media (hover: hover) { .nav-btn:hover { background: var(--spf-hover-white); } }
            .nav-btn:active { background: var(--spf-active-white); }
            .nav-btn svg { pointer-events: none; }

            /* --- Search Box --- */
            .search-container {
                display: flex; align-items: center; justify-content: center;
                background: var(--spf-btn-bg);
                border-radius: 50%; width: 40px; height: 40px;
                padding: 0; overflow: hidden;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            }
            @media (hover: hover) { .search-container:not(.active):hover { background: var(--spf-hover-white); } }

            .search-container.active {
                width: 240px; background: var(--spf-text-main); border-radius: 20px;
                padding: 0 8px; justify-content: flex-start;
            }
            .search-icon-btn {
                width: 40px; height: 40px;
                background: none; border: none; color: var(--spf-text-main);
                cursor: pointer; padding: 0; margin: 0;
                display: flex; align-items: center; justify-content: center;
                flex-shrink: 0; position: relative; z-index: 2;
            }
            .search-icon-btn svg { transform: translate(1px, 1px); }
            .search-container.active .search-icon-btn { color: #000; width: 32px; }

            .search-input {
                background: transparent !important; border: none; outline: none;
                color: #000; font-size: var(--spf-text-base, 13.5px); opacity: 0; width: 0; min-width: 0;
                padding: 0; margin: 0; pointer-events: none; position: relative; z-index: 1;
                transition: opacity 0.2s, width 0.3s ease; line-height: 40px;
            }
            .search-container.active .search-input {
                opacity: 1; width: 100%; margin-left: 4px; pointer-events: auto;
            }

            /* --- Dropdown Menu --- */
            .dropdown-menu {
                position: absolute; top: calc(60px + var(--spf-safe-top)); right: 60px;
                background: var(--spf-bg-card-hover); border-radius: 8px;
                width: 180px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                display: none; flex-direction: column; z-index: 30;
            }
            .dropdown-menu.visible { display: flex; }

            .menu-item { padding: 12px 16px; cursor: pointer; font-size: var(--spf-text-base, 13.5px); color: var(--spf-text-main); transition: background 0.2s; }
            @media (hover: hover) { .menu-item:hover { background: var(--spf-hover-white); } }
            .menu-item:active { background: var(--spf-active-white); }
            .menu-item:first-child { border-radius: 8px 8px 0 0; }
            .menu-item:last-child { border-radius: 0 0 8px 8px; }
        `, headerStyles];
    }

    constructor() {
        super();
        this.backButtonVisible = false;
        this.centerTitle = '';
        this.searchVisible = false;
        this.menuVisible = false;
        this.transparent = false;
        this.searchQuery = '';
        this.minimal = false;
        this.avatarVisible = false;
        this.avatarUrl = '';
        this.avatarSwitchable = false;
        this._boundHandleWindowClick = this._handleWindowClick.bind(this);
    }

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('click', this._boundHandleWindowClick);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('click', this._boundHandleWindowClick);
    }

    updated(changedProperties) {
        // The input is intentionally NOT value-bound in render() — rebinding on
        // every render fights the user's typing (cursor jumps, lost characters).
        // We only seed it when the search field is opened.
        if (changedProperties.has('searchVisible') && this.searchVisible) {
            const input = this.shadowRoot.getElementById('search-input');
            if (input) {
                input.value = this.searchQuery || '';
                // Only steal focus (and pop the keyboard) when the user explicitly
                // opened search — NOT when search re-appears on back-navigation.
                if (this._focusOnNextOpen) {
                    this._focusOnNextOpen = false;
                    // matches the css transition time
                    setTimeout(() => input.focus(), 300);
                }
            }
        }
    }

    /**
     * Called by the app when the user explicitly opens the search field, so the
     * next render focuses the input. Back-navigation to the search page does not
     * call this, so the keyboard stays down.
     */
    focusOnOpen() {
        this._focusOnNextOpen = true;
    }

    _handleWindowClick(e) {
        if (!this.menuVisible) return;

        // If the click path does NOT include this component (the header),
        // then the user clicked outside the header entirely.
        if (!e.composedPath().includes(this)) {
            this.dispatchEvent(new CustomEvent('close-menu'));
        }
    }

    render() {
        return html`
            <div
                class="header ${this.transparent ? 'transparent' : ''} ${this.transparent && this.scrollAlpha > 0.01 ? 'blurred' : ''}"
                style="--header-alpha: ${this.transparent ? this.scrollAlpha : 1};"
            >
                <div class="header-left">
                    <button
                        class="nav-btn"
                        id="back-btn"
                        style="display: ${this.backButtonVisible ? 'flex' : 'none'}"
                        @pointerdown=${(e) => e.stopPropagation()}
                        @click=${() => this.dispatchEvent(new CustomEvent('back-click'))}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6" /></svg>
                    </button>
                    ${this.minimal && !this.backButtonVisible ? html`
                    <button
                        class="nav-btn"
                        id="collapse-btn"
                        @pointerdown=${(e) => e.stopPropagation()}
                        @click=${() => this.dispatchEvent(new CustomEvent('collapse-click'))}
                    >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6" /></svg>
                    </button>
                    ` : ''}
                    ${!this.minimal && !this.backButtonVisible ? html`
                    <svg
                        class="spotify-logo"
                        viewBox="0 0 168 168"
                        @click=${() => this.dispatchEvent(new CustomEvent('logo-click'))}
                    >
                        <path d="M83.996.277C37.747.277.253 37.77.253 84.019c0 46.251 37.494 83.741 83.743 83.741 46.254 0 83.744-37.49 83.744-83.741 0-46.246-37.49-83.738-83.745-83.738zM121.49 121.36a4.789 4.789 0 0 1-6.574 1.574c-18.01-11.005-40.69-13.473-67.41-7.36a4.784 4.784 0 0 1-5.78-3.585 4.789 4.789 0 0 1 3.584-5.784c29.175-6.663 54.287-3.889 74.611 8.582a4.785 4.785 0 0 1 1.568 6.573zm9.457-21.207a5.996 5.996 0 0 1-8.22 1.991c-20.59-12.656-51.975-16.316-76.28-8.84a5.995 5.995 0 0 1-7.508-3.968 5.993 5.993 0 0 1 3.967-7.508c27.62-8.49 62.293-4.407 86.048 10.103a5.996 5.996 0 0 1 1.992 8.222zm1.102-22.266c-24.66-14.64-65.388-15.997-88.933-8.845a7.186 7.186 0 0 1-9.004-4.756 7.191 7.191 0 0 1 4.754-9.003c27.094-8.22 72.132-6.655 100.82 10.385a7.195 7.195 0 0 1 2.365 9.855 7.192 7.192 0 0 1-9.855 2.364h-.147z"/>
                    </svg>
                    ` : ''}
                    ${this.avatarVisible ? html`
                    <button
                        class="header-avatar ${this.avatarSwitchable ? 'switchable' : ''}"
                        style=${this.avatarUrl ? `background-image: url('${this.avatarUrl}')` : ''}
                        aria-label=${this.avatarSwitchable ? 'Switch account' : 'Account'}
                        @pointerdown=${(e) => e.stopPropagation()}
                        @click=${() => this.dispatchEvent(new CustomEvent('avatar-click'))}
                    >
                        ${this.avatarUrl ? '' : html`<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`}
                    </button>
                    ` : ''}
                </div>

                ${this.minimal ? html`<div class="header-drag-pill"></div>` : ''}

                <div class="header-center-title" style="opacity: ${this.titleOpacity || 0}">
                    ${this.centerTitle}
                </div>

                ${this.minimal ? '' : html`
                <div class="header-center" style="display: ${this.searchVisible ? 'flex' : 'none'}"></div>
                <div class="header-right">
                    <div class="search-container ${this.searchVisible ? 'active' : ''}" id="search-container">
                        <button
                            class="search-icon-btn"
                            id="search-toggle"
                            @click=${() => this.dispatchEvent(new CustomEvent('search-toggle-click'))}
                        >
                            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                        </button>
                        <input
                            type="text"
                            class="search-input"
                            id="search-input"
                            placeholder="Search..."
                            @input=${(e) => this.dispatchEvent(new CustomEvent('search-input', { detail: e.target.value }))}
                            @keydown=${(e) => {
                                // Drop the on-screen (tablet) keyboard on submit.
                                if (e.key === 'Enter') e.target.blur();
                                this.dispatchEvent(new CustomEvent('search-keydown', { detail: { key: e.key, value: e.target.value } }));
                            }}
                        >
                    </div>
                    
                    <button 
                        class="nav-btn" 
                        id="queue-btn" 
                        aria-label="Now playing and queue"
                        title="Now playing and queue"
                        style="margin-left: 4px;"
                        @click=${() => this.dispatchEvent(new CustomEvent('queue-click'))}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                    </button>

                    <button 
                        class="nav-btn" 
                        id="menu-btn" 
                        style="margin-left:4px;"
                        @click=${() => this.dispatchEvent(new CustomEvent('menu-click'))}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>
                    </button>
                    <button 
                        class="nav-btn" 
                        id="close-btn"
                        @click=${() => this.dispatchEvent(new CustomEvent('close-click'))}
                    >
                        <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                    
                    <div class="dropdown-menu ${this.menuVisible ? 'visible' : ''}" id="dropdown-menu">
                        <div class="menu-item" @click=${() => this.dispatchEvent(new CustomEvent('menu-item-click', { detail: 'menu-library' }))}>Your Library</div>
                        <div class="menu-item" @click=${() => this.dispatchEvent(new CustomEvent('menu-item-click', { detail: 'menu-device' }))}>Device Playback</div>
                        <div class="menu-item" @click=${() => this.dispatchEvent(new CustomEvent('menu-item-click', { detail: 'menu-accounts' }))}>Switch Accounts</div>
                        <div class="menu-item" @click=${() => this.dispatchEvent(new CustomEvent('menu-item-click', { detail: 'menu-refresh' }))}>Refresh Data</div>
                    </div>
                </div>
                `}
            </div>
        `;
    }
}

customElements.define('spotify-header', SpotifyHeader);
