# Spotify Browser v3

A Home Assistant Lovelace extension (vanilla JS + Lit, no build step) that renders a
full-screen Spotify browser on top of the [SpotifyPlus](https://github.com/thlucas1/homeassistantcomponent_spotifyplus)
integration. Loaded as a single dashboard resource: `index.js`.

## How it boots

`index.js` waits for `home-assistant`, finds the config (either a root
`spotify_browser:` key in the Lovelace YAML or a `type: custom:spotify-browser-card`
card), parses it with `ConfigParser`, and mounts `<spotify-browser-app>` on
`document.body`. The browser opens via the `spotify-browser-open` window event,
a `#spotify-browser` URL hash (configurable), or per-account hashes.

## Module ownership

| Module | Owns |
|---|---|
| `index.js` | Bootstrap, config discovery, hash/open triggers, placeholder `spotify-browser-card` element |
| `config_parser.js` | ALL config normalization (legacy key aliases live here and nowhere else) |
| `spotify-browser-app.js` | App shell: open/close, header state, popups visibility, manager lifecycles (`_initApi`, `_ensureManagers`) |
| `router.js` | Page navigation, history, LRU page cache, page creation + event wiring (`navigate`, `back`, `open-track-menu`, `header-scroll`) |
| `api.js` (`SpotifyApi`) | Every Home Assistant service call (SpotifyPlus + media_player). Pure transport — no UI state |
| `utils.js` | Shared helpers: device response parsing/normalization, item image resolution, spotify URI parsing, player-state readers |
| `components/controllers/player-controller.js` | Now-playing/queue state machine (EventTarget, emits `state-changed`) |
| `components/controllers/storage-manager.js` + `storage/` | Persistence facade. Single backend: a trigger-template sensor (`sensor.spotify_browser_data`), no localStorage fallback. Reads work for anyone who can see the sensor; writes need admin (fires the event) or a non-admin with a configured `storage.write_script` middle-man (`writeStatus()` reports `no_backend`/`ok`/`guest_local`; a configured `write_script` is trusted without requiring the script entity to be visible in the guest's state map) |
| `components/controllers/pinned-items-manager.js` | Pinned ("sticky") items on top of StorageManager (`pinned_items` key). `checkAvailability()` = can SHOW pins (sensor exists) → gates the home section (read-only for guests); `canEdit()` = can WRITE (admin or guest with working `write_script`) → gates pin buttons (both views) + the home Edit/reorder button |
| `components/devices/device-manager.js` | Saved/live device merging + persistence (`device_manager` key). `fetchMergedDevices(api, attrs, opts)` is the single device-scan entry point |
| `components/controllers/home-content.js` | Content builders shared by home + section views (made-for-you, recent-album dedup) |

## UI layers

- Pages (created by Router into `.page-container`): `spotify-home`,
  `spotify-search`, `spotify-context-view` (which delegates to
  `views/spotify-playlist-view`, `views/spotify-artist-view`,
  `views/spotify-section-view`, `views/spotify-context-list`).
- Chrome: `spotify-header`, `players/sidebar/` (desktop now playing + queue +
  recent), `players/` surfaces (`now-playing-mobile`, `connect-panel`,
  `queue-panel`, `account-panel` — all `bottom-sheet`s),
  `spotify-popups` (device picker, track menu, alerts, toasts),
  `spotify-reorder-dialog`, `devices/` popups.
- `spotify-header` shows the active account's avatar (only on home, right of the
  logo/collapse arrow). With >1 `spotify_accounts`, tapping it (`avatar-click`)
  opens `account-panel` to switch. The app rebuilds the API and clears the
  Router page cache on switch (`switchAccount` → `router.clearCache()`) so every
  page reloads with the new account's data.
- `components/media-templates.js` holds the shared card/pill/track-row templates.
  `spotify-home` renders HTML strings + event delegation (uses `renderCardHtml`);
  everything else uses Lit templates.
- `components/bottom-sheet.js` (`spotify-bottom-sheet`) is the reusable mobile
  slide-up sheet (backdrop + grab handle + drag-to-close). Sheets slot their
  content into it instead of re-implementing the chrome (see
  `players/connect-panel.js`, the mobile device picker, and
  `players/account-panel.js`, the account switcher).

## Conventions

- Events bubble composed; the Router attaches page-level listeners, the app
  handles global ones (`show-toast`, `show-alert`, `open-reorder`,
  `pinned-changed`).
- Components never reach into another object's underscore-prefixed fields —
  add a getter instead (see `DeviceManager.storageEntityId`, `PinnedItemsManager.sensorEntity`).
- Long-lived objects with timers expose `destroy()` (`SpotifyApi`, `PlayerController`);
  Lit components clear their timers in `disconnectedCallback`.
- Styles: `styles/shared-styles.js` = theme variables (`--spf-*`) + app shell +
  cross-page primitives. Component-specific CSS belongs in the matching
  `styles/*.styles.js` file. Desktop breakpoint is `min-width: 769px` /
  mobile `max-width: 768px`.
- Config keys are snake_case; legacy/no-underscore spellings are accepted as
  aliases inside `ConfigParser` only. `full_example_config.yaml` documents the schema.
- `lit.js` is the vendored Lit bundle — never edit it.
- `tests/` holds manual mock-based scripts (`node tests/test_backup.mjs`); there
  is no automated test suite or CI.
