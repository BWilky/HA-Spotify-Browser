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
        padding: calc(var(--spf-safe-top, 0px) + 12px) 16px 8px;
        background: var(--spf-bg);
    }
    .l-title { flex: 1; min-width: 0; font-size: 24px; font-weight: 800; color: #fff; }
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
        padding: 8px 16px; border-radius: 999px; font-size: 14px; font-weight: 600;
        background: #232323; color: #fff;
    }
    .pill.active { background: #fff; color: #000; }

    .body { padding-bottom: 120px; }
    .section-h {
        display: flex; align-items: center; gap: 8px;
        font-size: 14px; font-weight: 600; color: var(--spf-text-sub); padding: 16px 16px 4px;
    }
    .section-h svg { flex: 0 0 auto; }
    .empty { padding: 48px 24px; text-align: center; color: var(--spf-text-sub); }

    /* ---- Rows ---- */
    .row {
        display: grid; grid-template-columns: 56px 1fr;
        align-items: center; gap: 14px; padding: 8px 16px; cursor: pointer; min-height: 64px;
    }
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
    .name { color: #fff; font-size: 16px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .name.playing { color: var(--spf-brand); }
    .sub {
        display: flex; align-items: center; gap: 5px;
        color: var(--spf-text-sub); font-size: 13px; margin-top: 2px;
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

    /* ================= DESKTOP ================= */
    @media (min-width: 769px) {
        .l-top { display: none; }
        /* Constrain the single-column list to a comfortable centered width so the
           rows don't stretch the full width of the modal with empty space. */
        .body, .pills, .row, .skel, .section-h, .empty {
            max-width: 760px; margin-left: auto; margin-right: auto;
        }
        .pills { top: 0; justify-content: flex-start; padding: 16px 16px 12px; }
    }
`;
