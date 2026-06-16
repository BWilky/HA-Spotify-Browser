import { LitElement, html, unsafeHTML } from "../lit.js";
import { sharedStyles } from '../styles/shared-styles.js';
import { homeStyles } from '../styles/spotify-home.styles.js';
import { renderCardHtml } from './media-templates.js';
import { loadMadeForYouItems, dedupeRecentAlbums } from './controllers/home-content.js';
import { getItemImage, getPlayingTrackId, fireHaptic, isContextPlaying, getPlayerStateObj } from '../utils.js';

// --- HTML-string section templates (home uses unsafeHTML + event delegation) ---
function renderCarouselSection(title, sectionId, items = null, seeMoreParams = null) {
    let headerAction = '';
    // If items exist, show See All logic
    if (items && items.length > 0) {
        // New "See All" button -> Navigates to full table view
        headerAction = `<button class="see-all-btn" data-action="navigate-section" data-section="${sectionId}">See All</button>`;
    } else {
        headerAction = `<button class="see-all-btn" style="display:none">See All</button>`;
    }

    // Expand Icon (Chevron) - Toggles Grid/Carousel in place
    const expandIcon = `
        <button class="icon-btn expand-btn" data-action="toggle-view" aria-label="Toggle View" style="background:none; border:none; color:var(--secondary-text-color, #b3b3b3); cursor:pointer; margin-left: 8px; padding: 4px; display: flex; align-items: center;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
        </button>
    `;

    let contentHtml = '';
    if (items === null) { // Loading
        contentHtml = Array(6).fill(0).map(() => cardSkeleton(sectionId.includes('artists'))).join('');
    } else if (items.length === 0) { // Empty
        contentHtml = `<div style="padding:20px; opacity:0.5; white-space:nowrap;">No content found.</div>`;
    } else {
        contentHtml = items.map(item => renderCardHtml(item, item.type || item._fallbackType)).join('');
    }

    return `
    <section class="home-section" data-section-id="${sectionId}">
        <div class="section-header" style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center;">
                <h3 class="section-title" style="margin:0;">${title}</h3>
                ${expandIcon}
            </div>
            ${headerAction}
        </div>
        <div class="carousel-wrapper">
            <div class="carousel-layout" id="carousel-${sectionId}" data-section="${sectionId}">
                ${contentHtml}
            </div>
            <button class="scroll-btn right" data-action="scroll-right" style="${items && items.length > 5 ? '' : 'display:none'}">
                <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
            </button>
        </div>
    </section>
    `;
}

function cardSkeleton(isCircle = false) {
    return `
      <div class="media-card skeleton-pulse ${isCircle ? 'artist-card' : ''}">
        <div class="media-image-wrapper">
            <div class="card-image-sk" style="${isCircle ? 'border-radius:50%' : ''}"></div>
        </div>
        <div class="card-text-sk"></div>
        <div class="card-text-sk short"></div>
      </div>
    `;
}

function renderPillSection(title, sectionId, items = null, playingId = null, canEdit = false) {
    let contentHtml = '';
    if (items === null) {
        contentHtml = Array(8).fill(0).map(() => recentPillSkeleton()).join('');
    } else if (items.length === 0) {
        contentHtml = `<div style="padding:20px; opacity:0.5; white-space:nowrap;">No content found.</div>`;
    } else {
        contentHtml = items.map(item => recentPill(item, playingId)).join('');
    }

    let headerAction = '';
    if (sectionId === 'pinned' && canEdit) {
        // Add Reorder Button for Pinned Section (only when the user can edit)
        headerAction = `
            <button class="icon-btn reorder-btn" data-action="reorder-pinned" aria-label="Reorder Items" style="background:none; border:none; color:var(--secondary-text-color, #b3b3b3); cursor:pointer; margin-left: 8px; padding: 4px; display: flex; align-items: center;">
                 <span style="font-size: 0.8rem; margin-right: 4px; font-weight: bold;">Edit</span>
                 <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>
            </button>
        `;
    }

    return `
    <section class="home-section" data-section-id="${sectionId}">
        <div class="section-header" style="display: flex; align-items: center; justify-content: space-between;">
             <h3 class="section-title" style="margin:0;">${title}</h3>
             ${headerAction}
        </div>
        <div class="recent-grid-layout" id="grid-${sectionId}" data-section="${sectionId}">
            ${contentHtml}
        </div>
    </section>
    `;
}

function recentPillSkeleton() {
    return `
      <div class="recent-pill skeleton-pulse">
        <div class="recent-pill-img"></div>
        <div class="recent-pill-text" style="width: 60%; height: 12px; background: #333; border-radius: 4px;"></div>
      </div>
    `;
}

function recentPill(item, playingId = null, contextPlaying = false) {
    const id = item.id;
    const uri = item.uri;
    const title = item.name || item.title || 'Unknown';
    const img = getItemImage(item);

    // Track-level playing (overlay on the art). Note: pinned items might be
    // playlists/albums, but we only match Track ID reliably from HASS.
    let isPlaying = false;
    if (playingId) {
        if (item.type === 'track' && (id === playingId || uri === `spotify:track:${playingId}`)) {
            isPlaying = true;
        }
    }

    const eqBars = `<svg width="18" height="18" viewBox="0 0 24 24" fill="var(--spf-brand)"><rect x="4" y="10" width="3" height="10"><animate attributeName="height" values="5;10;3;10;5" dur="1s" repeatCount="indefinite" /><animate attributeName="y" values="14;9;16;9;14" dur="1s" repeatCount="indefinite" /></rect><rect x="10" y="5" width="3" height="15"><animate attributeName="height" values="10;15;5;15;10" dur="1s" repeatCount="indefinite" /><animate attributeName="y" values="9;4;14;4;9" dur="1s" repeatCount="indefinite" /></rect><rect x="16" y="8" width="3" height="12"><animate attributeName="height" values="8;12;4;12;8" dur="1s" repeatCount="indefinite" /><animate attributeName="y" values="11;7;15;7;11" dur="1s" repeatCount="indefinite" /></rect></svg>`;

    return `
    <div class="recent-pill interactive"
         data-id="${id}"
         data-type="${item.type}"
         data-uri="${uri}"
         data-title="${title.replace(/"/g, '&quot;')}"
         data-subtitle="">
        <div class="recent-pill-img" style="background-image: url('${img}');">
             ${isPlaying ? `<div class="play-btn-overlay mini" style="opacity: 1; background: rgba(0,0,0,0.7);">${eqBars}</div>` : ''}
        </div>
        <div class="recent-pill-text" style="${isPlaying ? 'color: var(--spf-brand); font-weight: bold;' : ''}">${title}</div>
        ${contextPlaying ? `<div class="pill-eq" aria-label="Now playing">${eqBars}</div>` : ''}
    </div>
    `;
}

class SpotifyHome extends LitElement {
    static get properties() {
        return {
            hass: { type: Object },
            api: { type: Object },
            config: { type: Object },
            _offsets: { type: Object, state: true },
            _totals: { type: Object, state: true },
            _fetching: { type: Object, state: true },
            _manualData: { type: Array, state: true },
            _sectionData: { type: Object, state: true },
        };
    }

    static get styles() {
        return [sharedStyles, homeStyles];
    }

    constructor() {
        super();
        this._offsets = { favorites: 0, artists: 0, albums: 0, recent: 0, madeforyou: 0 };
        this._totals = { favorites: null, artists: null, albums: null, recent: null };
        this._fetching = { favorites: false, artists: false, albums: false, recent: false, madeforyou: false };
        this._sectionData = {}; // Stores { sectionKey: [items] }
        this._hasLoaded = false;
    }

    firstUpdated(changedProperties) {
        super.firstUpdated(changedProperties);
        if (this.hass && this.api) {
            this.loadHomeData();
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._clearLongPress();
    }

    updated(changedProperties) {
        if (changedProperties.has('hass') || changedProperties.has('api') || changedProperties.has('pinned')) {
            if (this.hass && this.api && !this._hasLoaded) {
                this.loadHomeData();
            }

            // Reactive update for Pinned Items (if loaded)
            if (this._hasLoaded && this.hass && this.pinned && changedProperties.has('hass')) {
                const oldHass = changedProperties.get('hass');
                if (this.pinned.hasDataChanged(oldHass, this.hass)) {
                    this.fetchSectionData('pinned');
                }
            }
            if (changedProperties.has('pinned') && this.pinned) {
                // Pinned Manager arrived late, trigger fetch
                this.fetchSectionData('pinned');
            }
        }

    }

    /* --- Long-press on a pinned button opens the reorder editor --- */
    _onPinnedPointerDown(e) {
        // Reset any stale suppression from a prior press before deciding.
        this._suppressClick = false;
        this._clearLongPress();
        // Primary button / touch / pen only.
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const item = e.target.closest('.interactive');
        if (!item || !item.closest('.home-section[data-section-id="pinned"]')) return;
        // Editing requires write access; guests get the buttons read-only.
        if (!this.pinned || !this.pinned.canEdit()) return;

        this._lpStartX = e.clientX;
        this._lpStartY = e.clientY;
        this._longPressTimer = setTimeout(() => {
            this._longPressTimer = null;
            this._suppressClick = true; // cancel the trailing click
            fireHaptic('medium');
            this.dispatchEvent(new CustomEvent('open-reorder', { bubbles: true, composed: true }));
        }, 500);
    }

    _onPinnedPointerMove(e) {
        // Movement means a scroll/drag, not a long-press — cancel.
        if (!this._longPressTimer) return;
        if (Math.abs(e.clientX - this._lpStartX) > 10 || Math.abs(e.clientY - this._lpStartY) > 10) {
            this._clearLongPress();
        }
    }

    _clearLongPress() {
        if (this._longPressTimer) {
            clearTimeout(this._longPressTimer);
            this._longPressTimer = null;
        }
    }

    _handleCardClick(e) {
        // A long-press just opened the editor — swallow the click it would
        // otherwise fire (which would navigate/play the pressed item).
        if (this._suppressClick) {
            this._suppressClick = false;
            return;
        }

        // 1. Scroll Buttons
        const scrollBtn = e.target.closest('.scroll-btn');
        if (scrollBtn) {
            e.stopPropagation();
            const wrapper = scrollBtn.closest('.carousel-wrapper');
            const layout = wrapper ? wrapper.querySelector('.carousel-layout') : null;
            if (layout) {
                const scrollAmount = layout.clientWidth * 0.75;
                // Simple right scroll only for now as requested, but logic supports both if we add left btn
                const direction = 1;
                layout.scrollBy({ left: scrollAmount * direction, behavior: 'smooth' });
            }
            return;
        }

        // 2. See All Buttons (Navigate OR Toggle)
        const seeAllBtn = e.target.closest('.see-all-btn, .reorder-btn');
        if (seeAllBtn) {
            e.stopPropagation();
            const action = seeAllBtn.dataset.action;

            if (action === 'reorder-pinned') {
                this.dispatchEvent(new CustomEvent('open-reorder', { bubbles: true, composed: true }));
            }
            else if (action === 'search-more') {
                // Navigate to search-all page
                const query = seeAllBtn.dataset.query;
                const type = seeAllBtn.dataset.type;
                this.dispatchEvent(new CustomEvent('navigate', {
                    detail: { pageId: `search-all:${type}:${encodeURIComponent(query)}` },
                    bubbles: true, composed: true
                }));
            }
            // --- NEW: Library Link ---
            else if (action === 'library-link') {
                this.dispatchEvent(new CustomEvent('navigate', {
                    detail: { pageId: 'collection:playlists' },
                    bubbles: true, composed: true
                }));
            }
            // --- NEW: Full Section Navigation ---
            else if (action === 'navigate-section') {
                const sectionId = seeAllBtn.dataset.section;
                // Dispatch navigation to a new route format: 'section:{id}'
                // This informs the app to load the full table view for this section.
                this.dispatchEvent(new CustomEvent('navigate', {
                    detail: { pageId: `section:${sectionId}` },
                    bubbles: true, composed: true
                }));
            }
            return;
        }

        // 3. Toggle View / Expand Button (Icon)
        const toggleBtn = e.target.closest('[data-action="toggle-view"]');
        if (toggleBtn) {
            e.stopPropagation();
            const section = toggleBtn.closest('.home-section');
            if (section) {
                const container = section.querySelector('.carousel-layout, .section-grid');
                const scrollBtn = section.querySelector('.scroll-btn');
                const iconSvg = toggleBtn.querySelector('svg');

                if (container) {
                    const isGrid = container.classList.contains('section-grid');
                    if (isGrid) {
                        // Collapse back to Carousel
                        container.classList.remove('section-grid');
                        container.classList.add('carousel-layout');
                        if (scrollBtn) scrollBtn.style.display = 'flex';
                        // Rotate icon back
                        if (iconSvg) iconSvg.style.transform = 'rotate(0deg)';
                    } else {
                        // Expand to Grid
                        container.classList.remove('carousel-layout');
                        container.classList.add('section-grid');
                        if (scrollBtn) scrollBtn.style.display = 'none';
                        // Rotate icon down
                        if (iconSvg) iconSvg.style.transform = 'rotate(180deg)';
                    }
                }
            }
            return;
        }

        // 4. Media Cards
        const card = e.target.closest('.interactive');
        if (card) {
            const { id, type, title, subtitle } = card.dataset;

            // SPECIAL CASE: User Library Pinned Item
            if (id === 'user-library') {
                this.dispatchEvent(new CustomEvent('navigate', {
                    detail: { pageId: 'likedsongs' },
                    bubbles: true, composed: true
                }));
                return;
            }

            // Tracks have no detail page — play them directly (e.g. pinned tracks)
            if (type === 'track') {
                const uri = card.dataset.uri || `spotify:track:${id}`;
                this.api.playMedia(uri, 'track');
                return;
            }

            if (id && type) {
                this.dispatchEvent(new CustomEvent('navigate', {
                    detail: {
                        pageId: `${type}:${id}`,
                        data: { title, type, subtitle }
                    },
                    bubbles: true,
                    composed: true
                }));
            } else {
                console.warn('[Home] Card click missing id or type:', { id, type });
            }
        }
    }

    render() {
        if (!this.config) {
            return html``;
        }
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        // Updated path for madeforyou
        const hasMadeForYou = this.config.homescreen?.madeforyou?.content?.length > 0;
        const hasManual = this.config.homescreen?.customize?.manual;

        let order = this._getSectionOrder();

        // Ensure pinned is visible if configured (Legacy behavior only if sort not defined)
        // If sort IS defined, user controls visibility explicitly.
        const hasPinned = !!this.pinned && this.pinned.checkAvailability();

        if (!this.config.homescreen?.sort) {
            if (hasPinned && !order.includes('pinned')) {
                order = ['pinned', ...order];
            }
        }

        // Always hide pinned if not available/configured
        if (!hasPinned) {
            order = order.filter(k => k !== 'pinned');
        }

        if (isMobile) {
            return this.renderHomeMobile(hasMadeForYou, hasManual, order);
        }
        return this.renderHomeDesktop(hasMadeForYou, hasManual, order);
    }

    /**
     * Build the pinned buttons actually shown: Liked Songs (#0) + the user's
     * other pins, then top up to a max of 8 with recently played items that
     * aren't already pinned. Returns null while pins are still loading.
     */
    _pinnedDisplayItems(stored) {
        if (stored === null || stored === undefined) return null;
        const result = (Array.isArray(stored) ? stored : []).slice(0, 8);
        const seen = new Set(result.map(i => i.id));
        const recent = this._sectionData?.recent || [];
        for (const r of recent) {
            if (result.length >= 8) break;
            if (!r || !r.id || seen.has(r.id)) continue;
            const type = r.type || r._fallbackType || 'album';
            result.push({ ...r, type });
            seen.add(r.id);
        }
        return result.slice(0, 8);
    }

    renderPinnedSection(title, sectionId, items = null, playingId, isMobile = false) {
        const canEdit = !!this.pinned && this.pinned.canEdit();

        // Mobile: always render the native-style 2-column pill grid (4 rows tall,
        // sliding horizontally as a carousel once it overflows).
        if (isMobile) {
            return this.renderPinnedMobile(title, sectionId, this._pinnedDisplayItems(items), playingId, canEdit);
        }

        items = this._pinnedDisplayItems(items);

        // 1. Loading — headerless card skeletons (no "Pinned" title).
        if (items === null) {
            return `
            <section class="home-section" data-section-id="${sectionId}">
                <div class="carousel-wrapper">
                     <div class="carousel-layout" style="gap: 16px; padding-bottom: 8px;">
                        ${Array(6).fill(0).map(() => cardSkeleton()).join('')}
                     </div>
                </div>
            </section>
            `;
        }

        // 2. Empty (shouldn't normally happen — Liked Songs is always present).
        if (items.length === 0) return '';

        // 3. Cards. Pinned is capped at 8, so it always renders as a card row
        // (the carousel scrolls horizontally on overflow). No title, no Edit
        // button — long-pressing any pinned button opens the editor (editors only).
        const contentHtml = items.map(item => renderCardHtml(item, item.type || 'playlist')).join('');

        return `
        <section class="home-section" data-section-id="${sectionId}">
            <div class="carousel-wrapper">
                 <div class="carousel-layout" style="gap: 16px; padding-bottom: 8px;">
                    ${contentHtml}
                 </div>
            </div>
        </section>
        `;
    }

    /**
     * Mobile pinned grid — mirrors the native iOS "quick access" layout: a
     * 2-column grid of pills, 4 rows tall, that slides horizontally as a
     * carousel once it overflows 8 items.
     */
    renderPinnedMobile(title, sectionId, items, playingId, canEdit) {
        // Loading. Row count is capped at 4 (then columns flow sideways), but
        // shrinks to the item count so a couple of pins don't reserve 4 empty rows.
        let contentHtml;
        let rows = 4;
        if (items === null) {
            contentHtml = Array(8).fill(0).map(() => recentPillSkeleton()).join('');
        } else if (items.length === 0) {
            // Read-only guests don't see an empty section; editors get a prompt.
            if (!canEdit) return '';
            contentHtml = `<div style="padding: 8px 0; color: var(--secondary-text-color); font-size: 0.9rem; opacity: 0.7;">Nothing there.</div>`;
        } else {
            contentHtml = items.map(item => recentPill(item, playingId, this._isContextPlaying(item.uri))).join('');
            rows = Math.min(4, items.length);
        }

        // No "Pinned" title and no Edit button — long-pressing any pinned button
        // opens the editor (editors only). See _onPinnedPointerDown.
        return `
        <section class="home-section" data-section-id="${sectionId}">
            <div class="pinned-grid-mobile" id="grid-${sectionId}" data-section="${sectionId}" style="grid-template-rows: repeat(${rows}, 56px);">
                ${contentHtml}
            </div>
        </section>
        `;
    }

    renderHomeDesktop(hasMadeForYou, hasManual, order) {
        // Updated path for madeforyou pills
        const usePills = this.config.homescreen?.madeforyou?.pills || false;
        const sd = this._sectionData || {};

        const playingId = this._getPlayingTrackId();

        const sections = {
            'pinned': this.renderPinnedSection('Pinned', 'pinned', sd['pinned'], playingId),
            'recent': renderCarouselSection('Recently Played', 'recent', sd['recent']),
            'favorites': renderCarouselSection('Your Favorite Playlists', 'favorites', sd['favorites']),
            'artists': renderCarouselSection('Followed Artists', 'artists', sd['artists']),
            'albums': renderCarouselSection('Your Favorite Albums', 'albums', sd['albums']),
            'madeforyou': hasMadeForYou
                ? (usePills ? renderPillSection('Made For You', 'madeforyou', sd['madeforyou'], playingId) : renderCarouselSection('Made For You', 'madeforyou', sd['madeforyou']))
                : ''
        };

        const htmlContent = order.map(key => sections[key] || '').join('');

        return html`<div class="scroll-content"
            @click=${this._handleCardClick}
            @pointerdown=${this._onPinnedPointerDown}
            @pointermove=${this._onPinnedPointerMove}
            @pointerup=${this._clearLongPress}
            @pointercancel=${this._clearLongPress}
            @pointerleave=${this._clearLongPress}
        >${unsafeHTML(htmlContent)}</div>`;
    }

    _getSectionOrder() {
        const defaultOrder = ['pinned', 'recent', 'madeforyou', 'favorites', 'artists', 'albums'];
        const sortConfig = this.config.homescreen?.sort;

        if (Array.isArray(sortConfig) && sortConfig.length > 0) {
            const map = {
                'pinned': 'pinned',
                'recently played': 'recent',
                'followed_artists': 'artists',
                'favourite_playlists': 'favorites',
                'favourite_albums': 'albums',
                'made_for_you': 'madeforyou'
            };

            const order = [];
            for (const key of sortConfig) {
                // normalize key to lower case just in case
                const k = key.toLowerCase();
                const internalKey = map[k] || k; // access map or fallback

                // Only add if it maps to a known section or is a valid internal key
                const validKeys = ['pinned', 'recent', 'artists', 'favorites', 'albums', 'madeforyou'];
                if (validKeys.includes(internalKey)) {
                    order.push(internalKey);
                }
            }
            return order;
        }

        return this.config.home_order || defaultOrder;
    }

    _getPlayingTrackId() {
        return getPlayingTrackId(this.hass, this.api?.entityId || this.config?.entity);
    }

    /** True when a pinned item's context (playlist/album/artist/liked) is playing. */
    _isContextPlaying(uri) {
        if (!uri) return false;
        const entityId = this.api?.entityId || this.config?.entity;
        // Liked Songs has no real context URI — match HASS's collection context.
        if (uri === 'spotify:user-library') {
            const stateObj = getPlayerStateObj(this.hass, entityId);
            if (!stateObj || stateObj.state !== 'playing') return false;
            const ctx = stateObj.attributes?.media_context_content_id || '';
            return /collection|liked/i.test(ctx);
        }
        return isContextPlaying(this.hass, entityId, uri);
    }

    renderHomeMobile(hasMadeForYou, hasManual, order) {
        const sd = this._sectionData || {};
        const playingId = this._getPlayingTrackId();

        // Helper to render special recent grid or standard sections
        const renderSection = (key) => {
            if (key === 'recent') {
                let recentHtml = '';
                if (!sd['recent']) { // Loading
                    recentHtml = Array(6).fill(0).map(() => recentPillSkeleton()).join('');
                } else if (sd['recent'].length === 0) { // Empty
                    recentHtml = 'No recent items.';
                } else { // Data
                    recentHtml = sd['recent'].map(item => recentPill(item, playingId, this._isContextPlaying(item.uri))).join('');
                }
                return `
                    <h3 class="section-title" style="margin-bottom:16px;">Good Morning</h3>
                    <div class="recent-grid-layout" id="grid-recent" data-section="recent" style="margin-bottom: 32px;">
                        ${recentHtml}
                    </div>
                `;
            } else if (key === 'pinned') {
                return this.renderPinnedSection('Pinned', 'pinned', sd['pinned'], playingId, true);
            } else if (key === 'favorites') {
                return renderCarouselSection('Your Playlists', 'favorites', sd['favorites']);
            } else if (key === 'artists') {
                return renderCarouselSection('Your Artists', 'artists', sd['artists']);
            } else if (key === 'albums') {
                return renderCarouselSection('Your Albums', 'albums', sd['albums']);
            } else if (key === 'madeforyou') {
                const usePills = this.config.homescreen?.madeforyou?.pills || false;
                return hasMadeForYou
                    ? (usePills ? renderPillSection('Made For You', 'madeforyou', sd['madeforyou'], playingId) : renderCarouselSection('Made For You', 'madeforyou', sd['madeforyou']))
                    : '';
            }
            return '';
        };

        const htmlContent = order.map(key => renderSection(key)).join('');
        return html`<div class="scroll-content"
            @click=${this._handleCardClick}
            @pointerdown=${this._onPinnedPointerDown}
            @pointermove=${this._onPinnedPointerMove}
            @pointerup=${this._clearLongPress}
            @pointercancel=${this._clearLongPress}
            @pointerleave=${this._clearLongPress}
        >${unsafeHTML(htmlContent)}</div>`;
    }



    async loadHomeData() {
        if (!this.hass || !this.api) return;
        this._hasLoaded = true;

        this._offsets = { favorites: 0, artists: 0, albums: 0, recent: 0, madeforyou: 0 };

        // Checks if pinned entity is configured and available
        const hasPinned = this.pinned && this.pinned.checkAvailability();

        let order = this._getSectionOrder();

        // If 'pinned' is not in custom order but is configured, prepend it.
        // This ensures the feature is visible if configured, even if home_order is old.
        // ONLY valid if sort is NOT defined.
        if (!this.config.homescreen?.sort) {
            if (hasPinned && !order.includes('pinned')) {
                order.unshift('pinned');
            }
        }

        // Filter out pinned if not enabled
        if (!hasPinned) {
            order = order.filter(k => k !== 'pinned');
        }

        const fetchList = order.map(key => {
            if (key === 'pinned') return this.fetchSectionData('pinned');
            if (key === 'madeforyou') {
                // Check new config location
                const mfy = this.config.homescreen?.madeforyou?.content;
                if (!mfy || mfy.length === 0) return Promise.resolve();
            }
            return this.fetchSectionData(key);
        });

        await Promise.allSettled(fetchList);
    }

    async fetchSectionData(sectionKey) {
        if (this._fetching[sectionKey]) return;
        this._fetching[sectionKey] = true;
        this.requestUpdate();

        if (sectionKey === 'pinned') {
            // The manager returns Liked Songs first, then the user's other pins
            // (already capped). Home tops this up to 8 with recently played items
            // at render time (see _pinnedDisplayItems).
            const items = await this.pinned.getItems();
            if (items) {
                this._sectionData = { ...this._sectionData, pinned: items };
            }
            this._fetching['pinned'] = false;
            this.requestUpdate();
            return;
        }

        const offset = this._offsets[sectionKey];
        if (offset > 0 && this._totals[sectionKey] !== null && offset >= this._totals[sectionKey]) {
            this._fetching[sectionKey] = false;
            return;
        }

        const limit = 20;

        try {
            let data = null;
            let type = 'playlist';

            if (sectionKey === 'madeforyou') {
                if (offset > 0) return;
                const items = await loadMadeForYouItems(this.api, this.config);
                if (items.length === 0) return;
                data = { items: items, total: items.length };
                type = 'playlist';
            }
            else if (sectionKey === 'favorites') {
                const res = await this.api.fetchSpotifyPlus('get_playlist_favorites', { limit: limit, offset: offset });
                data = res?.result; type = 'playlist';
            }
            else if (sectionKey === 'recent') {
                if (offset > 0) return;
                const res = await this.api.fetchSpotifyPlus('get_player_recent_tracks', { limit: 50 });
                if (res?.result?.items) {
                    const uniqueItems = dedupeRecentAlbums(res.result.items);
                    data = { items: uniqueItems, total: uniqueItems.length }; type = 'album';
                }
            }
            else if (sectionKey === 'artists') {
                if (offset > 0) return;
                const res = await this.api.fetchSpotifyPlus('get_artists_followed', { limit });
                // Robust parsing: Check for direct items, or nested artists object
                if (res?.result) {
                    data = res.result;
                    if (data.artists) data = data.artists;
                }
                type = 'artist';
            }
            else if (sectionKey === 'albums') {
                const res = await this.api.fetchSpotifyPlus('get_album_favorites', { limit, offset });
                if (res?.result?.items) { data = { items: res.result.items.map(i => i.album).filter(Boolean), total: res.result.total }; type = 'album'; }
            }

            if (data && Array.isArray(data.items)) {
                if (data.total !== undefined) this._totals[sectionKey] = data.total;
                this._offsets[sectionKey] += data.items.length;

                // DATA UPDATE: Append new items to state
                const currentItems = this._sectionData[sectionKey] || [];
                // We need to store type with the item if not present, or know it generally. 
                // mediaCard logic uses item.type OR fallback type.
                // Let's ensure items have type if possible, or we pass it to render.
                const newItems = data.items.map(i => ({ ...i, _fallbackType: type }));

                this._sectionData = {
                    ...this._sectionData,
                    [sectionKey]: [...currentItems, ...newItems]
                };
            } else {
                // Handle empty/error state if needed (e.g. set flag)
                if (offset === 0 && (!this._sectionData[sectionKey])) {
                    // Mark as empty so we don't show skeleton forever?
                    // We can set it to empty array explicitly if undefined
                    this._sectionData = { ...this._sectionData, [sectionKey]: [] };
                }
            }
        } catch (e) {
            console.error(`Error fetching ${sectionKey}: `, e);
            // On error, if no data, set to empty to clear skeleton or show error?
            if (!this._sectionData[sectionKey]) {
                this._sectionData = { ...this._sectionData, [sectionKey]: [] };
            }
        } finally {
            this._fetching[sectionKey] = false;
            this.requestUpdate();
        }
    }
}

customElements.define('spotify-home', SpotifyHome);
