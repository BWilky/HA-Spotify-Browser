// Just enough browser globals for the vendored lit.js to load under
// `node --test`, so template helpers (components/media-templates.js) can be
// imported and their TemplateResults inspected. Import this module BEFORE
// anything that imports lit.js. Nothing is rendered: markup() below
// serialises a TemplateResult's strings and values instead.
globalThis.window ??= globalThis;
globalThis.litDisableBundleWarning = true;
globalThis.HTMLElement ??= class {};
globalThis.document ??= { createTreeWalker: () => ({}), createComment: () => ({}), createElement: () => ({}) };

/**
 * Serialises a lit TemplateResult (nested templates and arrays inlined) to
 * an HTML-like string. Functions (event listeners) print as `[fn]`; null,
 * undefined and lit sentinels print as nothing, as lit renders them.
 */
export function markup(v) {
    if (v === null || v === undefined || v === false) return '';
    if (Array.isArray(v)) return v.map(markup).join('');
    if (typeof v === 'function') return '[fn]';
    if (typeof v === 'symbol') return '';
    if (typeof v === 'object' && Array.isArray(v.strings) && Array.isArray(v.values)) {
        let s = v.strings[0];
        for (let i = 0; i < v.values.length; i++) s += markup(v.values[i]) + v.strings[i + 1];
        return s;
    }
    return String(v);
}

/** markup() with whitespace collapsed and class lists normalised, for comparisons. */
export function normalized(v) {
    return markup(v)
        .replace(/\s+/g, ' ')
        .replace(/class="([^"]*)"/g, (_, c) => `class="${c.trim().split(' ').filter(Boolean).join(' ')}"`)
        .replace(/style="\s*([^"]*?)\s*"/g, 'style="$1"')
        .replace(/>\s+/g, '>').replace(/\s+</g, '<')
        .trim();
}

/** Every function value inside a TemplateResult (event listeners), in order. */
export function listeners(v, out = []) {
    if (Array.isArray(v)) v.forEach(x => listeners(x, out));
    else if (typeof v === 'function') out.push(v);
    else if (v && typeof v === 'object' && Array.isArray(v.values)) v.values.forEach(x => listeners(x, out));
    return out;
}
