import { LitElement, html, css } from "../lit.js";

export const headerStyles = css`
    :host {
        display: block;
        position: absolute;
        top: 0; left: 0; width: 100%;
        height: calc(64px + var(--spf-safe-top, 0px)); /* Grows for Dynamic Island */
        z-index: 100002;
        pointer-events: none; /* Allow clicks through empty areas, but children have pointer-events: auto via .header */
    }
    
    /* --- Header --- */
    .header {
        position: absolute; top: 0; left: 0; right: 0;
        height: calc(64px + var(--spf-safe-top, 0px));
        padding-top: var(--spf-safe-top, 0px); /* Push content below Dynamic Island */
        display: flex; justify-content: space-between; align-items: center;
        padding-left: 24px; padding-right: 24px; padding-bottom: 0;
        background: rgba(18, 18, 18, 1);
        border-bottom: none !important; /* Force removal */
        z-index: 110; 
        box-sizing: border-box;
        
        /* Smooth transition for background/opacity changes */
        transition: background-color 0.3s ease, border-bottom 0.3s ease, backdrop-filter 0.3s ease;
        
        pointer-events: auto;
    }

    .header.transparent {
        background: rgba(18, 18, 18, var(--header-alpha, 0));
        backdrop-filter: blur(calc(var(--header-alpha, 0) * 20px));
        -webkit-backdrop-filter: blur(calc(var(--header-alpha, 0) * 20px));
        box-shadow: none;
        /* Ensure transition applies here too */
        transition: background-color 0.3s ease, border-bottom 0.3s ease, backdrop-filter 0.3s ease;
    }
    
    .header-center-title {
        position: absolute; left: 50%; transform: translateX(-50%);
        font-weight: 700; font-size: 18px; color: var(--spf-text-main);
        opacity: 0; transition: opacity 0.2s ease;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        max-width: 40%; pointer-events: none; z-index: 120; 
    }

    /* Mobile minimal header: grab handle for drag-to-close */
    .header-drag-pill {
        position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
        width: 40px; height: 4px; border-radius: 2px;
        background: rgba(255,255,255,0.4);
        pointer-events: none;
    }

    .header-left, .header-right { display: flex; align-items: center; gap: 16px; }
    .spotify-logo { width: 32px; height: 32px; fill: var(--spf-text-main); }

    /* Account avatar (home only): sits right of the logo / collapse arrow */
    .header-avatar {
        width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
        background-size: cover; background-position: center;
        background-color: var(--spf-bg-card-hover);
        border: none; padding: 0; cursor: default;
        display: flex; align-items: center; justify-content: center;
        color: rgba(255,255,255,0.85);
        transition: transform 0.1s ease, box-shadow 0.2s ease;
    }
    .header-avatar.switchable { cursor: pointer; }
    .header-avatar svg { width: 20px; height: 20px; pointer-events: none; }
    @media (hover: hover) { .header-avatar.switchable:hover { box-shadow: 0 0 0 2px var(--spf-brand); } }
    .header-avatar.switchable:active { transform: scale(0.92); }
    
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

    /* Mobile home: the header only carries the collapse arrow + avatar, so shrink
       it and top-align its contents. This lets the page content (Pinned) start
       much higher instead of clearing a 64px bar full of empty space. */
    @media (max-width: 768px) {
        :host([avatarvisible]) { height: calc(48px + var(--spf-safe-top, 0px)); }
        :host([avatarvisible]) .header {
            height: calc(48px + var(--spf-safe-top, 0px));
            align-items: flex-start;
            padding-top: calc(var(--spf-safe-top, 0px) + 4px);
        }
    }
`;