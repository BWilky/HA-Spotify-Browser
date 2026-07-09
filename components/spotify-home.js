import { LitElement, html } from "../lit.js";
import { sharedStyles } from '../styles/shared-styles.js';
import { homeStyles } from '../styles/spotify-home.styles.js';
import { renderCardTemplate, renderCardSkeletonTemplate } from './media-templates.js';
import { loadMadeForYouItems, dedupeRecentAlbums } from './controllers/home-content.js';
import { getItemImage, getPlayingTrackId, fireHaptic, isContextPlaying, getPlayerStateObj } from '../utils.js';
import { playingBarsIcon } from './common/icons.js';

// --- Shared snippets (lit templates) ---

function recentPillSkeleton() {
    return html`
      <div class="recent-pill skeleton-pulse">
        <div class="recent-pill-img"></div>
        <div class="recent-pill-text" style="width: 60%; height: 12px; background: #333; border-radius: 4px;"></div>
      </div>
    `;
}

/** Subtitle shown on home cards (owner, then artists, then 'Artist'). */
function cardSubtitle(item, type) {
    let subtitle = item.subtitle;
    if (!subtitle && item.owner) subtitle = item.owner.display_name;
    if (!subtitle && item.artists && Array.isArray(item.artists)) subtitle = item.artists.map(a => a.name).join(', ');
    if (!subtitle) subtitle = type === 'artist' ? 'Artist' : '';
    return subtitle;
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
            _expandedSections: { type: Object, state: true },
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
        this._expandedSections = new Set(); // Section ids toggled from carousel to grid
        this._hasLoaded = false;
        this._hassSig = undefined;
    }

    firstUpdated(changedProperties) {
        super.firstUpdated(changedProperties);
        if (this.hass && this.api && !this._hasLoaded) {
            this.loadHomeData();
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._clearLongPress();
    }

    /**
     * Gate re-renders on HASS ticks: hass updates arrive ~1/s while playing,
     * but home only shows playing-state info (pill overlays / eq indicators).
     * Skipping unchanged ticks preserves carousel scroll positions and avoids
     * re-rendering the whole home tree every second.
     *
     * The data-load triggers live here (not in updated()) because they must
     * still run on ticks whose render is skipped.
     */
    shouldUpdate(changedProperties) {
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

        if (changedProperties.has('hass')) {
            const sig = this._hassRenderSignature();
            const hassChanged = sig !== this._hassSig;
            this._hassSig = sig;
            // hass-only tick with nothing home displays changed -> skip render
            if (!hassChanged && changedProperties.size === 1) {
                return false;
            }
        }
        return true;
    }

    /** Everything home reads from hass at render time, as a comparable string. */
    _hassRenderSignature() {
        const entityId = this.api?.entityId || this.config?.entity;
        const stateObj = getPlayerStateObj(this.hass, entityId);
        const attrs = stateObj?.attributes || {};
        return [
            stateObj?.state,
            attrs.media_content_id,
            attrs.media_context_content_id,
            !!this.pinned && this.pinned.checkAvailability(),
            !!this.pinned && this.pinned.canEdit(),
        ].join('|');
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

    /* --- Click handlers (per-element, attached in the lit templates) --- */

    _onScrollRight(e) {
        e.stopPropagation();
        const wrapper = e.currentTarget.closest('.carousel-wrapper');
        const layout = wrapper ? wrapper.querySelector('.carousel-layout') : null;
        if (layout) {
            const scrollAmount = layout.clientWidth * 0.75;
            // Simple right scroll only for now as requested, but logic supports both if we add left btn
            const direction = 1;
            layout.scrollBy({ left: scrollAmount * direction, behavior: 'smooth' });
        }
    }

    _onReorderClick(e) {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('open-reorder', { bubbles: true, composed: true }));
    }

    _onNavigateSection(e, sectionId) {
        e.stopPropagation();
        // Dispatch navigation to a route format: 'section:{id}'.
        // This informs the app to load the full table view for this section.
        this.dispatchEvent(new CustomEvent('navigate', {
            detail: { pageId: `section:${sectionId}` },
            bubbles: true, composed: true
        }));
    }

    /** Toggle a section between carousel and grid (survives re-renders). */
    _toggleSectionView(e, sectionId) {
        e.stopPropagation();
        const next = new Set(this._expandedSections);
        if (next.has(sectionId)) {
            next.delete(sectionId);
        } else {
            next.add(sectionId);
        }
        this._expandedSections = next;
    }

    /** Click on a media card or pill (navigate to detail, or play tracks). */
    _onItemClick(item, type, subtitle = '') {
        // A long-press just opened the editor — swallow the click it would
        // otherwise fire (which would navigate/play the pressed item).
        if (this._suppressClick) {
            this._suppressClick = false;
            return;
        }

        const id = item.id;
        const title = item.name || item.title || 'Unknown';

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
            const uri = item.uri || `spotify:track:${id}`;
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

    /* --- Section templates --- */

    _cardTemplate(item, type) {
        const subtitle = cardSubtitle(item, type);
        return renderCardTemplate(
            { ...item, subtitle },
            type,
            () => this._onItemClick(item, type, subtitle)
        );
    }

    _recentPillTemplate(item, playingId = null, contextPlaying = false) {
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

        return html`
        <div class="recent-pill interactive" @click=${() => this._onItemClick(item, item.type)}>
            <div class="recent-pill-img" style="background-image: url('${img}');">
                 ${isPlaying ? html`<div class="play-btn-overlay mini" style="opacity: 1; background: rgba(0,0,0,0.7);">${playingBarsIcon(18)}</div>` : ''}
            </div>
            <div class="recent-pill-text" style="${isPlaying ? 'color: var(--spf-brand); font-weight: bold;' : ''}">${title}</div>
            ${contextPlaying ? html`<div class="pill-eq" aria-label="Now playing">${playingBarsIcon(18)}</div>` : ''}
        </div>
        `;
    }

    _carouselSection(title, sectionId, items = null) {
        const hasItems = !!items && items.length > 0;
        const expanded = this._expandedSections.has(sectionId);

        let content;
        if (items === null) { // Loading
            content = Array(6).fill(0).map(() => renderCardSkeletonTemplate(sectionId.includes('artists')));
        } else if (items.length === 0) { // Empty
            content = html`<div style="padding:20px; opacity:0.5; white-space:nowrap;">No content found.</div>`;
        } else {
            content = items.map(item => this._cardTemplate(item, item.type || item._fallbackType));
        }

        return html`
        <section class="home-section" data-section-id="${sectionId}">
            <div class="section-header" style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center;">
                    <h3 class="section-title" style="margin:0;">${title}</h3>
                    <button class="icon-btn expand-btn" @click=${(e) => this._toggleSectionView(e, sectionId)} aria-label="Toggle View" style="background:none; border:none; color:var(--secondary-text-color, #b3b3b3); cursor:pointer; margin-left: 8px; padding: 4px; display: flex; align-items: center;">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(${expanded ? 180 : 0}deg);">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>
                </div>
                ${hasItems
                ? html`<button class="see-all-btn" @click=${(e) => this._onNavigateSection(e, sectionId)}>See All</button>`
                : html`<button class="see-all-btn" style="display:none">See All</button>`}
            </div>
            <div class="carousel-wrapper">
                <div class="${expanded ? 'section-grid' : 'carousel-layout'}" id="carousel-${sectionId}" data-section="${sectionId}">
                    ${content}
                </div>
                <button class="scroll-btn right" @click=${this._onScrollRight} style="${hasItems && items.length > 5 && !expanded ? '' : 'display:none'}">
                    <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                </button>
            </div>
        </section>
        `;
    }

    _pillSection(title, sectionId, items = null, playingId = null, canEdit = false) {
        let content;
        if (items === null) {
            content = Array(8).fill(0).map(() => recentPillSkeleton());
        } else if (items.length === 0) {
            content = html`<div style="padding:20px; opacity:0.5; white-space:nowrap;">No content found.</div>`;
        } else {
            content = items.map(item => this._recentPillTemplate(item, playingId));
        }

        // Reorder Button for Pinned Section (only when the user can edit)
        const headerAction = (sectionId === 'pinned' && canEdit) ? html`
            <button class="icon-btn reorder-btn" @click=${this._onReorderClick} aria-label="Reorder Items" style="background:none; border:none; color:var(--secondary-text-color, #b3b3b3); cursor:pointer; margin-left: 8px; padding: 4px; display: flex; align-items: center;">
                 <span style="font-size: 0.8rem; margin-right: 4px; font-weight: bold;">Edit</span>
                 <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>
            </button>
        ` : '';

        return html`
        <section class="home-section" data-section-id="${sectionId}">
            <div class="section-header" style="display: flex; align-items: center; justify-content: space-between;">
                 <h3 class="section-title" style="margin:0;">${title}</h3>
                 ${headerAction}
            </div>
            <div class="recent-grid-layout" id="grid-${sectionId}" data-section="${sectionId}">
                ${content}
            </div>
        </section>
        `;
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
            return html`
            <section class="home-section" data-section-id="${sectionId}">
                <div class="carousel-wrapper">
                     <div class="carousel-layout" style="gap: 16px; padding-bottom: 8px;">
                        ${Array(6).fill(0).map(() => renderCardSkeletonTemplate())}
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
        return html`
        <section class="home-section" data-section-id="${sectionId}">
            <div class="carousel-wrapper">
                 <div class="carousel-layout" style="gap: 16px; padding-bottom: 8px;">
                    ${items.map(item => this._cardTemplate(item, item.type || 'playlist'))}
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
        let content;
        let rows = 4;
        if (items === null) {
            content = Array(8).fill(0).map(() => recentPillSkeleton());
        } else if (items.length === 0) {
            // Read-only guests don't see an empty section; editors get a prompt.
            if (!canEdit) return '';
            content = html`<div style="padding: 8px 0; color: var(--secondary-text-color); font-size: 0.9rem; opacity: 0.7;">Nothing there.</div>`;
        } else {
            content = items.map(item => this._recentPillTemplate(item, playingId, this._isContextPlaying(item.uri)));
            rows = Math.min(4, items.length);
        }

        // No "Pinned" title and no Edit button — long-pressing any pinned button
        // opens the editor (editors only). See _onPinnedPointerDown.
        return html`
        <section class="home-section" data-section-id="${sectionId}">
            <div class="pinned-grid-mobile" id="grid-${sectionId}" data-section="${sectionId}" style="grid-template-rows: repeat(${rows}, 56px);">
                ${content}
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
            'recent': this._carouselSection('Recently Played', 'recent', sd['recent']),
            'favorites': this._carouselSection('Your Favorite Playlists', 'favorites', sd['favorites']),
            'artists': this._carouselSection('Followed Artists', 'artists', sd['artists']),
            'albums': this._carouselSection('Your Favorite Albums', 'albums', sd['albums']),
            'madeforyou': hasMadeForYou
                ? (usePills ? this._pillSection('Made For You', 'madeforyou', sd['madeforyou'], playingId) : this._carouselSection('Made For You', 'madeforyou', sd['madeforyou']))
                : ''
        };

        return html`<div class="scroll-content"
            @pointerdown=${this._onPinnedPointerDown}
            @pointermove=${this._onPinnedPointerMove}
            @pointerup=${this._clearLongPress}
            @pointercancel=${this._clearLongPress}
            @pointerleave=${this._clearLongPress}
        >${order.map(key => sections[key] || '')}</div>`;
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
                let recentContent;
                if (!sd['recent']) { // Loading
                    recentContent = Array(6).fill(0).map(() => recentPillSkeleton());
                } else if (sd['recent'].length === 0) { // Empty
                    recentContent = 'No recent items.';
                } else { // Data
                    recentContent = sd['recent'].map(item => this._recentPillTemplate(item, playingId, this._isContextPlaying(item.uri)));
                }
                return html`
                    <h3 class="section-title" style="margin-bottom:16px;">Good Morning</h3>
                    <div class="recent-grid-layout" id="grid-recent" data-section="recent" style="margin-bottom: 32px;">
                        ${recentContent}
                    </div>
                `;
            } else if (key === 'pinned') {
                return this.renderPinnedSection('Pinned', 'pinned', sd['pinned'], playingId, true);
            } else if (key === 'favorites') {
                return this._carouselSection('Your Playlists', 'favorites', sd['favorites']);
            } else if (key === 'artists') {
                return this._carouselSection('Your Artists', 'artists', sd['artists']);
            } else if (key === 'albums') {
                return this._carouselSection('Your Albums', 'albums', sd['albums']);
            } else if (key === 'madeforyou') {
                const usePills = this.config.homescreen?.madeforyou?.pills || false;
                return hasMadeForYou
                    ? (usePills ? this._pillSection('Made For You', 'madeforyou', sd['madeforyou'], playingId) : this._carouselSection('Made For You', 'madeforyou', sd['madeforyou']))
                    : '';
            }
            return '';
        };

        return html`<div class="scroll-content"
            @pointerdown=${this._onPinnedPointerDown}
            @pointermove=${this._onPinnedPointerMove}
            @pointerup=${this._clearLongPress}
            @pointercancel=${this._clearLongPress}
            @pointerleave=${this._clearLongPress}
        >${order.map(key => renderSection(key))}</div>`;
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
