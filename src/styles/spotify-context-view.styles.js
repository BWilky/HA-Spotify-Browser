import { css } from "../lit.js";

export const contextViewStyles = css`
    :host {
        display: block;
        width: 100%;
        height: 100%;
    }

    /* Hero & Artist Profile */
    .hero-banner, .artist-hero { 
        position: relative; height: 300px !important; width: 100%; overflow: hidden;
        transition: height 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); will-change: height;
    }
    
    .hero-bg {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: #181818; /* Fallback skeleton color */
        z-index: 0;
        overflow: hidden;
        transition: all 0.5s ease;
        transform-origin: top center; will-change: transform;
    }
    
    .hero-gradient, .artist-hero .hero-gradient { 
        position: absolute; top: 0; left: 0; right: 0; bottom: 0; 
        background: linear-gradient(to top, var(--spf-bg) 0%, transparent 25%);
        z-index: 1; pointer-events: none;
    }
    
    .hero-content, .artist-header-content { 
        position: absolute; bottom: 0; left: 0; width: 100%; 
        z-index: 2; padding: 24px; box-sizing: border-box;
        display: flex; align-items: flex-end; gap: 24px;
    }
    .artist-header-content { flex-direction: column !important; align-items: flex-start !important; justify-content: flex-end; }
    .artist-header-content .hero-actions { margin-top: 0; margin-left: 4px; }
    
    /* Ensure the skeleton art inside the hero is fixed size */
    .hero-art { 
        width: 180px; height: 180px; 
        box-shadow: 0 4px 60px rgba(0,0,0,0.5); 
        background: var(--spf-skeleton-bg); flex-shrink: 0; 
        /* FIX: Prevent collapse if image is missing */
        display: block; 
        position: relative;
        overflow: hidden;
    }
    /* Image inside hero-art */
    .hero-art-img {
        width: 100%; height: 100%;
        object-fit: cover;
        display: block;
    }
    .hero-text { flex: 1; }
    .hero-type { font-size: var(--spf-text-sm, 12px); text-transform: uppercase; font-weight: 700; margin-bottom: 4px; }
    .hero-title { font-size: 3rem; font-weight: 900; margin: 0 0 8px 0; line-height: 1; }
    .hero-subtitle { font-size: var(--spf-text-base, 13.5px); color: rgba(255,255,255,0.7); }
    .hero-actions { display: flex; align-items: center; gap: 16px; margin-top: 16px; }
    .artist-hero-name { position: static; margin-bottom: 16px; font-size: 4rem; font-weight: 900; color: white; text-shadow: 0 4px 12px rgba(0,0,0,0.5); }
    
    .hero-btn-play {
        width: 56px; height: 56px; border-radius: 50%; background: var(--spf-brand); color: black; border: none;
        display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.2s;
    }
    .hero-btn-play:hover { transform: scale(1.05); background: var(--spf-brand-hover); }
    .hero-btn-play svg { width: 28px; height: 28px; fill: currentColor; }
    
    .hero-btn-fav {
        background: transparent; border: 1px solid rgba(255,255,255,0.3); color: white;
        padding: 8px 16px; border-radius: 20px; display: flex; align-items: center; justify-content: center;
        cursor: pointer; transition: all 0.2s; font-size: var(--spf-text-sm, 12px); font-weight: 700; letter-spacing: 1px;
    }
    .hero-btn-fav:hover { border-color: white; transform: scale(1.05); }
    .hero-btn-fav.is-favorite { color: var(--spf-brand); border-color: var(--spf-brand); }

    .artist-track-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 32px; }
    @media (max-width: 600px) { .artist-track-grid { grid-template-columns: 1fr; } .artist-hero-name { font-size: 2.5rem; } }

    .artist-top-track { display: flex; align-items: center; background: rgba(255,255,255,0.05); border-radius: 6px; overflow: hidden; transition: background 0.2s; height: 56px; cursor: pointer; position: relative; padding-right: 8px; }
    @media (hover: hover) { 
        .artist-top-track:hover { background: var(--spf-hover-white); } 
        .artist-top-track:active { background: var(--spf-active-white); }
    }
    
    .artist-top-track.playing .track-title { color: var(--spf-brand); }
    .track-art-left { 
        width: 56px; height: 56px; 
        background-size: cover; background-position: center; 
        position: relative; flex-shrink: 0; margin-right: 12px; 
    }

    /* FIX: Standardize positioning so it matches the hover transform */
    .artist-top-track .play-btn-overlay.mini { 
        width: 32px; height: 32px; 
        
        /* Reset the conflicting centering method */
        bottom: auto; right: auto; margin: 0;
        
        /* Use standard centering (Top/Left 50%) */
        top: 50%; left: 50%; 
        transform: translate(-50%, -50%) scale(0.8); /* Start slightly smaller */
        
        opacity: 0; 
        transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }

    /* On Row Hover: Reveal and scale to normal */
    @media (hover: hover) { 
        .artist-top-track:hover .play-btn-overlay.mini { 
            opacity: 1; 
            transform: translate(-50%, -50%) scale(1);
        } 
    }
    
    .track-info-middle { flex: 1; overflow: hidden; display: flex; flex-direction: column; justify-content: center; }
    .track-title { font-size: var(--spf-text-base, 13.5px); font-weight: 700; color: var(--spf-text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Track Rows — the base rules (columns, hover) live in shared-styles.js
       and the text colours in views/spotify-playlist-view.js; this block only
       carries the context-view overrides. */
    .track-row {
        overflow: visible;
        display: grid;
        /* num/art | title+artist | action buttons (flush right) */
        grid-template-columns: 40px 1fr auto;
        gap: 16px;
        padding: 8px 16px;
        align-items: center; cursor: pointer;

        /* User Customization: Transparent default, hover effect only */
        background: transparent;
        border-radius: 8px;
        margin: 0 4px 4px 4px;

        /* FIX: Enforce minimum height to match loaded content */
        min-height: 56px;
        box-sizing: border-box;

        /* Long lists: skip layout/paint of off-screen rows. The placeholder
           is the content box (56px row - 2x8px padding); 'auto' then keeps
           each row's last real size. Edit rows (.edit-row) are not affected. */
        content-visibility: auto;
        contain-intrinsic-size: auto 40px;
    }
    /* Inline now-playing layout: equalizer sits left of the green title */
    .track-name { display: flex; align-items: center; gap: 6px; }
    .track-name-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Now-playing equalizer (inline, next to the track title) */
    .track-eq {
        flex: 0 0 auto;
        width: 14px; height: 14px;
        display: flex; align-items: flex-end; justify-content: center;
        gap: 2px; box-sizing: border-box;
    }
    .track-eq span {
        width: 2px; height: 100%; background: var(--spf-brand); border-radius: 1px;
        /* Animate scaleY (compositor-only) instead of height (layout per frame);
           bottom origin keeps the bars growing up from the baseline. */
        transform-origin: bottom;
        animation: track-eq-bounce 0.9s ease-in-out infinite;
    }
    .track-eq span:nth-child(1) { animation-delay: -0.2s; }
    .track-eq span:nth-child(2) { animation-delay: -0.5s; }
    .track-eq span:nth-child(3) { animation-delay: -0.1s; }
    @keyframes track-eq-bounce {
        0%, 100% { transform: scaleY(0.3); }
        50% { transform: scaleY(1); }
    }

    /* Skeleton styles (.skeleton-pulse, @keyframes pulse, .card-*-sk) live in
       shared-styles.js, which every consumer of this module also imports. */

    /* Artist View Specifics */
    .artist-section { margin-bottom: 40px; }
    .artist-section h2 { margin-bottom: 16px; font-size: var(--spf-text-xl, 22px); font-weight: 700; color: var(--spf-text-main); }

    /* ================= SPOTIFY-STYLE MOBILE TRACK LIST ================= */
    @media (max-width: 768px) {
        /* Native-style rows: art/index | title+artist | menu.
           The first column sizes to its content (40px art/eq, or the number),
           so the now-playing equalizer gets its own cell instead of breaking
           the grid. */
        .track-row {
            grid-template-columns: auto 1fr auto !important;
            padding: 6px 16px !important;
            margin: 0 !important;
            border-radius: 0 !important;
            min-height: 64px !important;
            gap: 12px !important;
            /* 64px row - 2x6px padding */
            contain-intrinsic-size: auto 52px;
        }

        /* Album track numbers: keep them, centered in the art column */
        .track-num {
            display: block !important;
            width: 48px;
        }

        /* Show album art thumbnails (playlists / liked songs) */
        .track-row > img:first-child {
            display: block !important;
            width: 48px !important;
            height: 48px !important;
            border-radius: 4px;
            object-fit: cover;
        }

        /* Clean track text (sized to match the native app's mobile list). */
        .track-name {
            font-size: var(--spf-text-base, 13.5px) !important;
            font-weight: 500 !important;
        }

        .track-artist {
            font-size: var(--spf-text-sm, 12px) !important;
            margin-top: 3px !important;
        }

        /* Proper overflow for track info column */
        .track-info {
            overflow: hidden;
            display: flex;
            flex-direction: column;
            justify-content: center;
            min-width: 0; /* Critical for text-overflow: ellipsis */
        }

        /* Hide heart and queue buttons — keep only "..." menu */
        .track-action-btn[data-action="save"],
        .track-action-btn[data-action="queue"] {
            display: none !important;
        }

        .track-actions-right {
            gap: 0 !important;
        }
    }
`;

/**
 * Hero-page rules shared by the playlist and artist views. Adopted by those two
 * only, right after contextViewStyles and before each view's own CSS (where
 * these rules used to sit at the top). Kept out of contextViewStyles because
 * spotify-context-view adopts that sheet too, and this :host (!important)
 * would size and position its host as well.
 */
export const heroPageStyles = css`
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
    .content-wrapper {
        padding: 12px;
        padding-bottom: 100px;
        position: relative;
        background: var(--spf-bg);
    }
    .hero-bg, .hero-bg img { width: 100%; height: 100%; object-fit: cover; }

    /* Pin button: outlined circle when not pinned, green-filled when pinned
       (the playlist view's album save button looks the same). */
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
`;
