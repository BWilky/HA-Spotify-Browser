import { css } from "../lit.js";

/*
 * Where stylesheets live:
 *  - styles/ holds only what more than one component adopts: this file
 *    (sharedStyles: the :host theme/typography tokens every component that
 *    adopts it relies on, plus the primitives several components render;
 *    artFallbackStyles), list-row.styles.js, spotify-context-view.styles.js,
 *    sheet.styles.js (bottom-sheet chrome) and fonts.js (document-level
 *    @font-face).
 *  - A sheet with a single consumer lives next to that component as
 *    <component-file-name>.styles.js (spotify-browser-app.styles.js for the
 *    root's app frame, components/spotify-header.styles.js,
 *    components/players/sidebar/queue.styles.js, ...).
 *  - Each component's own remaining CSS stays inline in its static styles.
 * Every component has its own shadow root: a rule here only reaches elements
 * rendered in the shadow root of a component that adopts the sheet, and the
 * order of a static styles array is cascade order.
 */

/**
 * Default artwork placeholder: a muted music note on the card-gray background,
 * shown wherever Spotify supplies no image (empty playlists, failed loads).
 * Exported separately for components that don't include the full sharedStyles
 * (playlist picker, queue panel); also baked into sharedStyles below.
 */
export const artFallbackStyles = css`
    .art-fallback {
        background-color: var(--spf-bg-card-hover, #282828);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23535353'%3E%3Cpath d='M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'/%3E%3C/svg%3E");
        background-size: 45%;
        background-repeat: no-repeat;
        background-position: center;
    }
`;

export const sharedStyles = css`
    ${artFallbackStyles}

    :host {
        display: block;
        position: absolute;
        top: 0; left: 0; width: 0; height: 0;
        z-index: 9999;

        /* This is an app-like UI, not a document: suppress the native text
           selection, blue tap highlight, and long-press callout that fire when
           touching/dragging on touch devices (tablet/phone). Inherited, so it
           propagates to every component that uses these shared styles. */
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        -webkit-tap-highlight-color: transparent;

        /* Spotify's typeface. The @font-face set is registered at document
           level by styles/fonts.js (ensureAppFonts); falls back cleanly when
           the woff2 files aren't deployed. Inherited by every component. */
        --spf-font-family: 'Circular Std', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
        font-family: var(--spf-font-family);

        /* Type scale (Spotify-compact, anchored to metrics measured off the
           iOS app). Custom properties inherit across shadow boundaries, so
           components that skip sharedStyles still resolve these. Weights:
           Circular is registered at 400/500/700/900 only — declare those. */
        --spf-text-xs: 11px;     /* eyebrows, fine print */
        --spf-text-sm: 12px;     /* metadata, subtitles */
        --spf-text-base: 13.5px; /* body, list rows, menus */
        --spf-text-md: 15px;     /* emphasized rows, inputs */
        --spf-text-lg: 17px;     /* section headers */
        --spf-text-xl: 22px;     /* page/sheet titles */
        --spf-text-2xl: 26px;    /* large titles */
        --spf-text-hero: 34px;   /* biggest non-banner titles */

        /* Dynamic Island / notch safe area */
        --spf-safe-top: env(safe-area-inset-top, 0px);
        /* Home-indicator safe area (kept off the footer buttons) */
        --spf-safe-bottom: env(safe-area-inset-bottom, 0px);

        /* --- THEME VARIABLES --- */
        --spf-brand: #1db954;
        --spf-brand-hover: #1ed760;
        --spf-bg: #121212;
        --spf-bg-card: #181818;
        --spf-bg-card-hover: #282828;
        --spf-skeleton-bg: #282828;
        --spf-text-main: #ffffff;
        --spf-text-sub: #b3b3b3;
        --spf-hover-white: rgba(255, 255, 255, 0.1);
        --spf-active-white: rgba(255, 255, 255, 0.2);
        --spf-btn-bg: rgba(0, 0, 0, 0.3);
        --spf-border: rgba(255, 255, 255, 0.1);
        --spf-border-subtle: rgba(255, 255, 255, 0.05);
        --spf-scroll-thumb: rgba(255, 255, 255, 0.2);
    }

    /* Form controls don't inherit font-family by default — keep them on the
       app typeface instead of the UA font. */
    button, input, textarea, select {
        font-family: inherit;
    }

    /* Keep selection/caret behavior for real text fields. */
    input, textarea {
        user-select: text;
        -webkit-user-select: text;
        -webkit-touch-callout: default;
    }

    /* What is left here of the old mobile layout block after the app shell's
       rules moved to spotify-browser-app.styles.js and the header/sidebar
       ones to their components. */

    /* ================= MOBILE STYLES ================= */
    @media (max-width: 768px) {
        .hero-title { font-size: 2rem !important; }

        /* Ensure view containers are padded above mini player and bottom nav */
        .scroll-content {
            padding-bottom: calc(130px + var(--spf-safe-bottom, 0px)) !important;
        }
        .main-scroll-container {
            padding-bottom: calc(130px + var(--spf-safe-bottom, 0px)) !important;
        }
        .list-container {
            padding-bottom: calc(130px + var(--spf-safe-bottom, 0px)) !important;
        }
    }

    /* --- Page content --- */

    .scroll-content {
        position: relative;
        z-index: 1;
        /* This is the margin you lost */
        padding: 24px; 
        /* This ensures you can scroll past the bottom player */
        padding-bottom: 100px; 
    }

    @media (max-width: 768px) {
        /* Tighter side margins to match the native app (was 24px). */
        .scroll-content { padding-left: 16px; padding-right: 16px; }
        /* Keep horizontal carousels bleeding exactly to the screen edge. */
        .carousel-layout { margin-left: -16px; margin-right: -16px; padding-left: 16px; padding-right: 16px; }

        /* --- Mobile type scale ---
           Our text ran a touch larger than the native app. shared-styles is
           imported into every component's shadow root, so reducing these shared
           text primitives here scales them app-wide. This is the single place to
           tune mobile text sizing. */
        .media-title { font-size: var(--spf-text-base, 13.5px); }
        .media-subtitle { font-size: var(--spf-text-xs, 11px); }
        .section-title { font-size: var(--spf-text-md, 15px); }
        .track-name { font-size: var(--spf-text-base, 13.5px); }
        .track-artist { font-size: var(--spf-text-sm, 12px); }
    }

    /* --- Content Components --- */
    .section-title { font-size: var(--spf-text-lg, 17px); font-weight: 700; margin-bottom: 16px; margin-top: 32px; }
    .section-title:first-child { margin-top: 0; }
    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; margin-top: 32px; }
    .section-header .section-title { margin: 0; }
    .see-all-btn { background: none; border: none; color: var(--spf-text-sub); font-weight: 700; cursor: pointer; font-size: var(--spf-text-sm, 12px); letter-spacing: 1px; text-transform: uppercase; transition: color 0.2s; }
    .see-all-btn:hover { color: var(--spf-text-main); text-decoration: underline; }

    .carousel-wrapper { position: relative; }
    .carousel-layout { 
        display: flex; overflow-x: auto; gap: 20px; 
        margin-left: -24px; margin-right: -24px; padding-left: 24px; padding-right: 24px;
        padding-bottom: 10px; 
        scroll-behavior: smooth; scrollbar-width: none; -webkit-overflow-scrolling: touch; 
    }
    .carousel-layout::-webkit-scrollbar { height: 6px; background: transparent; }
    .carousel-layout:hover::-webkit-scrollbar-thumb { background: var(--spf-scroll-thumb); border-radius: 4px; }
    .carousel-layout .media-card { min-width: 125px; width: 125px; flex-shrink: 0; }

    .section-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(125px, 1fr)); gap: 20px; }

    .scroll-btn {
        position: absolute; top: 45%; transform: translateY(-50%); z-index: 2;
        background: rgba(0,0,0,0.7); color: var(--spf-text-main); border: none; border-radius: 50%; 
        width: 32px; height: 32px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity 0.3s; right: -10px;
    }
    .carousel-wrapper:hover .scroll-btn { opacity: 1; }

    /* Media Card */
    .media-card {
        padding: 16px; background: var(--spf-bg-card); border-radius: 8px;
        transition: background 0.3s ease, transform 0.1s ease; 
        cursor: pointer; position: relative; box-sizing: border-box;
        backface-visibility: hidden; 
        
        /* FIX: Enforce minimum width so skeletons don't squish */
        min-width: 125px; 
    }
    
    @media (hover: hover) { 
        .media-card:hover { background: var(--spf-bg-card-hover); } 
        .media-card:active { transform: scale(0.96); background: var(--spf-bg-card-hover); }
    }

    .media-image-wrapper {
        position: relative;
        width: 100%; 
        /* FIX: Reserve square space immediately, even if empty */
        aspect-ratio: 1 / 1; 
        margin-bottom: 12px; 
        box-shadow: 0 4px 8px rgba(0,0,0,0.3); 
    }
    
    .media-image, .card-image-sk { 
        position: absolute; top: 0; left: 0; /* Pin to corners of wrapper */
        width: 100%; height: 100%; 
        border-radius: 4px; background-size: cover; background-position: center; 
    }
    
    .play-btn-overlay {
        position: absolute; top: 50%; left: 50%; 
        width: 48px; height: 48px; border-radius: 50%; 
        background-color: var(--spf-brand); color: black; border: none;
        box-shadow: 0 8px 16px rgba(0,0,0,0.3); 
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; opacity: 0; 
        transform: translate(-50%, -50%) scale(0.5); 
        transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .play-btn-overlay svg { width: 24px; height: 24px; fill: currentColor; }

    @media (hover: hover) { 
        .media-card:hover .play-btn-overlay { opacity: 1; transform: translate(-50%, -50%) scale(1); } 
    }
    .play-btn-overlay:hover { transform: translate(-50%, -50%) scale(1.1) !important; background-color: var(--spf-brand-hover); }
    
    .media-card.artist-card { background: transparent; padding: 10px; }
    /* Circular art: no square shadow box, and hover highlights the circle
       (a ring) instead of drawing a rectangle around a transparent card */
    .media-card.artist-card .media-image-wrapper { box-shadow: none; }
    @media (hover: hover) {
        .media-card.artist-card:hover { background: transparent; }
        .media-card.artist-card:hover .media-image { box-shadow: 0 0 0 3px var(--spf-hover-white); }
    }
    
    .media-title { font-weight: 700; font-size: var(--spf-text-base, 13.5px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
    .media-subtitle { font-size: var(--spf-text-sm, 12px); color: var(--spf-text-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Hero & artist-pill styles live in spotify-context-view.styles.js
       (playlist/artist views are the only consumers and import it).
       .recent-grid-layout lives in components/spotify-home.styles.js (home is
       the only consumer); the scrollbar rules below still reference it. */

    /* Track Rows (also consumed by spotify-context-list, which imports only
       sharedStyles — keep these here) */
    .track-row {
        overflow: visible;
        display: grid;
        /* num/art | title+artist | action buttons (flush right) */
        grid-template-columns: 40px 1fr auto;
        padding: 8px 16px; border-radius: 4px; align-items: center; cursor: pointer;

        /* FIX: Enforce minimum height to match loaded content */
        min-height: 56px;
        box-sizing: border-box;
    }
    .track-row.with-art { grid-template-columns: 40px 48px 1fr auto; }

    @media (hover: hover) { 
        .track-row:hover { background: var(--spf-hover-white); } 
        .track-row:active { background: var(--spf-active-white); }
    }
    
    .track-row.playing .track-name { color: var(--spf-brand); }
    .track-num { color: var(--spf-text-sub); font-size: var(--spf-text-base, 13.5px); text-align: center; }
    
    .track-art-small {
        width: 40px; height: 40px; background-size: cover; background-position: center;
        border-radius: 4px; background-color: var(--spf-skeleton-bg);
    }

    .track-name { color: var(--spf-text-main); font-size: var(--spf-text-md, 15px); }
    .track-artist { color: var(--spf-text-sub); font-size: var(--spf-text-base, 13.5px); }

    .track-actions-right {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
    }
    
    
    .track-action-btn { background: transparent; border: none; color: var(--spf-text-sub); cursor: pointer; padding: 8px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: color 0.2s, background 0.2s; }
    @media (hover: hover) { .track-action-btn:hover { color: var(--spf-text-main); background: var(--spf-hover-white); } }
    .track-action-btn.is-favorite { color: var(--spf-brand); }
    .track-action-btn.is-favorite svg { fill: var(--spf-brand); }
    
    
    /* Artist / Skeleton Styles */
    .skeleton-pulse { animation: pulse 1.5s infinite ease-in-out; background: var(--spf-bg-card-hover); }
    .card-image-sk { background: var(--spf-bg-card-hover); }
    .card-text-sk { height: 12px; background: var(--spf-bg-card-hover); margin-bottom: 8px; border-radius: 2px; width: 80%; }
    .card-text-sk.short { width: 50%; }
    @keyframes pulse { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }

    /* ================================================= */
    /* SCROLLBAR STYLING (Floating & Hover Only)        */
    /* ================================================= */
    /* The .page entries of these selector lists (the router's page
       elements, root shadow root only) are in spotify-browser-app.styles.js. */

    /* 1. Mobile/Touch: Native Overlay (Fade on scroll) */
    @media (max-width: 768px) {
        .queue-list, .carousel-layout, .recent-grid-layout, .scroll-content {
            scrollbar-width: none; /* Hide standard bars */
            -ms-overflow-style: none;
        }
        ::-webkit-scrollbar { display: none; } 
    }

    /* 2. Desktop: Invisible Track + Floating Thumb */
    @media (min-width: 769px) {
        .queue-list, .carousel-layout, .recent-grid-layout, .scroll-content {
            /* Try to force overlay (Chrome/Edge feature) */
            overflow-y: overlay !important;
            
            /* Firefox: Thin and invisible until hover */
            scrollbar-width: thin;
            scrollbar-color: transparent transparent;
            transition: scrollbar-color 0.3s;
        }

        /* Firefox Hover */
        .queue-list:hover, .scroll-content:hover {
            scrollbar-color: rgba(255,255,255,0.2) transparent;
        }

        /* --- Webkit (Chrome/Edge/Safari) --- */

        /* The Container */
        ::-webkit-scrollbar {
            width: 8px !important; /* Width of the interactive zone */
            background: transparent !important;
        }

        /* The Highway (Track) - Must be invisible */
        ::-webkit-scrollbar-track {
            background: transparent !important;
            margin: 4px 0;
        }

        /* The Moving Part (Thumb) */
        ::-webkit-scrollbar-thumb {
            background-color: transparent; /* Invisible by default */
            
            /* MAGIC TRICK: Simulates a "floating" pill */
            border-radius: 8px;
            border: 2px solid transparent; 
            background-clip: content-box; 
        }

        /* Show Thumb on Container Hover */
        .queue-list:hover::-webkit-scrollbar-thumb,
        .scroll-content:hover::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.25); /* Visible Grey */
        }

        /* Brighten on Grab */
        ::-webkit-scrollbar-thumb:hover {
            background-color: rgba(255, 255, 255, 0.5) !important;
        }
    }
    
`;
