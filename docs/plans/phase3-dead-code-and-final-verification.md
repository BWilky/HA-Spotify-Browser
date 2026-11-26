# Phase 3 (dead-code removal) and final verification — HA Spotify Browser

**Status: done.** Phase 1 (`f2070dc`), Phase 2 (`4995afc`) and Phase 3 (the commit that adds this note) are on branch `worktree-bridge-cse_01HVcWXE9McGsDjLcW4C5zMn`. The full review and the Phase 4 roadmap are in `docs/plans/architecture-review.md`.

Kept on purpose during Phase 3, with the reason:
- `skipNext`'s extra `triggerScan`: on a failed skip it is the only scan that runs.
- `try/catch` in playlist-view `render()` / `renderTrackRow()`: the bodies run plain JS that can throw on malformed data, and the catch renders a useful fallback.
- The inline shuffle SVGs (no exported equivalent) and the pill equalizer (not equivalent to `playingBarsIcon`).
- `sharedStyles` in the reorder dialog: its buttons and input rely on its `font-family: inherit`, text-selection and scrollbar rules.
- One `requestUpdate()` in context-view, after an assignment that can be the same object reference.

See "Bug follow-up after Phase 3" below for what was fixed afterwards and what remains.

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

## Bug follow-up after Phase 3

Fixed in the follow-up commit:

- Tapping the blurred sidebar queue with the device dropdown open now closes the dropdown (it used to open the volume overlay as well).
- Creating or deleting a playlist no longer tries to refresh the home pinned section when pinned is disabled.
- Liked Songs: tracks loaded on later pages now get genres attached when their artists were already looked up.
- "Refresh Data" re-runs the current search, and on the library also re-reads the Albums and Artists pills.
- A failed page load shows "Couldn't load this page" instead of spinning forever and re-requesting on every player change; returning to the page (or Refresh Data) retries.
- Clicking the alert backdrop no longer closes the device picker or cancels a pending device choice.
- The mobile mini-player progress bar follows the entity that is actually playing (the Sonos speaker during local Sonos playback). Not tested against a real Sonos.
- The "played … ago" line in the sidebar's Recently Played tab is styled.

Not a bug after all: the discography page draws its own header under a deliberately transparent app header.

Still open — left for Phase 4 because each falls out of a planned consolidation or needs a design decision:

1. Duplicate fetches on open: recents twice (home and the player refresh), and on desktop the queue twice (sidebar refresh plus the app's). → single player-state subscription.
2. The root component re-renders on every player state tick. → `PlayerStateController` / mini-player extraction.
3. The track context menu receives the full-size cover for a 46px thumbnail. → shared `openTrackMenu` helper.
4. Lost storage update: a pin write followed quickly by a device write can revert the pin. → single pending-write overlay in storage.
5. Desktop next/previous has no optimistic update and desktop shuffle does not refresh the queue (mobile does both). → shared now-playing controller.
6. Desktop device transfers from the sidebar dropdown show no toast and do not report failures. → single transfer handler.
7. The Connect sheet ignores the documented `rate_control` and `optimistic` volume options. → shared volume controller.
8. Escape closes only the device picker and device manager, not the playlist picker or create sheet. → overlay stack.
9. Progress may jump back after an attribute-only update such as a volume change, because position is extrapolated from the entity's last update time (suspected; the code comment suggests the choice was deliberate).
10. The device icon next to shuffle in the desktop sidebar is malformed (four overlapping paths). Needs a decision on which icon to use.

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

## Phase 4 progress

**Wave 1 — done.**
- Playlist edit mode extracted into `<spotify-playlist-editor>`; the choice of Spotify operations is a pure, tested function (`components/controllers/playlist-edit-plan.js`). A scripted edit-and-save in the browser harness produces the same service calls as before, and edit mode renders pixel-identically.
- Storage: one pending-write overlay for the whole blob in `StorageManager` (the trigger-template strategy is merged into it). Closes open bug 4 (a pin write followed by a device write reverting the pin).
- `NowPlayingController` shared by the desktop sidebar and the mobile full-screen view; one `playbackProgress()` for sidebar, mobile view and mini-player. Closes open bug 5. Intended behaviour changes on desktop: Next/Previous are optimistic, Shuffle refreshes the queue, and Previous restarts the current track when more than a few seconds in (as mobile already did).
- `api.js`: command/check wrappers collapsed onto private helpers; `fetchSpotifyPlus` also accepts an options object. Pinned by a characterization suite written against the old code.

Found during Wave 1, not fixed:
- In playlist edit mode the app header's buttons (back arrow, close) sit on top of the editor's Cancel / Save bar. Present before the refactor too.
- `api.js` inconsistencies recorded by the characterization tests: some commands use `callService` and others `callWS`; an empty id list is sent as `ids: ''`; `checkArtistsFollowing` / `checkAlbumFavorites` return raw response shapes while `checkTrackFavorites` normalizes.

**Wave 2 — done.**
- `<spotify-mini-player>` element; the root no longer mirrors player state and no longer re-renders on Home Assistant updates (harness: 10 root renders per 10 player ticks → 0). Mobile now-playing, queue sheet, Connect sheet and sidebar subscribe through `PlayerStateController`. Closes open bug 2.
- One toast/alert channel in the root (`_toast` / `_alert`); `spotify-popups` is toasts + alert only and the device picker is rendered by the root.
- One overlay stack (`components/controllers/overlay-stack.js`): Escape closes only the top surface and is on by default for every sheet, the desktop context menu and alerts. Closes open bug 8. The reorder dialog is rebuilt on `<spotify-bottom-sheet>` and `ListDragController`.
- One device row (`components/devices/device-row.js`) for the picker and the Connect sheet (which now shows custom device icons); one transfer flow (`_transferTo`) that the desktop sidebar dropdown also uses, so desktop transfers get toasts and failure reports. Closes open bug 6.
- One `VolumeController` for the sidebar and the Connect sheet; both honour `devices.volume.rate_control` and `optimistic`. Closes open bug 7.
- The app header is not rendered while a playlist edit session is on screen, so it no longer covers the editor's Cancel / Save.
- The playlist create sheet can no longer be dismissed while a create is in flight.

Behaviour changes in Wave 2 to check on a device:
- Connect sheet volume: updates every 200 ms while dragging (it used to send only when the finger paused), holds the chosen value for 3 s, -/+ taps are throttled with the last one always sent.
- Desktop sidebar device dropdown closes immediately on selection and no longer marks the device active before Home Assistant confirms.
- Reorder dialog: a bottom sheet with a grip on phones; 16px corner radius on desktop (was 12px); Escape in its add-URI field cancels the field rather than closing the dialog.
- Picking the already-active device in the sidebar dropdown or Connect sheet does nothing; the desktop picker still transfers to whatever is picked.
- An alert is layered under the desktop device picker (unchanged from before; one number to flip if unwanted).

Still open after Wave 2: bug 1 (duplicate fetches on open), bug 3 (track-menu image size), bug 9 (progress jump, suspected), bug 10 (malformed device icon in the sidebar — it is a music note drawn over a playlist glyph; needs a decision between the per-type device icon and the cast icon), and the `api.js` inconsistencies listed under Wave 1. `heldVolume` in utils.js is now unused by app code.

Deliberately not done: moving the keyboard/viewport lock, idle auto-close and drag-to-close code out of the root, and collapsing the fourteen popup visibility flags. Both are iOS-sensitive or wide-reaching and cannot be checked without a device.

**Remaining waves**
- Wave 3 — views: shared scroll / like / pin controllers, one list-row template, loader map, track-menu payload helper (bug 3).
- Wave 4 — organization: CSS split, folder layout, type-checking config.
