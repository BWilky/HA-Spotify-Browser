import { css } from "../lit.js";

/**
 * The list row drawn by renderListRow / renderRowSkeletons / renderEmptyState
 * (components/media-templates.js): art, name, subtitle, optional trailing
 * controls. Adopted by search, library, the home "See All" section page and
 * the discography list; each adds its own differences after this sheet.
 *
 * Sizing, set on :host by the page:
 *   --list-row-art  art width/height and the first column (default 48px)
 *   --list-row-gap  column gap (default 12px)
 */
export const listRowStyles = css`
    .row {
        display: grid; grid-template-columns: var(--list-row-art, 48px) 1fr auto;
        align-items: center; gap: var(--list-row-gap, 12px); padding: 8px 16px; cursor: pointer; min-height: 64px;
    }
    @media (hover: hover) { .row:hover { background: var(--spf-hover-white); } }
    .art {
        width: var(--list-row-art, 48px); height: var(--list-row-art, 48px); border-radius: 4px;
        background-size: cover; background-position: center;
        background-color: var(--spf-bg-card-hover);
    }
    .art.circle { border-radius: 50%; }
    .info { min-width: 0; }
    .name { color: #fff; font-size: var(--spf-text-md, 15px); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .name.playing { color: var(--spf-brand); }
    .sub { color: var(--spf-text-sub); font-size: var(--spf-text-base, 13.5px); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Skeleton rows. skeleton-pulse (shared) fills the whole row; keep it
       transparent so only the art + text-line shapes read as a skeleton. */
    .skel {
        display: grid; grid-template-columns: var(--list-row-art, 48px) 1fr; gap: var(--list-row-gap, 12px);
        align-items: center; padding: 8px 16px; min-height: 64px;
    }
    .skel.skeleton-pulse { background: transparent; }
    .skel .art { background: var(--spf-skeleton-bg); }
    .skel-lines > div { height: 12px; border-radius: 3px; background: var(--spf-skeleton-bg); }
    .skel-lines > div:first-child { width: 60%; margin-bottom: 8px; }
    .skel-lines > div:last-child { width: 35%; }

    .empty { padding: 48px 24px; text-align: center; color: var(--spf-text-sub); }
`;

/**
 * Sticky filter pills above a list (search, library). The page sets the
 * mobile `top` offset — it depends on the height of its own top bar.
 */
export const filterPillStyles = css`
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

    @media (max-width: 768px) {
        .pills { padding: 6px 16px 12px; }
    }
    @media (min-width: 769px) {
        .pills { top: 0; justify-content: flex-start; padding: 16px 16px 12px; }
    }
`;
