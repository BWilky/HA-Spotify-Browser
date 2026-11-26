# Architecture review and improvement plan — HA Spotify Browser

## Context

The card has grown to ~17k lines of plain Lit JS (27 custom elements, no types, no lint, tests only on pure modules). You asked for an architecture review covering speed, organization and code reduction, run through sub-agents with me planning and verifying.

How it was done: four read-only reviewers (2 Fable, 2 Opus) each read one slice in full — app shell, data layer, browse views, players/devices/overlays — and I covered styles/build/layout myself. I then re-read the source behind each reviewer's top claims. Everything below marked **verified** I confirmed in the code. Nothing was built, run or measured (plan mode), so speed payoffs are call counts and render counts read from code, not timings, and line counts are reviewer estimates.

**Headline:** the architecture is sound in outline (one service stack, a router with a page cache, a single overlay primitive, a table-driven config parser). The size comes from three things: parallel implementations of the same feature (desktop vs mobile now-playing, playlist vs artist view, five device lists, five list-row templates), a root component that is also the window manager and popup host, and ~650 lines of dead code. The speed problems are mostly "work that runs when nobody is looking": the whole service stack fetches from Spotify while the overlay is closed, hidden pages re-render on every HA tick, and status checks re-run with every track id on each page of a playlist.

The review also turned up **nine functional bugs**, listed first because they are cheap and independent of any refactor.

## What approval of this plan executes

**Phases 1–3 only** (bugs, speed quick wins, dead-code removal): small, low-risk diffs that the existing tests plus a smoke harness can check. One commit per phase on the current branch, pushed, no PR.

**Phase 4 is a roadmap, not part of this run.** Those are structural moves that change how things feel (scroll, drag, skip) and need you to check them on a real phone/tablet against live SpotifyPlus and Sonos, which I cannot do from here. Each item there should be its own PR.

Implementation is fanned out to sub-agents (Fable/Opus) on disjoint file sets; I review every diff before it is committed.

---

## Phase 1 — Bugs (all verified in code unless marked)

| # | Bug | Where | Fix |
|---|---|---|---|
| 1 | "Refresh Data" menu item does nothing — header emits `menu-refresh`, the app handles only `menu-device`/`menu-accounts`/`menu-library` | `components/spotify-header.js:201`, `spotify-browser-app.js:1126-1136` | Add a `menu-refresh` case that calls the current page's existing `refresh()` / `refreshSections()` |
| 2 | Storage-corruption alert can never appear — dispatched on the host, the only listener is on the inner wrapper, and it fires while the overlay is closed | `spotify-browser-app.js:920-937`, `:596` | Call `_handleShowAlert` directly, deferred until the overlay is open |
| 3 | Navigating to the page you are already on pushes history, so Back appears stuck (search via Enter after debounce, library menu on library, etc.) | `router.js:46` | Guard `pageId !== currentPageId`; add a case to `tests/router.test.js` |
| 4 | Queue-only changes never notify the UI — `refreshQueue` mutates `this.state.queue` in place, so `_statesEqual` sees no change | `components/controllers/player-controller.js:373-379`, `:237-241` | One `_setState(patch)` that builds a new object and dispatches; route the ~10 dispatch sites through it |
| 5 | End-of-track timer re-arms every 300 ms via `refreshQueue` → `_updateStateFromHass` → `_resyncEOSTimer` while HA still reports the old track past its duration | `player-controller.js:725-748` | Latch the end-of-track refresh to once per track id |
| 6 | A hidden cached artist page rewrites the app header (title/transparency) on every track change; a scrolled playlist comes back from Back with a transparent untitled header | `components/views/spotify-artist-view.js:153`, `router.js:192-194`, `components/spotify-context-view.js:725-735` | Dispatch `header-scroll` only when the page is the current one and values changed; add `updateHeaderState()` to playlist-view |
| 7 | `performance: auto` never auto-detects unless the user writes the `performance:` key — nested defaults are skipped when the key is absent | `config_parser.js:273`, `:336-346` | Always recurse into nested groups; drop the duplicated defaults in parents. **Behaviour change:** weak devices (≤4 cores) that never set the key will start getting lite mode (no blur). Tell me if you would rather keep today's default |
| 8 | Services can hold a stale `hass` — the render gate passes only for the player entity and storage sensor, and services get `hass` only after a passed gate, so Sonos entity changes may not reach `PlayerController`/`SonosBridge` (code path verified; live impact suspected) | `spotify-browser-app.js:148-160`, `:398-404` | Always pointer-swap `hass` into api/sonosBridge/storage; add the Sonos device-map entities to the gate's relevance list. Needs your check on a Sonos setup |
| 9 | Sidebar queue rows stay clickable under the blur while the volume/device overlay is open (suspected) | `styles/spotify-queue.styles.js` `:host`, `components/players/sidebar/queue.js:23-31`, `sidebar/index.js:50-54` | Split `queueStyles` into host layout vs row styles (also removes the override) |

## Phase 2 — Speed quick wins

1. **Stop working while the overlay is closed** (verified). `updated()` fans `hass` out to every service regardless of `_isOpen`; each track change then fires queue, recents and favorites calls plus art preloads on every tab that merely has the card loaded. Opening already re-reads all of it (`_refreshAfterReturn`). → In `spotify-browser-app.js:398-406` skip `playerController.updateHass` and the router fan-out when closed, push once on open; add an `active` flag in `player-controller.js` gating `refreshQueue`/`refreshRecent`/`checkTrackFavorites`/`_preloadNeighborArt`. Saves ~3–4 SpotifyPlus calls per track per connected client.
2. **Push `hass` only to the visible page** (verified). `router.js:24` assigns it to all ≤10 cached pages. → Assign to the current page; call `_injectProps` when a cached page is shown.
3. **No app re-render per scroll frame** (verified). Hero pages dispatch `header-scroll` every frame and the app handler calls `requestUpdate()` (`spotify-browser-app.js:281-286`), re-evaluating ~75 bindings and re-rendering the context menu via a fresh `|| []`. → Early-return when values are unchanged, set the header's props directly, use a constant empty array.
4. **Status checks only for new ids** (verified). `spotify-playlist-view.js:521-537` re-runs follow/pin/like checks with *all* loaded track ids on every `data` swap — once per 50-track background page (a 500-track playlist sends 2,700 ids over 9 calls); the artist view repeats its checks 5× per open. → Re-run id-scoped checks only when `data.id` changes; check only unseen track ids in chunks of 50; pass follow state down from context-view; set `hasMore:false` for playlist/album.
5. **Right-sized images** (verified). `getItemImage` (`utils.js:141-149`) always returns `images[0]`, Spotify's largest, for 40px rows, queue rows, the mini-player and cards. → Add `pickImage(images, minPx)` and use ~64px for rows, ~300px for cards, full size only for heroes and mobile now-playing; add `loading="lazy"`/`decoding="async"` on `<img>` rows.
6. **Guards on hidden components** (verified). `spotify-search.js` declares `hass` and never reads it; `spotify-library.js` has no `shouldUpdate` and re-attaches its IntersectionObserver every render; nothing under `components/players|devices|popups` has a `shouldUpdate`; the sidebar's 1 Hz progress timer runs whenever the panel is open, on mobile too. → Drop `hass` from search; `shouldUpdate` on library keyed to playing context; `shouldUpdate` on `now-playing-mobile`, `queue-panel`, `device-manager-popup` keyed to `visible`; start/stop the sidebar timer on visibility.
7. **Long playlists** (mechanism verified, not measured). Any state change (hero play, pin, follow) rebuilds every track row; `render()` also reduces/filters all items each pass. → Wrap the list in `guard([...], () => repeat(...))` (already exported by `lit.js`), memoize totals and the genre filter in `willUpdate`, add `content-visibility:auto` on `.track-row` (check against sticky/parallax).
8. **Parallel pagination** (verified). `fetchPaginated` (`api.js:461-477`) is sequential against a 10-item cap and rails ask for 12, so every artist rail takes two round trips; discography takes five; similar-artist hydration awaits six lookups in series. → Rails ask for 10; after page 1 returns `total`, fetch the remaining offsets with `Promise.all`; same for similar artists. `tests/fetchPaginated.test.js` pins limits/offsets, which a parallel version still satisfies.
9. **One short-TTL read cache with in-flight de-dupe.** `get_artist` is requested from 6 sites, recents from 4 with different limits, and library "recent" fetches a full `get_playlist` per context just for name and image. → `api.cachedRead(service, params, {ttl})` storing promises (dropping null/rejected), replacing the two bespoke unbounded caches at `api.js:1206-1238`.

## Phase 3 — Dead code removal (~650 lines, each grepped repo-wide)

- **Shell (~60):** `reveal-all-devices` + handler, `close-queue` listener, unreachable mini-player fallback (`spotify-browser-app.js:1869-1872`), the empty `status === 'empty'` branch, `router.js` `host`/`currentPageData`/impossible `pageId` check.
- **Views (~130):** the unreachable `collection-playlists` path in `spotify-context-view.js` (+ context-list `layout`/grid CSS), `hass` props passed to views that never read it, unused artist-view fields, ~25 redundant `requestUpdate()` after reactive assignments, no-op `try/catch` around `render()`, dead CSS in `spotify-context-view.styles.js`.
- **Data (~115):** `DeviceManager.setDefault/setBackup/remove/update/rename` (no callers), `PlayerController.play`, two unused pseudo-service map entries, the double scan in `skipNext`, and the ~11 unreachable `playerController ? … : api…` fallbacks in the player UI. The old array-schema storage migration (`device-manager.js:66-71`) goes only if you confirm no v1 users remain.
- **Styles (~230):** the now-playing block in `styles/spotify-queue.styles.js:70-265` (duplicated inside `nowplaying.js`'s own shadow root), the device/dropdown rules in `styles/spotify-popups.styles.js:14-80`, `.device-*` in `shared-styles.js:665-678`. Each class gets a fresh grep before deletion — my spot-check found `device-refresh-btn` still used by `sidebar/queue.js`, so that one stays.
- **Icons (~70):** seven unused exports in `components/common/icons.js` (`plusIcon`, `playlistAddIcon`, `pencilIcon`, `trashIcon`, `lockIcon`, `peopleIcon`, `personIcon` — or better, use them in place of the inline copies), the dead `'manager'` variant of `deviceTypeIcon`, unused `MENU_ICONS` keys.
- **Build hygiene (same commit):** release workflow builds with `npm ci && npm run build:prod` instead of unpinned `npx esbuild`; add a PR workflow running `npm test` and the build.

---

## Phase 4 — Structural roadmap (separate PRs, not executed now)

Ordered by value. Each needs a manual check on device.

**Views** (`spotify-playlist-view.js` 1683 → ~900)
- Extract playlist edit mode (~335 lines) into `<spotify-playlist-editor>`, with the diff/reorder plan as a pure, tested `planPlaylistEdit(orig, final)` — today it is the riskiest untested code in the repo.
- One `HeroScrollController` replacing four copies of scroll/parallax/header-alpha/load-more (model: the existing `components/controllers/list-drag-controller.js`).
- Shared likes / pin / optimistic-playback controllers for playlist-view and artist-view, which are near line-for-line copies (~350 lines).
- One `renderListRow` + `itemSubtitle` + skeleton/empty helpers in `components/media-templates.js` replacing five row implementations (~150 lines); search and library CSS merge.
- `loadPageData` (285-line if/else) → loader map in a plain module. Note `tests/includeGroups.test.js` regex-reads this source and must be replaced with a real unit test.

**Players, devices, overlays**
- `NowPlayingController` shared by `sidebar/nowplaying.js` and `now-playing-mobile.js` (~150–200 lines; also gives desktop optimistic skip and a queue refresh after shuffle, which have drifted). First step: a pure `playbackProgress()` in `utils.js` replacing three copies — also fixes the mini-player reading the wrong entity under Sonos (suspected).
- One device row template, one scan path, one transfer handler (five lists / three scans / three transfers today; desktop transfers currently show no toast or failure).
- Overlay stack in `components/bottom-sheet.js` so Escape closes only the top surface everywhere; shared `sheetStyles`; move `spotify-reorder-dialog.js` onto bottom-sheet + `ListDragController` (452 → ~280).
- One `VolumeController` — the Connect sheet currently ignores the documented `rate_control`/`optimistic` options.

**Shell** (`spotify-browser-app.js` 1876 → ~1,200)
- Viewport-lock, idle-close and drag-dismiss controllers (~260 lines with no Spotify dependency).
- `<spotify-mini-player>` + a small `PlayerStateController` so the root stops mirroring player state (two subscription mechanisms → one).
- One toast/alert channel (15 inline `getElementById('popups').showToast` sites, four mechanisms); `spotify-popups` shrinks to toasts and alerts.
- Popup state: 14 visibility booleans and a hand-maintained 41-line `_closeAllPopups` → a single "active overlay" field.

**Data layer**
- `api.js`: `_command`/`_checkIds` helpers and an options object instead of three positional booleans (~125 lines); then split into transport / playback / library behind the same `SpotifyApi` facade; add list methods so views stop re-parsing 56 raw `fetchSpotifyPlus('get_*')` responses.
- One pending-write overlay in storage instead of two (closes a lost-update window between a pin write and a device write); merge `storage-manager.js` into the strategy.
- Typed read failures — today `null` means error, empty and loading alike, and a failed `get_playlist` spins forever.

**Organization**
- CSS: ~2,800 lines inline in components vs ~2,000 in `styles/`, no rule. Adopt one: component CSS lives beside the component in `<name>.styles.js`; `styles/` holds only tokens and shared primitives. Split the 950-line `sharedStyles` (≈400 lines are shell-only) into shell vs shared.
- Layout: move root `api.js`/`router.js`/`utils.js`/`config_parser.js`/`spotify-browser-app.js` under `src/`; `home-content.js` is pure functions misfiled under `controllers/`; split `utils.js` by domain (pure file moves).
- Add `jsconfig.json` with `checkJs` on the pure modules first — the bug classes above (wrong event target, stale reference, dead branches) are what it catches.

## Deliberately left alone

- **Vendored `lit.js`** (29 KB) and **single-file bundle**: HACS ships one file, so lazy `import()` is not viable without a packaging change.
- **Teardown on close** (`render()` returns nothing when closed): cheap and keeps zero DOM while closed.
- **`config_parser.js`**: already table-driven; no rewrite to be had beyond bug 7.
- **`utils.js`**: no dead exports.
- **No virtual-list library**: `guard` + `content-visibility` covers it with what Lit already ships.
- The Sonos/Cast/iOS workarounds the reviewers flagged as odd-but-intentional (scan gating, transfer holds, stalled-launch watchdog, delayed `visibility:hidden` on sheets, z-index ladder).

## Verification (Phases 1–3)

1. `npm ci && npm test` — all 14 existing test files stay green; new cases for router same-page history, `_setState` dispatch on queue change, EOS latch, `pickImage`, parallel `fetchPaginated`, config nested defaults.
2. `npm run build` (output in gitignored `dist/`) — bundle builds; compare size before/after.
3. Smoke harness in the scratchpad: load `dist/spotify-browser.js` in the pre-installed Chromium via Playwright with a stub `hass` (fake `callWS`/`states`), open the overlay, navigate home → playlist → artist → back, open queue and device sheets; assert no console errors and count `callWS` invocations while closed (expect zero after Phase 2.1) and per playlist page-in.
4. Per dead-code deletion: a repo-wide grep for the symbol/class immediately before removing it.
5. For you to check on a real instance, since I cannot: Sonos playback state updates (bug 8), scroll feel on mobile hero pages, lite mode on a weak tablet (bug 7).
