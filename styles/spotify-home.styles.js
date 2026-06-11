import { LitElement, html, css } from "../lit.js";

export const homeStyles = css`
    :host { display: block; }
    
    /* --- Global Pills Grid --- */
    .recent-grid-layout {
        display: grid; grid-template-rows: repeat(2, 1fr); 
        grid-auto-flow: column; grid-auto-columns: 180px; 
        gap: 12px; overflow-x: auto; padding-bottom: 16px; 
        scroll-behavior: smooth; scrollbar-width: none;
    }
    .recent-grid-layout::-webkit-scrollbar { display: none; }

    .recent-pill {
        display: flex; align-items: center;
        background: var(--spf-bg-card); border-radius: 4px;
        
        /* FIX: Height is already set here, but ensure flex-shrink doesn't collapse it */
        height: 64px; 
        flex-shrink: 0;
        
        overflow: hidden; 
        transition: background 0.2s, transform 0.1s ease;
        cursor: pointer; border: 1px solid transparent;
        box-sizing: border-box;
    }
    @media (hover: hover) { .recent-pill:hover { background: var(--spf-bg-card-hover); border-color: var(--spf-border); } }
    .recent-pill:active { background: var(--spf-bg-card-hover); transform: scale(0.98); }
    
    .recent-pill-img { width: 64px; height: 64px; background-size: cover; background-position: center; flex-shrink: 0; }
    .recent-pill-text {
        font-size: 13px; font-weight: 700; color: var(--spf-text-main);
        padding: 0 12px; white-space: normal; line-height: 1.3;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }

    @media (max-width: 768px) {
        .recent-grid-layout { grid-auto-columns: 160px; margin-left: -24px; margin-right: -24px; padding-left: 24px; padding-right: 24px; }
        .recent-pill { height: 56px; }
        .recent-pill-img { width: 56px; height: 56px; }
        .recent-pill-text { font-size: 12px; }
    }

    /* Artist / Skeleton Styles */
    .skeleton-pulse { animation: pulse 1.5s infinite ease-in-out; background: var(--spf-bg-card-hover); }
    .card-image-sk { background: var(--spf-bg-card-hover); }
    .card-text-sk { height: 12px; background: var(--spf-bg-card-hover); margin-bottom: 8px; border-radius: 2px; width: 80%; }
    .card-text-sk.short { width: 50%; }
    @keyframes pulse { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }
`;