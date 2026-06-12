import { LitElement, html, css } from "../lit.js";

export const popupsStyles = css`
    :host {
        /* OVERRIDE shared-styles 0x0 */
        display: block;
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        z-index: 230000; /* Ensure container (Alerts/Toasts) is on top of Manager (220000) */
        pointer-events: none; /* Let clicks pass through empty areas */
    }

    /* --- Device Popup --- */
    .device-popup-backdrop {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
        z-index: 200; 
        display: none; align-items: center; justify-content: center;
        opacity: 0; pointer-events: none; transition: opacity 0.3s;
    }
    .device-popup-backdrop.visible { opacity: 1; pointer-events: auto; display: flex; }
    
    .device-popup-content {
        background: var(--spf-bg); width: 90%; max-width: 400px;
        border-radius: 16px; padding: 24px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.8);
        display: flex; flex-direction: column; gap: 16px;
    }
    .device-popup-title { margin: 0; font-size: 18px; font-weight: 700; text-align: center; color: var(--spf-text-main); }
    .device-list { max-height: 300px; overflow-y: auto; }
    
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
    .device-default-badge { color: var(--spf-brand); font-size: 10px; border: 1px solid var(--spf-brand); border-radius: 4px; padding: 0 4px; margin-left: 6px; }
    .device-close-btn { background: transparent; border: none; color: var(--spf-text-main); font-weight: 700; padding: 12px; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; align-self: center; }
    
    .device-empty-state {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 32px 0; color: var(--spf-text-sub); text-align: center;
    }
    .device-empty-state svg { margin-bottom: 12px; opacity: 0.5; }
    
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

    /* --- TRACK MENU (header + actions) --- */
    .track-popup-header {
        display: grid;
        grid-template-columns: 56px 1fr;
        align-items: center;
        gap: 16px;
        padding-bottom: 16px;
        margin-bottom: 12px;
        border-bottom: 1px solid var(--spf-border);
        width: 100%;
        box-sizing: border-box;
    }

    .track-popup-art {
        width: 100%;
        height: 56px;
        background-color: var(--spf-skeleton-bg);
        background-size: cover;
        background-position: center;
        border-radius: 4px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.4);
    }

    .track-popup-info {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: flex-start;
        min-width: 0; /* Required for text truncation in Grid */
    }

    .track-popup-title-text {
        font-size: 1.1rem;
        font-weight: 700;
        color: var(--spf-text-main);
        line-height: 1.2;
        width: 100%;
        margin-bottom: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .track-popup-artist-text {
        font-size: 1rem;
        color: var(--spf-text-sub);
        line-height: 1.2;
        width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .track-popup-item {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 20px;
        width: 100%;
        padding: 14px 8px;
        background: transparent;
        border: none;
        border-radius: 4px;
        font-size: 16px;
        color: var(--spf-text-main);
        text-align: left;
        cursor: pointer;
        transition: background 0.2s, opacity 0.2s;
    }

    .track-popup-item svg {
        width: 24px;
        height: 24px;
        fill: var(--spf-text-sub);
        flex-shrink: 0;
        pointer-events: none;
    }

    .track-popup-item:active,
    .track-popup-item:hover {
        background-color: var(--spf-hover-white);
    }

    .track-popup-item:hover svg {
        fill: var(--spf-text-main);
    }

    /* --- Reusable Alert Modal --- */
    .alert-content {
        background: var(--spf-bg-card); border: 1px solid var(--spf-border);
        border-radius: 12px; width: 85%; max-width: 320px;
        padding: 24px; text-align: center;
        box-shadow: 0 12px 40px rgba(0,0,0,0.8);
        transform: scale(0.9); transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .alert-content.mini { max-width: 260px; padding: 20px; }
    .alert-content.medium { max-width: 320px; }
    .alert-content.large { max-width: 480px; }
    .popup-backdrop.visible .alert-content { transform: scale(1); }

    .alert-title { font-size: 18px; font-weight: 700; color: var(--spf-text-main); margin-bottom: 8px; }
    .alert-message { font-size: 14px; color: var(--spf-text-sub); line-height: 1.5; margin-bottom: 24px; }

    .alert-btn {
        background: transparent; border: 1px solid var(--spf-border);
        color: var(--spf-text-main); padding: 12px; border-radius: 24px;
        font-size: 14px; font-weight: 700; cursor: pointer;
        text-transform: uppercase; letter-spacing: 1px;
        transition: background 0.2s;
    }
    .alert-btn:hover { background: var(--spf-hover-white); }
    .alert-btn.primary { background: var(--spf-brand); border-color: var(--spf-brand); color: black; }
    .alert-btn.primary:hover { background: var(--spf-brand-hover); }
`;