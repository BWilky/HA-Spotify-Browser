# Code improvement TODO and findings

A running list of improvements for this codebase: duplicated code that can share a helper, speed and efficiency, bugs found along the way, and decisions waiting on the owner. Updated as work lands — check an item off with the commit that did it, and add new findings to the section they belong to.

Paths are relative to the repo root (source lives under `src/`). Background: `docs/plans/architecture-review.md`, `docs/plans/phase3-dead-code-and-final-verification.md`, `docs/plans/HANDOFF.md`.

Cleared on 2026-11-27 once everything in it was done. The full list as it stood then (decisions D1–D10, S1–S17, X1–X4, P1–P5, B1–B20 and the notes), with the commit for each item, is in git history: `git show f9d07f5:docs/TODO.md`.

Legend: `[ ]` open · `[x]` done (commit) · `[~]` in progress · `[?]` needs the owner's decision · `[-]` decided against (reason given)

## Decisions

## Shared helpers / duplicated code

## Dead code

## Speed and efficiency

## Bugs and robustness

- [ ] **B18 The app panel may not drag closed with a finger in Chromium/Android**: its header has no `touch-action: none` (the sheets' grip does), so Chromium may fire `pointercancel` at once (`src/spotify-browser-app.js`, the `spotify-header` `@pointerdown`). iOS checked by the owner (2026-11-27): dragging the header closes the panel. Check on an Android phone before changing.

## Notes

- Kept as they are on purpose:
  - The discography page keeps its own scroll / load-more code rather than `HeroScrollController` (it sends no header events; moving it adds options and shifts load-more timing by a frame, for no line saving).
  - Near-duplicate icons that render differently: header close X vs search clear X, header queue lines vs `queueIcon`, search row chevron vs `rowChevronIcon`.
  - The phone Search and Library pages have no drag-to-close (owner, 2026-11-27).
  - The device picker opened by a playback error may show a live list up to 10 s old (owner, 2026-11-27).

## Deferred (needs a real device)

- [-] Moving the keyboard/viewport lock, idle auto-close and drag-to-close code out of the root, and collapsing the fourteen popup visibility flags — iOS-sensitive and wide-reaching; not checkable from a cloud session.
