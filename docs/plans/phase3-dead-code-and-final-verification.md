# Phase 3 (dead-code removal) and final verification — HA Spotify Browser

**Status: done.** Phase 1 (`f2070dc`), Phase 2 (`4995afc`) and Phase 3 (the commit that adds this note) are on branch `worktree-bridge-cse_01HVcWXE9McGsDjLcW4C5zMn`. The full review and the Phase 4 roadmap are in `docs/plans/architecture-review.md`.

Kept on purpose during Phase 3, with the reason:
- `skipNext`'s extra `triggerScan`: on a failed skip it is the only scan that runs.
- `try/catch` in playlist-view `render()` / `renderTrackRow()`: the bodies run plain JS that can throw on malformed data, and the catch renders a useful fallback.
- The inline shuffle SVGs (no exported equivalent) and the pill equalizer (not equivalent to `playingBarsIcon`).
- `sharedStyles` in the reorder dialog: its buttons and input rely on its `font-family: inherit`, text-selection and scrollbar rules.
- One `requestUpdate()` in context-view, after an assignment that can be the same object reference.
- `.queue-context-sub` still has no CSS (unstyled "played … ago" line); left for a design decision.

The "small bugs found during Phases 1–2" list below is still open.

## Rules for the whole phase

- Pure deletion or like-for-like replacement only. No behaviour changes, no restructuring (that is Phase 4).
- Line numbers below come from the review of the original code and have shifted after Phases 1–2. **Grep each symbol or class repo-wide immediately before deleting it**; if anything still references it, leave it and note why. One reviewer claim was already wrong this way (`device-refresh-btn` is still used by `components/players/sidebar/queue.js`).
- One commit for the phase. `npm test` must stay green (164 tests at the end of Phase 2).
- Expected size: about 650 lines removed. That is the reviewers' estimate, not a measurement.

## 3.1 App shell — about 60 lines

File: `spotify-browser-app.js`, plus `router.js`.

- `reveal-all-devices` listener and `_handleRevealAllDevices` (marked "Legacy/Fallback"): nothing dispatches the event.
- `@close-queue` listener on `<spotify-sidebar-player>`: nothing dispatches it.
- The unreachable `else if (this.api)` fallback at the end of the mini-player handlers (controller and api are created and destroyed together).
- The `status === 'empty'` branch in `_validateStorage`: nine lines of comment, no code. Keep one line of the comment's reasoning.
- `router.js`: `this.host` and `currentPageData` are never read; the `newPage.pageId !== pageId` half of the context-page condition can never be true (the cache is keyed by pageId).
- `components/spotify-popups.js`: `_renderBackdrop` has one caller — inline it.

## 3.2 Views — about 130 lines

- `components/spotify-context-view.js`: the `collection-playlists` path (type detection, loader branch, render branch). No producer of a `collection:` page id exists. With it go the `layout` property and `.content-grid` CSS in `components/views/spotify-context-list.js`.
- `hass` props that the receiving view never reads: the `.hass=` bindings context-view passes to playlist-view, artist-view and section-view, the `hass` property declarations there, and the `shouldUpdate` guards that exist only to swallow hass-only updates. Check each view for a real read first (artist-view only assigns `this.hass = null`).
- `components/views/spotify-artist-view.js`: `_currentHassIdAtClick` (written, never read), `_getHassTrackId` (only feeds it), `_currentUserId` (unused).
- `components/spotify-context-view.js`: the no-op `connectedCallback` override; about 25 `requestUpdate()` calls that directly follow an assignment to the reactive `_contextData`. **Keep** any that follow an in-place mutation.
- The `@navigate` / `@back` re-dispatch handlers in context-view: the events are already `bubbles: true, composed: true`. Confirm in a browser that navigation from section view and discography still works before deleting.
- `try/catch` around template construction in `spotify-playlist-view.js` `render()` and `renderTrackRow()`: Lit errors surface at commit, not while the template is built, so these never catch.
- Inline SVGs that duplicate an exported icon: pin icon in playlist-view (`pinIcon` exists), the shuffle path inlined twice there, the hand-coded equalizer in `renderPillTemplate` (`playingBarsIcon` is already imported).
- Dead CSS in `styles/spotify-context-view.styles.js`: `.page.is-refreshing`, `.artist-content`, `.track-meta`.

## 3.3 Data layer — about 115 lines

- `components/devices/device-manager.js`: `setDefault`, `setBackup`, `remove`, `update`, `rename` have no callers (the popup only calls `saveDevices(wholeList)`). `add` is used only by `tests/deviceManager.test.js` — point those tests at `saveDevices` and remove it. `_loadData` is an async shim over the synchronous `_readData`.
- `components/controllers/player-controller.js`: `play()` has no callers; `skipNext` calls `triggerScan` right after `fetchSpotifyPlus` already did.
- `api.js`: the `player_media_play` / `player_media_pause` entries in the pseudo-service map have no callers.
- `PinnedItemsManager.isPinned` is used only by tests. **Keep it** — Phase 4 wants the two views to use it instead of their own copies.
- The unreachable `playerController ? … : api.fetchSpotifyPlus(…)` fallbacks in `components/players/sidebar/nowplaying.js` and `components/players/now-playing-mobile.js` (about 11 sites), and the `shuffle-toggle` / `like-toggle` events they would fire, which nothing listens for.
- The old array-schema (v1) storage migration in `device-manager.js` — removed; the owner confirmed no v1 installs remain.

## 3.4 Styles — about 230 lines

- `styles/spotify-queue.styles.js` (`queueListStyles` after the Phase 1 split): the now-playing and mini-player block — `.queue-now-playing-row`, `.queue-mini-controls`, `.large-side-btn`, `.queue-progress-*`, `.queue-device-row`, `.mini-btn`, `.volume-control-container`, `.vol-icon`, `.volume-slider`, `.queue-row-play-btn`, `.queue-section-label`. These classes are rendered only inside `nowplaying.js`, which has its own shadow root and its own copy of the rules. Keep the row classes, `.row-menu-btn` and the empty-state rules.
- `styles/spotify-popups.styles.js`: `.device-popup-*`, `.device-row*`, `.device-refresh-btn` (dead **in this sheet** only), `.dropdown-menu`, `.menu-item`, and the unused `LitElement, html` imports.
- `styles/shared-styles.js`: `.device-row`, `.device-icon`, `.device-info`, `.device-name`, `.device-type`, `.device-active-icon`. Check `sidebar/queue.js` and `device-picker-small.js` first; `sharedStyles` is adopted by 13 components.
- `components/spotify-reorder-dialog.js`: `.alert-btn*` CSS, the `_confirmDeleteId` and `_showResetConfirm` properties, and the `sharedStyles` import (it overrides `:host` and uses none of its classes — confirm the override is not the only thing making it lay out).
- `components/players/queue-row.js` emits `.queue-context-sub`, which has no CSS anywhere: either style it or drop the class. Decide by looking at it.

## 3.5 Icons — about 70 lines

File: `components/common/icons.js`.

- Seven exports with no importers: `plusIcon`, `playlistAddIcon`, `pencilIcon`, `trashIcon`, `lockIcon`, `peopleIcon`, `personIcon`. Preferred: use them where a component inlines the same SVG (`personIcon` in `account-panel.js`, `trashIcon` in `spotify-reorder-dialog.js`), and delete the ones that still have no user.
- The `'manager'` variant of `deviceTypeIcon` — it is never called with a second argument.
- `MENU_ICONS` keys `play`, `plus`, `drag-handle` in `components/popups/spotify-context-menu.js`.
- Byte-identical inline copies of `menuIcon` in `sidebar/queue.js` and `queue-panel.js`.

## 3.6 Build hygiene (same commit)

- `.github/workflows/release.yml`: build with `npm ci && npm run build:prod` so releases use the locked esbuild, not whatever `npx esbuild` resolves that day.
- New `.github/workflows/test.yml`: on pull requests and pushes to `main`, run `npm ci`, `npm test`, `npm run build:prod`.

## Small bugs found during Phases 1–2, not yet fixed

Not dead code, but cheap, and found while working. Fix here or fold into Phase 4 — your call.

1. `components/players/sidebar/index.js` `_handleBlurClick`: with the **device dropdown** open, a tap on the blurred queue opens the volume overlay as well instead of closing the dropdown.
2. `spotify-browser-app.js` `_handlePlaylistChanged` calls `_refreshHomePinned()` unconditionally; with pinned disabled, home's `this.pinned` is null and `fetchSectionData('pinned')` likely throws and leaves `_fetching.pinned` stuck true. Read from code, not reproduced.
3. `spotify-playlist-view.js` `_enrichGenres`: returns early when no new artists need looking up, so newly loaded liked songs whose artists are already known never get genres attached.
4. `artist-discography:` pages count as hero pages, so the app header is set transparent on arrival, and the discography view never restores it.
5. "Refresh Data" does nothing page-specific on search, and on library only re-reads playlists and recents (not the Albums / Artists pills).
6. Duplicate fetches on open: recents twice (home and the player refresh), and on desktop the queue twice (the sidebar's own tab refresh plus the app's).
7. The root component still re-renders on every player state tick (10 of 10 in the harness). Removing that needs the `PlayerStateController` change in Phase 4.
8. `open-track-menu` payloads still carry the full-size image for a 46px menu thumbnail.

## Final verification (after Phase 3)

1. `npm ci && npm test` — all green.
2. `npm run build:prod -- --outfile=dist/final.js` and compare with the baseline: 547.8 KB minified, 130.8 KB gzip (`gzip -c dist/final.js | wc -c`).
3. Browser harness (stub Home Assistant in headless Chromium), in `tools/smoke/`:
   - Run: `npm run build && node tools/smoke/smoke.mjs dist/spotify-browser.js <outDir> final && node tools/smoke/summ.cjs <outDir>/final.json` (needs `playwright` resolvable, e.g. via `NODE_PATH`, and a Chromium it can launch).
   - Pass criteria: zero console errors; every number equal to the Phase 2 run (dead-code removal must not change a single call count, render count or image size); screenshots of home, playlist, queue, artist and library on desktop and mobile visually identical to the Phase 2 screenshots.
4. Targeted checks for what Phase 3 deletes, in the harness or by hand: open the queue sidebar, the device picker, the device manager, the pinned reorder dialog, a track context menu, and the account sheet (all lose CSS or icons in 3.4–3.5); navigate into a section "See All" page and a discography page and back (3.2 removes event re-dispatch).
5. On a real instance — these cannot be checked from the cloud session:
   - Sonos: track, play/pause and volume changes reach the UI during local Sonos playback (Phase 1 fix 8).
   - Lite mode: a device with ≤4 cores or ≤4 GB now loses blur unless `performance: high` is set (Phase 1 fix 7). Confirm that is what you want on your phones.
   - Scroll feel and header fade on mobile hero pages; long-playlist scrolling with `content-visibility` (rows must not clip focus rings or shadows; no effect on Safari before 18).
   - Thumbnail sharpness on a high-density phone and on a wall tablet.
   - Open the overlay after a track changed while it was closed: now-playing, queue and like state are correct within a second or two.
   - Tap a blurred queue row with the volume overlay open: it should dismiss, not play.
