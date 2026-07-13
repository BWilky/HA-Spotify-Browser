import { LitElement, html, css } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { renderCardTemplate, renderPillTemplate, renderCardSkeletonTemplate, renderPillSkeletonTemplate } from '../media-templates.js';
import { contextViewStyles } from '../../styles/spotify-context-view.styles.js';
import { playIcon, pauseIcon, pinIcon } from '../common/icons.js';

export class SpotifyArtistView extends LitElement {
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
                .artist-hero { 
                    height: 375px !important; 
                    min-height: 375px !important; 
                    max-height: 375px !important;
                    display: block !important;
                    position: relative !important;
                    margin-top: 0 !important;
                    width: 100% !important;
                    overflow: visible !important;
                }
                /* Ensure this specific element behaves as expected */
                .artist-hero .hero-bg {
                     height: 100% !important;
                     overflow: visible !important;
                }
                .content-wrapper {
                    padding: 12px;
                    padding-bottom: 100px;
                    position: relative;
                    background: var(--spf-bg); 
                }
                .hero-bg, .hero-bg img { width: 100%; height: 100%; object-fit: cover; }

                /* Pin button — same styling as the playlist header: outlined
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
            `
        ];
    }

    static get properties() {
        return {
            hass: { type: Object },
            data: { type: Object },
            api: { type: Object },
            config: { type: Object },
            pinned: { type: Object }, // Add pinned
            // Narrow values derived from hass by the parent context-view; these
            // (not raw hass) drive re-renders on player state ticks.
            playingTrackId: { type: String },
            currentTrackId: { type: String },
            isPlaying: { type: Boolean },
            _isFollowing: { type: Boolean, state: true },
            _currentUserId: { type: String, state: true },
            _isPinned: { type: Boolean, state: true },
            _pinnedEntity: { type: String, state: true },
            _trackLikes: { type: Object, state: true }, // Map of trackId -> boolean
            _optimisticPlayingTrackId: { type: String, state: true },
            _optimisticPlayState: { type: String, state: true } // 'playing', 'paused', or null
        };
    }

    constructor() {
        super();
        this.hass = null;
        this.playingTrackId = null;
        this.currentTrackId = null;
        this.isPlaying = false;
        this._isPinned = false;
        this._pinnedEntity = null;
        this._trackLikes = {};
        this._optimisticPlayingTrackId = null;
        this._optimisticPlayState = null;
        this._currentHassIdAtClick = null;
    }

    connectedCallback() {
        super.connectedCallback();
        this._checkPinStatus();
    }



    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._optimisticTimer) clearTimeout(this._optimisticTimer);
        if (this._optimisticContextTimer) clearTimeout(this._optimisticContextTimer);
        if (this._scrollRaf) cancelAnimationFrame(this._scrollRaf);
        this._optimisticTimer = null;
        this._optimisticContextTimer = null;
        this._scrollRaf = null;
    }

    /**
     * Raw `hass` is kept only as an interaction-time reference; re-renders on
     * player ticks are driven by the derived props (playingTrackId, isPlaying,
     * currentTrackId) the parent context-view maintains.
     */
    shouldUpdate(changedProperties) {
        if (changedProperties.size === 1 && changedProperties.has('hass')) return false;
        return true;
    }

    updated(changedProperties) {
        if (changedProperties.has('data')) {
            this._checkPinStatus();
            this._checkFollowStatus();
            this._checkTrackLikes();
        }

        // --- STATE HANDOFF LOGIC ---
        // Clear the optimistic track once HASS catches up to it. We intentionally do NOT
        // clear on other track changes: HASS can report intermediate IDs during a skip,
        // which would make the UI revert briefly.
        if (this._optimisticPlayingTrackId && changedProperties.has('currentTrackId')) {
            if (this.currentTrackId === this._optimisticPlayingTrackId) {
                this._optimisticPlayingTrackId = null;
            }
        }

        // Check header state on updates (handles back navigation scroll restoration)
        setTimeout(() => this._updateHeaderState(), 0);
    }

    _getPlayingTrackId() {
        // Optimistic state wins for immediate feedback
        if (this._optimisticPlayingTrackId) {
            return this._optimisticPlayingTrackId;
        }
        return this.playingTrackId || null;
    }

    _getIsPlaying() {
        if (this._optimisticPlayState) {
            return this._optimisticPlayState === 'playing';
        }
        return !!this.isPlaying;
    }

    _handleHeroPlayClick() {
        // Different logic than top tracks. This plays the CONTEXT.
        const isPlaying = this._getIsPlaying();
        const newState = isPlaying ? 'paused' : 'playing';

        // Optimistic Update
        this._optimisticPlayState = newState;

        // Clear optimistic state after 3s
        if (this._optimisticContextTimer) clearTimeout(this._optimisticContextTimer);
        this._optimisticContextTimer = setTimeout(() => {
            this._optimisticPlayState = null;
        }, 3000);

        if (newState === 'playing') {
            this._playContext(this.data.uri, 'artist');
        } else {
            this.api.togglePlayback(false);
        }
    }

    async _checkPinStatus() {
        if (!this.pinned || !this.data) return;

        // The pin button is an edit action — only for users who can write.
        if (!this.pinned.canEdit()) {
            this._pinnedEntity = null;
            return;
        }

        const items = await this.pinned.getItems();
        this._isPinned = !!items.find(i => i.id === this.data.id);
        this._pinnedEntity = this.pinned.sensorEntity;
    }

    _getHassTrackId() {
        return this.currentTrackId || null;
    }

    async _checkFollowStatus() {
        if (!this.api || !this.data) return;
        const isFollowing = await this.api.checkArtistsFollowing(this.data.id);
        if (isFollowing !== null) {
            this._isFollowing = isFollowing;
        }
    }

    async _toggleFollow() {
        if (!this.api || !this.data) return;

        // Optimistic UI Update
        const oldState = this._isFollowing;
        const newState = !oldState;
        this._isFollowing = newState;

        // Call API
        let result;
        if (newState) {
            result = await this.api.followArtist(this.data.id);
        } else {
            result = await this.api.unfollowArtist(this.data.id);
        }

        if (!result.success) {
            // Revert on immediate failure
            this._isFollowing = oldState;
            this.dispatchEvent(new CustomEvent('show-alert', {
                detail: {
                    title: "Follow Action Failed",
                    message: "Failed to update follow status.",
                    confirmText: "OK",
                    size: 'mini'
                },
                bubbles: true,
                composed: true
            }));
            return;
        }

        // Verification after 3 seconds
        setTimeout(async () => {
            if (!this.isConnected) return;
            const confirmedState = await this.api.checkArtistsFollowing(this.data.id);
            if (confirmedState !== null && confirmedState !== newState) {
                console.warn("[SpotifyArtistView] Follow state mismatch detected after verification. Correcting.");
                this._isFollowing = confirmedState;
            }
        }, 3000);
    }

    async _togglePin() {
        if (!this._pinnedEntity || !this.pinned) return;

        const item = {
            id: this.data.id,
            type: this.data.type,
            name: this.data.name || this.data.title,
            images: this.data.images,
            uri: this.data.uri
        };

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

    async _checkTrackLikes() {
        if (!this.api || !this.data || !this.data.topTracks) return;

        const trackIds = this.data.topTracks.map(t => t.id || t.track?.id).filter(Boolean);
        if (trackIds.length === 0) return;

        const results = await this.api.checkTrackFavorites(trackIds);
        if (results) {
            this._trackLikes = { ...this._trackLikes, ...results };
        }
    }

    async _toggleTrackLike(track, e) {
        if (e) e.stopPropagation();
        if (!this.api || !track) return;

        const isLiked = !!this._trackLikes[track.id];
        const newState = !isLiked;

        // Optimistic Update
        this._trackLikes = { ...this._trackLikes, [track.id]: newState };

        let result;
        if (newState) {
            result = await this.api.saveTrackFavorites(track.id);
        } else {
            result = await this.api.removeTrackFavorites(track.id);
        }

        if (!result.success) {
            // Revert
            this._trackLikes = { ...this._trackLikes, [track.id]: isLiked };
            this.dispatchEvent(new CustomEvent('show-alert', {
                detail: {
                    title: "Action Failed",
                    message: "Failed to update favorite.",
                    confirmText: "OK",
                    size: 'mini'
                },
                bubbles: true,
                composed: true
            }));
            return;
        }

        // Verification
        setTimeout(async () => {
            if (!this.isConnected) return;
            const confirmedState = await this.api.checkTrackFavorites(track.id);
            if (confirmedState !== null && confirmedState !== newState) {
                console.warn(`[SpotifyArtistView] Track like mismatch for ${track.id}. Correcting.`);
                this._trackLikes = { ...this._trackLikes, [track.id]: confirmedState };
            }
        }, 3000);
    }

    // Scroll fires many times per gesture; coalesce the work into one frame and
    // reuse cached element refs instead of re-querying the shadow root each time.
    _handleScroll(e) {
        this._scrollTarget = e.currentTarget || e.target;
        if (this._scrollRaf) return;
        this._scrollRaf = requestAnimationFrame(() => {
            this._scrollRaf = null;
            this._applyScroll(this._scrollTarget);
        });
    }

    _applyScroll(container) {
        if (container) {
            const scrollTop = container.scrollTop;
            let heroImg = this._heroImgEl;
            if (!heroImg || !heroImg.isConnected) heroImg = this._heroImgEl = this.shadowRoot.querySelector('.artist-hero .hero-bg img');
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
        }
        this._updateHeaderState();
    }

    updateHeaderState() {
        this._updateHeaderState();
    }

    _updateHeaderState() {
        let scrollContainer = this._scrollContainerEl;
        if (!scrollContainer || !scrollContainer.isConnected) scrollContainer = this._scrollContainerEl = this.shadowRoot.querySelector('.main-scroll-container');
        if (!scrollContainer) return;

        const scrollTop = scrollContainer.scrollTop;
        const fadeEnd = 200; // Pixel value where header becomes fully opaque

        let alpha = Math.min(1, scrollTop / fadeEnd);
        let textAlpha = 0;
        if (scrollTop > fadeEnd - 50) {
            textAlpha = Math.min(1, (scrollTop - (fadeEnd - 50)) / 50);
        }

        this.dispatchEvent(new CustomEvent('header-scroll', {
            detail: {
                alpha,
                title: this.data?.name || '',
                textAlpha
            },
            bubbles: true,
            composed: true
        }));
    }

    _playPopularTrack(startTrack) {
        if (!startTrack || !this.api || !this.data || !this.data.topTracks) return;

        // 1. Create a copy of the tracks array
        const tracks = [...this.data.topTracks];

        // 2. Find and remove the start track from the list
        // startTrack is the normalized track object passed from the click handler
        const startId = startTrack.id;
        const startIndex = tracks.findIndex(t => (t.id === startId) || (t.track && t.track.id === startId));

        if (startIndex === -1) return;

        // --- OPTIMISTIC UI START ---
        // Capture state BEFORE optimistic update
        this._currentHassIdAtClick = this._getHassTrackId();

        // Clear any pending safety timer from previous clicks
        if (this._optimisticTimer) {
            clearTimeout(this._optimisticTimer);
            this._optimisticTimer = null;
        }

        this._optimisticPlayingTrackId = startId;

        // Safety Timeout (8s): If HASS never updates (e.g. failure), clear state eventually
        this._optimisticTimer = setTimeout(() => {
            if (this._optimisticPlayingTrackId === startId) {
                this._optimisticPlayingTrackId = null;
            }
        }, 8000);
        // ---------------------------

        const [first] = tracks.splice(startIndex, 1);

        // 3. Shuffle the remaining tracks (Fisher-Yates)
        for (let i = tracks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
        }

        // 4. Combine: Start Track + Shuffled Rest
        const queueTracks = [first, ...tracks];

        // 5. Extract URIs
        const uris = queueTracks.map(t => t.uri || t.track?.uri).filter(Boolean);

        if (uris.length === 0) return;

        // 6. Play List
        // We explicitly disable player shuffle so it respects our manually shuffled order (Start Track first).
        this.api.playMedia(uris, 'track', null, { shuffle: false });
    }

    _playContext(uri, type = 'artist') {
        if (!uri || !this.api) return;
        this.api.playMedia(uri, type);
    }

    _navigateToAlbum(album, e) {
        if (e) e.stopPropagation();
        this.dispatchEvent(new CustomEvent('navigate', {
            detail: {
                pageId: `album:${album.id}`,
                data: album
            },
            bubbles: true,
            composed: true
        }));
    }

    _navigateToArtist(artist, e) {
        if (e) e.stopPropagation();
        this.dispatchEvent(new CustomEvent('navigate', {
            detail: {
                pageId: `artist:${artist.id}`,
                data: artist
            },
            bubbles: true,
            composed: true
        }));
    }

    render() {
        if (!this.data) return html`<div class="loading-spinner"></div>`;
        return this.renderArtistProfile(this.data);
    }

    renderArtistProfile(data) {
        return html`
            <div class="main-scroll-container has-hero" @scroll=${this._handleScroll}>
                <div class="artist-hero">
                    <div class="hero-bg skeleton-pulse">
                         <img src="${data.images?.[0]?.url}" 
                             style="width: 100%; height: 100%; object-fit: cover; object-position: center 20%; opacity: 0; transition: opacity 0.5s ease;"
                             onload="this.style.opacity = 1; this.parentElement.classList.remove('skeleton-pulse');"
                        >
                    </div>
                    <div class="hero-gradient"></div>
                    <div class="artist-header-content">
                        <h1 class="artist-hero-name">${data.name}</h1>
                        <div class="hero-stats">
                            ${data.followers?.total ? html`<span>${data.followers.total.toLocaleString()} followers</span>` : ''}
                            ${data.genres?.length ? html`<span> • ${data.genres.slice(0, 3).join(', ')}</span>` : ''}
                        </div>
                        <div class="hero-actions">
                            <button class="hero-btn-play" @click=${() => this._handleHeroPlayClick()}>
                                ${this._getIsPlaying() ? pauseIcon(28) : playIcon(28)}
                            </button>
                            <button 
                                class="hero-btn-fav" 
                                @click=${this._toggleFollow}
                                style="${this._isFollowing ? 'border-color: var(--spf-brand); color: var(--spf-brand);' : ''}"
                            >
                                ${this._isFollowing ? 'FOLLOWING' : 'FOLLOW'}
                            </button>

                            ${this._pinnedEntity ? html`
                                <button class="hero-pin ${this._isPinned ? 'pinned' : ''}" @click=${this._togglePin}
                                        aria-label="${this._isPinned ? 'Unpin' : 'Pin'}" title="${this._isPinned ? 'Unpin' : 'Pin'}">
                                    ${pinIcon}
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
                <div class="content-wrapper">
                    ${data.topTracks === null || data.topTracks?.length ? html`
                        <section class="artist-section">
                            <h2>Popular</h2>
                            <div class="artist-track-grid">
                                ${data.topTracks === null
                    ? Array(5).fill(0).map(() => renderPillSkeletonTemplate())
                    : data.topTracks.map((item, index) => this.renderArtistTopTrack(item.track || item))
                }
                            </div>
                        </section>
                    ` : ''}
                    
                    ${data.albums === null || data.albums?.length ? html`
                        <section class="artist-section">
                            <div class="section-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                                <h2 style="margin: 0;">Discography</h2>
                                <button class="see-all-btn" @click=${() => this.dispatchEvent(new CustomEvent('navigate', { detail: { pageId: `artist-discography:${data.id}`, data: { name: data.name, id: data.id } }, bubbles: true, composed: true }))} style="background: none; border: none; color: #b3b3b3; font-size: var(--spf-text-sm, 12px); font-weight: 700; letter-spacing: 1px; cursor: pointer; text-transform: uppercase;">SEE ALL</button>
                            </div>
                            <div class="carousel-wrapper">
                                 <div class="carousel-layout">
                                    ${data.albums === null
                    ? Array(5).fill(0).map(() => renderCardSkeletonTemplate())
                    : data.albums.map(album => renderCardTemplate(album, 'album', (e) => this._navigateToAlbum(album, e)))
                }
                                 </div>
                            </div>
                        </section>
                    ` : ''}

                    ${data.playlists === undefined || data.playlists?.length ? html`
                        <section class="artist-section">
                            <h2>Appears On</h2>
                            <div class="carousel-wrapper">
                                <div class="carousel-layout">
                                    ${!data.playlists
                    ? Array(5).fill(0).map(() => renderCardSkeletonTemplate())
                    : data.playlists.map(playlist => renderCardTemplate(playlist, 'playlist', () => {
                        this.dispatchEvent(new CustomEvent('navigate', { detail: { pageId: `playlist:${playlist.id}`, data: playlist }, bubbles: true, composed: true }));
                    }))
                }
                                </div>
                            </div>
                        </section>
                    ` : ''}

                    ${data.similarArtists === null || data.similarArtists?.length ? html`
                        <section class="artist-section">
                            <h2>Fans Also Like</h2>
                            <div class="carousel-wrapper">
                                <div class="carousel-layout circle-cards">
                                    ${data.similarArtists === null
                    ? Array(5).fill(0).map(() => renderCardSkeletonTemplate())
                    : data.similarArtists.map(artist => renderCardTemplate(artist, 'artist', (e) => this._navigateToArtist(artist, e)))
                }
                                </div>
                            </div>
                        </section>
                    ` : ''}
                </div>
            </div>
        `;
    }

    renderArtistTopTrack(track) {
        const isLiked = !!this._trackLikes[track.id];

        // Unified playback check
        const currentPlayingId = this._getPlayingTrackId();
        const isPlaying = currentPlayingId === track.id;

        return renderPillTemplate(
            track,
            (e) => this._playPopularTrack(track),
            (e) => {
                e.preventDefault();
                e.stopPropagation();

                const image = track.album?.images?.[0]?.url;
                const trackData = {
                    name: track.name,
                    artist: track.artists ? track.artists.map(a => a.name).join(', ') : '',
                    album: track.album?.name || '',
                    uri: track.uri,
                    id: track.id,
                    image,
                    anchor: e.currentTarget.getBoundingClientRect(),
                };

                this.dispatchEvent(new CustomEvent('open-track-menu', {
                    detail: trackData,
                    bubbles: true,
                    composed: true
                }));
            },
            (e) => this._toggleTrackLike(track, e),
            isLiked,
            isPlaying
        );
    }
}

customElements.define('spotify-artist-view', SpotifyArtistView);
