import { LitElement, html, css } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { contextViewStyles } from '../../styles/spotify-context-view.styles.js';

export class SpotifyPlaylistView extends LitElement {
    static get properties() {
        return {
            data: { type: Object },
            api: { type: Object },
            hass: { type: Object },
            config: { type: Object },
            pinned: { type: Object }, // Add pinned
            _isFollowing: { type: Boolean, state: true },
            _currentUserId: { type: String, state: true },
            _isPinned: { type: Boolean, state: true },
            _pinnedEntity: { type: String, state: true },
            _optimisticPlayState: { type: String, state: true } // 'playing', 'paused', or null
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
                }
                .content-wrapper {
                    padding: 12px;
                    padding-bottom: 100px;
                    position: relative;
                    background: var(--spf-bg); 
                }
                .hero-bg, .hero-bg img { width: 100%; height: 100%; object-fit: cover; }

                /* Hero Content Layout */
                .hero-content { 
                    position: absolute; bottom: 0; left: 0; width: 100%; 
                    z-index: 2; padding: 24px; box-sizing: border-box;
                    display: flex; align-items: flex-end; gap: 24px;
                }
                .hero-art { 
                    width: 220px; height: 220px; 
                    box-shadow: 0 4px 60px rgba(0,0,0,0.5); 
                    background: #282828; flex-shrink: 0; 
                    position: relative;
                }
                .hero-art-img { width: 100%; height: 100%; object-fit: cover; }
                
                .hero-text { flex: 1; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
                .hero-type { font-size: 12px; text-transform: uppercase; font-weight: 700; margin-bottom: 4px; }
                .hero-title { font-size: 3rem; font-weight: 900; margin: 0 0 8px 0; line-height: 1; }
                .hero-subtitle { font-size: 14px; color: rgba(255,255,255,0.7); }
                .hero-actions { display: flex; align-items: center; gap: 16px; margin-top: 16px; }

                .hero-btn-play {
                    width: 56px; height: 56px; border-radius: 50%; background: var(--spf-brand); color: black; border: none;
                    display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.2s;
                }
                .hero-btn-play:hover { transform: scale(1.05); background: var(--spf-brand-hover); }
                .hero-btn-play svg { width: 28px; height: 28px; fill: currentColor; }
            `
        ];
    }

    constructor() {
        super();
        this._isFollowing = false;
        this._currentUserId = null;
        this._isPinned = false;
        this._pinnedEntity = null;
        this._optimisticPlayState = null;
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
        this._optimisticTimer = null;
    }

    updated(changedProperties) {
        if (changedProperties.has('data')) {
            this._checkFollowStatus();
            this._checkPinStatus();
        }

        // Check for HASS updates to the Pinned Items helper
        if (changedProperties.has('hass') && this.pinned && this.pinned.sensorEntity) {
            const oldHass = changedProperties.get('hass');
            const entityId = this.pinned.sensorEntity;
            if (oldHass && this.hass && oldHass.states[entityId] !== this.hass.states[entityId]) {
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
    // --- PINNED ITEMS LOGIC ---
    async _checkPinStatus() {
        if (!this.pinned || !this.data) return;

        // Use manager direct access with availability check
        if (!this.pinned.checkAvailability()) {
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
        // 1. Check Optimistic State
        if (this._optimisticPlayState) {
            return this._optimisticPlayState === 'playing';
        }

        // 2. Check Real State
        if (!this.hass || !this.config || !this.config.entity) return false;
        const stateObj = this.hass.states[this.config.entity];
        if (!stateObj) return false;

        if (stateObj.state !== 'playing') return false;

        const attrs = stateObj.attributes;
        const currentUri = this.data.uri;

        // 3. Check for specific context match (User Request)
        if (attrs.media_context_content_id === currentUri) return true;

        // 4. Fallback: media_content_id matches URI (unlikely for playlists but possible for albums sometimes?)
        // Or if media_content_type matches and media_content_id matches?
        // Note: For Spotify, media_content_id is usually a track URI.
        // But let's check it anyway just in case the integration logic differs.
        if (attrs.media_content_id === currentUri) return true;

        return false;
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
                name: this.data.name,
                images: this.data.images,
                uri: this.data.uri,
                description: this.data.description
            };
        }

        const result = await this.pinned.toggle(item);

        if (result.success) {
            this._isPinned = !this._isPinned;
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

    _handleScroll(e) {
        const target = e.target;
        const scrollTop = target.scrollTop;
        if (target.classList.contains('has-hero')) {
            const alpha = Math.min(scrollTop / 200, 1);
            const textAlpha = Math.max(0, Math.min((scrollTop - 220) / 60, 1));

            const heroContent = this.shadowRoot.querySelector('.hero-content');
            if (heroContent) {
                const heroOp = Math.max(0, 1 - (scrollTop / 200));
                heroContent.style.opacity = heroOp;
                const scale = 1 - (scrollTop / 1000);
                if (scale > 0.8) {
                    heroContent.style.transform = `scale(${scale})`;
                    heroContent.style.transformOrigin = 'center center';
                }
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
            const threshold = 200;
            if (target.scrollTop + target.clientHeight >= target.scrollHeight - threshold) {
                this.dispatchEvent(new CustomEvent('load-more', {
                    bubbles: true,
                    composed: true
                }));
            }
        }
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

        try {
            return html`
                <div class="main-scroll-container has-hero" @scroll=${this._handleScroll}>
                    <div class="hero-banner" style="height: 375px !important; margin-top: 0; display: block !important; position: relative !important; top: 0; left: 0; z-index: 0;">
                        <div class="hero-bg">
                            <img src="${data.images?.[0]?.url}" 
                                 style="width: 100%; height: 100%; object-fit: cover; filter: blur(20px) brightness(0.6); transform: scale(1.1); opacity: 0.5;"
                            >
                        </div>
                        <div class="hero-content">
                        <div class="hero-art ${!data.images?.[0]?.url ? 'skeleton-pulse' : ''}" style="${!data.images?.[0]?.url ? 'background-color: #282828;' : ''}">
                            ${data.images?.[0]?.url ? html`
                                <img src="${data.images[0].url}" 
                                     class="hero-art-img" 
                                     style="opacity: 0; transition: opacity 0.5s ease;"
                                     onload="this.style.opacity = 1; this.parentElement.classList.remove('skeleton-pulse');"
                                     onerror="this.style.display='none'; this.parentElement.classList.add('skeleton-pulse');"
                                >
                            ` : ''}
                        </div>
                            <div class="hero-text">
                                <div class="hero-type">${data.type}</div>
                                <h1 class="hero-title">${data.name}</h1>
                                <div class="hero-subtitle">${subtitle}</div>
                                <div class="hero-actions">
                                    <button class="hero-btn-play" @click=${() => this._handleHeroPlayClick()}>
                                        ${this._getIsPlaying()
                    ? html`<svg height="28" width="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>` // Pause Icon
                    : html`<svg height="28" width="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>` // Play Icon
                }
                                    </button>
                                    ${data.type === 'playlist' ? html`
                                        <button class="hero-btn-fav" @click=${this._toggleFollowPlaylist} style="margin-left: 12px; background: transparent; border: 1px solid rgba(255,255,255,0.3); border-radius: 50%; width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: ${this._isFollowing ? '#1DB954' : 'white'}; transition: all 0.2s ease;">
                                            <svg height="28" width="28" viewBox="0 0 24 24" fill="${this._isFollowing ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                                                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                                            </svg>
                                        </button>
                                    ` : ''}

                                    <!-- PIN BUTTON (Sticky Feature) -->
                                    ${this._pinnedEntity ? html`
                                        <button class="hero-btn-fav" @click=${this._togglePin} style="margin-left: 12px; background: transparent; border: 1px solid rgba(255,255,255,0.3); border-radius: 50%; width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: ${this._isPinned ? 'var(--spf-brand)' : 'white'}; transition: all 0.2s ease;">
                                            <svg height="24" width="24" viewBox="0 0 24 24" fill="${this._isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${this._isPinned ? '0' : '2'}">
                                                <path d="M16 12V4H17V2H7V4H8V12L6 14V16H11.2V22H12.8V16H18V14L16 12Z"/>
                                            </svg>
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="content-wrapper">
                        <div class="track-list">
                            ${data.tracks?.items?.map((item, index) => this.renderTrackRow(item.track || item, index + 1)) || ''}
                        </div>
                    </div>
                </div>
            `;
        } catch (e) {
            console.error('[PlaylistView] RENDER ERROR:', e);
            return html`<div style="padding: 20px; color: red;">Error Rendering View: ${e.message}</div>`;
        }
    }

    renderTrackRow(track, index) {
        if (!track) return ''; // Safety check
        try {
            const artistNames = track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown';
            const image = track.album?.images?.[0]?.url;
            const trackData = {
                name: track.name,
                artist: artistNames,
                uri: track.uri,
                id: track.id,
                image,
            };
            const isAlbum = this.data?.type === 'album';

            // For playlists, show Art. For Albums, show Index.
            let firstColContent;
            if (image && !isAlbum) {
                firstColContent = html`<img src="${image}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover;" loading="lazy">`;
            } else {
                firstColContent = html`<div class="track-num">${index}</div>`;
            }

            return html`
            <div class="track-row interactive" data-track-id="${track.id}" data-uri="${track.uri}" @click=${(e) => this._handleTrackClick(e, track)}>
                ${firstColContent}
                <div class="track-info">
                    <div class="track-name" style="${isAlbum ? '' : 'color: white;'}">${track.name}</div>
                    <div class="track-artist">${artistNames}</div>
                </div>
                <div class="track-actions-right">
                    <button class="track-action-btn" data-action="save" @click=${(e) => this._handleSaveTrack(e, track)}>
                       <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                    </button>
                    <button class="track-action-btn" data-action="queue" @click=${(e) => this._handleQueueTrack(e, track)}>
                       <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
                    </button>
                    <button class="track-action-btn" data-action="menu" @click=${(e) => this._handleTrackMenu(e, trackData)}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>
                    </button>
                </div>
            </div>
        `;
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

    async _handleSaveTrack(e, track) {
        e.stopPropagation();
        if (!this.api || !track?.id) return;
        const res = await this.api.saveTrackFavorites(track.id);
        this.dispatchEvent(new CustomEvent('show-toast', {
            detail: { message: res.success ? 'Added to Liked Songs' : 'Failed to save track' },
            bubbles: true, composed: true
        }));
    }

    async _handleQueueTrack(e, track) {
        e.stopPropagation();
        if (!this.api || !track?.uri) return;
        const res = await this.api.fetchSpotifyPlus('add_player_queue_items', { uris: track.uri }, false);
        this.dispatchEvent(new CustomEvent('show-toast', {
            detail: { message: res ? 'Added to queue' : 'Failed to add to queue' },
            bubbles: true, composed: true
        }));
    }

    async _handleTrackClick(e, track) {
        if (e.target.closest('button')) return; // Ignore button clicks

        console.log('[PlaylistView] Playing Track:', track.name, track.uri);
        const contextType = this.data.type;

        if (contextType === 'likedsongs') {
            // Liked songs often behaves differently, play just the track
            await this.api.playMedia(track.uri, 'track');
        } else {
            // For Playlists/Albums, play context with offset
            await this.api.playMedia(this.data.uri, contextType, null, { offset_uri: track.uri });
        }
    }

    async _playContext(uri, type = 'playlist') {
        if (!uri || !this.api) return;
        await this.api.playMedia(uri, type);
    }

    _handleHeroPlayClick() {
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
}

customElements.define('spotify-playlist-view', SpotifyPlaylistView);
