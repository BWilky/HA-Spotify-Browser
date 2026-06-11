
export class ConfigParser {
    static parse(config) {


        // --- 1. Parse Accounts ---
        let accounts = [];
        if (Array.isArray(config.spotify_accounts)) {
            accounts = config.spotify_accounts.map(acc => ({
                entity: acc.entity,
                name: acc.name,
                hash: acc.hash ? (acc.hash.startsWith('#') ? acc.hash : `#${acc.hash}`) : null,
                isDefault: acc.default === true
            }));
        }

        const startupEntity = accounts.find(a => a.isDefault)?.entity ||
            accounts[0]?.entity ||
            config.entity ||
            config.entity_id;

        if (!startupEntity) {
            throw new Error("SpotifyBrowser: No entity found. Configure 'spotify_accounts' or a root 'entity'.");
        }

        // --- 2. Homescreen Config ---
        let homescreenConfig = {
            cache: true,
            expiry: 60,
            madeforyou: { content: [], pills: false },
            customize: null
        };

        // Legacy / Root handling for homescreen cache/expiry
        let rawHomescreen = config.homescreen;

        if (Array.isArray(rawHomescreen)) {
            // Legacy Array support (just cache/expiry)
            rawHomescreen.forEach(item => {
                if (item.cache !== undefined) homescreenConfig.cache = item.cache;
                if (item.expiry !== undefined) homescreenConfig.expiry = item.expiry;
            });
        } else if (typeof rawHomescreen === 'object') {
            // Object support (New Standard)
            if (rawHomescreen.cache !== undefined) homescreenConfig.cache = rawHomescreen.cache;
            if (rawHomescreen.expiry !== undefined) homescreenConfig.expiry = rawHomescreen.expiry;

            // Made For You (New Location)
            if (rawHomescreen.madeforyou) {
                const mfy = rawHomescreen.madeforyou;
                if (Array.isArray(mfy)) {
                    homescreenConfig.madeforyou.content = mfy;
                } else if (typeof mfy === 'object') {
                    homescreenConfig.madeforyou.content = mfy.items || mfy.content || [];
                    homescreenConfig.madeforyou.pills = mfy.desktop_pills || mfy.pills || false;
                }
            }

            // Customize (New Location)
            // Support both spellings as requested
            const cust = rawHomescreen.customize || rawHomescreen.custimize;
            if (cust) {
                homescreenConfig.customize = cust;
                // Ensure manual structure if exists
                if (homescreenConfig.customize.manual) {
                    const m = homescreenConfig.customize.manual;
                    // defaults
                    if (!m.buttontype) m.buttontype = 'squares';
                    if (m.library === undefined) m.library = true; // Default to true as requested
                    if (!m.content) m.content = [
                        {
                            id: "37i9dQZF1DXcBWIGoYBM5M",
                            title: "Top Hits",
                            type: "playlist",
                            images: [{ url: "https://charts-images.scdn.co/assets/locale_en/regional/daily/region_global_default.jpg" }]
                        }
                    ];
                }
            }
        }

        // Pinned Items (Sticky Feature)
        // Pinned Items (Sticky Feature)
        // Supports: homescreen: { sticky: { helper: 'input_select.cx', limit: 10 } }
        // OR legacy/alternate: pinned_items_entity
        if (rawHomescreen.sticky) {
            homescreenConfig.sticky = {
                helper: rawHomescreen.sticky.helper,
                limit: rawHomescreen.sticky.limit || 10
            };
        } else if (rawHomescreen.pinned_items_entity) {
            // Backward compatibility or alternative simple key
            homescreenConfig.sticky = {
                helper: rawHomescreen.pinned_items_entity,
                limit: 10
            };
        }

        // --- 3. Device Config (FIXED FOR YOUR YAML) ---
        let devicePlayback = { hide: [], show: [] };
        let foundDefaultDevice = null;

        if (Array.isArray(config.device_playback)) {
            config.device_playback.forEach(entry => {
                if (entry.hide) devicePlayback.hide = devicePlayback.hide.concat(entry.hide);
                if (entry.show) devicePlayback.show = devicePlayback.show.concat(entry.show);
                if (entry.default) foundDefaultDevice = entry.default;
            });
        } else if (typeof config.device_playback === 'object' && config.device_playback !== null) {
            const dp = config.device_playback;
            if (dp.hide) devicePlayback.hide = devicePlayback.hide.concat(dp.hide);
            if (dp.hide) devicePlayback.hide = devicePlayback.hide.concat(dp.hide);
            if (dp.show) devicePlayback.show = devicePlayback.show.concat(dp.show);
        }

        // --- 3b. Volume Settings ---
        let volumeConfig = {
            rules: [],
            fallback: 25,
            slider: { rate_control: true, optimistic: true }
        };
        let volumeSet = false;

        // NEW: Top-level Volume Config
        if (config.volume) {
            volumeSet = true;
            const v = config.volume;

            // Slider Settings
            if (v.slider) {
                if (v.slider.rate_control !== undefined) volumeConfig.slider.rate_control = v.slider.rate_control === true;
                if (v.slider.optimistic !== undefined) volumeConfig.slider.optimistic = v.slider.optimistic === true;
            }

            // Default / Fallback Logic
            if (v.default !== undefined) {
                if (typeof v.default === 'number') {
                    // Case 1: Scalar (volume.default = 25)
                    volumeConfig.fallback = v.default;
                } else if (typeof v.default === 'object' && !Array.isArray(v.default)) {
                    // Case 2: Object (volume.default = { fallback: 25, rules: [...] })
                    if (v.default.fallback !== undefined) volumeConfig.fallback = Number(v.default.fallback);
                    if (Array.isArray(v.default.rules)) volumeConfig.rules = v.default.rules;
                }
            }
            // Note: If v.default is missing, we use internal default (25)
        }

        // LEGACY: device_playback.default_volume
        if (!volumeSet && config.device_playback && config.device_playback.default_volume) {
            const rawVol = config.device_playback.default_volume;
            if (typeof rawVol === 'number') {
                volumeConfig.fallback = rawVol;
            } else if (typeof rawVol === 'object') {
                if (rawVol.default !== undefined) volumeConfig.fallback = Number(rawVol.default);
                if (Array.isArray(rawVol.time)) volumeConfig.rules = rawVol.time;
            }
        }

        // --- 4. Queue Config ---
        let queueSettings = {
            enabled: false,
            openInit: false,
            components: { shuffle: false, previous: true, next: true, like: true, volume: true, device: true }
        };



        if (config.queue && typeof config.queue === 'object' && !Array.isArray(config.queue)) {
            // Desktop Settings
            const desktop = config.queue.desktop;
            if (desktop) {
                if (desktop.open_init === true) queueSettings.openInit = true;

                // Miniplayer Settings
                if (desktop.miniplayer) {
                    if (desktop.miniplayer === true) {
                        queueSettings.enabled = true;
                    } else if (typeof desktop.miniplayer === 'object') {
                        // Strict object parsing for miniplayer components
                        const mp = desktop.miniplayer;
                        queueSettings.components.shuffle = !!mp.shuffle;
                        queueSettings.components.previous = !!mp.previous;
                        queueSettings.components.next = !!mp.next;
                        queueSettings.components.like = !!mp.like;
                        queueSettings.components.volume = !!mp.volume;
                        queueSettings.components.device = !!mp.device;
                    }
                }
            }
        }

        // console.log("[SpotifyBrowser] Parsed Queue Settings:", queueSettings);

        // --- 5. Made For You Config (DEBUGGING) ---
        // Log the state of parser to help debug "missing made for you"
        // console.log('SpotifyBrowser ConfigParser: Raw Homescreen:', rawHomescreen);
        // console.log('SpotifyBrowser ConfigParser: Raw MadeForYou (Root):', config.madeforyou);

        // Fallback: Legacy Root Made For You (if not defined in homescreen)
        if (homescreenConfig.madeforyou.content.length === 0) {
            if (Array.isArray(config.madeforyou)) {
                // console.log('SpotifyBrowser: Using Legacy Array MadeForYou');
                homescreenConfig.madeforyou.content = config.madeforyou;
                if (config.desktop_madeforyou_pills) homescreenConfig.madeforyou.pills = true;
            } else if (config.madeforyou && typeof config.madeforyou === 'object') {
                // console.log('SpotifyBrowser: Using Legacy Object MadeForYou');
                homescreenConfig.madeforyou.pills = config.madeforyou.desktop_pills || false;
                homescreenConfig.madeforyou.content = config.madeforyou.items || config.madeforyou.content || [];
            }
        }

        // console.log('SpotifyBrowser: Final Homescreen Config:', homescreenConfig);

        // --- 6. ADVANCED & EXTERNAL CONFIG ---
        let advConfig = {
            similar_artists: { provider: null, limit: 10 },
            radio_track: { enabled: false }
        };

        if (config.advanced) {
            if (config.advanced.similar_artists) {
                advConfig.similar_artists = { ...advConfig.similar_artists, ...config.advanced.similar_artists };
            }
            if (config.advanced.radio_track) {
                const rt = config.advanced.radio_track;
                if (rt.provider) {
                    advConfig.radio_track = {
                        enabled: true,
                        provider: rt.provider,
                        limit: rt.limit !== undefined ? rt.limit : 30,
                        dontstopthemusic: rt.dontstopthemusic !== undefined ? rt.dontstopthemusic : true
                    };
                }
            }
        }

        let extProviders = config.external_providers || {};

        // --- FINAL CONFIG OBJECT ---
        return {
            auto_close_seconds: 0,
            scan_interval: null,
            close_on_disconnect: config.closeondisconnect !== false,
            custom_hash: config.custom_hash ?
                (config.custom_hash.startsWith('#') ? config.custom_hash : `#${config.custom_hash}`)
                : '#spotify-browser',

            // Merge root config first
            ...config,

            // Apply our logic overrides

            entity: startupEntity,
            default_entity: startupEntity,
            spotify_accounts: accounts,

            spotify_accounts: accounts,

            // Home On Exit Logic
            home_on_exit: (() => {
                const val = config.homeonexit;
                if (val === undefined || val === true) return { enabled: true, timeout: 0 };
                if (val === false) return { enabled: false, timeout: 0 };
                if (typeof val === 'number') return { enabled: true, timeout: val };
                if (typeof val === 'object' && val.timeout) return { enabled: true, timeout: val.timeout };
                return { enabled: true, timeout: 0 };
            })(),

            animations: {
                page_transition: config.animations?.page_transition || 'fade',
                browser_open: config.animations?.browser_open || 'fade',
                blur: config.animations?.blur !== false // Default true
            },

            default_device: null,
            volume: volumeConfig,

            advanced: advConfig,
            external_providers: extProviders,
            homescreen: homescreenConfig,
            device_manager: (config.device_playback && config.device_playback.helper) || null,
            device_playback: devicePlayback,
            queue_settings: queueSettings,
            cache_size: config.cache_size === undefined ? 10 : config.cache_size,

            // Desktop Config
            desktop_style: (() => {
                const ds = config.desktop_style || {};
                const toCss = (val, def) => {
                    if (val === undefined || val === null) return def;
                    if (typeof val === 'number') return `${val}px`;
                    if (typeof val === 'string' && !isNaN(val)) return `${val}px`;
                    return val;
                };

                const globalMargin = toCss(ds.margin, '24px');

                return {
                    // Mode: 'default', 'fixed', 'fullscreen'
                    mode: ds.mode || (ds.width || ds.height ? 'fixed' : 'default'),
                    width: toCss(ds.width, '85vw'),
                    height: toCss(ds.height, '85vh'),

                    // Margins (Individual override global)
                    margin_top: toCss(ds.margin_top, globalMargin),
                    margin_bottom: toCss(ds.margin_bottom, globalMargin),
                    margin_left: toCss(ds.margin_left, globalMargin),
                    margin_right: toCss(ds.margin_right, globalMargin),

                    fullscreen: ds.fullscreen === true // Shortcut
                };
            })(),
        };
    }
}
