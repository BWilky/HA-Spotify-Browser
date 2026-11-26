import { css } from "./lit.js";

/**
 * App shell: the rules that can only ever match inside the root component's
 * shadow root (spotify-browser-app.js) - the backdrop, the browser wrapper
 * (the app frame: desktop window / mobile sheet, its open/close transitions
 * per `appearance.animations`, no-blur, kb-open, queue-open), the page
 * container, the classes the router puts on page elements (`page`,
 * `home-page`, `search-page`, `has-hero`, `page-hidden`, the slide/fade
 * transition classes and their @keyframes) and the mobile bottom nav.
 *
 * Adopted by the root only, AFTER sharedStyles. The only sharedStyles rules
 * that match anything in the root's shadow root are :host and the global
 * ::-webkit-scrollbar* rules (the root renders no button/input and none of
 * the shared classes), and those never set the same property at the same
 * specificity and importance as a rule here on the same element, so the
 * cascade is the same as when these rules sat in between them in one sheet.
 */
export const shellStyles = css`
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
            /* On touch tablets the height is locked in px at open time (see
               _captureAppHeight) so the keyboard overlays the window; pointer-fine
               desktops fall back to live 85vh. */
            width: 85vw; max-width: 1200px; height: var(--spf-app-height, 85vh);
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

        .page-container {
            transition: margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .browser-wrapper.queue-open .page-container { margin-right: 350px; }
        
        .browser-wrapper.is-dragging .page-container {
            transition: none !important;
        }

        /* While the on-screen keyboard is up (kb-open, toggled by JS), anchor the
           floating window to the top at its full pre-keyboard height so the
           keyboard overlays the lower edge instead of shrinking/reflowing it. */
        .browser-wrapper.open.kb-open {
            top: 0 !important;
            height: var(--spf-app-height, 85vh) !important;
            transform: translateX(-50%) !important;
            border-radius: 0 0 16px 16px;
            transition: none !important;
        }
    }

    /* ================= MOBILE STYLES ================= */
    @media (max-width: 768px) {
        .browser-wrapper {
            /* Anchored to the top with a height locked at open time, so the
               on-screen keyboard overlays the panel instead of resizing it. */
            top: 0; left: 0; width: 100%; height: var(--spf-app-height, 100%);
            max-width: none; max-height: none;
            border-radius: 0;
            margin-top: 0;
            border: none;

            /* Base Mobile Hidden State */
            pointer-events: none;
        }

        /* --- MOBILE FADE (Slide-up panel with fade) --- */
        .browser-wrapper.anim-fade {
            transform: translateY(100%);
            opacity: 0;
            transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
        }
        .browser-wrapper.open.anim-fade {
            transform: translateY(0);
            opacity: 1; pointer-events: auto;
        }

        /* --- MOBILE SLIDE --- */
        .browser-wrapper.anim-slide {
            transform: translateY(100%);
            opacity: 1; 
            transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
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

        .browser-wrapper.queue-open .queue-panel::before {
            pointer-events: auto;
        }

        .browser-wrapper.queue-open .page-container { margin-right: 0 !important; }

        /* Mobile Bottom Nav (the mini-player's styles live in its own
           element, components/players/mini-player.js) */
        .mobile-bottom-nav {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: calc(60px + var(--spf-safe-bottom, 0px));
            padding-bottom: var(--spf-safe-bottom, 0px);
            background: rgba(18, 18, 18, 0.95);
            backdrop-filter: blur(24px);
            -webkit-backdrop-filter: blur(24px);
            border-top: 1px solid var(--spf-border-subtle, rgba(255,255,255,0.05));
            display: flex;
            justify-content: space-around;
            align-items: center;
            z-index: 10000;
            box-sizing: border-box;
        }
        .nav-tab {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: #b3b3b3;
            font-size: var(--spf-text-xs, 11px);
            font-weight: 500;
            cursor: pointer;
            gap: 4px;
            flex: 1;
            height: 100%;
            transition: color 0.2s ease;
        }
        .nav-tab svg {
            width: 22px;
            height: 22px;
            fill: currentColor;
        }
        .nav-tab.active {
            color: #ffffff;
        }
    }

    /* --- Page & Transitions --- */

    .page-container { position: relative; flex: 1; overflow: hidden; background: var(--spf-bg); box-sizing: border-box; }
    .page {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        overflow-y: auto; overflow-x: hidden;
        background: var(--spf-bg);
        transition: transform 0.3s ease, opacity 0.3s ease;
        padding-top: calc(64px + var(--spf-safe-top)); box-sizing: border-box;
        
        /* GPU Acceleration Hints */
        will-change: transform, opacity;
        backface-visibility: hidden;
        transform: translateZ(0); 
    }
    .page.has-hero { padding-top: 0 !important; }
    .page.has-hero-header { padding-top: 0; }
    /* Mobile search/library own their own top bar (no app header), so drop the page inset. */
    @media (max-width: 768px) {
        .page.search-page { padding-top: 0 !important; }
        /* Home's header is shrunk to just the collapse arrow + avatar, so its
           content clears a much smaller bar (matches the header rule). */
        .page.home-page { padding-top: calc(52px + var(--spf-safe-top)) !important; }
    }
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

    .browser-wrapper.is-dragging .page-container,
    .browser-wrapper.is-dragging .queue-panel {
        transition: none !important;
    }

    /* Scrollbars of the router's pages (the .page part of the scrollbar
       treatment in sharedStyles, same declarations, same order). */
    /* 1. Mobile/Touch: Native Overlay (Fade on scroll) */
    @media (max-width: 768px) {
        .page {
            scrollbar-width: none; /* Hide standard bars */
            -ms-overflow-style: none;
        }
    }

    /* 2. Desktop: Invisible Track + Floating Thumb */
    @media (min-width: 769px) {
        .page {
            /* Try to force overlay (Chrome/Edge feature) */
            overflow-y: overlay !important;
            
            /* Firefox: Thin and invisible until hover */
            scrollbar-width: thin;
            scrollbar-color: transparent transparent;
            transition: scrollbar-color 0.3s;
        }

        /* Firefox Hover */
        .page:hover {
            scrollbar-color: rgba(255,255,255,0.2) transparent;
        }

        /* Show Thumb on Container Hover */
        .page:hover::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.25); /* Visible Grey */
        }
    }
`;
