import { css } from "../lit.js";

// Styles for <spotify-library>. Closely mirrors the search page (pills + rows +
// skeletons) so the two surfaces feel consistent. The library owns its own top
// bar on mobile (the app header is hidden for this page, like search).
export const libraryStyles = css`
    :host { display: block; height: 100%; }

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

    /* ---- Filter pills ---- */
    .pills {
        position: sticky; z-index: 4;
        display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none;
        background: var(--spf-bg);
    }
    .pills::-webkit-scrollbar { display: none; }
    .pill {
        flex: 0 0 auto; border: none; cursor: pointer; white-space: nowrap;
        padding: 8px 16px; border-radius: 999px; font-size: var(--spf-text-base, 13.5px); font-weight: 700;
        background: #232323; color: #fff;
    }
    .pill.active { background: #fff; color: #000; }

    .body { padding-bottom: 120px; }
    .empty { padding: 48px 24px; text-align: center; color: var(--spf-text-sub); }

    /* ---- Rows ---- */
    .row {
        display: grid; grid-template-columns: 56px 1fr auto;
        align-items: center; gap: 14px; padding: 8px 16px; cursor: pointer; min-height: 64px;
    }
    .row-menu-btn {
        background: none; border: none; cursor: pointer; color: var(--spf-text-sub);
        width: 40px; height: 40px; padding: 0;
        display: flex; align-items: center; justify-content: center;
    }
    @media (hover: hover) { .row-menu-btn:hover { color: #fff; } }
    @media (hover: hover) { .row:hover { background: var(--spf-hover-white); } }
    .art {
        width: 56px; height: 56px; border-radius: 4px;
        background-size: cover; background-position: center;
        background-color: var(--spf-bg-card-hover);
    }
    .art.circle { border-radius: 50%; }
    .art.liked {
        background: linear-gradient(135deg, #4a35d6 0%, #8d7bf0 100%);
        display: flex; align-items: center; justify-content: center;
    }
    .art.liked svg { width: 26px; height: 26px; fill: #fff; }
    .info { min-width: 0; }
    .name { color: #fff; font-size: var(--spf-text-md, 15px); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .name.playing { color: var(--spf-brand); }
    .sub {
        display: flex; align-items: center; gap: 5px;
        color: var(--spf-text-sub); font-size: var(--spf-text-base, 13.5px); margin-top: 2px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .sub .pin { color: var(--spf-brand); flex: 0 0 auto; }

    /* ---- Skeletons ---- */
    .skel { display: grid; grid-template-columns: 56px 1fr; gap: 14px; align-items: center; padding: 8px 16px; min-height: 64px; }
    .skel.skeleton-pulse { background: transparent; }
    .skel .art { background: var(--spf-skeleton-bg); }
    .skel-lines > div { height: 12px; border-radius: 3px; background: var(--spf-skeleton-bg); }
    .skel-lines > div:first-child { width: 60%; margin-bottom: 8px; }
    .skel-lines > div:last-child { width: 35%; }

    /* ================= MOBILE ================= */
    @media (max-width: 768px) {
        .pills { top: calc(var(--spf-safe-top, 0px) + 60px); padding: 6px 16px 12px; }
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
        }
        .pills { top: 0; justify-content: flex-start; padding: 16px 16px 12px; }
    }
`;
