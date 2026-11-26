import { css } from "../lit.js";

/*
 * Chrome shared by the components that render a <spotify-bottom-sheet>
 * (see shared-styles.js for where stylesheets live). Only rules that were
 * written out identically in more than one sheet are here; anything that
 * differs in a single value stays in the sheet's own CSS. Adopt these first,
 * before the component's own CSS: none of the component rules sets the same
 * property on the same elements, so the cascade is what it was with the
 * copies inline.
 *
 * Two sets, because the two kinds of sheet give .title and .empty different
 * values:
 */

/**
 * Sheets with a large title above a list: the account switcher and the
 * mobile Connect sheet.
 */
export const sheetStyles = css`
    :host { display: contents; }

    .title { font-size: var(--spf-text-2xl, 26px); font-weight: 900; margin: 0 0 18px; flex-shrink: 0; }

    .empty { text-align: center; color: var(--spf-text-sub, #b3b3b3); padding: 28px 0; font-size: var(--spf-text-base, 13.5px); }
`;

/**
 * Sheets that are centred dialogs on tablet/desktop, with a head row (title
 * plus a trailing button): the device picker and the device manager (whose
 * own :host rule repeats display: contents next to its sheet variables).
 */
export const dialogSheetStyles = css`
    :host { display: contents; }

    .title {
        margin: 0;
        font-size: var(--spf-text-xl, 22px); font-weight: 900;
        color: var(--spf-text-main, #fff);
    }

    .empty {
        text-align: center; color: var(--spf-text-sub, #b3b3b3);
        padding: 28px 12px; font-size: var(--spf-text-base, 13.5px); line-height: 1.5;
    }
`;
