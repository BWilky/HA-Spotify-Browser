import { LitElement, html, css, repeat, guard, keyed } from "../../lit.js";
import { sharedStyles } from '../../styles/shared-styles.js';
import { contextViewStyles, heroPageStyles } from '../../styles/spotify-context-view.styles.js';
import { fireHaptic, pickImage, IMG_THUMB } from '../../utils.js';
import { renderTrackRowTemplate } from '../media-templates.js';
import { heartToggleIcon, playIcon, pauseIcon, menuIcon, pinIcon, checkIcon, heroShuffleIcon } from '../common/icons.js';
import { HeroScrollController } from '../controllers/hero-scroll-controller.js';
import { TrackLikesController } from '../controllers/track-likes-controller.js';
import { OptimisticPlaybackController } from '../controllers/optimistic-playback-controller.js';
import { PinStateController } from '../controllers/pin-state-controller.js';
import { FollowStateController } from '../controllers/follow-state-controller.js';
import {
    playlistMenuItems, openActionMenu, togglePlaylistFlag, setPlaylistFollowed, confirmDeletePlaylist, canEditPlaylistItems,
} from '../playlist-actions.js';
import './spotify-playlist-editor.js';

// Stable empty list, so "no tracks yet" doesn't look like a new array each render.
const NO_ITEMS = [];

export class SpotifyPlaylistView extends LitElement {
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
            pinnedSensorState: { type: Object },
            _albumLiked: { type: Boolean, state: true },   // album saved to library
            _artistInfo: { type: Object, state: true },    // album's primary artist { id, name, image }
            _genrePills: { type: Array, state: true }, // Liked Songs filter pills: [{ label, genre }]
            _activeGenre: { type: String, state: true }, // currently selected pill genre, or null
            _editMode: { type: Boolean, state: true }       // playlist edit mode (<spotify-playlist-editor>) is open
        };
    }

    static get styles() {
        return [
            sharedStyles,
            css`
                /* Track-row rules that sat in sharedStyles but only render
                   here (renderTrackRowTemplate). Kept
                   between sharedStyles and contextViewStyles: their place in
                   the cascade before they moved. */
                .track-row.playing .track-name { color: var(--spf-brand); }
                .track-name { color: var(--spf-text-main); font-size: var(--spf-text-md, 15px); }
                .track-artist { color: var(--spf-text-sub); font-size: var(--spf-text-base, 13.5px); }
                .track-action-btn.is-favorite { color: var(--spf-brand); }
                .track-action-btn.is-favorite svg { fill: var(--spf-brand); }
            `,
            contextViewStyles,
            heroPageStyles,
            css`
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
                .hero-bg { overflow: visible !important; }

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
                /* Liked Songs has no album art (mirrors the native app), so the
                   hero is just the title + count + controls over the gradient.
                   Shrink the banner accordingly on desktop. The gradient is
                   painted on the banner itself — a composited child div (the old
                   .liked-gradient) left an unpainted strip behind the floating
                   header. 300px keeps the bottom-anchored text clear of the
                   header's 64px zone now that the hero truly starts at the top. */
                .liked-hero .hero-banner {
                    height: 300px !important; min-height: 300px !important; max-height: 300px !important;
                    background: linear-gradient(180deg, #4733b0 0%, #3a2f7a 45%, var(--spf-bg) 100%);
                }
                .liked-hero .hero-bg { background: transparent; }
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
                .hero-btn-menu svg { fill: currentColor; width: 26px; height: 26px; }

                /* Follow heart (a playlist you don't own): a round outlined
                   button instead of contextViewStyles' FOLLOW pill. Comes after
                   .hero-btn-fav:hover, so its border stays put on hover. */
                .hero-btn-fav.follow-heart {
                    margin-left: 12px; background: transparent; border: 1px solid rgba(255,255,255,0.3);
                    border-radius: 50%; width: 56px; height: 56px;
                    display: flex; align-items: center; justify-content: center;
                    cursor: pointer; color: white; transition: all 0.2s ease;
                }
                .hero-btn-fav.follow-heart.following { color: #1DB954; }

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
                    color: var(--spf-text-main); font-size: var(--spf-text-base, 13.5px); font-weight: 700;
                }
                .hero-artist:hover .hero-artist-name { text-decoration: underline; }
                .hero-release {
                    color: var(--spf-text-sub); font-size: var(--spf-text-base, 13.5px); margin-bottom: 4px;
                }

                .genre-pills {
                    display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none;
                    padding: 4px 4px 12px; -webkit-overflow-scrolling: touch;
                }
                .genre-pills::-webkit-scrollbar { display: none; }
                .genre-pill {
                    flex: 0 0 auto; border: none; cursor: pointer; white-space: nowrap;
                    padding: 8px 16px; border-radius: 999px; font-size: var(--spf-text-base, 13.5px); font-weight: 500;
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
                        font-size: var(--spf-text-xl, 22px) !important;
                        font-weight: 900 !important;
                        line-height: 1.15 !important;
                        margin: 0 0 8px 0 !important;
                    }

                    /* Native hides the type eyebrow on mobile; for non-liked
                       playlists the description/owner/meta rows replace the
                       generic subtitle. */
                    .hero-type { display: none !important; }
                    .main-scroll-container:not(.liked-hero) .hero-subtitle { display: none !important; }

                    .liked-hero .hero-subtitle {
                        font-size: var(--spf-text-base, 13.5px) !important;
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
                        font-size: var(--spf-text-md, 15px) !important;
                        line-height: 1.4 !important;
                        color: var(--spf-text-main) !important;
                        margin-bottom: 14px !important;
                    }

                    .hero-owner {
                        display: flex !important;
                        align-items: center !important;
                        gap: 8px !important;
                        font-size: var(--spf-text-base, 13.5px) !important;
                        color: var(--spf-text-main) !important;
                        margin-bottom: 6px !important;
                    }
                    .hero-owner svg { width: 24px !important; height: 24px !important; flex: 0 0 auto; }
                    .hero-owner b { font-weight: 700 !important; }

                    .hero-meta {
                        display: block !important;
                        font-size: var(--spf-text-base, 13.5px) !important;
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
        this._hero = new HeroScrollController(this, {
            getTitle: () => this.data?.name || '',
            heroImage: '.hero-banner .hero-bg img',
            heroContent: '.hero-content',
            isLite: () => this.config?.appearance?.performance?.lite,
            fade: { textStart: 220, textSpan: 60 },
            // The mobile hero is tall (height: auto): fade by its real height.
            mobileFade: { query: '(max-width: 768px)', heroBanner: '.hero-banner' },
            dedupe: true,
            onNearBottom: () => this.dispatchEvent(new CustomEvent('load-more', { bubbles: true, composed: true })),
        });
        this._follow = new FollowStateController(this);
        this._followCheck = 0;     // bumped per follow check and per toggle (B15)
        this._currentUserId = null; // cache for the network follow check; never rendered
        this._pin = new PinStateController(this, {
            // Liked Songs is the mandatory user-library pin.
            getPinId: () => this.data.type === 'likedsongs' ? 'user-library' : this.data.id,
            getPinItem: () => this._pinItem(),
        });
        this._albumLiked = false;     // album saved to library (album view)
        this._artistInfo = null;      // { id, name, image } for the album's primary artist
        this._playback = new OptimisticPlaybackController(this, {
            getApi: () => this.api,
            getContext: () => ({ uri: this.data.uri, type: this.data.type }),
        });
        this._likes = new TrackLikesController(this, {
            getApi: () => this.api,
            getIds: () => this.data?.tracks?.items?.map(item => (item.track || item)?.id),
            onToggled: (liked, ok) => this._toast(ok
                ? (liked ? 'Added to Liked Songs' : 'Removed from Liked Songs')
                : (liked ? 'Failed to save track' : 'Failed to remove track')),
        });
        this._genrePills = [];
        this._activeGenre = null;
        this._trackGenres = {}; // trackId -> string[] of genres (not reactive; drives pills)
        this._editMode = false;
        this._editSession = 0;    // bumped per edit session: each gets a fresh editor element
    }

    connectedCallback() {
        super.connectedCallback();
        // Follow/pin status is checked from updated() when data arrives; the
        // first update always carries 'data', so checking here doubled it.
    }

    /**
     * Derived list values, recomputed only when their inputs change (render
     * runs on every hero/follow/pin/player-state change too).
     */
    willUpdate() {
        const allItems = this.data?.tracks?.items || NO_ITEMS;
        if (allItems !== this._durationItems) {
            this._durationItems = allItems;
            this._totalMs = allItems.reduce((s, it) => s + ((it.track || it)?.duration_ms || 0), 0);
        }
        // Genre filter (Liked Songs only). _trackGenres is filled in place, and
        // every fill is followed by _rebuildGenrePills assigning a new
        // _genrePills array, so that identity doubles as its change signal.
        const genre = this.data?.type === 'likedsongs' ? this._activeGenre : null;
        if (allItems !== this._filterItems || genre !== this._filterGenre || this._genrePills !== this._filterPills) {
            this._filterItems = allItems;
            this._filterGenre = genre;
            this._filterPills = this._genrePills;
            this._trackItems = genre
                ? allItems.filter(it => (this._trackGenres[(it.track || it)?.id] || []).includes(genre))
                : allItems;
        }
    }

    updated(changedProperties) {
        if (changedProperties.has('data')) {
            // The router reuses this element across pages — never carry an
            // open edit session over to a different playlist.
            if (this._editMode && this.data?.id !== this._editPlaylistId) {
                this._editMode = false;
            }
            // The parent swaps `data` for every background track page and
            // load-more. Id-scoped checks run only when the page identity
            // changes or when what they depend on first becomes available.
            const prev = changedProperties.get('data');
            const data = this.data;
            const identityChanged = !prev || !data || prev.id !== data.id || prev.type !== data.type;
            // A reload of the same page (refresh(): placeholder with no tracks)
            // starts over too, so an explicit refresh re-reads the likes.
            if (identityChanged || !data?.tracks?.items) this._likes.reset();
            const loaded = !!data && !data.isLoading && (identityChanged || !!prev?.isLoading);
            // Follow: needs isOwner (known once loaded) and the parent's follow
            // fetch to settle (followPending true -> false).
            if (data?.type === 'playlist' && !data.isLoading && !data.followPending
                && (loaded || !!prev?.followPending)) {
                this._checkFollowStatus();
            }
            if (identityChanged) this._pin.check();
            // Likes + genres: only when the track list itself changed.
            const itemsChanged = identityChanged || prev?.tracks?.items !== data?.tracks?.items;
            if (itemsChanged) this._likes.check();
            if (itemsChanged && data?.type === 'likedsongs') this._enrichGenres();
            if (data?.type === 'album') {
                if (identityChanged) this._checkAlbumLike();
                // Needs data.artists, which arrives with the loaded album.
                if (identityChanged || prev?.artists !== data.artists) this._fetchArtistInfo();
            }
            // One-shot: navigated here via "Edit Playlist" (library row menu).
            // Waits for the full track list — reorder math needs it.
            if (this.data?.autoEdit && !this._editMode
                && this.data.canEditItems && this.data.tracksComplete) {
                this.data.autoEdit = false;
                this._enterEditMode();
            }
        }

        // Tell the app when an edit session starts or ends, whatever flipped
        // _editMode (enter, the editor's done, the reset above): while one is
        // open the editor's bar is the page's top bar and the app header
        // steps aside. After the render, so the app reacts to what is on
        // screen.
        if (changedProperties.has('_editMode')
            && !!changedProperties.get('_editMode') !== !!this._editMode) {
            this.dispatchEvent(new CustomEvent('edit-session-changed', {
                detail: { active: !!this._editMode, playlistId: this.data?.id || null },
                bubbles: true,
                composed: true
            }));
            // Back in the list: it was re-rendered from the top, so the header
            // state from before the session (scrolled: opaque, titled) is
            // stale. Report the real one for the returning header.
            if (!this._editMode) this.updateHeaderState();
        }

        // Check for HASS updates to the Pinned Items helper (the parent derives
        // the sensor's state object, so any change here is a real change).
        if (changedProperties.has('pinnedSensorState') && this.pinned && this.pinned.sensorEntity) {
            if (changedProperties.get('pinnedSensorState') !== undefined) {
                this._pin.check();
            }
        }
    }

    async _checkFollowStatus() {
        if (!this.data || this.data.type !== 'playlist' || !this.api) return;
        // B15: only the latest check, for the playlist still shown, may set the
        // heart; a later check or a toggle supersedes an answer still on its way.
        const check = ++this._followCheck;
        const playlistId = this.data.id;
        const current = () => check === this._followCheck
            && this.data?.type === 'playlist' && this.data.id === playlistId;

        // Your own playlist is always "in your library" — the heart is hidden
        // and delete lives in the header menu instead.
        if (this.data.isOwner) {
            this._follow.following = false;
            return;
        }

        // The parent context-view already fetched it while loading.
        if (typeof this.data.isFollowing === 'boolean') {
            this._follow.following = this.data.isFollowing;
            return;
        }

        // Fetch User if needed (entity attribute first — no network)
        if (!this._currentUserId) {
            try {
                this._currentUserId = await this.api.getCurrentUserId();
            } catch (e) { }
            if (!current()) return;
        }

        if (this._currentUserId && playlistId) {
            try {
                const follows = await this.api.checkUserFollowsPlaylist(playlistId, this._currentUserId);
                if (!current()) return;
                if (follows && Array.isArray(follows) && follows.length > 0) this._follow.following = follows[0];
            } catch (e) { }
        }
    }

    /** What a pin of this page stores (PinStateController.toggle). */
    _pinItem() {
        // SPECIAL CASE: Liked Songs -> user-library
        if (this.data.type === 'likedsongs') {
            return {
                id: 'user-library',
                type: 'library',
                title: 'User Library',
                subtitle: 'Your collection & liked songs',
                image: 'https://www.gstatic.com/images/icons/material/system/2x/library_music_white_24dp.png',
                uri: 'spotify:user-library'
            };
        }
        return {
            id: this.data.id,
            type: this.data.type,
            name: this.data.name || this.data.title,
            images: this.data.images,
            uri: this.data.uri,
            description: this.data.description
        };
    }

    /** Called by the parent context-view when this page becomes visible again. */
    updateHeaderState() {
        this._hero.updateHeaderState();
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
        if (this._editMode) return this._renderEditMode();
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

        // Filtered by the active genre pill (Liked Songs only); see willUpdate.
        const trackItems = this._trackItems;

        // Native mobile text stack: description, owner row, "saves • duration".
        const descLine = !isLiked ? (data.description || '') : '';
        const ownerName = !isLiked ? (data.owner?.display_name || '') : '';
        const durStr = this._formatDuration(this._totalMs);
        const saves = data.followers?.total;
        const savesStr = (saves != null) ? `${new Intl.NumberFormat().format(saves)} saves` : '';
        const metaLine = [savesStr, durStr].filter(Boolean).join(' • ');

        // Shared action buttons (reused across album/playlist/liked layouts).
        const playBtnTpl = html`
            <button class="hero-btn-play" @click=${() => this._handleHeroPlayClick()}>
                ${this._playback.isPlaying ? pauseIcon(28) : playIcon(28)}
            </button>`;
        const pinBtnTpl = (this._pin.entity && !isLiked) ? html`
            <button class="hero-pin ${this._pin.isPinned ? 'pinned' : ''}" @click=${this._pin.toggle} aria-label="${this._pin.isPinned ? 'Unpin' : 'Pin'}" title="${this._pin.isPinned ? 'Unpin' : 'Pin'}">
                ${pinIcon}
            </button>` : '';

        try {
            return html`
                <div class="main-scroll-container has-hero ${isLiked ? 'liked-hero' : ''} ${isAlbum ? 'album-hero' : ''}" @scroll=${this._hero.onScroll}>
                    <div class="hero-banner" style="margin-top: 0; display: block !important; position: relative !important; top: 0; left: 0; z-index: 0;">
                        <div class="hero-bg">
                            ${isLiked
                ? ''
                : html`<img src="${data.images?.[0]?.url}"
                                 style="width: 100%; height: 100%; object-fit: cover; filter: blur(20px) brightness(0.6); transform: scale(1.1); opacity: 0.5;">`}
                        </div>
                        <div class="hero-content">
                        ${!isLiked ? html`
                        <div class="hero-art ${!data.images?.[0]?.url ? (data.isLoading ? 'skeleton-pulse' : 'art-fallback') : ''}">
                            ${data.images?.[0]?.url ? html`
                                <img src="${data.images[0].url}"
                                     class="hero-art-img"
                                     style="opacity: 0; transition: opacity 0.5s ease;"
                                     onload="this.style.opacity = 1; this.parentElement.classList.remove('skeleton-pulse');"
                                     onerror="this.style.display='none'; this.parentElement.classList.remove('skeleton-pulse'); this.parentElement.classList.add('art-fallback');"
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
                                            ${checkIcon}
                                        </button>
                                        ${pinBtnTpl}
                                        <div class="ha-right">
                                            ${playBtnTpl}
                                            <button class="hero-btn-icon hero-btn-shuffle" title="Shuffle play" @click=${() => this._handleAlbumShuffle()}>
                                                ${heroShuffleIcon}
                                            </button>
                                        </div>
                                    </div>
                                ` : html`
                                    <div class="hero-actions">
                                        ${isLiked ? html`
                                            <button class="hero-btn-icon" title="Shuffle play" @click=${() => this._handleShufflePlay()}>
                                                ${heroShuffleIcon}
                                            </button>
                                        ` : ''}
                                        ${playBtnTpl}
                                        ${data.type === 'playlist' && !data.isOwner ? html`
                                            <button class="hero-btn-fav follow-heart ${this._follow.following ? 'following' : ''}" @click=${this._toggleFollowPlaylist}>
                                                ${heartToggleIcon(this._follow.following, 28)}
                                            </button>
                                        ` : ''}
                                        ${pinBtnTpl}
                                        ${data.type === 'playlist' ? html`
                                            <button class="hero-btn-icon hero-btn-menu" title="More options" aria-label="More options" @click=${this._openHeaderMenu}>
                                                ${menuIcon}
                                            </button>
                                        ` : ''}
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
                    const playingId = this._playback.playingTrackId;
                    // guard: skip the whole list unless something a row
                    // renders changed — the rows read only the (filtered)
                    // items, the playing track id, the like map and the page
                    // type (album index column). Handlers read `this` at
                    // click time, so reused closures stay correct.
                    // Keyed rows let Lit reuse existing row DOM when pages are
                    // appended (load-more). Key includes the index because a
                    // playlist may legally contain the same track twice, and
                    // repeat() requires unique keys.
                    return guard([trackItems, playingId, this._likes.map, data.type], () => repeat(
                        trackItems,
                        (item, index) => `${(item.track || item)?.id || 'na'}:${index}`,
                        (item, index) => this.renderTrackRow(item.track || item, index + 1, playingId)
                    ));
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
                    isPlaying,
                    isAlbum,
                    liked: this._likes.isLiked(track.id),
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
        let detail = { ...trackData, anchor: e.currentTarget.getBoundingClientRect() };
        // Inside a playlist, the menu gains playlist-scoped actions (remove
        // from this playlist). uriCount lets the app warn before a remove that
        // would take out every copy of a duplicated track.
        if (this.data?.type === 'playlist') {
            const uri = trackData?.uri;
            const uriCount = (this.data.tracks?.items || [])
                .filter(it => (it?.track || it)?.uri === uri).length;
            detail = {
                ...detail,
                context: {
                    surface: 'playlist',
                    playlistId: this.data.id,
                    canEditItems: !!this.data.canEditItems,
                    snapshotId: this.data.snapshotId || null,
                    uriCount
                }
            };
        }
        this.dispatchEvent(new CustomEvent('open-track-menu', {
            detail,
            bubbles: true,
            composed: true
        }));
    }

    _toast(message) {
        this.dispatchEvent(new CustomEvent('show-toast', {
            detail: { message },
            bubbles: true,
            composed: true
        }));
    }

    /**
     * Liked Songs filter pills. Spotify's native mood pills aren't exposed by
     * SpotifyPlus, so we approximate them with artist genres. This runs in the
     * background, is bounded + cached, and never blocks the track list: if no
     * genres come back the pills row simply stays hidden.
     */
    /** Attach genres to each track we can resolve from the artists enriched so far. */
    _attachTrackGenres(items) {
        if (!this._artistGenreLocal) return;
        for (const entry of items) {
            const track = entry.track || entry;
            if (!track?.id || this._trackGenres[track.id]) continue;
            const genres = new Set();
            for (const a of (track.artists || [])) {
                for (const g of (this._artistGenreLocal.get(a?.id) || [])) genres.add(g);
            }
            if (genres.size) this._trackGenres[track.id] = [...genres];
        }
    }

    async _enrichGenres() {
        // Low-power profile: skip the background artist lookups + pill rebuilds.
        if (this.config?.appearance?.performance?.lite) return;
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
        if (toFetch.length === 0) {
            // Nothing new to look up — but tracks loaded since the last pass
            // still need genres attached from the artists already resolved.
            this._attachTrackGenres(items);
            this._rebuildGenrePills();
            return;
        }

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

            this._attachTrackGenres(items);
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

    _handleSaveTrack(e, track) {
        e.stopPropagation();
        if (!track?.id) return;
        return this._likes.toggle(track.id);
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
        // HASS will confirm (the controller's handoff clears the guess).
        this._playback.startTrack(track.id, { playing: true });

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

    _handleShufflePlay() {
        // Favorites playback already shuffles; reflect optimistically and play.
        this._playback.hold('playing');
        this._playback.playContext();
    }

    _handleHeroPlayClick() {
        fireHaptic('light');
        this._playback.heroClick();
    }

    /**
     * Heart button and the menu's Add to / Remove from Your Library
     * (playlist-actions.js: the toast, and `playlist-changed` so the library
     * list follows). Optimistic (FollowStateController); reverted when the
     * call fails.
     */
    async _toggleFollowPlaylist(e) {
        e?.stopPropagation();
        const playlistId = this.data?.id;
        if (!playlistId || !this.api) return;
        this._followCheck++; // a follow check still on its way no longer applies (B15)

        await this._follow.toggle(async (follow) => {
            if (!await setPlaylistFollowed(this, this.api, { id: playlistId }, follow)) return false;
            // Keep the (cached) page data in step: a rebuilt view reads it, and
            // a collaborator's edit rights go with following.
            const data = this.data;
            if (data?.id === playlistId) {
                data.isFollowing = follow;
                if (!data.isOwner) data.canEditItems = canEditPlaylistItems(data, { isFollowing: follow });
            }
            return true;
        });
    }

    /* --- PLAYLIST MANAGEMENT (header menu + edit mode) --- */

    /**
     * Playlist header "..." menu (playlist-actions.js, the same as a library
     * row's); items depend on ownership, edit rights and follow state.
     */
    _openHeaderMenu(e) {
        e?.stopPropagation();
        const data = this.data;
        if (!data) return;
        openActionMenu(this, {
            header: {
                image: data.images?.[0]?.url || '',
                name: data.name,
                subtitle: data.owner?.display_name || 'Playlist'
            },
            items: playlistMenuItems(data, {
                isOwner: !!data.isOwner,
                canEdit: !!data.canEditItems,
                isFollowing: this._follow.following,
                canPin: !!this._pin.entity,
                isPinned: this._pin.isPinned,
            }),
            anchor: e?.currentTarget?.getBoundingClientRect?.() || null,
            // Read this.data when chosen, as the menu may outlive a data swap.
            actions: {
                'edit': () => this._enterEditMode(),
                'toggle-public': () => togglePlaylistFlag(this, this.api, this.data, 'public'),
                'toggle-collab': () => togglePlaylistFlag(this, this.api, this.data, 'collaborative'),
                'pin': () => this._pin.toggle(),
                'follow': () => this._toggleFollowPlaylist(),
                'unfollow': () => this._toggleFollowPlaylist(),
                'delete': () => confirmDeletePlaylist(this, this.api, this.data),
            },
        });
    }

    /* --- EDIT MODE --- */

    _enterEditMode() {
        if (!this.data?.canEditItems) return;
        // Reorder positions are absolute — the full track list must be in.
        if (this.data.tracksComplete === false) {
            this._toast('Tracks are still loading — try again in a moment.');
            return;
        }
        this._editPlaylistId = this.data.id;
        this._editSession++;
        this._editMode = true;
    }

    /** The editor finished (saved, cancelled or failed) — back to the list. */
    _onEditDone() {
        this._editMode = false;
    }

    /**
     * Edit mode: the editor owns the working list, the details fields and the
     * save; this view only supplies the scroll container (the editor's sticky
     * bar sticks to it). Keyed by session so an edit never inherits state from
     * an earlier one.
     */
    _renderEditMode() {
        const data = this.data;
        return html`
            <div class="main-scroll-container edit-mode">
                ${keyed(this._editSession, html`
                    <spotify-playlist-editor
                        .api=${this.api}
                        .playlistId=${data.id}
                        .name=${data.name}
                        .description=${data.description}
                        .snapshotId=${data.snapshotId}
                        .isPublic=${data.public}
                        .collaborative=${data.collaborative}
                        .tracks=${data.tracks}
                        @done=${this._onEditDone}
                    ></spotify-playlist-editor>
                `)}
            </div>
        `;
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
            const img = pickImage((await this.api.getArtist(artist.id))?.images, IMG_THUMB);
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
        this._playback.hold('playing');
        // Turn shuffle on, then play the album context.
        try { this.api?.fetchSpotifyPlus('player_shuffle', { state: 'true' }, false); } catch (_) {}
        this._playback.playContext();
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
