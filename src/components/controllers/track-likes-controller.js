/**
 * Liked-Songs state of the tracks on a page (the heart on each row): which of
 * them are saved, checked against Spotify in deltas, and the save/remove
 * toggle.
 *
 *   this._likes = new TrackLikesController(this, {
 *       getApi: () => this.api,
 *       getIds: () => this.data?.tracks?.items?.map(item => (item.track || item)?.id),
 *       onToggled: (liked, ok) => ...,   // feedback after a save/remove
 *   });
 *   page identity changed / page reloaded -> this._likes.reset()
 *   the track list changed                -> this._likes.check()
 *   row heart                             -> this._likes.isLiked(id), click: this._likes.toggle(id)
 *
 * The like map (`map`, `{ trackId: boolean }`) is REPLACED on every change,
 * never mutated, and each replacement requests a host update — hosts may use
 * its identity as a render dependency (e.g. a guard() over the track list).
 * It is never cleared: results are keyed by track id, so they stay valid
 * across pages.
 *
 * check(): asks only for ids not yet checked on this page (`reset()` forgets
 * them), at most `chunkSize` ids per call, the calls in parallel. Ids are
 * marked when requested, so an overlapping check doesn't ask again, and
 * unmarked if their call fails or comes back empty. `maxPerCheck` caps the
 * ids asked for in one check (the rest wait for the next one).
 *
 * toggle(id): optimistic flip, save or remove, revert on failure; after a
 * success the state is re-read from Spotify `verifyMs` later in case of races.
 * `verify` picks how:
 *   'latest'  one pending re-check: a newer toggle (of any track) replaces it.
 *             It corrects the entry when Spotify disagrees with what is shown.
 *   'each'    every toggle re-checks its own track. It corrects the entry when
 *             Spotify disagrees with the state that toggle set (onCorrected
 *             is told first).
 * Pending re-checks are cancelled when the host disconnects.
 */
export const LIKE_CHECK_CHUNK = 50; // Spotify's check endpoints accept at most 50 ids per call.
export const VERIFY_MS = 3000;

export class TrackLikesController {
    constructor(host, {
        getApi,
        getIds,
        chunkSize = LIKE_CHECK_CHUNK,
        maxPerCheck = Infinity,
        verify = 'latest',
        verifyMs = VERIFY_MS,
        onToggled = null,
        onCorrected = null,
    }) {
        this.host = host;
        this._getApi = getApi;
        this._getIds = getIds;
        this._chunkSize = chunkSize;
        this._maxPerCheck = maxPerCheck;
        this._verify = verify;
        this._verifyMs = verifyMs;
        this._onToggled = onToggled;
        this._onCorrected = onCorrected;
        this._map = {};
        this._seen = new Set();
        this._verifyTimers = new Set();
        host.addController(this);
    }

    /** `{ trackId: boolean }`; a new object after every change. */
    get map() { return this._map; }

    isLiked(id) { return !!this._map[id]; }

    hostDisconnected() {
        this._clearVerify();
    }

    /** Forget which ids were checked: the next check() asks for all of them again. */
    reset() {
        this._seen = new Set();
    }

    /** Like state for the page's ids not checked yet. */
    async check() {
        const api = this._getApi();
        if (!api) return;
        const all = this._getIds();
        if (!all) return;
        // Captured: a reset() while calls are in flight starts a new set, and
        // the failures of the old calls unmark in the old one.
        const seen = this._seen;
        const ids = [...new Set(all.filter(id => id && !seen.has(id)))].slice(0, this._maxPerCheck);
        if (ids.length === 0) return;

        const chunks = [];
        for (let i = 0; i < ids.length; i += this._chunkSize) chunks.push(ids.slice(i, i + this._chunkSize));
        await Promise.all(chunks.map(async (chunk) => {
            chunk.forEach(id => seen.add(id));
            const results = await api.checkTrackFavorites(chunk);
            if (results && typeof results === 'object' && Object.keys(results).length) {
                this._replace({ ...this._map, ...results });
            } else {
                chunk.forEach(id => seen.delete(id));
            }
        }));
    }

    /** Save or remove `id` (the opposite of what is shown now). */
    async toggle(id) {
        const api = this._getApi();
        if (!api) return;
        const wasLiked = !!this._map[id];
        const liked = !wasLiked;

        this._replace({ ...this._map, [id]: liked }); // optimistic

        const res = liked
            ? await api.saveTrackFavorites(id)
            : await api.removeTrackFavorites(id);

        if (!res.success) {
            this._replace({ ...this._map, [id]: wasLiked }); // revert
            this._onToggled?.(liked, false);
            return;
        }
        this._onToggled?.(liked, true);
        this._scheduleVerify(id, liked);
    }

    _scheduleVerify(id, liked) {
        if (this._verify === 'latest') this._clearVerify();
        const timer = setTimeout(async () => {
            this._verifyTimers.delete(timer);
            if (!this.host.isConnected) return;
            const confirmed = await this._getApi().checkTrackFavorites(id);
            if (this._verify === 'latest') {
                if (typeof confirmed === 'boolean' && confirmed !== this._map[id]) {
                    this._replace({ ...this._map, [id]: confirmed });
                }
            } else if (confirmed !== null && confirmed !== liked) {
                this._onCorrected?.(id, confirmed);
                this._replace({ ...this._map, [id]: confirmed });
            }
        }, this._verifyMs);
        this._verifyTimers.add(timer);
    }

    _clearVerify() {
        this._verifyTimers.forEach(clearTimeout);
        this._verifyTimers.clear();
    }

    _replace(map) {
        this._map = map;
        this.host.requestUpdate();
    }
}
