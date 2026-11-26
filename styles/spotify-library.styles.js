import { css } from "../lit.js";

// Styles for <spotify-library>. Rows, skeletons, the empty state and the
// filter pills come from list-row.styles.js (shared with the search page);
// this sheet adds the library's sizes and its own pieces. The library owns
// its own top bar on mobile (the app header is hidden for this page, like search).
export const libraryStyles = css`
    :host { display: block; height: 100%; --list-row-art: 56px; --list-row-gap: 14px; }

    .l-scroll {
        height: 100%; overflow-y: auto; overflow-x: hidden;
        background: var(--spf-bg);
    }

    /* ---- Top bar (mobile owns its own title + search affordance) ---- */
    .l-top {
        position: sticky; top: 0; z-index: 5;
        display: flex; align-items: center; gap: 12px;
        /* Explicit row height: 12 + 40 + 8 = 60px total, exactly the pills'
           sticky offset below — otherwise a seam opens between the two bars. */
        height: 40px;
        padding: calc(var(--spf-safe-top, 0px) + 12px) 16px 8px;
        background: var(--spf-bg);
    }
    .l-title { flex: 1; min-width: 0; font-size: var(--spf-text-xl, 22px); font-weight: 900; color: #fff; }
    .l-icon-btn {
        flex: 0 0 auto; background: none; border: none; color: #fff; cursor: pointer;
        padding: 6px; display: flex; align-items: center; justify-content: center;
    }
    @media (hover: hover) { .l-icon-btn:hover { color: var(--spf-text-sub); } }

    .body { padding-bottom: 120px; }

    /* ---- Rows (renderListRow) ---- */
    .row-menu-btn {
        background: none; border: none; cursor: pointer; color: var(--spf-text-sub);
        width: 40px; height: 40px; padding: 0;
        display: flex; align-items: center; justify-content: center;
    }
    @media (hover: hover) { .row-menu-btn:hover { color: #fff; } }
    .art.liked {
        background: linear-gradient(135deg, #4a35d6 0%, #8d7bf0 100%);
        display: flex; align-items: center; justify-content: center;
    }
    .art.liked svg { width: 26px; height: 26px; fill: #fff; }
    /* Flex so the Liked Songs row can lead its subtitle with a pin icon. */
    .sub { display: flex; align-items: center; gap: 5px; }
    .sub .pin { color: var(--spf-brand); flex: 0 0 auto; }

    /* ================= MOBILE ================= */
    @media (max-width: 768px) {
        .pills { top: calc(var(--spf-safe-top, 0px) + 60px); }
    }

    /* "+ New" playlist pill: desktop-only — mobile has the l-top icon button. */
    .pill-create { display: none; }

    /* Sort toggle pill — right end of the pills row, same size as the tab pills. */
    .pill-sort {
        margin-left: auto;
        display: inline-flex; align-items: center; gap: 6px;
    }
    .pill-sort svg { color: var(--spf-text-sub); }
    @media (hover: hover) { .pill-sort:hover { color: var(--spf-brand); } }

    .scroll-sentinel { height: 1px; }

    /* ================= DESKTOP ================= */
    @media (min-width: 769px) {
        .l-top { display: none; }
        .pill-create { display: inline-flex; }
        /* Constrain the single-column list to a comfortable centered width so the
           rows don't stretch the full width of the modal with empty space. */
        .body, .pills, .row, .skel, .empty {
            max-width: 760px; margin-left: auto; margin-right: auto;
            box-sizing: border-box;
        }
    }
`;
