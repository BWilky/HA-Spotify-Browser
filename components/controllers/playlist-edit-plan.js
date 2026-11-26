/**
 * Playlist edit-mode save planning — pure, no DOM/Lit.
 *
 * Given the pre-edit list and the edited list (both `[{ key, item }]`, the
 * shape the playlist editor works on; keys are unique per ROW, so two copies
 * of one track have different keys), decide which Spotify item operations to
 * send, in order. The editor executes the plan; nothing here talks to the api.
 *
 * Primary path preserves added_at/added_by: one remove for the fully-removed
 * URIs, then a left-to-right sequence of single-range reorders (upward-only
 * moves, so the 0-based -> 1-based conversion is exactly +1/+1). Removing
 * SOME copies of a duplicated URI is impossible via remove (Spotify drops
 * every copy), so that case uses a single replace — atomic and
 * duplicate-precise but capped at 100 tracks and it resets added_at.
 */

/** playlist_items_replace takes at most this many tracks. */
export const REPLACE_MAX_ITEMS = 100;

/** `blocked` value: one copy of a duplicated track removed in a list too long to replace. */
export const BLOCKED_PARTIAL_DUPLICATE = 'partial-duplicate-over-replace-limit';

/** Track uri of an edit entry (playlist items wrap the track; album-style items don't). */
export const entryUri = (entry) => (entry.item?.track || entry.item)?.uri;

/**
 * @param {Array<{key: string, item: object}>} orig  the list as it was when editing began
 * @param {Array<{key: string, item: object}>} fin   the list as it should be after saving
 * @returns {{
 *   tracksChanged: boolean,
 *   blocked: string|null,
 *   ops: Array<
 *     { op: 'remove', uris: string[] } |
 *     { op: 'reorder', rangeStart: number, insertBefore: number, rangeLength: number } |
 *     { op: 'replace', uris: string[] } |
 *     { op: 'abort', message: string }
 *   >
 * }}
 *   - `tracksChanged`: false when `fin` is `orig` row for row (ops is then empty).
 *   - `blocked`: non-null when the edit cannot be saved at all (ops is then
 *     empty and nothing must be sent); see BLOCKED_PARTIAL_DUPLICATE.
 *   - `ops`, to run in order:
 *       remove   — drop EVERY copy of each uri.
 *       reorder  — positions are 1-based and refer to the list as it stands
 *                  when the op runs (i.e. after the ops before it); always
 *                  rangeLength 1 and insertBefore < rangeStart.
 *       replace  — set the playlist to exactly these uris, in this order.
 *       abort    — the diff could not account for a row of `fin` (it is not a
 *                  rearrangement of rows of `orig`): run the ops before it,
 *                  then fail with `message`.
 */
export function planPlaylistEdit(orig, fin) {
    orig = orig || [];
    fin = fin || [];

    const tracksChanged = !(fin.length === orig.length && fin.every((e, i) => e.key === orig[i].key));

    const finalKeys = new Set(fin.map(e => e.key));
    const countByUri = (list) => {
        const m = new Map();
        for (const e of list) {
            const u = entryUri(e);
            m.set(u, (m.get(u) || 0) + 1);
        }
        return m;
    };
    const origCounts = countByUri(orig);
    const finCounts = countByUri(fin);
    const fullyRemoved = [];
    let hasPartialDuplicateRemoval = false;
    for (const [uri, count] of origCounts) {
        const left = finCounts.get(uri) || 0;
        if (left === 0) fullyRemoved.push(uri);
        else if (left < count) hasPartialDuplicateRemoval = true;
    }

    if (hasPartialDuplicateRemoval && fin.length > REPLACE_MAX_ITEMS) {
        return { tracksChanged, blocked: BLOCKED_PARTIAL_DUPLICATE, ops: [] };
    }

    if (hasPartialDuplicateRemoval) {
        return { tracksChanged, blocked: null, ops: [{ op: 'replace', uris: fin.map(entryUri) }] };
    }

    const ops = [];
    if (fullyRemoved.length) ops.push({ op: 'remove', uris: fullyRemoved });

    const working = orig.filter(e => finalKeys.has(e.key)).map(e => e.key);
    const target = fin.map(e => e.key);
    for (let i = 0; i < target.length; i++) {
        if (working[i] === target[i]) continue;
        const j = working.indexOf(target[i], i);
        if (j < 0) {
            ops.push({ op: 'abort', message: 'reorder diff diverged' });
            break;
        }
        ops.push({ op: 'reorder', rangeStart: j + 1, insertBefore: i + 1, rangeLength: 1 });
        working.splice(j, 1);
        working.splice(i, 0, target[i]);
    }

    return { tracksChanged, blocked: null, ops };
}
