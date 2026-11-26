import { css } from "../../../lit.js";

// Sidebar container (spotify-sidebar-player): positioned overlay host + panel layout.
export const queueSidebarStyles = css`
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
`;
