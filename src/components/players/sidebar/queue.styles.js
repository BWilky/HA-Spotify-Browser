import { css } from "../../../lit.js";

// Track list (spotify-sidebar-tracklist): list + row rules. No :host layout here —
// the list host is a plain block inside the sidebar and inherits pointer-events.
export const queueListStyles = css`
    :host * { box-sizing: border-box; }

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
        font-size: var(--spf-text-base, 13.5px); 
        font-weight: 700; 
        color: var(--spf-text-main); 
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis;
        line-height: 1.2;
    }

    .queue-artist {
        font-size: var(--spf-text-sm, 12px);
        color: var(--spf-text-sub);
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis;
        line-height: 1.2;
    }

    /* "Played ... ago" line under the artist (Recently Played tab). */
    .queue-context-sub {
        font-size: var(--spf-text-xs, 11px);
        color: var(--spf-text-sub);
        opacity: 0.75;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.2;
    }

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

    /* Per-row "..." menu button (queue / recent rows) */
    .row-menu-btn {
        flex-shrink: 0; width: 36px; height: 36px;
        background: transparent; border: none; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        color: var(--spf-text-sub);
    }
    .row-menu-btn:hover { color: var(--spf-text-main); }
    .row-menu-btn svg { fill: currentColor; }

    .queue-empty-state {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        height: 200px; text-align: center; opacity: 0.5;
    }

    .empty-text { margin-top: 16px; font-weight: 700; font-size: var(--spf-text-md, 15px); }
    .empty-sub { font-size: var(--spf-text-base, 13.5px); }
`;