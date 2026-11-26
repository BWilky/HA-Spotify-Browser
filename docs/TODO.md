# Code improvement TODO and findings

A running list of improvements for this codebase: duplicated code that can share a helper, speed and efficiency, bugs found along the way, and decisions waiting on the owner. Updated as work lands — check an item off with the commit that did it, and add new findings to the section they belong to.

Paths are relative to the repo root (source lives under `src/`). Background: `docs/plans/architecture-review.md`, `docs/plans/phase3-dead-code-and-final-verification.md`, `docs/plans/HANDOFF.md`.

**Now:** wave A of the cleanup is running (four agents on separate files) — the `[~]` items. Next wave: S7, S9, S10, S12, P2, P4.

Legend: `[ ]` open · `[x]` done (commit) · `[~]` in progress · `[?]` needs the owner's decision · `[-]` decided against (reason given)

## Needs a decision

- [?] **D1 Subtitle wording** differs by screen (`SUBTITLE_STYLE` in `src/components/media-templates.js`). A playlist reads "Playlist • Bob" (library, search), "By Bob" ("See All", discography) or "Bob" (home cards). Suggested: lists use Spotify's "Type • who" form, home cards just "who", discography "2015 • Album/Single".
- [?] **D2 Toast when a pin is pushed off** the full list ("Removed X to make room"). Today the eviction is silent.
- [?] **D3 Alert stacking**: an alert opens under the desktop device picker (inherited layering). One number to flip if an alert should always be on top.

## Shared helpers / duplicated code

- [~] **S1 Playlist actions written twice** — delete confirmation, pin toggle and the owner/non-owner menus exist in both `src/components/views/spotify-playlist-view.js` and `src/components/views/spotify-library.js`. One `playlist-actions.js` helper.
- [x] **S2 Artist view carousels** — the "title + carousel + skeleton-or-cards" block appears three times in `src/components/views/spotify-artist-view.js`; `renderCarouselSection` (media-templates) already exists. — **Done (b89c6b5):** artist rails use `renderCarouselSection` (`ARTIST_CAROUSEL` options).
- [x] **S3 Artist view track-menu payload** is still hand-built; `openTrackMenu` / `trackMenuDetail` (`src/components/track-menu.js`) exist. — **Done (b89c6b5):** artist top tracks use `openTrackMenu` (thumbnail image).
- [~] **S4 Section and discography pages** run their own scroll/header/load-more code instead of `HeroScrollController`. — **Section page done (b89c6b5).** Discography left: it sends no header events and its 6-line load-more check is synchronous; moving it would add options and change load-more timing by a frame, for no line saving.
- [~] **S5 Sheet styling copied across ~6 sheets** — `.empty`, `.list` scroll region, `.title`, close button (account, connect, queue sheet, device picker, device manager, playlist picker, create sheet). One shared `sheetStyles`.
- [~] **S6 Inline SVG icons duplicated across components** (close X ×3, check mark ×2, play/pause and heart paths, speaker outline, equalizer bars, shuffle/prev/next in the now-playing surfaces). Move to `src/components/common/icons.js`.
- [ ] **S7 Raw SpotifyPlus reads re-parsed at ~56 sites** — views call `api.fetchSpotifyPlus('get_*')` directly and each unwraps `result.items`, `result.artists.items`, `items.map(i => i.album)` etc. Add list/read methods on `SpotifyApi` (`getSavedAlbums`, `getFollowedArtists`, `getSavedPlaylists`, `getRecentTracks`, …) returning `{ items, total, cursor }` and migrate.
- [~] **S8 Third drag-reorder implementation** in `src/components/devices/device-manager-popup.js`; `ListDragController` exists.
- [ ] **S9 App panel drag-to-close** (`src/spotify-browser-app.js`) repeats `bottom-sheet`'s pointer logic almost line for line. One `DragDismissController`.
- [ ] **S10 Follow state** (follow/unfollow, optimistic flip, verify re-check) is implemented separately in the playlist and artist views; APIs differ, so share only the common flow.
- [~] **S11 Header CSS duplicated**: most of the block moved from `sharedStyles` into `src/components/spotify-header.js` is re-declared and overridden by `spotify-header.styles.js`.
- [ ] **S12 Single-consumer rules still in `sharedStyles`** (home `.section-title`/`.section-grid`/`.scroll-btn`/`.recent-grid-layout`; playlist `.track-row.with-art`, `.track-name`, `.track-artist`, `.track-action-btn.is-favorite`, mobile `.hero-title`; context-list mobile `.list-container`; tracklist `.queue-list` in the scrollbar list). Move each beside its component where cascade order allows.
- [~] **S13 Connect sheet vs picker polish**: the picker has four row rules (tap highlight, `:active`, ellipsis, svg no-shrink) the Connect sheet lacks; the Connect sheet's active-device card ignores custom device icons; the type line wording differs (`deviceTypeLabel` vs raw type).

## Dead code

- [ ] **X4 Artist view leftovers**: class `circle-cards` on the "Fans Also Like" row has no CSS anywhere (`src/components/views/spotify-artist-view.js` ~328); an unused `index` parameter (~299) and an unused `e` in `_playPopularTrack`'s handler.

- [~] **X1 Dead CSS** (no element renders them): `.mobile-drag-handle`, `spotify-queue`, `.grid-layout` (×2), `.list-item-title/-subtitle`, `.track-duration`, `.device-list`, `.media-card.playing .media-title`, `.popup-scroll-content`, `.popup-close-btn`, `.page.has-hero-header`.
- [~] **X2 Unused helpers**: ~~`renderMediaRowTemplate`~~ (removed b89c6b5), `heldVolume` (utils, replaced by `VolumeController`; its test stays only if the helper does).
- [~] **X3 Small leftovers** (router `host` parameter, same-value `pageId` write and `_currentUserId` done in 05b0ac7): `Router` constructor's unused `host` parameter; `router.js` same-value `newPage.pageId = pageId` write; `spotify-context-view`'s reactive `_currentUserId` used only as a cache; stale "Driven by spotify-popups" doc comment in `device-picker-large.js`; the "Maybe." comment on the app's `@open-manager` handler.

## Speed and efficiency

- [x] **P1 Duplicate fetches on open**: recents fetched twice (home + the player refresh); on desktop the queue twice (sidebar tab refresh + the app's refresh). — **Done (05b0ac7):** recents read once per open via `api.getRecentTracks({ since })`, queue skipped when a read since the open already stands (harness `open_home` 8 → 7 calls; desktop with `queue.open_on_desktop` 2 → 1 queue reads).
- [ ] **P2 Device scans**: each scan makes two calls (`get_spotify_connect_devices` + `get_player_devices` capability refetch), most callers force `refresh: true`, overlapping scans are not coalesced, and the app, sidebar and device manager each hold their own device list. `DeviceManager` should own the last list, serve it immediately and revalidate single-flight; refetch capabilities only for unknown ids.
- [x] **P3 Neighbour art preload** loads full-size covers on desktop, where neighbours are only shown at thumbnail size. — **Done (05b0ac7):** `PlayerController.setNeighborArtSize()`: thumbnails on desktop, full size on mobile (desktop 640px requests 18 → 10).
- [ ] **P4 Bootstrap** (`src/index.js`): a permanent 200 ms `setInterval` copies `hass` into the app; config is read once from whichever dashboard was open at load (after in-app navigation to another dashboard the card does not respond until reload). Needs care: HA-internal APIs.
- [x] **P5 Artist view header events** are not de-duplicated per scroll frame and parallax is not skipped in lite mode (the playlist view does both). — **Done (b89c6b5):** artist page: header de-duplicated (31 → 9 events per open-and-scroll), lite mode skips parallax.

## Bugs and robustness

- [ ] **B8 Silent like failure in the playlist picker**: after B4's switch to the websocket path, the picker's Liked Songs toggle (`src/components/popups/spotify-playlist-picker.js` ~298) shows nothing when the save fails (the now-playing heart got a message in 05b0ac7).
- [ ] **B9 Duplicate load while a page is loading**: `spotify-context-view` re-runs `loadPageData` on every relevant hass change while the page still has `isLoading: true` (e.g. the Liked Songs shell), starting a second full load (`src/components/spotify-context-view.js` ~90).
- [ ] **B10 Failed "See All" load-more stops paging for good**: it commits and caches `hasMore: false` (`page-loaders.js` ~485); discography and Liked Songs load-more do not cache a failure.
- [ ] **B11 `cssSize(' 10 ')`** gives `' 10 px'` (invalid CSS) (`config_parser.js` ~140).
- [ ] **B12 Dead fallbacks in `playMedia`**: the play-the-track-alone fallback and three "Call Failed" returns can never run, because the context play throws (`src/api.js` ~872–899).
- [ ] **B13 Artist albums rail** could use `fetchPaginated`'s new `failed` flag to show a failure instead of an empty rail.
- [x] **B6 "Fans Also Like" loading skeletons were square** while the loaded artist cards are round (b89c6b5).
- [ ] **B7 Discography page shows two back buttons**: it draws its own sticky header with a back arrow right under the app header's back button (`src/components/views/spotify-context-list.js` ~110). Decide which header the page should use.

- [x] **B1 Progress may jump back** after an attribute-only update (e.g. volume): `extrapolatedPosition` (utils) extrapolates from `last_updated`, not `media_position_updated_at`. Suspected — verify which timestamp HA moves on a volume change before changing. — **Done (05b0ac7):** progress counts from `media_position_updated_at`, falling back to `last_updated`.
- [x] **B2 Page loading edge cases** (`src/components/controllers/page-loaders.js`): a refresh issued while a load is in flight can leave the page on "Loading..." if the older load's follow check lands first; Liked Songs, sections and discography show an empty page instead of the failure state when their read fails (and cache it); after a refresh whose follow check returns nothing, `canEditItems` uses the previous answer; two cached instances of the same half-loaded playlist can both page it. — **Done (05b0ac7):** all four fixed with tests (load counter on refresh; failed Liked Songs/section/discography reads show the failure, uncached; edit rights from this load only; one pager per page id).
- [x] **B3 Artist view follow-verify timer** is never cleared on disconnect (the like-verify one now is). — **Done (b89c6b5):** follow-verify timers tracked and cleared.
- [x] **B4 `api.js` inconsistencies** (pinned by `tests/apiCommands.test.js`): some commands use `hass.callService` (HA shows its own failure toast) and others `callWS`; an empty id list is sent as `ids: ''`; `checkArtistsFollowing` / `checkAlbumFavorites` return raw response shapes while `checkTrackFavorites` normalizes; their `catch` blocks never see a failed call; `playMedia` checks a `res.error` that cannot be set. — **Done (05b0ac7):** empty id lists make no call; the three checks share one normalized shape; dead `res.error` branch removed; commands and setVolume use `call_service` over the websocket so failures show only the card message.
- [x] **B5 `cssSize('')`** (config_parser) returns `'px'`. — **Done (05b0ac7):** blank sizes are ignored with a config warning.

## Notes

- `checkUserFollowsPlaylist` logs with `console.warn` while the other checks use `console.error` (`src/api.js` ~1210); left as is.
- The harness never sets `queue.open_on_desktop`; a probe for the desktop open path exists in an agent's temp folder and could be folded into `tools/smoke`.

- The smoke harness runs in lite mode (`detectLite()` is true in headless Chromium), so parallax is never exercised there.
- `SUBTITLE_STYLE.mediaRow` now only serves the discography list; rename to `discography` when D1 is decided.

## Deferred (needs a real device)

- [-] Moving the keyboard/viewport lock, idle auto-close and drag-to-close code out of the root, and collapsing the fourteen popup visibility flags — iOS-sensitive and wide-reaching; not checkable from a cloud session.

## Done

- [x] Sidebar device icon is the cast icon; pins are first in, first out (`42b228c`).
- [x] Phase 1–4 work: see `docs/plans/phase3-dead-code-and-final-verification.md`.
