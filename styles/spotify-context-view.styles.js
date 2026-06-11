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
    .page.is-refreshing .hero-banner, .page.is-refreshing .artist-hero { height: 360px !important; }
    
    .hero-bg { 
        position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
        background: #181818; /* Fallback skeleton color */
        z-index: 0; 
        overflow: hidden;
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
        background: #282828; flex-shrink: 0; 
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

    /* Track Rows */
    .track-row {
        overflow: visible;
        display: grid; 
        grid-template-columns: 40px 1fr auto 80px; 
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
    }
    .track-row.with-art { grid-template-columns: 48px 1fr auto 80px; }

    @media (hover: hover) { .track-row:hover { background: var(--spf-hover-white); } }
    .track-row:active { background: var(--spf-active-white); }
    
    .track-row.playing .track-name { color: var(--spf-brand); }
    .track-num { color: var(--spf-text-sub); font-size: 14px; text-align: center; }
    
    .track-art-small {
        width: 40px; height: 40px; background-size: cover; background-position: center;
        border-radius: 4px; background-color: #282828;
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

    /* Artist View Specifics */
    .artist-content { padding-top: 24px; }
    .artist-section { margin-bottom: 40px; }
    .artist-section h2 { margin-bottom: 16px; font-size: 24px; font-weight: 700; color: var(--spf-text-main); }
`;