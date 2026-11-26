import { LitElement, html, css } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { renderCardTemplate, renderPillTemplate, renderCardSkeletonTemplate, renderPillSkeletonTemplate } from '../media-templates.js';
import { contextViewStyles, heroPageStyles } from '../../styles/spotify-context-view.styles.js';
import { playIcon, pauseIcon, pinIcon } from '../common/icons.js';
import { HeroScrollController } from '../controllers/hero-scroll-controller.js';
import { TrackLikesController } from '../controllers/track-likes-controller.js';
import { OptimisticPlaybackController } from '../controllers/optimistic-playback-controller.js';
import { PinStateController } from '../controllers/pin-state-controller.js';

export class SpotifyArtistView extends LitElement {
    static get styles() {
        return [
            sharedStyles,
            contextViewStyles,
            heroPageStyles,
            css`
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
            `
        ];
    }

    static get properties() {
        return {
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
        };
    }

    constructor() {
        super();
        this.playingTrackId = null;
        this.currentTrackId = null;
        this.isPlaying = false;
        this._pin = new PinStateController(this, {
            getPinId: () => this.data.id,
            getPinItem: () => ({
                id: this.data.id,
                type: this.data.type,
                name: this.data.name || this.data.title,
                images: this.data.images,
                uri: this.data.uri
            }),
        });
        this._likes = new TrackLikesController(this, {
            getApi: () => this.api,
            getIds: () => this.data?.topTracks?.map(t => t.id || t.track?.id),
            // Top tracks are far below the 50-id cap: one call.
            maxPerCheck: 50,
            verify: 'each',
            onToggled: (liked, ok) => {
                if (ok) return;
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
            },
            onCorrected: (id) => console.warn(`[SpotifyArtistView] Track like mismatch for ${id}. Correcting.`),
        });
        this._playback = new OptimisticPlaybackController(this, {
            getApi: () => this.api,
            getContext: () => ({ uri: this.data.uri, type: 'artist' }),
        });
        this._hero = new HeroScrollController(this, {
            getTitle: () => this.data?.name || '',
            heroImage: '.artist-hero .hero-bg img',
            fade: { textStart: 150, textSpan: 50 },
        });
    }

    connectedCallback() {
        super.connectedCallback();
        this._pin.check();
    }

    updated(changedProperties) {
        if (changedProperties.has('data')) {
            // The parent swaps `data` once per progressive load step (artist,
            // albums, top tracks, playlists, similar). Following is per artist
            // id (known from the loading placeholder on); likes only for top
            // tracks not checked yet.
            const prev = changedProperties.get('data');
            const identityChanged = !prev || prev.id !== this.data?.id;
            // A reload of the same artist (refresh(): loading placeholder) starts
            // over too, so an explicit refresh re-reads follow and like state.
            const reloaded = !identityChanged && !!this.data?.isLoading && !this.data.topTracks && !!prev.topTracks;
            if (identityChanged || reloaded) this._likes.reset();
            this._pin.check();
            if (identityChanged || reloaded) this._checkFollowStatus();
            if (identityChanged || prev?.topTracks !== this.data?.topTracks) this._likes.check();
        }

        // Check header state on updates (handles back navigation scroll restoration)
        this._hero.syncSoon();
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

    _toggleTrackLike(track, e) {
        if (e) e.stopPropagation();
        if (!track) return;
        return this._likes.toggle(track.id);
    }

    /** Called by the parent context-view when this page becomes visible again. */
    updateHeaderState() {
        this._hero.updateHeaderState();
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

        // Optimistic: highlight the row now; cleared when HASS reports it (or after 8 s).
        this._playback.startTrack(startId);

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
            <div class="main-scroll-container has-hero" @scroll=${this._hero.onScroll}>
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
                            <button class="hero-btn-play" @click=${() => this._playback.heroClick()}>
                                ${this._playback.isPlaying ? pauseIcon(28) : playIcon(28)}
                            </button>
                            ${this._pin.entity ? html`
                                <button class="hero-pin ${this._pin.isPinned ? 'pinned' : ''}" @click=${this._pin.toggle}
                                        aria-label="${this._pin.isPinned ? 'Unpin' : 'Pin'}" title="${this._pin.isPinned ? 'Unpin' : 'Pin'}">
                                    ${pinIcon}
                                </button>
                            ` : ''}

                            <button
                                class="hero-btn-fav"
                                @click=${this._toggleFollow}
                                style="${this._isFollowing ? 'border-color: var(--spf-brand); color: var(--spf-brand);' : ''}"
                            >
                                ${this._isFollowing ? 'FOLLOWING' : 'FOLLOW'}
                            </button>
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
        const isLiked = this._likes.isLiked(track.id);

        // Unified playback check
        const currentPlayingId = this._playback.playingTrackId;
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
