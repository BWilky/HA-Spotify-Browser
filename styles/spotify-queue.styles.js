import { css } from "../lit.js";

export const queueStyles = css`
    :host {
        display: block;
        position: absolute; 
        top: 63px; /* Overlap by 1px to ensure flush visual join */
        right: 0;
        left: auto;
        /* Force height calculation to avoid bottom:0 ambiguity */
        height: calc(100% - 63px);
        width: 350px;
        z-index: 100001;
        transform: translateX(100%);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
        box-sizing: border-box; 
    }
    
    :host * { box-sizing: border-box; } 

    :host([visible]) {
        transform: translateX(0);
        pointer-events: auto;
    }

    .queue-panel {
        position: relative !important;
        top: 0 !important;
        left: 0 !important;
        height: 100% !important;
        width: 100%;
        background: var(--spf-bg); 
        display: flex !important; 
        flex-direction: column !important;
        overflow: hidden; 
    }

    @media (max-width: 768px) {
        :host {
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            transform: translate3d(0, 100%, 0);
        }
        :host([visible]) {
            transform: translate3d(0, 0, 0);
        }
        .queue-panel {
            border-left: none;
        }
    }
    
    /* ================================================= */
    /* QUEUE PANEL & MINI PLAYER                         */
    /* ================================================= */

    .queue-header-wrapper {
        flex-shrink: 0;
        background: var(--spf-bg);
        border-bottom: 1px solid var(--spf-border-subtle);
        z-index: 5; 
        position: relative;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4); 
        padding: 0 !important; 
        overflow: visible;
    }

    .queue-now-playing-row {
        position: relative;
        padding: 16px 16px 8px 16px; /* Adjusted padding */
        display: flex;
        flex-direction: column;
    }

    .queue-item-content { 
        display: flex; 
        align-items: center; 
        gap: 16px; 
    }

    .queue-art.large { 
        width: 56px; 
        height: 56px; 
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

    .queue-info { 
        flex: 1; 
        overflow: hidden; 
        display: flex; 
        flex-direction: column; 
        justify-content: center; 
        margin-right: 12px; 
        gap: 2px; 
        min-width: 0;
    }

    .queue-title { 
        font-size: 14px; 
        font-weight: 700; 
        color: var(--spf-text-main); 
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis;
        line-height: 1.2;
    }
    .queue-title.active { color: var(--spf-brand); }

    .queue-artist {
        font-size: 12px;
        color: var(--spf-text-sub);
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis;
        line-height: 1.2;
    }

    .queue-device-row {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px; 
        font-weight: 500;
        color: var(--spf-brand); /* Green */
        opacity: 0.9;
        margin-top: 2px;
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

    /* --- Big Play Button --- */
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

    .queue-play-btn.large-side-btn svg { fill: black; width: 28px; height: 28px; }

    /* --- Controls Row --- */
    .queue-mini-controls {
        display: flex;
        align-items: center;
        width: 100%;
        height: 48px;       
        margin-top: 0;    
        padding: 0 8px;    
        box-sizing: border-box;
        justify-content: space-between; 
    }

    .volume-control-container {
        display: flex; align-items: center;
        width: 100%; height: 48px; margin-top: 4px; padding: 0 8px; box-sizing: border-box;
        justify-content: center; animation: fadeIn 0.2s ease;
    }

    .mini-btn {
        background: transparent; 
        border: none; 
        color: var(--spf-text-sub); 
        cursor: pointer; 
        padding: 8px;
        display: flex; 
        align-items: center; 
        justify-content: center;
        transition: color 0.2s, transform 0.2s;
    }

    .mini-btn:hover { color: var(--spf-text-main); transform: scale(1.1); }
    .mini-btn svg { width: 20px; height: 20px; } /* Slightly smaller secondary controls */
    .mini-btn.is-favorite { color: var(--spf-brand); }
    .mini-btn.is-favorite svg { fill: var(--spf-brand); }

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

    /* --- Progress Bar --- */
    .queue-progress-container {
        position: absolute; 
        bottom: 0;          
        left: 0;            
        width: 100%;        
        height: 2px;        
        margin: 0;
        padding: 0;
        background: rgba(255, 255, 255, 0.1);
        z-index: 10;
    }
    
    .queue-progress-bar {
        height: 100%;
        background: var(--spf-brand); /* Green progress */
        width: 0%;
        border-radius: 0 2px 2px 0;
        transition: width 0.5s linear;
    }

    .queue-progress-bar::after {
        content: ''; position: absolute; right: -3px; top: -3px;
        width: 8px; height: 8px; background: var(--spf-text-main);
        border-radius: 50%; opacity: 0; transition: opacity 0.2s;
    }

    .queue-header-wrapper:hover .queue-progress-bar::after { opacity: 1; }

    .queue-list { 
        flex: 1 1 auto; /* Grow and shrink as needed */
        min-height: 0;
        overflow-y: auto; 
        padding: 0 0 16px 0; 
        background: var(--spf-bg);
    }

    .queue-item {
        display: flex; 
        align-items: center; 
        padding: 8px 16px; 
        gap: 12px; 
        cursor: pointer;
        transition: background 0.2s;
        border-bottom: 1px solid rgba(255,255,255,0.03);
    }

    @media (hover: hover) { .queue-item:hover { background: var(--spf-border-subtle); } }

    .queue-art { 
        width: 40px; height: 40px; 
        border-radius: 4px; 
        background-size: cover; 
        background-position: center; 
        flex-shrink: 0;
        background-color: var(--spf-skeleton-bg);
    }

    .queue-row-play-btn {
        background: transparent; border: none; color: var(--spf-text-sub);
        cursor: pointer; padding: 8px; display: flex; align-items: center; justify-content: center;
        transition: color 0.2s, transform 0.2s;
    }

    .queue-row-play-btn:hover { color: var(--spf-text-main); transform: scale(1.1); }
    .queue-row-play-btn svg { width: 24px; height: 24px; }

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
`;