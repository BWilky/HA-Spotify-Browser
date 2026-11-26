# Handoff — architecture refactor (Phase 4 complete)

Read this first if you are picking the work up. Everything below is the state at handoff; verify against `git log` and `git status` before acting.

## Where things are

Branch `worktree-bridge-cse_01HVcWXE9McGsDjLcW4C5zMn`, pushed, no PR opened (the owner has not asked for one).

| Commit | Content |
|---|---|
| `f2070dc` | Phase 1 — nine bug fixes |
| `4995afc` | Phase 2 — speed |
| `06a1c88` | Phase 3 — dead-code removal |
| `8969e0f` | eight follow-up bug fixes |
| `d1d55c2` | Phase 4 wave 1 — playlist editor, storage overlay, now-playing controller, api helpers |
| `b3f9a49` | Phase 4 wave 2 — mini-player, player-state subscription, overlay stack, device row, volume |
| `c58dfda` | Phase 4 wave 3 — shared view controllers, page loaders, one list row |
| `35c5b6b` | Wave 4 part 1 — `jsconfig.json` type-checking, three subtitle wording fixes, this file |
| `c27f6ab` | Wave 4 part 2 — stylesheet organization |
| (next)   | Wave 4 part 3 — source moved under `src/` |

All source now lives under `src/`; paths in older notes below and in the other plan files predate the move (prefix them with `src/`). The root `index.js` only re-exports `src/index.js`.

Background and the record of every wave: `docs/plans/architecture-review.md` (original review + roadmap) and `docs/plans/phase3-dead-code-and-final-verification.md` (per-wave results, behaviour changes to check on a device, open bugs and decisions).

## Working agreements with the owner

- **Stop after each wave**: commit, push, summarize, then ask before starting the next. The owner watches usage.
- Do small fixes directly; fan larger work out to sub-agents on **disjoint file sets**, each with a brief that names the files it owns, the contracts with other agents, and how to prove no behaviour change. Run them at the model and effort level the owner last asked for.
- The lead **reviews every diff** before committing. Agent reports are sometimes confidently wrong; twice a review caught a real regression (a removed `:host` override that the shared stylesheet needed; a refresh that stopped re-reading likes).
- One commit per wave, pushed with `git push -u origin <branch>`. No PR unless asked.
- Nothing can be tested against a live Home Assistant / SpotifyPlus / Sonos from the cloud session. Say so plainly and list what the owner should check on a device.

## Verification toolkit

```
. ~/tools/playwright/env.sh          # required: Chromium needs these user-space libraries
npm test                             # 652 tests
npm run build                        # dev bundle -> dist/spotify-browser.js (dist/ is gitignored)
node tools/smoke/smoke.mjs "$(pwd)/dist/spotify-browser.js" <outDir> <label>
node tools/smoke/summ.cjs <outDir>/<label>.json
npx --yes -p typescript@5 tsc -p jsconfig.json     # type-check; installs nothing into the project
```

The harness (`tools/smoke/`) drives the built bundle in headless Chromium against a stubbed Home Assistant on desktop (1400×900) and mobile (390×844) and records SpotifyPlus call counts per flow, per-component render counts per player tick, image sizes requested, router history, header state, Escape behaviour with stacked overlays, a scripted playlist edit-and-save, a now-playing button sweep, and screenshots. **Method for a behaviour-neutral change:** build the previous commit to a bundle (`git archive <sha> | tar -x -C <tmp>` then `./node_modules/.bin/esbuild <tmp>/index.js --bundle --outfile=<tmp>/before.js`), run the harness on both bundles, and diff the two JSON files entry by entry; they must be identical.

Expected numbers at `c58dfda` (both layouts): boot while closed 1 call; five track changes while closed 0 calls; 500-track playlist = `get_playlist` 1, `check_playlist_followers` 1, `check_track_favorites` 10 (500 ids), `get_playlist_items` 8; artist page 6 calls; `renders_10_player_ticks` `{}`; zero console errors.

Known harness noise (not regressions): image request counts wobble by 1–3 between runs; the `mobile-1-home` screenshot flips between two sizes (open animation mid-fade); many screenshots differ by a few bytes (progress bar, equalizer animation); on mobile the `np-device` button entry in `player_buttons` varies.

`esbuild` reads `jsconfig.json`: do not add `alwaysStrict` or `"strict": true` there — it changes the shipped bundle.

## Next — offered to the owner, not yet approved

A duplication pass over the reorganized code. Known leftovers:

- Playlist actions (delete confirmation, pin toggle, owner menus) written twice: playlist view and library.
- Artist view: carousel block three times (use `renderCarouselSection`), its own track-menu payload (use `openTrackMenu`), follow-state logic duplicated with the playlist view, an untracked follow-verify timer.
- Section and discography pages are not on `HeroScrollController`.
- Sheet styling (`.empty`, `.list`, `.title`) copied across about six sheets.
- A third drag-reorder implementation in the device manager.
- About 56 raw `fetchSpotifyPlus('get_*')` call sites in views re-parse the same response shapes.
- Inline SVG icons duplicated across components.
- The app panel's drag-to-close repeats `bottom-sheet`'s logic.
- Unused now: `renderMediaRowTemplate`, `heldVolume`.
- Deliberately not done (iOS-sensitive, needs a device): moving the keyboard/viewport lock, idle auto-close and drag-to-close code out of the root; collapsing the fourteen popup visibility flags.

## Decisions waiting on the owner

- Sidebar device icon next to shuffle (a music note drawn over a playlist glyph today): per-type device icon or cast icon?
- Subtitle wording differs by screen (`SUBTITLE_STYLE` in `components/media-templates.js`): pick one wording per item type.
- With more than 7 pins stored, the views report the 8th as not pinned while the manager's `isPinned()` says it is: which is intended?
- Desktop Previous now restarts the track when more than a few seconds in (as mobile did): keep or revert on desktop?
