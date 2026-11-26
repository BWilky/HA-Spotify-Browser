/**
 * Registers the Circular Std @font-face set at DOCUMENT level. @font-face is
 * ignored inside shadow roots, so this must land in document.head once; shadow
 * trees then reference the family (via --spf-font-family in shared-styles)
 * normally. The woff2 files are deployed next to the bundle by `build.sh
 * deploy` (/homeassistant/www/spotify-browser-fonts → /local/...). On an
 * instance without the files the requests 404 and the browser silently uses
 * the fallback stack — the card is unaffected.
 */
const FONT_BASE = '/local/spotify-browser-fonts';
const WEIGHTS = [
    ['Book', 400],
    ['Medium', 500],
    ['Bold', 700],
    ['Black', 900],
];

export function ensureAppFonts() {
    if (typeof document === 'undefined' || document.getElementById('spf-circular-font')) return;
    const style = document.createElement('style');
    style.id = 'spf-circular-font';
    style.textContent = WEIGHTS.map(([name, weight]) => `
        @font-face {
            font-family: 'Circular Std';
            font-weight: ${weight};
            font-style: normal;
            font-display: swap;
            src: url('${FONT_BASE}/CircularStd-${name}.woff2') format('woff2');
        }`).join('\n');
    document.head.appendChild(style);
}
