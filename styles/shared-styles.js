import { css } from "../lit.js";

export const sharedStyles = css`
    :host {
        display: block;
        position: absolute;
        top: 0; left: 0; width: 0; height: 0;
        z-index: 9999;

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

    /* --- EDIT MODE --- */
    :host(.edit-mode) {
        position: relative;
        width: 100%;
        height: auto;
        z-index: 1; 
    }

    .editor-placeholder {
        display: none;
        background: var(--spf-bg-card);
        border: 1px dashed var(--spf-border);
        border-radius: 12px;
        padding: 16px;
        align-items: center;
        gap: 16px;
        cursor: pointer;
        box-sizing: border-box;
        margin-bottom: 8px;
    }

    :host(.edit-mode) .editor-placeholder { display: flex; }

    .editor-icon { 
        width: 40px; height: 40px; 
        background: var(--spf-brand); 
        border-radius: 50%; 
        display: flex; align-items: center; justify-content: center; 
        color: black; flex-shrink: 0;
    }
    .editor-icon svg { width: 24px; height: 24px; }
    
    .editor-text { display: flex; flex-direction: column; }
    .editor-text strong { color: var(--spf-text-main); font-size: 14px; }
    .editor-text span { color: var(--spf-text-sub); font-size: 12px; }

    /* --- Global Backdrop --- */
    .backdrop {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0, 0, 0, 0.6);
        opacity: 0; pointer-events: none; 
        transition: opacity 0.3s ease;
        z-index: 9998; 
        backdrop-filter: blur(4px);
    }
    .backdrop.open { opacity: 1; pointer-events: auto; }

    /* --- Main Browser Shell --- */
    .browser-wrapper {
        position: fixed;
        background: var(--spf-bg); 
        color: var(--spf-text-main);
        display: flex; flex-direction: column;
        transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        z-index: 9999;
        overflow: hidden;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        box-sizing: border-box;
    }

    /* ================= DESKTOP STYLES ================= */
    @media (min-width: 769px) {
        .browser-wrapper {
            top: 50%; left: 50%;
            width: 85vw; max-width: 1200px; height: 85vh;
            border-radius: 16px;
            box-shadow: 0 20px 50px rgba(0,0,0,0.6);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            
            /* Base State (Hidden) varies by animation */
            pointer-events: none;
            opacity: 0; 
        }

        /* --- FADE (Default) --- */
        .browser-wrapper.anim-fade {
            transform: translate(-50%, -45%) scale(0.95);
            transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .browser-wrapper.open.anim-fade {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1; pointer-events: auto;
        }

        /* --- SLIDE (Legacy-ish) --- */
        .browser-wrapper.anim-slide {
            transform: translate(-50%, 100vh); /* Start off-screen bottom */
            opacity: 1; /* Visible, just off screen */
            transition: transform 0.5s cubic-bezier(0.19, 1, 0.22, 1);
        }
        .browser-wrapper.open.anim-slide {
            transform: translate(-50%, -50%);
            opacity: 1; pointer-events: auto;
        }

        /* --- NONE --- */
        .browser-wrapper.anim-none {
            transform: translate(-50%, -50%); /* Just center it */
            transition: none !important;
            display: none; /* Hide when closed */
        }
        .browser-wrapper.open.anim-none {
            display: flex;
            opacity: 1; pointer-events: auto;
        }

        /* --- NO BLUR (Opaque Fallback) --- */
        .browser-wrapper.no-blur {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            background: #121212 !important; /* Solid Opaque */
            box-shadow: 0 20px 50px rgba(0,0,0,0.9);
        }
        
        .queue-header-wrapper {
            position: relative;
            padding: 0 !important; /* Critical: Remove wrapper padding */
            overflow: visible;      /* Allow floating volume to hang out */
            background: var(--spf-bg);
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 5;
        }
        
        .page-container {
            transition: margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .browser-wrapper.queue-open .page-container { margin-right: 350px; }
        
        .browser-wrapper.is-dragging .page-container {
            transition: none !important;
        }
        
        .mobile-drag-handle { display: none; }
    }

    /* ================= MOBILE STYLES ================= */
    @media (max-width: 768px) {
        .browser-wrapper {
            bottom: 0; left: 0; width: 100%; height: 100%;
            max-width: none; max-height: none;
            border-radius: 0;
            margin-top: 0;
            border: none;
            
            /* Base Mobile Hidden State */
            pointer-events: none;
        }

        /* --- MOBILE FADE --- */
        .browser-wrapper.anim-fade {
            transform: translateY(0);
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        .browser-wrapper.open.anim-fade {
            opacity: 1; pointer-events: auto;
        }

        /* --- MOBILE SLIDE (Default) --- */
        .browser-wrapper.anim-slide {
            transform: translateY(100%);
            opacity: 1; 
            transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .browser-wrapper.open.anim-slide {
            transform: translateY(0);
            pointer-events: auto;
        }
        
        /* --- MOBILE NONE --- */
        .browser-wrapper.anim-none {
            display: none;
            transform: translateY(0);
        }
        .browser-wrapper.open.anim-none {
            display: block; opacity: 1; pointer-events: auto;
        }

        /* Fix Queue Mobile - Slide OVER header (z-index 120 > 110) */
        spotify-queue {
            z-index: 200000 !important;
        }

        .queue-panel {
            top: 0 !important;
            padding-top: 0;
            height: 100% !important;
        }

        .queue-panel::before {
            content: '';
            position: absolute;
            bottom: 0; left: 0; width: 100%; height: 200vh; 
            background: rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            z-index: -1; 
            pointer-events: none; 
            opacity: var(--blur-opacity);
            transition: opacity 0.3s ease;
        }
        
        .browser-wrapper.queue-open .queue-panel::before {
            pointer-events: auto;
        }
        
        .queue-panel.is-dragging::before {
            transition: none !important;
        }

        .queue-header-wrapper {
            border-radius: 20px 20px 0 0;
            border-top: 1px solid var(--spf-border);
            padding-bottom: 8px;
            background: var(--spf-bg); 
            box-shadow: 0 -10px 40px rgba(0,0,0,0.5); 
            padding-top: 12px; 
            overflow: hidden;
        }

        .queue-list { background: var(--spf-bg); }

        .mobile-drag-handle {
            display: block !important;
            width: 40px; height: 4px;
            background: #ffffff; opacity: 0.3; 
            border-radius: 2px;
            margin: 16px auto 4px auto; 
        }
        
        .browser-wrapper.queue-open .page-container { margin-right: 0 !important; }
        .search-container.active { width: auto !important; flex: 1; margin-right: 8px; }
        .hero-title { font-size: 2rem !important; }
        .grid-layout { grid-template-columns: repeat(2, 1fr) !important; gap: 12px; }
        
        .header { padding: 0 12px !important; }
        .header-left, .header-right { gap: 8px !important; }
    }

    /* --- Header --- */
    .header {
        position: absolute; top: 0; left: 0; right: 0; height: 64px;
        display: flex; justify-content: space-between; align-items: center;
        padding: 0 24px; background: rgba(18, 18, 18, 1);
        z-index: 110; 
        transition: border-bottom 0.3s ease;
    }
    
    .header-center-title {
        position: absolute; left: 50%; transform: translateX(-50%);
        font-weight: 700; font-size: 18px; color: var(--spf-text-main);
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
        color: #000; font-size: 14px; opacity: 0; width: 0; min-width: 0; 
        padding: 0; margin: 0; pointer-events: none; position: relative; z-index: 1; 
        transition: opacity 0.2s, width 0.3s ease; line-height: 40px; 
    }
    .search-container.active .search-input { 
        opacity: 1; width: 100%; margin-left: 4px; pointer-events: auto; 
    }
    
    /* --- Search Result List Layout --- */
    .search-list-layout { display: flex; flex-direction: column; gap: 4px; }

    /* Generic List Item */
    .list-item {
        display: grid;
        grid-template-columns: 56px 1fr 32px; 
        gap: 16px; padding: 8px 16px;
        align-items: center; border-radius: 6px;
        transition: background 0.2s; cursor: pointer;
    }
    @media (hover: hover) { .list-item:hover { background: var(--spf-hover-white); } }
    .list-item:active { background: var(--spf-active-white); }

    .list-item-img {
        width: 56px; height: 56px;
        background-size: cover; background-position: center;
        border-radius: 4px; background-color: var(--spf-skeleton-bg);
    }
    .list-item.artist .list-item-img { border-radius: 50%; }

    .list-item-info { display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
    .list-item-title { font-size: 16px; font-weight: 600; color: var(--spf-text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
    .list-item-subtitle { font-size: 14px; color: var(--spf-text-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .list-item-action { color: var(--spf-text-sub); display: flex; justify-content: center; }


    /* --- Page & Transitions --- */
    
    .scroll-content {
        position: relative;
        z-index: 1;
        /* This is the margin you lost */
        padding: 24px; 
        /* This ensures you can scroll past the bottom player */
        padding-bottom: 100px; 
    }

    .page-container { position: relative; flex: 1; overflow: hidden; background: var(--spf-bg); box-sizing: border-box; }
    .page {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        overflow-y: auto; overflow-x: hidden;
        background: var(--spf-bg);
        transition: transform 0.3s ease, opacity 0.3s ease;
        padding-top: 64px; box-sizing: border-box;
        
        /* GPU Acceleration Hints */
        will-change: transform, opacity;
        backface-visibility: hidden;
        transform: translateZ(0); 
    }
    .page.has-hero { padding-top: 0 !important; }
    .page.has-hero-header { padding-top: 0; }
    .page-hidden { display: none; }
    
    .slide-in-right { animation: slideInRight 0.3s forwards; }
    .slide-out-left { animation: slideOutLeft 0.3s forwards; }
    .slide-in-left { animation: slideInLeft 0.3s forwards; }
    .slide-out-right { animation: slideOutRight 0.3s forwards; }
    .fade-in { animation: fadeIn 0.3s forwards; }

    @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
    @keyframes slideOutLeft { from { transform: translateX(0); } to { transform: translateX(-30%); opacity: 0; } }
    @keyframes slideInLeft { from { transform: translateX(-30%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes slideOutRight { from { transform: translateX(0); } to { transform: translateX(100%); } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }





    /* ================================================= */
    /* QUEUE PANEL & MINI PLAYER                         */
    /* ================================================= */

    /* --- 1. Main Slide-out Panel --- */
    .queue-panel {
        position: absolute; 
        top: 64px; 
        right: 0; 
        bottom: 0;
        width: 350px; 
        background: var(--spf-bg); 
        z-index: 100; 
        display: flex; 
        flex-direction: column;
    }

    /* --- 2. Sticky Header (Now Playing) --- */
    .queue-header-wrapper {
        flex-shrink: 0;
        background: var(--spf-bg);
        border-bottom: 1px solid var(--spf-border-subtle);
        z-index: 5; 
        position: relative;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4); 
        
        /* FIX: Zero padding ensures progress bar hits the edge */
        padding: 0 !important; 
        overflow: hidden;
    }

    .queue-now-playing-row {
        position: relative; /* Anchor for absolute elements */
        padding: 16px 16px 12px 16px; /* Content breathing room */
        display: flex;
        flex-direction: column;
    }

    .queue-item-content { 
        display: flex; 
        align-items: center; 
        gap: 16px; 
    }

    /* --- 3. Header Album Art --- */
    .queue-art.large { 
        width: 64px; 
        height: 64px; 
        box-shadow: 0 4px 12px rgba(0,0,0,0.3); 
        border-radius: 4px;
        background-size: cover;
        background-position: center;
        flex-shrink: 0;
        background-color: var(--spf-skeleton-bg);
        animation: imageFadeIn 0.5s ease-out;
    }

    @keyframes imageFadeIn {
        0% { opacity: 0; transform: scale(0.95); }
        100% { opacity: 1; transform: scale(1); }
    }

    /* --- 4. Header Text Info Stack --- */
    .queue-info { 
        flex: 1; 
        overflow: hidden; 
        display: flex; 
        flex-direction: column; 
        justify-content: center; 
        
        /* Space from Right Play Button */
        margin-right: 12px; 
        
        /* Tight grouping logic */
        gap: 0; 
        min-width: 0; /* Critical for ellipsis */
    }

    .queue-title { 
        font-size: 14px; 
        font-weight: 700; 
        color: var(--spf-text-main); 
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis;
        
        /* Tight to Artist */
        line-height: 1.2;
        margin-bottom: 1px;
    }
    .queue-title.active { color: var(--spf-brand); }

    .queue-artist {
        font-size: 13px;
        color: var(--spf-text-sub);
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis;
        
        /* Separated from Device */
        line-height: 1.2;
        margin-bottom: 4px;
    }

    .queue-device-row {
        display: flex;
        align-items: center;
        gap: 4px;
        
        font-size: 11px; 
        font-weight: 500;
        color: var(--spf-brand); /* Green indicator */
        opacity: 0.9;
        
        margin-top: 0;
        line-height: 1.2;
        
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis;
    }
    .queue-device-row svg {
        width: 12px; height: 12px;
        fill: currentColor;
        flex-shrink: 0;
    }
    .device-name-text {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* --- 5. Controls Rows (Buttons & Volume) --- */
    
    /* Unified Container Rules */
    .queue-mini-controls,
    .volume-control-container {
        display: flex;
        align-items: center;
        width: 100%;
        
        /* LOCK DIMENSIONS to prevent jumps */
        height: 48px;       
        margin-top: 4px;    
        padding: 0 8px;    
        box-sizing: border-box;
    }

    /* Standard Buttons Layout */
    .queue-mini-controls {
        justify-content: space-between; 
    }

    /* Volume Slider Layout */
    .volume-control-container {
        justify-content: center; 
        animation: fadeIn 0.2s ease;
    }

    /* Mini Buttons (General) */
    .mini-btn {
        background: transparent; 
        border: none; 
        color: var(--spf-text-sub); 
        cursor: pointer; 
        padding: 8px; /* Consistent hit area */
        display: flex; 
        align-items: center; 
        justify-content: center;
        transition: color 0.2s, transform 0.2s;
    }
    .mini-btn:hover { color: var(--spf-text-main); transform: scale(1.1); }
    .mini-btn svg { width: 24px; height: 24px; }
    .mini-btn.is-favorite { color: var(--spf-brand); }
    .mini-btn.is-favorite svg { fill: var(--spf-brand); }

    /* Volume Slider Styling */
    .vol-icon {
        display: flex; align-items: center; justify-content: center;
        width: 24px; color: var(--spf-text-sub);
    }
    
    .volume-slider {
        flex: 1; 
        -webkit-appearance: none;
        height: 4px;
        background: rgba(255,255,255,0.2);
        border-radius: 2px;
        outline: none;
        margin: 0 12px; 
    }
    .volume-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px; height: 14px;
        background: #fff;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    }

    /* Large Side Play Button */
    .queue-play-btn.large-side-btn {
        width: 48px; height: 48px;
        border-radius: 50%;
        background: var(--spf-text-main); 
        color: black; 
        border: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; 
        transition: transform 0.2s;
        flex-shrink: 0;
    }
    .queue-play-btn.large-side-btn:hover {
        transform: scale(1.05);
        background: var(--spf-brand-hover);
    }
    .queue-play-btn.large-side-btn svg { fill: black; }

    /* --- 6. Progress Bar (The Divider) --- */
    .queue-progress-container {
        position: absolute; 
        bottom: 0;          
        left: 0;            
        width: 100%;        
        height: 3px;        
        margin: 0;
        padding: 0;
        background: rgba(255, 255, 255, 0.1);
        z-index: 10;
    }
    
    .queue-progress-bar {
        height: 100%;
        background: var(--spf-brand);
        width: 0%;
        border-radius: 0 4px 4px 0;
        transition: width 1s linear;
    }
    /* Dot indicator on hover */
    .queue-progress-bar::after {
        content: ''; position: absolute; right: -3px; top: -3px;
        width: 8px; height: 8px; background: var(--spf-text-main);
        border-radius: 50%; opacity: 0; transition: opacity 0.2s;
    }
    .queue-header-wrapper:hover .queue-progress-bar::after { opacity: 1; }

    /* --- 7. The Queue List --- */
    .queue-list { 
        flex: 1; 
        overflow-y: auto; 
        padding: 0 0 16px 0; 
        background: var(--spf-bg);
    }

    .queue-item {
        display: flex; 
        align-items: center; 
        padding: 8px 16px 8px 8px; 
        gap: 12px; 
        cursor: default;
        transition: background 0.2s;
        border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    @media (hover: hover) { .queue-item:hover { background: var(--spf-border-subtle); } }

    /* List Item Art (Smaller) */
    .queue-art { 
        width: 40px; height: 40px; 
        border-radius: 4px; 
        background-size: cover; 
        background-position: center; 
        flex-shrink: 0;
        background-color: var(--spf-skeleton-bg);
        animation: imageFadeIn 0.5s ease-out;
    }

    .queue-row-play-btn {
        background: transparent; border: none; color: var(--spf-text-sub);
        cursor: pointer; padding: 8px; display: flex; align-items: center; justify-content: center;
        transition: color 0.2s, transform 0.2s;
    }
    .queue-row-play-btn:hover { color: var(--spf-text-main); transform: scale(1.1); }
    .queue-row-play-btn svg { width: 24px; height: 24px; }

    /* List Animation Logic */
    .queue-item.adding-top {
        animation: slideDownEnter 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        overflow: hidden; background: rgba(255, 255, 255, 0.05);
    }
    @keyframes slideDownEnter {
        0% { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; margin: 0; transform: translateY(-20px); }
        100% { opacity: 1; max-height: 60px; padding: 8px 12px 8px 4px; transform: translateY(0); }
    }

    .queue-item.removing {
        animation: collapseRow 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        overflow: hidden; pointer-events: none; 
    }
    @keyframes collapseRow {
        0% { opacity: 1; max-height: 60px; transform: scale(1); margin-bottom: 0; }
        50% { opacity: 0; transform: scale(0.9); }
        100% { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; margin: 0; border: none; transform: scale(0.9); }
    }

    .queue-item.optimistic-fade-in {
        animation: slideInFade 0.4s ease-out forwards;
        opacity: 0; transform: translateY(10px);
    }
    @keyframes slideInFade {
        0% { opacity: 0; transform: translateY(10px); }
        100% { opacity: 1; transform: translateY(0); }
    }

    /* --- 8. Empty States & Labels --- */
    .queue-empty-state {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        height: 200px; text-align: center; opacity: 0.5;
    }
    .empty-text { margin-top: 16px; font-weight: 700; font-size: 16px; }
    .empty-sub { font-size: 13px; }
    
    .queue-section-label { 
        padding: 12px 16px 4px; 
        font-size: 12px; 
        font-weight: 700; 
        color: var(--spf-text-sub); 
        text-transform: uppercase; 
        letter-spacing: 1px; 
    }






    /* --- Device Popup --- */
    /* --- Generic Popup & Dialog --- */
    .popup-backdrop {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
        z-index: 200000; /* Must be > header (100002) */
        display: none; align-items: center; justify-content: center;
        opacity: 0; pointer-events: none; transition: opacity 0.3s;
    }
    .popup-backdrop.visible { opacity: 1; pointer-events: auto; display: flex; }
    
    .popup-backdrop.no-blur {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        background: rgba(0,0,0,0.9); /* Darker overlay if no glass */
    }
    
    .popup-content {
        background: var(--spf-bg); width: 90%; max-width: 400px;
        border-radius: 16px; padding: 24px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.8);
        display: flex; flex-direction: column; gap: 16px;
        position: relative;
    }
    .popup-title { margin: 0; font-size: 18px; font-weight: 700; text-align: center; color: var(--spf-text-main); }
    .popup-scroll-content { max-height: 300px; overflow-y: auto; }
    .popup-close-btn { background: transparent; border: none; color: var(--spf-text-main); font-weight: 700; padding: 12px; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; align-self: center; }

    /* Alert / Confirm Specifics */
    .alert-dialog { max-width: 320px; text-align: center; }
    .alert-buttons { display: flex; gap: 12px; justify-content: center; margin-top: 8px; }
    .alert-btn { flex: 1; padding: 10px; border-radius: 20px; border: 1px solid var(--spf-border); background: transparent; color: var(--spf-text-main); cursor: pointer; font-weight: 700; }
    .alert-btn.primary { background: var(--spf-brand); color: black; border: none; }
    
    /* Device List specific styles (reused inside popup) */
    .device-row {
        display: flex; align-items: center; gap: 12px;
        padding: 12px; border-radius: 8px; cursor: pointer;
        transition: background 0.2s; color: var(--spf-text-sub);
    }
    @media (hover: hover) { .device-row:hover { background: var(--spf-hover-white); color: var(--spf-text-main); } }
    .device-row:active { background: var(--spf-active-white); color: var(--spf-text-main); }
    .device-row.active { color: var(--spf-brand); }
    
    .device-icon { width: 24px; height: 24px; }
    .device-info { flex: 1; }
    .device-name { font-weight: 600; font-size: 14px; display:flex; align-items:center; gap:6px; }
    .device-type { font-size: 12px; opacity: 0.7; text-transform: capitalize; }
    .device-active-icon { display: flex; }

    /* --- Toast Notification --- */
    .toast-container {
        position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
        display: flex; flex-direction: column; gap: 8px; z-index: 300; pointer-events: none;
        width: 90%; max-width: 400px;
    }
    .toast-message {
        background: var(--spf-bg-card-hover); color: var(--spf-text-main);
        padding: 12px 16px; border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        font-size: 14px; text-align: center;
        opacity: 0; transform: translateY(20px);
        animation: toastEnter 0.3s forwards;
    }
    .toast-message.hiding { animation: toastExit 0.3s forwards; }
    
    @keyframes toastEnter { to { opacity: 1; transform: translateY(0); } }
    @keyframes toastExit { to { opacity: 0; transform: translateY(-10px); } }

    /* Re-add device refresh btn styling compatible with new popup */
    .device-refresh-btn {
        margin-top: 16px; background: transparent; 
        border: 1px solid var(--spf-border);
        color: var(--spf-text-main); padding: 8px 20px; 
        border-radius: 20px; cursor: pointer; 
        font-size: 12px; font-weight: 700; 
        text-transform: uppercase; letter-spacing: 1px;
        transition: all 0.2s;
    }
    .device-refresh-btn:hover { border-color: var(--spf-text-main); background: var(--spf-hover-white); }
    
    /* --- Dropdown Menu --- */
    .dropdown-menu {
        position: absolute; top: 60px; right: 60px;
        background: var(--spf-bg-card-hover); border-radius: 8px;
        width: 180px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        display: none; flex-direction: column; z-index: 30;
    }
    .dropdown-menu.visible { display: flex; }
    
    .menu-item { padding: 12px 16px; cursor: pointer; font-size: 14px; color: var(--spf-text-main); transition: background 0.2s; }
    @media (hover: hover) { .menu-item:hover { background: var(--spf-hover-white); } }
    .menu-item:active { background: var(--spf-active-white); }
    .menu-item:first-child { border-radius: 8px 8px 0 0; }
    .menu-item:last-child { border-radius: 0 0 8px 8px; }

    /* --- Content Components --- */
    .section-title { font-size: 1.2rem; font-weight: 700; margin-bottom: 16px; margin-top: 32px; }
    .section-title:first-child { margin-top: 0; }
    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; margin-top: 32px; }
    .section-header .section-title { margin: 0; }
    .see-all-btn { background: none; border: none; color: var(--spf-text-sub); font-weight: 700; cursor: pointer; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; transition: color 0.2s; }
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

    .grid-layout { display: grid; grid-template-columns: repeat(auto-fill, minmax(125px, 1fr)); gap: 20px; }
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
    
    @media (hover: hover) { .media-card:hover { background: var(--spf-bg-card-hover); } }
    .media-card:active { transform: scale(0.96); background: var(--spf-bg-card-hover); }
    
    .media-card.playing .media-title { color: var(--spf-brand); }
    
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
    
    .media-title { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
    .media-subtitle { font-size: 12px; color: var(--spf-text-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* --- Global Pills Grid --- */
    .recent-grid-layout {
        display: grid; grid-template-rows: repeat(2, 1fr); 
        grid-auto-flow: column; grid-auto-columns: 180px; 
        gap: 12px; overflow-x: auto; padding-bottom: 16px; 
        scroll-behavior: smooth; scrollbar-width: none;
    }
    .recent-grid-layout::-webkit-scrollbar { display: none; }


    /* Hero & Artist Profile */
    .hero-banner, .artist-hero { 
        position: relative; height: 300px; width: 100%; overflow: hidden;
        transition: height 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); will-change: height;
    }
    .page.is-refreshing .hero-banner, .page.is-refreshing .artist-hero { height: 360px !important; }
    
    .hero-bg { 
        position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
        background: linear-gradient(to bottom, #555, var(--spf-bg)); 
        z-index: 0; transition: all 0.5s ease; 
        transform-origin: top center; will-change: transform;
    }
    
    .hero-gradient, .artist-hero .hero-gradient { 
        position: absolute; top: 0; left: 0; right: 0; bottom: 0; 
        background: linear-gradient(to top, var(--spf-bg) 0%, transparent 50%);
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
        background: #333; flex-shrink: 0; 
        
        /* FIX: Prevent collapse if image is missing */
        display: block; 
    }
    .hero-text { flex: 1; }
    .hero-type { font-size: 12px; text-transform: uppercase; font-weight: 700; margin-bottom: 4px; }
    .hero-title { font-size: 3rem; font-weight: 900; margin: 0 0 8px 0; line-height: 1; }
    .hero-subtitle { font-size: 14px; color: rgba(255,255,255,0.7); }
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
        cursor: pointer; transition: all 0.2s; font-size: 12px; font-weight: 700; letter-spacing: 1px;
    }
    .hero-btn-fav:hover { border-color: white; transform: scale(1.05); }
    .hero-btn-fav.is-favorite { color: var(--spf-brand); border-color: var(--spf-brand); }

    /* Track Rows */
    .track-row {
        overflow: visible;
        display: grid; 
        grid-template-columns: 40px 1fr auto 80px; 
        padding: 8px 16px; border-radius: 4px; align-items: center; cursor: pointer;
        
        /* FIX: Enforce minimum height to match loaded content */
        min-height: 56px; 
        box-sizing: border-box;
    }
    .track-row.with-art { grid-template-columns: 48px 1fr auto 80px; }

    @media (hover: hover) { .track-row:hover { background: var(--spf-hover-white); } }
    .track-row:active { background: var(--spf-active-white); }
    
    .track-row.playing .track-name { color: var(--spf-brand); }
    .track-num { color: var(--spf-text-sub); font-size: 14px; text-align: center; }
    
    .track-art-small {
        width: 40px; height: 40px; background-size: cover; background-position: center;
        border-radius: 4px; background-color: var(--spf-skeleton-bg);
    }

    .track-name { color: var(--spf-text-main); font-size: 15px; }
    .track-artist { color: var(--spf-text-sub); font-size: 13px; }
    .track-duration { color: var(--spf-text-sub); font-size: 14px; text-align: right; }

    .track-actions-right {
        display: flex;
        align-items: center;
        justify-content: flex-end; /* Keeps them grouped on the right side */
        
        /* ADD THIS to shift them leftwards away from the edge */
        padding-right: 24px;       /* Increase this number to move them further left */
        gap: 8px;                  /* Space between the buttons themselves */
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
    
    .artist-track-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 32px; }
    @media (max-width: 600px) { .artist-track-grid { grid-template-columns: 1fr; } .artist-hero-name { font-size: 2.5rem; } }

    .artist-top-track { display: flex; align-items: center; background: rgba(255,255,255,0.05); border-radius: 6px; overflow: hidden; transition: background 0.2s; height: 56px; cursor: pointer; position: relative; padding-right: 8px; }
    @media (hover: hover) { .artist-top-track:hover { background: var(--spf-hover-white); } }
    .artist-top-track:active { background: var(--spf-active-white); }
    
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
    .track-title { font-size: 14px; font-weight: 600; color: var(--spf-text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .track-meta { font-size: 12px; color: var(--spf-text-sub); margin-top: 2px; }

    .browser-wrapper.is-dragging .page-container,
    .browser-wrapper.is-dragging .queue-panel {
        transition: none !important;
    }
    
    /* ================================================= */
    /* SCROLLBAR STYLING (Floating & Hover Only)        */
    /* ================================================= */

    /* 1. Mobile/Touch: Native Overlay (Fade on scroll) */
    @media (max-width: 768px) {
        .queue-list, .device-list, .page, .carousel-layout, .recent-grid-layout, .scroll-content {
            scrollbar-width: none; /* Hide standard bars */
            -ms-overflow-style: none;
        }
        ::-webkit-scrollbar { display: none; } 
    }

    /* 2. Desktop: Invisible Track + Floating Thumb */
    @media (min-width: 769px) {
        .queue-list, .device-list, .page, .carousel-layout, .recent-grid-layout, .scroll-content {
            /* Try to force overlay (Chrome/Edge feature) */
            overflow-y: overlay !important;
            
            /* Firefox: Thin and invisible until hover */
            scrollbar-width: thin;
            scrollbar-color: transparent transparent;
            transition: scrollbar-color 0.3s;
        }

        /* Firefox Hover */
        .queue-list:hover, .page:hover, .device-list:hover, .scroll-content:hover {
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
        .device-list:hover::-webkit-scrollbar-thumb,
        .page:hover::-webkit-scrollbar-thumb,
        .scroll-content:hover::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.25); /* Visible Grey */
        }

        /* Brighten on Grab */
        ::-webkit-scrollbar-thumb:hover {
            background-color: rgba(255, 255, 255, 0.5) !important;
        }
    }
    
    /* --- PERFORMANCE MODE OVERRIDES --- */

    /* 1. Kill the Blur (Biggest GPU Saver) */
    .perf-mode .browser-header,
    .perf-mode .queue-panel,
    .perf-mode .track-popup-content,
    .perf-mode .device-popup-content,
    .perf-mode .search-bar-container {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        background: #121212 !important; /* Solid fallback color */
        border-bottom: 1px solid var(--spf-skeleton-bg);
    }
    
    /* 2. Simplified Transparencies */
    .perf-mode .queue-panel {
        background: #000000 !important; /* Solid black for queue */
    }
    
    /* 3. Disable Smooth Transitions (CPU Saver) */
    .perf-mode * {
        transition: none !important;
        animation: none !important;
    }
    
    /* 4. Remove Expensive Shadows */
    .perf-mode .media-card, 
    .perf-mode .queue-now-playing {
        box-shadow: none !important;
        border: 1px solid #333; /* Use simple border instead of shadow depth */
    }
    
    /* 5. Optimize Images */
    .perf-mode .hero-art,
    .perf-mode .queue-art {
        filter: none !important; /* Remove any brightness/contrast filters */
    }
    
    /* 6. Simplified Text Rendering */
    .perf-mode {
        text-rendering: auto !important; /* Disable optimizeLegibility */
    }
`;
