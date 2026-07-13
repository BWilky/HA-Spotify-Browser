/*
 * Config schema v2 (breaking — no v1 aliases; see README "Migrating from v1").
 *
 * Ten root keys: entity, accounts, browser, appearance, home, devices, queue,
 * sonos, storage, integrations. Every group obeys one shorthand rule:
 *   omitted -> defaults          true  -> enabled + defaults
 *   false   -> disabled          scalar/list -> the group's primary field
 *   object  -> merged over defaults (unknown keys warned)
 * Groups with an `enabled` field are implied enabled when the group is
 * configured at all, unless `enabled: false` is set.
 *
 * The parser output mirrors the input 1:1 (no raw passthrough); every group
 * is always present with defaults filled, so consumers never need `|| {}`
 * guards. Unknown, renamed and removed keys warn once per session in the
 * console — a typo can no longer silently do nothing.
 *
 * NOTE: switchAccount() rebuilds config as { ...config, entity } — group
 * objects are shared by reference across that copy, so consumers must treat
 * them as read-only.
 */

/* ------------------------------ warnings -------------------------------- */

const _warned = new Set();

function warnOnce(path, msg) {
    if (_warned.has(path)) return;
    _warned.add(path);
    console.warn(`[SpotifyBrowser] config: ${msg}`);
}

/** Two-row Levenshtein distance (for "did you mean" hints). */
function levenshtein(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
        prev = cur;
    }
    return prev[b.length];
}

function nearest(key, candidates) {
    let best = null;
    let bestD = Infinity;
    for (const c of candidates) {
        const d = levenshtein(key.toLowerCase(), c.toLowerCase());
        if (d < bestD) { bestD = d; best = c; }
    }
    return bestD <= Math.max(2, Math.floor(key.length / 4)) ? best : null;
}

/*
 * Every v1 root key/alias -> its v2 home (null = removed outright). Drives
 * the "renamed" warnings and matches the README migration table.
 */
const MOVED_KEYS = {
    entity_id: 'entity',
    spotify_accounts: 'accounts',
    custom_hash: 'browser.hash',
    auto_close: 'browser.auto_close',
    autoclose: 'browser.auto_close',
    auto_close_seconds: 'browser.auto_close',
    home_on_exit: 'browser.home_on_exit',
    homeonexit: 'browser.home_on_exit',
    cache_size: 'browser.cache_size',
    debug: 'browser.debug',
    performance: 'appearance.performance',
    perf: 'appearance.performance',
    animations: 'appearance.animations',
    desktop_style: 'appearance.desktop',
    homescreen: 'home',
    home_order: 'home.sort',
    madeforyou: 'home.made_for_you',
    desktop_madeforyou_pills: 'home.made_for_you.pills',
    device_playback: 'devices',
    volume: 'devices.volume',
    external_providers: 'integrations',
    storage_sensor: 'storage.sensor',
    storage_event: 'storage.event',
    storage_script: 'storage.script',
    close_on_disconnect: null,
    closeondisconnect: null,
    advanced: null,
};

// Lovelace-level keys that legitimately ride along on card config.
const IGNORED_ROOT = ['type', 'view_layout', 'grid_options', 'visibility', 'card_mod'];

function warnUnknown(raw, allowed, path) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    for (const k of Object.keys(raw)) {
        if (allowed.includes(k)) continue;
        const full = path ? `${path}.${k}` : k;
        if (!path && k in MOVED_KEYS) {
            const dest = MOVED_KEYS[k];
            warnOnce(full, dest
                ? `"${k}" was renamed in v2 — use "${dest}" (see README migration table). Ignored.`
                : `"${k}" was removed in v2 and is ignored (see README migration table).`);
            continue;
        }
        const hint = nearest(k, allowed);
        warnOnce(full, `unknown option "${full}"${hint ? ` — did you mean "${hint}"?` : ''}. Ignored.`);
    }
}

/* ------------------------------ coercers --------------------------------- */

const bool = (v) => v === true;
const num = (def) => (v) => (Number.isFinite(Number(v)) ? Number(v) : def);
const str = (v) => (v === null || v === undefined ? null : String(v));

const enumOf = (values, fallback) => (v, path) => {
    const s = String(v).toLowerCase();
    if (values.includes(s)) return s;
    warnOnce(path, `"${path}: ${v}" is not one of ${values.join('|')} — using "${fallback}".`);
    return fallback;
};

/** css size: bare numbers / numeric strings become px. */
const cssSize = (v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return `${v}px`;
    if (typeof v === 'string' && !isNaN(v)) return `${v}px`;
    return String(v);
};

const hashStr = (v) => {
    const s = String(v);
    return s.startsWith('#') ? s : `#${s}`;
};

/** Accepts 'script.foo' or bare 'foo'. */
const scriptId = (v) => {
    if (!v) return null;
    const s = String(v);
    return s.includes('.') ? s : `script.${s}`;
};

/** List of objects; each item checked against `fields` coercers. */
const listOf = (fields) => (v, path) => {
    if (!Array.isArray(v)) {
        warnOnce(path, `"${path}" must be a list. Ignored.`);
        return [];
    }
    return v
        .filter((item) => item && typeof item === 'object')
        .map((item, i) => {
            warnUnknown(item, Object.keys(fields), `${path}[${i}]`);
            const out = {};
            for (const [k, f] of Object.entries(fields)) {
                out[k] = item[k] === undefined ? (f === bool ? false : null) : f(item[k], `${path}[${i}].${k}`);
            }
            return out;
        });
};

// User-facing sort tokens -> internal section ids (spotify-home.js).
const SORT_TOKENS = {
    pinned: 'pinned',
    recently_played: 'recent',
    made_for_you: 'madeforyou',
    favourite_playlists: 'favorites',
    followed_artists: 'artists',
    favourite_albums: 'albums',
};
const SECTION_IDS = Object.values(SORT_TOKENS);

const sortTokens = (v, path) => {
    if (!Array.isArray(v)) {
        warnOnce(path, `"${path}" must be a list of sections. Using default order.`);
        return undefined; // undefined = keep the default
    }
    const order = [];
    for (const key of v) {
        const k = String(key).toLowerCase();
        const id = SORT_TOKENS[k] || (SECTION_IDS.includes(k) ? k : null);
        if (id) order.push(id);
        else warnOnce(`${path}.${key}`, `"${path}" has unknown section "${key}" — expected one of ${Object.keys(SORT_TOKENS).join(', ')}. Dropped.`);
    }
    return order.length ? order : undefined;
};

/* -------------------------- generic normalizer --------------------------- */

const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * The universal shorthand rule. spec:
 *   defaults  always-complete output shape
 *   primary   field a scalar/list shorthand assigns to
 *   fields    { key: coercerFn | nested spec }
 *   post      (out, raw) => out — group-specific fixups
 *   onFalse   mutate defaults for `false` when there's no `enabled` field
 */
function normalizeGroup(raw, spec, path) {
    const out = clone(spec.defaults);
    const finish = () => (spec.post ? spec.post(out, raw) : out);

    if (raw === undefined) return finish();
    if (raw === true) {
        if ('enabled' in out) out.enabled = true;
        return finish();
    }
    if (raw === false) {
        if ('enabled' in out) out.enabled = false;
        else if (spec.onFalse) spec.onFalse(out);
        return finish();
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        // scalar / list shorthand -> primary field
        if (!spec.primary) {
            warnOnce(path, `"${path}" expects an object — using defaults.`);
            return finish();
        }
        const f = spec.fields[spec.primary];
        const coerced = f(raw, `${path}.${spec.primary}`);
        if (coerced !== undefined) out[spec.primary] = coerced;
        if ('enabled' in out) out.enabled = true;
        return finish();
    }

    warnUnknown(raw, Object.keys(spec.fields), path);
    if ('enabled' in out && raw.enabled === undefined) out.enabled = true;
    for (const [k, f] of Object.entries(spec.fields)) {
        if (raw[k] === undefined) continue;
        // Plain coercers may return undefined to mean "invalid — keep default".
        const coerced = f.fields
            ? normalizeGroup(raw[k], f, `${path}.${k}`)
            : f(raw[k], `${path}.${k}`);
        if (coerced !== undefined) out[k] = coerced;
    }
    return finish();
}

/* ------------------------------- schema ---------------------------------- */

// `false | seconds | { timeout, enabled }` -> { enabled, timeout }
const timeoutGroup = (enabledByDefault) => ({
    defaults: { enabled: enabledByDefault, timeout: 0 },
    primary: 'timeout',
    fields: { enabled: bool, timeout: num(0) },
});

// auto: best-effort weak-device heuristic (deviceMemory/cores). Many iPads
// don't expose deviceMemory, so set `performance: low` explicitly for a
// known slow tablet.
function detectLite() {
    try {
        const mem = navigator.deviceMemory;
        const cores = navigator.hardwareConcurrency;
        if (typeof mem === 'number' && mem <= 4) return true;
        if (typeof cores === 'number' && cores <= 4) return true;
    } catch (e) { /* ignore */ }
    return false;
}

const SCHEMA = {
    browser: {
        defaults: {
            hash: '#spotify-browser',
            auto_close: { enabled: false, timeout: 0 },
            home_on_exit: { enabled: true, timeout: 0 },
            cache_size: 10,
            debug: false,
        },
        fields: {
            hash: hashStr,
            auto_close: {
                ...timeoutGroup(false),
                // enabled means "will actually fire": needs a positive timeout
                post: (out) => ({ enabled: out.enabled && out.timeout > 0, timeout: out.timeout }),
            },
            home_on_exit: timeoutGroup(true),
            cache_size: num(10),
            debug: bool,
        },
    },

    appearance: {
        defaults: {
            performance: { mode: 'auto', lite: false }, // lite resolved in post
            animations: { page_transition: 'fade', browser_open: 'fade', blur: true },
            desktop: {
                mode: 'default', width: '85vw', height: '85vh', fullscreen: false,
                margin_top: '24px', margin_bottom: '24px', margin_left: '24px', margin_right: '24px',
            },
        },
        fields: {
            performance: {
                defaults: { mode: 'auto', lite: false },
                primary: 'mode',
                fields: { mode: enumOf(['auto', 'high', 'low'], 'auto') },
                post: (out) => ({
                    mode: out.mode,
                    lite: out.mode === 'low' ? true : out.mode === 'high' ? false : detectLite(),
                }),
            },
            animations: {
                defaults: { page_transition: 'fade', browser_open: 'fade', blur: true },
                onFalse: (out) => { out.page_transition = 'none'; out.browser_open = 'none'; out.blur = false; },
                fields: { page_transition: str, browser_open: str, blur: bool },
            },
            desktop: {
                defaults: {
                    mode: 'default', width: '85vw', height: '85vh', fullscreen: false,
                    margin_top: '24px', margin_bottom: '24px', margin_left: '24px', margin_right: '24px',
                },
                fields: {
                    mode: enumOf(['default', 'fixed', 'fullscreen'], 'default'),
                    width: cssSize, height: cssSize, fullscreen: bool,
                    margin: cssSize, margin_top: cssSize, margin_bottom: cssSize, margin_left: cssSize, margin_right: cssSize,
                },
                post: (out, raw) => {
                    const r = raw && typeof raw === 'object' ? raw : {};
                    // width/height imply fixed unless the user set a mode
                    if (r.mode === undefined && (r.width !== undefined || r.height !== undefined)) out.mode = 'fixed';
                    // global margin cascades; individual sides override
                    const global = r.margin !== undefined ? cssSize(r.margin) : '24px';
                    for (const side of ['top', 'bottom', 'left', 'right']) {
                        out[`margin_${side}`] = r[`margin_${side}`] !== undefined ? cssSize(r[`margin_${side}`]) : global;
                    }
                    delete out.margin;
                    return out;
                },
            },
        },
    },

    home: {
        defaults: {
            sort: ['pinned', 'recent', 'madeforyou', 'favorites', 'artists', 'albums'],
            pinned: false,
            made_for_you: { content: [], pills: false },
        },
        fields: {
            sort: sortTokens, // undefined (bad input) keeps the default order
            pinned: bool,
            made_for_you: {
                defaults: { content: [], pills: false },
                primary: 'content',
                fields: {
                    content: (v, path) => (Array.isArray(v) ? v : (warnOnce(path, `"${path}" must be a list. Ignored.`), [])),
                    pills: bool,
                },
            },
        },
    },

    devices: {
        defaults: {
            default: null,
            icons: [],
            volume: { fallback: 25, rules: [], rate_control: true, optimistic: true },
        },
        fields: {
            default: str,
            icons: listOf({ name: str, id: str, icon: str }),
            volume: {
                defaults: { fallback: 25, rules: [], rate_control: true, optimistic: true },
                primary: 'fallback',
                fields: {
                    fallback: num(25),
                    rules: listOf({ start: str, end: str, level: num(0) }),
                    rate_control: (v) => v === true,
                    optimistic: (v) => v === true,
                },
            },
        },
    },

    queue: {
        defaults: {
            open_on_desktop: false,
            miniplayer: { enabled: true, shuffle: true, previous: true, next: true, like: true, volume: true, device: true },
        },
        fields: {
            open_on_desktop: bool,
            miniplayer: {
                defaults: { enabled: true, shuffle: true, previous: true, next: true, like: true, volume: true, device: true },
                fields: { enabled: bool, shuffle: bool, previous: bool, next: bool, like: bool, volume: bool, device: bool },
            },
        },
    },

    // Opt-in support for Sonos speakers. When enabled, context jumps use
    // offset_position (Sonos rejects offset_uri) and queue read/add/play-from
    // route through the Home Assistant Sonos integration instead of SpotifyPlus.
    sonos: {
        defaults: { enabled: false, launch_mode: 'local', prefer_sonos: false, debug: false, device_map: [] },
        fields: {
            enabled: bool,
            // 'local' (card drives the HA Sonos entity directly, falling back to
            // SpotifyPlus) or 'spotifyplus' (all launches go through the
            // integration, e.g. with Web Player token auth).
            launch_mode: enumOf(['local', 'spotifyplus'], 'local'),
            // Trust the mapped Sonos entity's own state first for now-playing
            // and controls, falling back to SpotifyPlus when it has nothing.
            prefer_sonos: bool,
            debug: bool,
            device_map: listOf({ spotify: str, entity: str, is_sonos: bool }),
        },
    },

    // Persistent storage backend (trigger-template sensor). Lets users point
    // the card at a differently-named sensor/event, e.g. when the default
    // entity_id was taken and HA assigned 'sensor.spotify_browser_data_2'.
    // `script`: optional middle-man — non-admin/guest users can call scripts
    // but cannot fire events, so writes go through it when set.
    storage: {
        defaults: {
            sensor: 'sensor.spotify_browser_data',
            event: 'spotify_browser_store_data',
            script: null,
        },
        fields: { sensor: str, event: str, script: scriptId },
    },

    integrations: {
        defaults: { lastfm: { api_key: null } },
        fields: {
            lastfm: {
                defaults: { api_key: null },
                fields: { api_key: str },
            },
        },
    },
};

/* -------------------------------- parser --------------------------------- */

export class ConfigParser {
    static parse(config) {
        const raw = config && typeof config === 'object' ? config : {};
        warnUnknown(raw, ['entity', 'accounts', ...Object.keys(SCHEMA), ...IGNORED_ROOT], '');

        const accounts = (Array.isArray(raw.accounts) ? raw.accounts : [])
            .filter((acc) => acc && typeof acc === 'object')
            .map((acc, i) => {
                warnUnknown(acc, ['entity', 'name', 'image', 'hash', 'default'], `accounts[${i}]`);
                return {
                    entity: acc.entity || null,
                    name: acc.name || null,
                    image: acc.image || null,
                    hash: acc.hash ? hashStr(acc.hash) : null,
                    is_default: acc.default === true,
                };
            });

        const entity = accounts.find((a) => a.is_default)?.entity ||
            accounts[0]?.entity ||
            raw.entity;
        if (!entity) {
            throw new Error("SpotifyBrowser: No entity found. Configure 'entity' or 'accounts'.");
        }

        const cfg = { entity, accounts };
        for (const [name, spec] of Object.entries(SCHEMA)) {
            cfg[name] = normalizeGroup(raw[name], spec, name);
        }

        // Lite/low-power profile forces blur off regardless of the blur flag.
        if (cfg.appearance.performance.lite) cfg.appearance.animations.blur = false;

        return cfg;
    }
}
