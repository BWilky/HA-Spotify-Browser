# Code improvement TODO and findings

A running list of improvements for this codebase: duplicated code that can share a helper, speed and efficiency, bugs found along the way, and decisions waiting on the owner. Updated as work lands — check an item off with the commit that did it, and add new findings to the section they belong to.

Paths are relative to the repo root (source lives under `src/`). Background: `docs/plans/architecture-review.md`, `docs/plans/phase3-dead-code-and-final-verification.md`, `docs/plans/HANDOFF.md`.

**Now:** wave A and decisions D1–D6 are done. Next: S7, S8, S9, S10, S12, S15/S17, P2, P4.

Legend: `[ ]` open · `[x]` done (commit) · `[~]` in progress · `[?]` needs the owner's decision · `[-]` decided against (reason given)

## Decisions (owner, 2026-11-26) — to implement

- [x] **D1 Subtitle wording, one style**: lists (Library, Search, "See All") read "Playlist • Owner", "Album • Artists", "Song • Artists", "Artist"; Home cards read just the owner / artists; the artist discography reads "2015 • Album" (or "• Single", etc.). Replaces `SUBTITLE_STYLE`'s per-screen variants. — **Done (e9f894d):** one rule with three styles (`list`, `card`, `discography`); `library` / `search` / `section` remain as aliases of `list` until the library call site is updated.
- [x] **D2 Toast when a pin is pushed off** the full list: "Removed X to make room". — **Done (c3d6c87):** `evictedPinMessage` toast from the playlist page, artist page, Library rows and add-by-URI.
- [x] **D3 Alerts always on top**, including over the desktop device picker. — **Done (c438377):** alert backdrop at 240000 and toasts at 241000, above every sheet, the device picker and the create sheet.
- [x] **D4 One playlist "…" menu**: the Library row offers the same actions as the playlist page (Edit, Make Private/Public, Collaborative, Pin, Delete for the owner; Remove from Your Library and Pin otherwise), and "Playlist deleted" is shown from both places. — **Done (c3d6c87):** Library row menu matches the playlist page (owner: edit, privacy, collaborative, pin, delete; follower: remove from library, pin); "Playlist deleted" from both.
- [x] **D5 Collaborators get "Edit Playlist"** where they are allowed to edit (collaborative playlist they follow). — **Done (c3d6c87):** "Edit Playlist" shown wherever the user may edit tracks (collaborative playlists they follow).
- [x] **D6 Discography page uses the app header** like every other page (drop its own sticky header and back arrow). — **Done (e9f894d):** the discography page uses the app header (one back button, title in the header, opaque from the start) and the shared list-page scroll handling.

## Shared helpers / duplicated code

- [x] **S1 Playlist actions written twice** — delete confirmation, pin toggle and the owner/non-owner menus exist in both `src/components/views/spotify-playlist-view.js` and `src/components/views/spotify-library.js`. One `playlist-actions.js` helper. — **Done (f51d08c):** `src/components/playlist-actions.js` (menus, pin, privacy/collaborative, delete, edit entry) used by both; 156 recorded user steps identical before and after. Library Liked Songs heart uses `heartIcon(true)`.
- [x] **S2 Artist view carousels** — the "title + carousel + skeleton-or-cards" block appears three times in `src/components/views/spotify-artist-view.js`; `renderCarouselSection` (media-templates) already exists. — **Done (b89c6b5):** artist rails use `renderCarouselSection` (`ARTIST_CAROUSEL` options).
- [x] **S3 Artist view track-menu payload** is still hand-built; `openTrackMenu` / `trackMenuDetail` (`src/components/track-menu.js`) exist. — **Done (b89c6b5):** artist top tracks use `openTrackMenu` (thumbnail image).
- [~] **S4 Section and discography pages** run their own scroll/header/load-more code instead of `HeroScrollController`. — **Section page done (b89c6b5).** Discography left: it sends no header events and its 6-line load-more check is synchronous; moving it would add options and change load-more timing by a frame, for no line saving.
- [x] **S5 Sheet styling copied across ~6 sheets** — `.empty`, `.list` scroll region, `.title`, close button (account, connect, queue sheet, device picker, device manager, playlist picker, create sheet). One shared `sheetStyles`. — **Done (6e333c8):** `src/styles/sheet.styles.js` (`sheetStyles` for the account and Connect sheets, `dialogSheetStyles` for the device picker and manager); only byte-identical rules moved.
- [~] **S6 Inline SVG icons duplicated across components** (partly done in 6e333c8: `closeIcon`, `checkIcon`, `sortIcon`, `speakerOutlineIcon`, `staticBarsIcon` and others exported and used in the players, devices and popups; the views' duplicates are S15/S17) (close X ×3, check mark ×2, play/pause and heart paths, speaker outline, equalizer bars, shuffle/prev/next in the now-playing surfaces). Move to `src/components/common/icons.js`.
- [ ] **S7 Raw SpotifyPlus reads re-parsed at ~56 sites** — views call `api.fetchSpotifyPlus('get_*')` directly and each unwraps `result.items`, `result.artists.items`, `items.map(i => i.album)` etc. Add list/read methods on `SpotifyApi` (`getSavedAlbums`, `getFollowedArtists`, `getSavedPlaylists`, `getRecentTracks`, …) returning `{ items, total, cursor }` and migrate.
- [-] **S8 Third drag-reorder implementation** — [-] decided against for now (P2_SHA review): matching the device manager's live reorder, end-clamping, tap tolerance and capture handling would add a second mode to `ListDragController`, not a few options in `src/components/devices/device-manager-popup.js`; `ListDragController` exists.
- [ ] **S9 App panel drag-to-close** (`src/spotify-browser-app.js`) repeats `bottom-sheet`'s pointer logic almost line for line. One `DragDismissController`.
- [ ] **S10 Follow state** (follow/unfollow, optimistic flip, verify re-check) is implemented separately in the playlist and artist views; APIs differ, so share only the common flow.
- [x] **S11 Header CSS duplicated**: most of the block moved from `sharedStyles` into `src/components/spotify-header.js` is re-declared and overridden by `spotify-header.styles.js`. — **Done (6e333c8):** overridden header declarations removed; screenshots identical.
- [ ] **S12 Single-consumer rules still in `sharedStyles`** (home `.section-title`/`.section-grid`/`.scroll-btn`/`.recent-grid-layout`; playlist `.track-row.with-art`, `.track-name`, `.track-artist`, `.track-action-btn.is-favorite`, mobile `.hero-title`; context-list mobile `.list-container`; tracklist `.queue-list` in the scrollbar list). Move each beside its component where cascade order allows.
- [x] **S13 Connect sheet vs picker polish**: the picker has four row rules (tap highlight, `:active`, ellipsis, svg no-shrink) the Connect sheet lacks; the Connect sheet's active-device card ignores custom device icons; the type line wording differs (`deviceTypeLabel` vs raw type). — **Done (6e333c8):** the picker's row polish is in the shared `deviceRowStyles`, and the Connect sheet's active-device card shows custom device icons. The type-line wording difference is left as is.

- [x] **S16 Pin toggle and owner rule repeated** (owner rule: `page-loaders.js` now imports `isPlaylistOwner`, 617605b): `PinStateController.toggle` (`src/components/controllers/pin-state-controller.js` ~58) repeats `togglePin` from `playlist-actions.js` (same `pinned-changed` event and "Pinning Failed" alert); `page-loaders.js` ~65 repeats `isPlaylistOwner`. — **Done (c3d6c87):** `PinStateController.toggle` uses `togglePin`; `page-loaders.js` uses `isPlaylistOwner`.
- [ ] **S17 More icon duplicates (views and popups)**: check mark ×3 (`spotify-playlist-view.js` ~603, `now-playing-mobile.js` ~507, `spotify-playlist-picker.js` ~376); shuffle ×2 in `spotify-playlist-view.js` (~609, ~617) plus variants in the two now-playing surfaces; sort arrows ×2 (`spotify-library.js` ~405, `spotify-playlist-picker.js` ~403); search magnifier at four sizes (library, header, search, playlist picker); the playlist picker's Liked Songs heart could use `heartIcon(true)`.

## Dead code

- [x] **X4 Artist view leftovers**: class `circle-cards` on the "Fans Also Like" row has no CSS anywhere (`src/components/views/spotify-artist-view.js` ~328); an unused `index` parameter (~299) and an unused `e` in `_playPopularTrack`'s handler. — **Done (e9f894d):** removed.

- [x] **X1 Dead CSS** (no element renders them): `.mobile-drag-handle`, `spotify-queue`, `.grid-layout` (×2), `.list-item-title/-subtitle`, `.track-duration`, `.device-list`, `.media-card.playing .media-title`, `.popup-scroll-content`, `.popup-close-btn`, `.page.has-hero-header`. — **Done (6e333c8):** all listed rules removed after re-checking adopters.
- [~] **X2 Unused helpers**: ~~`renderMediaRowTemplate`~~ (removed b89c6b5), `heldVolume` (utils, replaced by `VolumeController`; its test stays only if the helper does).
- [~] **X3 Small leftovers** (router `host` parameter, same-value `pageId` write and `_currentUserId` done in 05b0ac7): `Router` constructor's unused `host` parameter; `router.js` same-value `newPage.pageId = pageId` write; `spotify-context-view`'s reactive `_currentUserId` used only as a cache; ~~stale doc comment in `device-picker-large.js`~~ (6e333c8); the "Maybe." comment on the app's `@open-manager` handler.

## Speed and efficiency

- [x] **P1 Duplicate fetches on open**: recents fetched twice (home + the player refresh); on desktop the queue twice (sidebar tab refresh + the app's refresh). — **Done (05b0ac7):** recents read once per open via `api.getRecentTracks({ since })`, queue skipped when a read since the open already stands (harness `open_home` 8 → 7 calls; desktop with `queue.open_on_desktop` 2 → 1 queue reads).
- [x] **P2 Device scans**: each scan makes two calls (`get_spotify_connect_devices` + `get_player_devices` capability refetch), most callers force `refresh: true`, overlapping scans are not coalesced, and the app, sidebar and device manager each hold their own device list. `DeviceManager` should own the last list, serve it immediately and revalidate single-flight; refetch capabilities only for unknown ids. — **Done (P2_SHA):** `DeviceManager.scanLiveDevices` owns the live list: overlapping scans share one request, a list under 10 s old answers non-refresh callers, capabilities are refetched only for new device ids or a playing device without one. Opening the volume overlay no longer scans; "See all", reopening the dropdown and opening picker + manager together each save one or two calls.
- [x] **P3 Neighbour art preload** loads full-size covers on desktop, where neighbours are only shown at thumbnail size. — **Done (05b0ac7):** `PlayerController.setNeighborArtSize()`: thumbnails on desktop, full size on mobile (desktop 640px requests 18 → 10).
- [x] **P4 Bootstrap** (`src/index.js`): a permanent 200 ms `setInterval` copies `hass` into the app; config is read once from whichever dashboard was open at load (after in-app navigation to another dashboard the card does not respond until reload). Needs care: HA-internal APIs. — **Done (7f0320f):** a card on the page passes each `hass` straight from Lovelace (no delay); without a card the 200 ms poll stays as before, and while a card forwards a 2 s safety-net poll guards against a card Lovelace stops updating. A card on a later dashboard now sets the browser up without a reload. Still needs a reload: a dashboard configured only by the root key, reached by in-app navigation from one with no config.
- [x] **P5 Artist view header events** are not de-duplicated per scroll frame and parallax is not skipped in lite mode (the playlist view does both). — **Done (b89c6b5):** artist page: header de-duplicated (31 → 9 events per open-and-scroll), lite mode skips parallax.

## Bugs and robustness

- [ ] **B15 Stale follow answers**: the artist view's `_checkFollowStatus` (~134), the search top-result check (`spotify-search.js` ~211) and the playlist view's network path (~454) have no stale-response guard — moving quickly from artist A to B can let A's answer set B's button.
- [ ] **B16 Artist follow re-check after leaving** reads `this.data.id` when it fires 3 s later; if another artist is open by then, it re-checks the wrong one. Capture the id at toggle time.
- [ ] **B17 Shared drag controller robustness** (`list-drag-controller.js` ~38, ~55–79): `setPointerCapture` is not guarded and there is no `lostpointercapture` handling; releasing outside the rows does nothing (the device manager clamps to the ends). The device manager's own drag starts on any mouse button (~428).

- [x] **B14 Follow/unfollow from the playlist page does not refresh the library**: `_toggleFollowPlaylist` (`spotify-playlist-view.js` ~894) sends no `playlist-changed`, so a cached library Playlists list is stale until refreshed (delete and edit do refresh it). — **Done (c3d6c87):** follow/unfollow sends `playlist-changed` `follow`/`unfollow`; the app only refreshes the library list for those.
- [x] **B8 Silent like failure in the playlist picker**: after B4's switch to the websocket path, the picker's Liked Songs toggle (`src/components/popups/spotify-playlist-picker.js` ~298) shows nothing when the save fails (the now-playing heart got a message in 05b0ac7). — **Done (c438377):** the playlist picker reports failed Liked Songs saves and playlist adds ("Couldn't save — try again.", or "… — some changes failed").
- [x] **B9 Duplicate load while a page is loading**: `spotify-context-view` re-runs `loadPageData` on every relevant hass change while the page still has `isLoading: true` (e.g. the Liked Songs shell), starting a second full load (`src/components/spotify-context-view.js` ~90). — **Done (617605b):** a load in flight for the page is not started again by later hass ticks; `refresh()` still supersedes it.
- [x] **B10 Failed "See All" load-more stops paging for good**: it commits and caches `hasMore: false` (`page-loaders.js` ~485); discography and Liked Songs load-more do not cache a failure. — **Done (617605b):** a failed load-more keeps `hasMore` (uncached), so scrolling retries.
- [x] **B11 `cssSize(' 10 ')`** gives `' 10 px'` (invalid CSS) (`config_parser.js` ~140). — **Done (617605b):** sizes are trimmed first.
- [x] **B12 Dead fallbacks in `playMedia`**: the play-the-track-alone fallback and three "Call Failed" returns can never run, because the context play throws (`src/api.js` ~872–899). — **Done (617605b):** the unreachable fallback and "Call Failed" returns removed; a failed play reaches the existing error handling (pinned by `tests/playMediaFailure.test.js`).
- [x] **B13 Artist albums rail** could use `fetchPaginated`'s new `failed` flag to show a failure instead of an empty rail. — **Done (617605b):** a failed albums rail is flagged (`albumsFailed`) and the page is not cached; the view still shows it as an empty rail — showing a failure message there is a small follow-up in `spotify-artist-view.js`.
- [x] **B6 "Fans Also Like" loading skeletons were square** while the loaded artist cards are round (b89c6b5).
- [x] **B7 Discography page shows two back buttons**: it draws its own sticky header with a back arrow right under the app header's back button (`src/components/views/spotify-context-list.js` ~110). Decide which header the page should use. — **Done (e9f894d):** fixed by D6.

- [x] **B1 Progress may jump back** after an attribute-only update (e.g. volume): `extrapolatedPosition` (utils) extrapolates from `last_updated`, not `media_position_updated_at`. Suspected — verify which timestamp HA moves on a volume change before changing. — **Done (05b0ac7):** progress counts from `media_position_updated_at`, falling back to `last_updated`.
- [x] **B2 Page loading edge cases** (`src/components/controllers/page-loaders.js`): a refresh issued while a load is in flight can leave the page on "Loading..." if the older load's follow check lands first; Liked Songs, sections and discography show an empty page instead of the failure state when their read fails (and cache it); after a refresh whose follow check returns nothing, `canEditItems` uses the previous answer; two cached instances of the same half-loaded playlist can both page it. — **Done (05b0ac7):** all four fixed with tests (load counter on refresh; failed Liked Songs/section/discography reads show the failure, uncached; edit rights from this load only; one pager per page id).
- [x] **B3 Artist view follow-verify timer** is never cleared on disconnect (the like-verify one now is). — **Done (b89c6b5):** follow-verify timers tracked and cleared.
- [x] **B4 `api.js` inconsistencies** (pinned by `tests/apiCommands.test.js`): some commands use `hass.callService` (HA shows its own failure toast) and others `callWS`; an empty id list is sent as `ids: ''`; `checkArtistsFollowing` / `checkAlbumFavorites` return raw response shapes while `checkTrackFavorites` normalizes; their `catch` blocks never see a failed call; `playMedia` checks a `res.error` that cannot be set. — **Done (05b0ac7):** empty id lists make no call; the three checks share one normalized shape; dead `res.error` branch removed; commands and setVolume use `call_service` over the websocket so failures show only the card message.
- [x] **B5 `cssSize('')`** (config_parser) returns `'px'`. — **Done (05b0ac7):** blank sizes are ignored with a config warning.

## Notes

- Device picker opened by a playback error may now show a list up to 10 s old (`spotify-browser-app.js` ~1079); pass `{ refresh: true }` there if a fresh scan is wanted. When playing with no device, the picker first shows saved devices only even if a recent live list exists (~1202).
- `spotify-playlist-view.js` `_currentUserId` is reactive state but never rendered (a needless render when set); the follow heart's long inline style belongs in CSS (~624).
- Near-duplicate icons left alone because they render differently: header close X vs search clear X, header queue lines vs `queueIcon`, search row chevron vs `rowChevronIcon`.
- The smoke harness takes no screenshot of the album page, Liked Songs, search results, the playlist picker or a filtered library.

- `checkUserFollowsPlaylist` logs with `console.warn` while the other checks use `console.error` (`src/api.js` ~1210); left as is.
- The harness never sets `queue.open_on_desktop`; a probe for the desktop open path exists in an agent's temp folder and could be folded into `tools/smoke`.

- The smoke harness runs in lite mode (`detectLite()` is true in headless Chromium), so parallax is never exercised there.
- `SUBTITLE_STYLE.mediaRow` now only serves the discography list; rename to `discography` when D1 is decided.

## Deferred (needs a real device)

- [-] Moving the keyboard/viewport lock, idle auto-close and drag-to-close code out of the root, and collapsing the fourteen popup visibility flags — iOS-sensitive and wide-reaching; not checkable from a cloud session.

## Done

- [x] Sidebar device icon is the cast icon; pins are first in, first out (`42b228c`).
- [x] Phase 1–4 work: see `docs/plans/phase3-dead-code-and-final-verification.md`.
