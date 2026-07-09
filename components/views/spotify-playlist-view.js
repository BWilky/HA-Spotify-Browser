import { LitElement, html, css, repeat } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { contextViewStyles } from '../../styles/spotify-context-view.styles.js';
import { fireHaptic } from '../../utils.js';
import { renderTrackRowTemplate } from '../media-templates.js';
import { heartToggleIcon, playIcon, pauseIcon } from '../common/icons.js';

export class SpotifyPlaylistView extends LitElement {
    static get properties() {
        return {
            data: { type: Object },
            api: { type: Object },
            hass: { type: Object },
            config: { type: Object },
            pinned: { type: Object }, // Add pinned
            // Narrow values derived from hass by the parent context-view; these
            // (not raw hass) drive re-renders on player state ticks.
            playingTrackId: { type: String },
            currentTrackId: { type: String },
            isPlaying: { type: Boolean },
            pinnedSensorState: { type: Object },
            _isFollowing: { type: Boolean, state: true },
            _currentUserId: { type: String, state: true },
            _isPinned: { type: Boolean, state: true },
            _pinnedEntity: { type: String, state: true },
            _albumLiked: { type: Boolean, state: true },   // album saved to library
            _artistInfo: { type: Object, state: true },    // album's primary artist { id, name, image }
            _optimisticPlayState: { type: String, state: true }, // 'playing', 'paused', or null
            _optimisticPlayingTrackId: { type: String, state: true }, // row to highlight immediately on click
            _trackLikes: { type: Object, state: true }, // map of trackId -> boolean (liked)
            _genrePills: { type: Array, state: true }, // Liked Songs filter pills: [{ label, genre }]
            _activeGenre: { type: String, state: true } // currently selected pill genre, or null
        };
    }

    static get styles() {
        return [
            sharedStyles,
            contextViewStyles,
            css`
                :host { 
                    display: block !important; 
                    width: 100% !important; 
                    height: 100% !important; 
                    position: relative !important;
                    overflow: hidden !important; 
                }
                .main-scroll-container {
                    width: 100%;
                    height: 100%;
                    overflow-y: auto;
                    overflow-x: hidden;
                    overscroll-behavior-y: auto;
                    overscroll-behavior-x: none;
                    position: relative;
                    background: var(--spf-bg);
                }
                .hero-banner { 
                    height: 375px !important; 
                    min-height: 375px !important; 
                    max-height: 375px !important;
                    display: block !important;
                    position: relative !important;
                    margin-top: 0 !important;
                    width: 100% !important;
                    overflow: visible !important;
                }
                .content-wrapper {
                    padding: 12px;
                    padding-bottom: 100px;
                    position: relative;
                    background: var(--spf-bg); 
                }
                .hero-bg { overflow: visible !important; }
                .hero-bg, .hero-bg img { width: 100%; height: 100%; object-fit: cover; }

                /* Hero layout/buttons come from spotify-context-view.styles.js;
                   only the playlist-specific differences live here. */
                .hero-art { width: 220px; height: 220px; background: #282828; }
                .hero-text { text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
                /* Native mobile-only text rows (shown in the mobile media query). */
                .hero-desc, .hero-owner, .hero-meta { display: none; }
                /* Album: shuffle + play grouped and pushed to the right edge as a
                   single unit (mirrors the single right-aligned play button used
                   elsewhere, which lays out reliably). */
                .ha-right { display: flex; align-items: center; gap: 16px; margin-left: auto; }

                /* ================= LIKED SONGS NATIVE STYLING ================= */
                .liked-gradient {
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: linear-gradient(180deg, #4733b0 0%, #3a2f7a 45%, var(--spf-bg) 100%);
                    transform: translateZ(0); /* own layer: avoids initial paint gap behind the header */
                }
                /* Liked Songs has no album art (mirrors the native app), so the
                   hero is just the title + count + controls over the gradient.
                   Shrink the banner accordingly on desktop. */
                .liked-hero .hero-banner {
                    height: 240px !important; min-height: 240px !important; max-height: 240px !important;
                }
                /* Over-scroll guard: a block of the gradient's top colour sitting
                   just above the content, so the rubber-band bounce reveals purple
                   instead of the black page background behind the scroller. */
                .main-scroll-container.liked-hero::before {
                    content: '';
                    position: absolute;
                    left: 0; right: 0; top: -400px; height: 400px;
                    background: #4733b0;
                    z-index: 0;
                    pointer-events: none;
                }
                .hero-btn-icon {
                    background: transparent; border: none; color: var(--spf-text-sub);
                    width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;
                    cursor: pointer; transition: color 0.2s;
                }
                .hero-btn-icon:hover { color: white; }

                /* Album save button — mirrors the now-playing like button: an
                   outlined circle with a checkmark that fills green when saved. */
                .album-save {
                    flex-shrink: 0; width: 56px; height: 56px; border-radius: 50%;
                    border: 2px solid rgba(255,255,255,0.6); background: transparent;
                    color: rgba(255,255,255,0.85); cursor: pointer; padding: 0;
                    display: flex; align-items: center; justify-content: center;
                    transition: all 0.15s ease;
                }
                .album-save svg { width: 26px; height: 26px; fill: currentColor; }
                .album-save.saved {
                    background: var(--spf-brand, #1ed760);
                    border-color: var(--spf-brand, #1ed760);
                    color: #000;
                }

                /* Pin button — same styling as the album save button: outlined
                   circle when not pinned, green-filled when pinned. */
                .hero-pin {
                    flex-shrink: 0; width: 56px; height: 56px; border-radius: 50%;
                    border: 2px solid rgba(255,255,255,0.6); background: transparent;
                    color: rgba(255,255,255,0.85); cursor: pointer; padding: 0;
                    display: flex; align-items: center; justify-content: center;
                    transition: all 0.15s ease;
                }
                .hero-pin svg { width: 26px; height: 26px; fill: currentColor; }
                .hero-pin.pinned {
                    background: var(--spf-brand, #1ed760);
                    border-color: var(--spf-brand, #1ed760);
                    color: #000;
                }

                /* Album: clickable artist row + release line */
                .hero-artist {
                    display: flex; align-items: center; gap: 10px;
                    cursor: pointer; margin-bottom: 6px; width: fit-content;
                }
                .hero-artist-avatar {
                    width: 28px; height: 28px; border-radius: 50%; flex: 0 0 auto;
                    background-size: cover; background-position: center;
                    background-color: var(--spf-bg-card-hover, #282828);
                }
                .hero-artist-name {
                    color: var(--spf-text-main); font-size: 14px; font-weight: 700;
                }
                .hero-artist:hover .hero-artist-name { text-decoration: underline; }
                .hero-release {
                    color: var(--spf-text-sub); font-size: 13px; margin-bottom: 4px;
                }

                .genre-pills {
                    display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none;
                    padding: 4px 4px 12px; -webkit-overflow-scrolling: touch;
                }
                .genre-pills::-webkit-scrollbar { display: none; }
                .genre-pill {
                    flex: 0 0 auto; border: none; cursor: pointer; white-space: nowrap;
                    padding: 8px 16px; border-radius: 999px; font-size: 14px; font-weight: 500;
                    background: var(--spf-bg-card, #232323); color: white; transition: background 0.15s, color 0.15s;
                }
                .genre-pill:hover { background: #3a3a3a; }
                .genre-pill.active { background: var(--spf-brand); color: #000; }

                /* ================= SPOTIFY-STYLE MOBILE HERO ================= */
                @media (max-width: 768px) {
                    .hero-banner {
                        height: auto !important;
                        min-height: auto !important;
                        max-height: none !important;
                        padding-top: calc(64px + var(--spf-safe-top, 0px) + 16px);
                    }

                    /* Gradient fade from blurred bg into content area */
                    .hero-banner::after {
                        content: '';
                        position: absolute;
                        bottom: 0; left: 0; right: 0;
                        height: 50%;
                        background: linear-gradient(to top, var(--spf-bg) 0%, transparent 100%);
                        z-index: 1;
                        pointer-events: none;
                    }

                    .hero-content {
                        position: relative !important;
                        bottom: auto !important;
                        flex-direction: column !important;
                        align-items: center !important;
                        padding: 0 16px 20px !important;
                        gap: 20px !important;
                        z-index: 2 !important;
                    }

                    .hero-art {
                        width: min(68vw, 320px) !important;
                        height: min(68vw, 320px) !important;
                        border-radius: 6px !important;
                        box-shadow: 0 8px 28px rgba(0,0,0,0.55) !important;
                    }

                    .hero-text {
                        width: 100% !important;
                        text-align: left !important;
                        text-shadow: none !important;
                    }

                    .hero-title {
                        font-size: 1.5rem !important;
                        font-weight: 800 !important;
                        line-height: 1.15 !important;
                        margin: 0 0 8px 0 !important;
                    }

                    /* Native hides the type eyebrow on mobile; for non-liked
                       playlists the description/owner/meta rows replace the
                       generic subtitle. */
                    .hero-type { display: none !important; }
                    .main-scroll-container:not(.liked-hero) .hero-subtitle { display: none !important; }

                    .liked-hero .hero-subtitle {
                        font-size: 14px !important;
                        color: var(--spf-text-sub) !important;
                    }

                    /* Liked Songs: compact, left-aligned header (no art) like iOS.
                       Title sits just under the back button, then the count, then
                       the controls row with the green play pushed to the right. */
                    .liked-hero .hero-banner {
                        height: auto !important; min-height: auto !important; max-height: none !important;
                        padding-top: calc(56px + var(--spf-safe-top, 0px)) !important;
                    }
                    .liked-hero .hero-content {
                        align-items: flex-start !important;
                        gap: 10px !important;
                        padding-bottom: 12px !important;
                    }
                    .liked-hero .hero-actions { margin-top: 10px !important; }
                    .liked-hero .hero-btn-play { margin-left: auto !important; order: 10 !important; }

                    .hero-desc {
                        display: block !important;
                        font-size: 15px !important;
                        line-height: 1.4 !important;
                        color: var(--spf-text-main) !important;
                        margin-bottom: 14px !important;
                    }

                    .hero-owner {
                        display: flex !important;
                        align-items: center !important;
                        gap: 8px !important;
                        font-size: 14px !important;
                        color: var(--spf-text-main) !important;
                        margin-bottom: 6px !important;
                    }
                    .hero-owner svg { width: 24px !important; height: 24px !important; flex: 0 0 auto; }
                    .hero-owner b { font-weight: 700 !important; }

                    .hero-meta {
                        display: block !important;
                        font-size: 13px !important;
                        color: var(--spf-text-sub) !important;
                    }

                    .hero-actions {
                        width: 100% !important;
                        margin-top: 6px !important;
                        gap: 20px !important;
                        align-items: center !important;
                    }
                    /* Native: secondary actions left, big green play on the right. */
                    .main-scroll-container:not(.liked-hero) .hero-btn-play {
                        order: 10;
                        margin-left: auto;
                    }

                    /* Album: slide the art up so its top lines up with the back
                       button instead of sitting well below the header. */
                    .main-scroll-container.album-hero .hero-banner {
                        padding-top: calc(var(--spf-safe-top, 0px) + 8px) !important;
                    }

                    /* Album: like/pin on the left, shuffle + play grouped right.
                       Cap the hero column + action row to the viewport so the
                       right-aligned play/shuffle can never be pushed off-edge. */
                    .album-hero .hero-content { max-width: 100vw !important; box-sizing: border-box !important; }
                    .album-hero .hero-text,
                    .album-hero .hero-actions { box-sizing: border-box !important; max-width: 100% !important; min-width: 0 !important; }
                    .album-hero .ha-right { gap: 12px !important; }
                    .album-hero .ha-right .hero-btn-play { margin-left: 0 !important; }
                    .album-hero .hero-btn-icon { width: 40px !important; height: 40px !important; }
                    .album-hero .album-save { width: 40px !important; height: 40px !important; }
                    .album-hero .album-save svg { width: 20px !important; height: 20px !important; }

                    .hero-btn-play {
                        width: 48px !important;
                        height: 48px !important;
                    }
                    .hero-btn-play svg {
                        width: 24px !important;
                        height: 24px !important;
                    }

                    /* Shrink fav/pin action circles */
                    .hero-btn-fav,
                    .hero-pin {
                        width: 40px !important;
                        height: 40px !important;
                    }
                    .hero-btn-fav svg,
                    .hero-pin svg {
                        width: 20px !important;
                        height: 20px !important;
                    }

                    .content-wrapper {
                        padding: 0 4px !important;
                        padding-bottom: 100px !important;
                    }
                }
            `
        ];
    }

    constructor() {
        super();
        this.playingTrackId = null;
        this.currentTrackId = null;
        this.isPlaying = false;
        this.pinnedSensorState = undefined;
        // Cache the MediaQueryList once; reading window.matchMedia() inside the
        // rAF scroll handler re-parses the query on every frame.
        this._mobileMql = window.matchMedia('(max-width: 768px)');
        this._isFollowing = false;
        this._currentUserId = null;
        this._isPinned = false;
        this._pinnedEntity = null;
        this._albumLiked = false;     // album saved to library (album view)
        this._artistInfo = null;      // { id, name, image } for the album's primary artist
        this._optimisticPlayState = null;
        this._optimisticPlayingTrackId = null;
        this._trackLikes = {};
        this._genrePills = [];
        this._activeGenre = null;
        this._trackGenres = {}; // trackId -> string[] of genres (not reactive; drives pills)
    }

    connectedCallback() {
        super.connectedCallback();
        // Check following status if data available
        this._checkFollowStatus();
        this._checkPinStatus();
    }



    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._optimisticTimer) clearTimeout(this._optimisticTimer);
        if (this._optimisticTrackTimer) clearTimeout(this._optimisticTrackTimer);
        if (this._likeVerifyTimer) clearTimeout(this._likeVerifyTimer);
        if (this._scrollRaf) cancelAnimationFrame(this._scrollRaf);
        this._optimisticTimer = null;
        this._optimisticTrackTimer = null;
        this._likeVerifyTimer = null;
        this._scrollRaf = null;
    }

    /**
     * Raw `hass` is kept only as an interaction-time reference; re-renders on
     * player ticks are driven by the derived props (playingTrackId, isPlaying,
     * currentTrackId, pinnedSensorState) the parent context-view maintains.
     */
    shouldUpdate(changedProperties) {
        if (changedProperties.size === 1 && changedProperties.has('hass')) return false;
        return true;
    }

    updated(changedProperties) {
        if (changedProperties.has('data')) {
            this._checkFollowStatus();
            this._checkPinStatus();
            this._checkTrackLikes();
            if (this.data?.type === 'likedsongs') this._enrichGenres();
            if (this.data?.type === 'album') {
                this._checkAlbumLike();
                this._fetchArtistInfo();
            }
        }

        // Optimistic-track handoff: once HASS reports the track we optimistically
        // marked as playing, drop the optimistic flag and let real state drive.
        if (this._optimisticPlayingTrackId && changedProperties.has('currentTrackId')) {
            if (this.currentTrackId === this._optimisticPlayingTrackId) {
                this._optimisticPlayingTrackId = null;
            }
        }

        // Check for HASS updates to the Pinned Items helper (the parent derives
        // the sensor's state object, so any change here is a real change).
        if (changedProperties.has('pinnedSensorState') && this.pinned && this.pinned.sensorEntity) {
            if (changedProperties.get('pinnedSensorState') !== undefined) {
                this._checkPinStatus();
            }
        }
    }

    async _checkFollowStatus() {
        if (!this.data || this.data.type !== 'playlist' || !this.api) return;

        // Fetch User if needed
        if (!this._currentUserId) {
            try {
                const user = await this.api.getCurrentUserProfile();
                if (user?.id) this._currentUserId = user.id;
            } catch (e) { }
        }

        if (this._currentUserId && this.data.id) {
            try {
                const follows = await this.api.checkUserFollowsPlaylist(this.data.id, this._currentUserId);
                if (follows && Array.isArray(follows) && follows.length > 0) this._isFollowing = follows[0];
            } catch (e) { }
        }
    }

    // --- PINNED ITEMS LOGIC ---
    async _checkPinStatus() {
        if (!this.pinned || !this.data) return;

        // The pin button is an edit action — only for users who can write.
        if (!this.pinned.canEdit()) {
            this._pinnedEntity = null;
            return;
        }

        const items = await this.pinned.getItems();

        let targetId = this.data.id;
        // SPECIAL CASE: Liked Songs -> user-library
        if (this.data.type === 'likedsongs') {
            targetId = 'user-library';
        }

        this._isPinned = !!items.find(i => i.id === targetId);
        this._pinnedEntity = this.pinned.sensorEntity;
    }

    _getIsPlaying() {
        if (this._optimisticPlayState) {
            return this._optimisticPlayState === 'playing';
        }
        return !!this.isPlaying;
    }

    /** Spotify track id currently playing (optimistic guess wins), or null. */
    _getPlayingTrackId() {
        if (this._optimisticPlayingTrackId) return this._optimisticPlayingTrackId;
        return this.playingTrackId || null;
    }

    async _togglePin() {
        if (!this._pinnedEntity || !this.pinned) return;

        let item;
        // SPECIAL CASE: Liked Songs -> user-library
        if (this.data.type === 'likedsongs') {
            item = {
                id: 'user-library',
                type: 'library',
                title: 'User Library',
                subtitle: 'Your collection & liked songs',
                image: 'https://www.gstatic.com/images/icons/material/system/2x/library_music_white_24dp.png',
                uri: 'spotify:user-library'
            };
        } else {
            item = {
                id: this.data.id,
                type: this.data.type,
                name: this.data.name || this.data.title,
                images: this.data.images,
                uri: this.data.uri,
                description: this.data.description
            };
        }

        const result = await this.pinned.toggle(item);

        if (result.success) {
            this._isPinned = !this._isPinned;
            // Refresh the home pinned row now rather than waiting for the sensor's
            // event round-trip (which the hass reactive path would eventually catch).
            this.dispatchEvent(new CustomEvent('pinned-changed', { bubbles: true, composed: true }));
        } else {
            this.dispatchEvent(new CustomEvent('show-alert', {
                detail: {
                    title: "Pinning Failed",
                    message: result.error || "Unknown error",
                    confirmText: "OK",
                    size: 'mini'
                },
                bubbles: true,
                composed: true
            }));
        }

    }

    // Scroll fires many times per gesture; coalesce the work into one frame and
    // reuse cached element refs instead of re-querying the shadow root each time.
    _handleScroll(e) {
        this._scrollTarget = e.target;
        if (this._scrollRaf) return;
        this._scrollRaf = requestAnimationFrame(() => {
            this._scrollRaf = null;
            this._applyScroll(this._scrollTarget);
        });
    }

    _applyScroll(target) {
        if (!target) return;
        const scrollTop = target.scrollTop;
        const lite = this.config?.performance?.lite;

        // Decorative parallax (stretchy art + hero fade/scale). Skipped on the
        // low-power profile — it's the heaviest per-frame work here.
        if (!lite) {
            let heroImg = this._heroImgEl;
            if (!heroImg || !heroImg.isConnected) heroImg = this._heroImgEl = this.shadowRoot.querySelector('.hero-banner .hero-bg img');
            if (heroImg) {
                if (scrollTop < 0) {
                    const scale = 1 - scrollTop / 375;
                    heroImg.style.transform = `translateY(${scrollTop}px) scale(${scale})`;
                    heroImg.style.transformOrigin = 'top center';
                } else {
                    heroImg.style.transform = '';
                    heroImg.style.transformOrigin = '';
                }
            }

            if (target.classList.contains('has-hero')) {
                let heroContent = this._heroContentEl;
                if (!heroContent || !heroContent.isConnected) heroContent = this._heroContentEl = this.shadowRoot.querySelector('.hero-content');
                if (heroContent) {
                    heroContent.style.opacity = Math.max(0, 1 - (scrollTop / 200));
                    const scale = 1 - (scrollTop / 1000);
                    if (scale > 0.8) {
                        heroContent.style.transform = `scale(${scale})`;
                        heroContent.style.transformOrigin = 'center center';
                    }
                }
            }
        }

        if (target.classList.contains('has-hero')) {
            let alpha, textAlpha;
            if (this._mobileMql.matches) {
                // Mobile hero is tall (height: auto) and centered, so a fixed
                // 200px threshold fades the header in while the hero is still
                // fully visible. Tie the fade to the actual hero height so the
                // header only starts appearing as the hero scrolls out under it.
                let heroBanner = this._heroBannerEl;
                if (!heroBanner || !heroBanner.isConnected) heroBanner = this._heroBannerEl = this.shadowRoot.querySelector('.hero-banner');
                const heroHeight = heroBanner ? heroBanner.offsetHeight : 375;
                const fadeEnd = Math.max(heroHeight - 100, 1); // ~header height below the hero
                const fadeStart = Math.max(fadeEnd - 80, 0);
                alpha = Math.max(0, Math.min((scrollTop - fadeStart) / (fadeEnd - fadeStart), 1));
                textAlpha = Math.max(0, Math.min((scrollTop - fadeEnd) / 50, 1));
            } else {
                alpha = Math.min(scrollTop / 200, 1);
                textAlpha = Math.max(0, Math.min((scrollTop - 220) / 60, 1));
            }
            this.dispatchEvent(new CustomEvent('header-scroll', {
                detail: {
                    alpha,
                    textAlpha,
                    title: this.data?.name || ''
                },
                bubbles: true,
                composed: true
            }));

            // Infinite Scroll Detection
            if (scrollTop + target.clientHeight >= target.scrollHeight - 200) {
                this.dispatchEvent(new CustomEvent('load-more', { bubbles: true, composed: true }));
            }
        }
    }

    _formatDuration(ms) {
        if (!ms) return '';
        const totalMin = Math.round(ms / 60000);
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        return h > 0 ? `${h}h ${m}m` : `${m} min`;
    }

    render() {
        if (!this.data) return html``;
        const data = this.data;
        let subtitle = data.description || (data.owner ? `By ${data.owner.display_name}` : '');

        // Add Song Count if available
        let songCount = data.total || (data.tracks ? data.tracks.total : null);
        if (songCount !== null && songCount !== undefined) {
            const formattedCount = new Intl.NumberFormat().format(songCount);
            if (subtitle) subtitle += ` • ${formattedCount} songs`;
            else subtitle = `${formattedCount} songs`;
        }

        const isLiked = data.type === 'likedsongs';
        const isAlbum = data.type === 'album';

        // Filter the track list by the active genre pill (Liked Songs only).
        const allItems = data.tracks?.items || [];
        const trackItems = (isLiked && this._activeGenre)
            ? allItems.filter(it => (this._trackGenres[(it.track || it)?.id] || []).includes(this._activeGenre))
            : allItems;

        // Native mobile text stack: description, owner row, "saves • duration".
        const descLine = !isLiked ? (data.description || '') : '';
        const ownerName = !isLiked ? (data.owner?.display_name || '') : '';
        const totalMs = allItems.reduce((s, it) => s + ((it.track || it)?.duration_ms || 0), 0);
        const durStr = this._formatDuration(totalMs);
        const saves = data.followers?.total;
        const savesStr = (saves != null) ? `${new Intl.NumberFormat().format(saves)} saves` : '';
        const metaLine = [savesStr, durStr].filter(Boolean).join(' • ');

        // Shared action buttons (reused across album/playlist/liked layouts).
        const playBtnTpl = html`
            <button class="hero-btn-play" @click=${() => this._handleHeroPlayClick()}>
                ${this._getIsPlaying() ? pauseIcon(28) : playIcon(28)}
            </button>`;
        const pinBtnTpl = (this._pinnedEntity && !isLiked) ? html`
            <button class="hero-pin ${this._isPinned ? 'pinned' : ''}" @click=${this._togglePin} aria-label="${this._isPinned ? 'Unpin' : 'Pin'}" title="${this._isPinned ? 'Unpin' : 'Pin'}">
                <svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>
            </button>` : '';

        try {
            return html`
                <div class="main-scroll-container has-hero ${isLiked ? 'liked-hero' : ''} ${isAlbum ? 'album-hero' : ''}" @scroll=${this._handleScroll}>
                    <div class="hero-banner" style="margin-top: 0; display: block !important; position: relative !important; top: 0; left: 0; z-index: 0;">
                        <div class="hero-bg">
                            ${isLiked
                ? html`<div class="liked-gradient"></div>`
                : html`<img src="${data.images?.[0]?.url}"
                                 style="width: 100%; height: 100%; object-fit: cover; filter: blur(20px) brightness(0.6); transform: scale(1.1); opacity: 0.5;">`}
                        </div>
                        <div class="hero-content">
                        ${!isLiked ? html`
                        <div class="hero-art ${!data.images?.[0]?.url ? 'skeleton-pulse' : ''}" style="${!data.images?.[0]?.url ? 'background-color: #282828;' : ''}">
                            ${data.images?.[0]?.url ? html`
                                <img src="${data.images[0].url}"
                                     class="hero-art-img"
                                     style="opacity: 0; transition: opacity 0.5s ease;"
                                     onload="this.style.opacity = 1; this.parentElement.classList.remove('skeleton-pulse');"
                                     onerror="this.style.display='none'; this.parentElement.classList.add('skeleton-pulse');"
                                >
                            ` : ''}
                        </div>` : ''}
                            <div class="hero-text">
                                <div class="hero-type">${isLiked ? 'Playlist' : data.type}</div>
                                <h1 class="hero-title">${data.name}</h1>
                                ${descLine ? html`<div class="hero-desc">${descLine}</div>` : ''}
                                <div class="hero-subtitle">${subtitle}</div>
                                ${isAlbum && this._artistInfo ? html`
                                    <div class="hero-artist" @click=${this._navigateToArtist} role="button" tabindex="0">
                                        <div class="hero-artist-avatar ${this._artistInfo.image ? '' : 'skeleton-pulse'}"
                                             style="${(this._artistInfo.image || data.images?.[0]?.url) ? `background-image: url('${this._artistInfo.image || data.images[0].url}')` : ''}"></div>
                                        <span class="hero-artist-name">${this._artistInfo.name}</span>
                                    </div>
                                ` : ''}
                                ${isAlbum && this._formatReleaseDate() ? html`
                                    <div class="hero-release">${this._albumTypeLabel()} • ${this._formatReleaseDate()}</div>
                                ` : ''}
                                ${ownerName ? html`
                                    <div class="hero-owner">
                                        <svg viewBox="0 0 168 168" aria-hidden="true"><path fill="#1ed760" d="M84 0C37.6 0 0 37.6 0 84s37.6 84 84 84 84-37.6 84-84S130.4 0 84 0zm38.5 121.2a5.2 5.2 0 0 1-7.2 1.7c-19.6-12-44.3-14.7-73.4-8a5.2 5.2 0 1 1-2.3-10.2c31.8-7.3 59.1-4.2 81.1 9.3a5.2 5.2 0 0 1 1.8 7.2zm10.3-22.9a6.5 6.5 0 0 1-9 2.1c-22.5-13.8-56.7-17.8-83.3-9.8a6.5 6.5 0 1 1-3.8-12.5c30.4-9.2 68.1-4.7 94 11.2a6.5 6.5 0 0 1 2.1 9zm.9-23.8C107 59.6 64.9 58.3 40.7 65.6a7.8 7.8 0 1 1-4.5-15c27.8-8.4 74.3-6.8 103.8 10.7a7.8 7.8 0 1 1-8 13.4z"/></svg>
                                        <span>By&nbsp;<b>${ownerName}</b></span>
                                    </div>` : ''}
                                ${metaLine && !isAlbum ? html`<div class="hero-meta">${metaLine}</div>` : ''}
                                ${isAlbum ? html`
                                    <div class="hero-actions">
                                        <button class="album-save ${this._albumLiked ? 'saved' : ''}" title="${this._albumLiked ? 'Remove from library' : 'Save to library'}" @click=${this._toggleLikeAlbum} aria-label="Save album">
                                            <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                                        </button>
                                        ${pinBtnTpl}
                                        <div class="ha-right">
                                            <button class="hero-btn-icon hero-btn-shuffle" title="Shuffle play" @click=${() => this._handleAlbumShuffle()}>
                                                <svg height="24" width="24" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                                            </button>
                                            ${playBtnTpl}
                                        </div>
                                    </div>
                                ` : html`
                                    <div class="hero-actions">
                                        ${isLiked ? html`
                                            <button class="hero-btn-icon" title="Shuffle play" @click=${() => this._handleShufflePlay()}>
                                                <svg height="24" width="24" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                                            </button>
                                        ` : ''}
                                        ${playBtnTpl}
                                        ${data.type === 'playlist' ? html`
                                            <button class="hero-btn-fav" @click=${this._toggleFollowPlaylist} style="margin-left: 12px; background: transparent; border: 1px solid rgba(255,255,255,0.3); border-radius: 50%; width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: ${this._isFollowing ? '#1DB954' : 'white'}; transition: all 0.2s ease;">
                                                ${heartToggleIcon(this._isFollowing, 28)}
                                            </button>
                                        ` : ''}
                                        ${pinBtnTpl}
                                    </div>
                                `}
                            </div>
                        </div>
                    </div>
                    <div class="content-wrapper">
                        ${isLiked && this._genrePills.length ? html`
                            <div class="genre-pills">
                                ${this._genrePills.map(p => html`
                                    <button class="genre-pill ${this._activeGenre === p.genre ? 'active' : ''}"
                                            @click=${() => this._toggleGenre(p.genre)}>${p.label}</button>
                                `)}
                            </div>
                        ` : ''}
                        <div class="track-list">
                            ${(() => {
                    const playingId = this._getPlayingTrackId();
                    // Keyed rows let Lit reuse existing row DOM when pages are
                    // appended (load-more). Key includes the index because a
                    // playlist may legally contain the same track twice, and
                    // repeat() requires unique keys.
                    return repeat(
                        trackItems,
                        (item, index) => `${(item.track || item)?.id || 'na'}:${index}`,
                        (item, index) => this.renderTrackRow(item.track || item, index + 1, playingId)
                    );
                })()}
                            ${isLiked && this._activeGenre && trackItems.length === 0
                ? html`<div style="padding: 32px 16px; text-align: center; color: var(--spf-text-sub);">No liked songs match this filter yet.</div>`
                : ''}
                        </div>
                    </div>
                </div>
            `;
        } catch (e) {
            console.error('[PlaylistView] RENDER ERROR:', e);
            return html`<div style="padding: 20px; color: red;">Error Rendering View: ${e.message}</div>`;
        }
    }

    renderTrackRow(track, index, playingId = null) {
        if (!track) return ''; // Safety check
        try {
            const isAlbum = this.data?.type === 'album';
            const isPlaying = !!playingId && track.id === playingId;

            return renderTrackRowTemplate(
                track,
                index,
                (e, t) => this._handleTrackClick(e, t, index - 1),
                {
                    layout: 'playlist',
                    isPlaying,
                    isAlbum,
                    liked: !!this._trackLikes[track.id],
                    onSave: (e, t) => this._handleSaveTrack(e, t),
                    onQueue: (e, t) => this._handleQueueTrack(e, t),
                    onMenu: (e, trackData) => this._handleTrackMenu(e, trackData),
                }
            );
        } catch (e) {
            console.error('[PlaylistView] Track Render Error:', e, track);
            return html`<div class="track-row error">Error loading track</div>`;
        }
    }

    _handleTrackMenu(e, trackData) {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('open-track-menu', {
            detail: trackData,
            bubbles: true,
            composed: true
        }));
    }

    async _checkTrackLikes() {
        if (!this.api || !this.data?.tracks?.items) return;
        const ids = this.data.tracks.items
            .map(item => (item.track || item)?.id)
            .filter(Boolean);
        if (ids.length === 0) return;

        const results = await this.api.checkTrackFavorites(ids);
        if (results && typeof results === 'object') {
            this._trackLikes = { ...this._trackLikes, ...results };
        }
    }

    /**
     * Liked Songs filter pills. Spotify's native mood pills aren't exposed by
     * SpotifyPlus, so we approximate them with artist genres. This runs in the
     * background, is bounded + cached, and never blocks the track list: if no
     * genres come back the pills row simply stays hidden.
     */
    async _enrichGenres() {
        // Low-power profile: skip the background artist lookups + pill rebuilds.
        if (this.config?.performance?.lite) return;
        if (this._enrichingGenres) return;
        const items = this.data?.tracks?.items;
        if (!this.api || !items?.length) return;

        // Map each track to its artists' ids; collect unenriched artist ids.
        if (!this._enrichedArtists) this._enrichedArtists = new Set();
        const pending = new Set();
        for (const entry of items) {
            const track = entry.track || entry;
            const ids = (track.artists || []).map(a => a?.id).filter(Boolean);
            for (const id of ids) {
                if (!this._enrichedArtists.has(id)) pending.add(id);
            }
        }
        // Bound the work: at most ~24 new artist lookups per pass.
        const toFetch = [...pending].slice(0, 24);
        if (toFetch.length === 0) { this._rebuildGenrePills(); return; }

        if (!this._artistGenreLocal) this._artistGenreLocal = new Map();
        this._enrichingGenres = true;
        try {
            const CONCURRENCY = 4;
            for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
                const slice = toFetch.slice(i, i + CONCURRENCY);
                const results = await Promise.all(slice.map(id => this.api.getArtistGenres(id)));
                slice.forEach((id, idx) => {
                    this._artistGenreLocal.set(id, results[idx] || []);
                    this._enrichedArtists.add(id);
                });
                if (!this.isConnected) return;
            }

            // Attach genres to each track we can resolve from what we've enriched.
            for (const entry of items) {
                const track = entry.track || entry;
                if (!track?.id || this._trackGenres[track.id]) continue;
                const genres = new Set();
                for (const a of (track.artists || [])) {
                    for (const g of (this._artistGenreLocal.get(a?.id) || [])) genres.add(g);
                }
                if (genres.size) this._trackGenres[track.id] = [...genres];
            }
            this._rebuildGenrePills();
        } finally {
            this._enrichingGenres = false;
        }
    }

    /** Tally enriched genres and expose the most common as filter pills. */
    _rebuildGenrePills() {
        const counts = new Map();
        for (const genres of Object.values(this._trackGenres)) {
            for (const g of genres) counts.set(g, (counts.get(g) || 0) + 1);
        }
        const pills = [...counts.entries()]
            .filter(([, n]) => n >= 2) // ignore one-off genres
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([genre]) => ({ genre, label: this._titleCase(genre) }));
        // Drop an active filter that no longer exists.
        if (this._activeGenre && !pills.some(p => p.genre === this._activeGenre)) {
            this._activeGenre = null;
        }
        this._genrePills = pills;
    }

    _titleCase(s) {
        return String(s).replace(/\b\w/g, c => c.toUpperCase());
    }

    _toggleGenre(genre) {
        this._activeGenre = this._activeGenre === genre ? null : genre;
    }

    async _handleSaveTrack(e, track) {
        e.stopPropagation();
        if (!this.api || !track?.id) return;

        const wasLiked = !!this._trackLikes[track.id];
        const nowLiked = !wasLiked;

        // Optimistic toggle
        this._trackLikes = { ...this._trackLikes, [track.id]: nowLiked };

        const res = nowLiked
            ? await this.api.saveTrackFavorites(track.id)
            : await this.api.removeTrackFavorites(track.id);

        if (!res.success) {
            // Revert on failure
            this._trackLikes = { ...this._trackLikes, [track.id]: wasLiked };
            this.dispatchEvent(new CustomEvent('show-toast', {
                detail: { message: nowLiked ? 'Failed to save track' : 'Failed to remove track' },
                bubbles: true, composed: true
            }));
            return;
        }

        this.dispatchEvent(new CustomEvent('show-toast', {
            detail: { message: nowLiked ? 'Added to Liked Songs' : 'Removed from Liked Songs' },
            bubbles: true, composed: true
        }));

        // Verify against the server after a moment in case of races
        if (this._likeVerifyTimer) clearTimeout(this._likeVerifyTimer);
        this._likeVerifyTimer = setTimeout(async () => {
            if (!this.isConnected) return;
            const confirmed = await this.api.checkTrackFavorites(track.id);
            if (typeof confirmed === 'boolean' && confirmed !== this._trackLikes[track.id]) {
                this._trackLikes = { ...this._trackLikes, [track.id]: confirmed };
            }
        }, 3000);
    }

    async _handleQueueTrack(e, track) {
        e.stopPropagation();
        if (!this.api || !track?.uri) return;
        const res = await this.api.addToQueue(track.uri);
        this.dispatchEvent(new CustomEvent('show-toast', {
            detail: { message: res?.success ? 'Added to queue' : 'Failed to add to queue' },
            bubbles: true, composed: true
        }));
    }

    async _handleTrackClick(e, track, position = null) {
        if (e.target.closest('button')) return; // Ignore button clicks

        const contextType = this.data.type;

        // Sonos needs offset_position (the track's 0-based index in the context)
        // since it rejects offset_uri. The rendered index maps directly to the
        // context position for albums/playlists; only pass it when the list isn't
        // genre-filtered (Liked Songs), where the index wouldn't match the context.
        const offsetPos = (position != null && !this._activeGenre) ? position : null;

        // Optimistic: assume this row is now playing and reflect it immediately;
        // HASS will confirm (and the handoff in updated() clears the guess).
        this._optimisticPlayingTrackId = track.id;
        this._optimisticPlayState = 'playing';
        if (this._optimisticTrackTimer) clearTimeout(this._optimisticTrackTimer);
        this._optimisticTrackTimer = setTimeout(() => {
            this._optimisticPlayingTrackId = null;
            this._optimisticPlayState = null;
        }, 8000); // safety: clear if HASS never catches up

        if (contextType === 'likedsongs') {
            // Play the whole Liked Songs collection starting at this track so
            // playback continues through the library. The collection is only a
            // playable context when the URI carries the real user id (the `me`
            // shorthand is not playable), so resolve it here. If Spotify rejects
            // the collection context/offset, playMedia falls back to single-track.
            const userId = await this.api.getCurrentUserId();
            if (userId) {
                const collectionUri = `spotify:user:${userId}:collection`;
                await this.api.playMedia(collectionUri, 'playlist', null, { offset_uri: track.uri, offset_position: offsetPos });
            } else {
                await this.api.playMedia(track.uri, 'track');
            }
        } else {
            // For Playlists/Albums, play context with offset
            await this.api.playMedia(this.data.uri, contextType, null, { offset_uri: track.uri, offset_position: offsetPos });
        }
    }

    async _playContext(uri, type = 'playlist') {
        if (!uri || !this.api) return;
        await this.api.playMedia(uri, type);
    }

    _handleShufflePlay() {
        // Favorites playback already shuffles; reflect optimistically and play.
        this._optimisticPlayState = 'playing';
        if (this._optimisticTimer) clearTimeout(this._optimisticTimer);
        this._optimisticTimer = setTimeout(() => { this._optimisticPlayState = null; }, 3000);
        this._playContext(this.data.uri, this.data.type);
    }

    _handleHeroPlayClick() {
        fireHaptic('light');
        const isPlaying = this._getIsPlaying();
        const newState = isPlaying ? 'paused' : 'playing';

        // Optimistic Update
        this._optimisticPlayState = newState;

        // Clear optimistic state after 3s to let HASS catch up or revert if failed
        if (this._optimisticTimer) clearTimeout(this._optimisticTimer);
        this._optimisticTimer = setTimeout(() => {
            this._optimisticPlayState = null;
        }, 3000);

        if (newState === 'playing') {
            this._playContext(this.data.uri, this.data.type);
        } else {
            this.api.togglePlayback(false);
        }
    }

    async _toggleFollowPlaylist(e) {
        e.stopPropagation();
        const playlistId = this.data?.id;
        if (!playlistId || !this.api) return;

        const optimisticState = !this._isFollowing;
        this._isFollowing = optimisticState; // Optimistic update

        let res;
        if (optimisticState) {
            res = await this.api.followPlaylist(playlistId);
        } else {
            res = await this.api.unfollowPlaylist(playlistId);
        }

        if (!res.success) {
            this._isFollowing = !optimisticState; // Revert on failure
            this.dispatchEvent(new CustomEvent('show-toast', {
                detail: { message: `Failed to ${optimisticState ? 'follow' : 'unfollow'} playlist.` },
                bubbles: true,
                composed: true
            }));
        } else {
            this.dispatchEvent(new CustomEvent('show-toast', {
                detail: { message: `${optimisticState ? 'Added to' : 'Removed from'} your library.` },
                bubbles: true,
                composed: true
            }));
        }
    }

    /* --- ALBUM HERO LOGIC --- */

    async _checkAlbumLike() {
        if (!this.api || !this.data?.id) return;
        try {
            const res = await this.api.checkAlbumFavorites(this.data.id);
            if (typeof res === 'boolean') this._albumLiked = res;
            else if (res && typeof res === 'object') this._albumLiked = res[this.data.id] === true;
        } catch (e) { /* leave default */ }
    }

    async _fetchArtistInfo() {
        const artist = this.data?.artists?.[0];
        if (!artist?.id) { this._artistInfo = null; return; }
        // Album data can update twice (album then tracks) — don't re-fetch / flash
        // the avatar if we already have this artist.
        if (this._artistInfo?.id === artist.id) return;
        // Show the name immediately; hydrate the avatar image in the background.
        this._artistInfo = { id: artist.id, name: artist.name, image: '' };
        if (!this.api) return;
        try {
            const res = await this.api.fetchSpotifyPlus('get_artist', { artist_id: artist.id });
            const img = res?.result?.images?.[0]?.url;
            if (img && this._artistInfo?.id === artist.id) {
                this._artistInfo = { ...this._artistInfo, image: img };
            }
        } catch (e) { /* name-only is fine */ }
    }

    async _toggleLikeAlbum(e) {
        if (e) e.stopPropagation();
        if (!this.api || !this.data?.id) return;
        fireHaptic('success');
        const next = !this._albumLiked;
        this._albumLiked = next; // optimistic
        const res = next
            ? await this.api.saveAlbumFavorites(this.data.id)
            : await this.api.removeAlbumFavorites(this.data.id);
        if (!res || res.success === false) {
            this._albumLiked = !next; // revert
            this.dispatchEvent(new CustomEvent('show-toast', {
                detail: { message: 'Failed to update your library.' }, bubbles: true, composed: true
            }));
        } else {
            this.dispatchEvent(new CustomEvent('show-toast', {
                detail: { message: next ? 'Added to your library.' : 'Removed from your library.' },
                bubbles: true, composed: true
            }));
        }
    }

    _handleAlbumShuffle() {
        fireHaptic('light');
        this._optimisticPlayState = 'playing';
        if (this._optimisticTimer) clearTimeout(this._optimisticTimer);
        this._optimisticTimer = setTimeout(() => { this._optimisticPlayState = null; }, 3000);
        // Turn shuffle on, then play the album context.
        try { this.api?.fetchSpotifyPlus('player_shuffle', { state: 'true' }, false); } catch (_) {}
        this._playContext(this.data.uri, this.data.type);
    }

    _navigateToArtist(e) {
        if (e) e.stopPropagation();
        const id = this._artistInfo?.id || this.data?.artists?.[0]?.id;
        if (!id) return;
        const name = this._artistInfo?.name || this.data?.artists?.[0]?.name || '';
        this.dispatchEvent(new CustomEvent('navigate', {
            detail: { pageId: `artist:${id}`, data: { title: name, type: 'artist', subtitle: 'Artist' } },
            bubbles: true, composed: true
        }));
    }

    _albumTypeLabel() {
        const t = this.data?.album_type || this.data?.type || 'album';
        const total = this.data?.total_tracks || this.data?.tracks?.total || this.data?.tracks?.items?.length || 0;
        if (t === 'single') return (total > 1 && total <= 6) ? 'EP' : 'Single';
        if (t === 'compilation') return 'Compilation';
        if (t === 'album' && total > 0 && total <= 6) return 'EP'; // Spotify marks short EPs as albums
        return 'Album';
    }

    _formatReleaseDate() {
        const rd = this.data?.release_date;
        if (!rd) return '';
        const prec = this.data?.release_date_precision;
        if (prec === 'year' || /^\d{4}$/.test(rd)) return rd.slice(0, 4);
        const d = new Date(rd);
        if (isNaN(d.getTime())) return rd;
        const sameYear = d.getFullYear() === new Date().getFullYear();
        const opts = sameYear
            ? { month: 'short', day: 'numeric' }
            : { month: 'short', day: 'numeric', year: 'numeric' };
        return d.toLocaleDateString(undefined, opts);
    }
}

customElements.define('spotify-playlist-view', SpotifyPlaylistView);
