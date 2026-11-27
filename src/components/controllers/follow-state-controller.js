import { VERIFY_MS } from './track-likes-controller.js';

/**
 * Follow state of the artist or playlist a page shows (its Follow / heart
 * button): the flag the button renders and the optimistic toggle. The check
 * and the follow / unfollow calls stay with each host (their APIs differ).
 *
 *   this._follow = new FollowStateController(this, {
 *       initial: false,                          // or null: not known
 *       verify: (context) => api.checkArtistsFollowing(context),   // optional re-check
 *       onCorrected: () => console.warn(...),
 *   });
 *   the host's check -> this._follow.following = answer   (host update on a change)
 *   click            -> this._follow.toggle(follow => <call>, resolving to whether it worked, context)
 *
 * toggle(): flips at once, reverts to `!follow` when the call fails and
 * resolves to whether it worked; failure feedback is the host's. After a
 * success, with `verify`, the state is read again `verifyMs` later and an
 * answer other than null that differs replaces it (onCorrected first). Every
 * toggle has its own re-check, handed the `context` that toggle was given
 * (e.g. the id it was made on); pending ones are cancelled on host
 * disconnect.
 */
export class FollowStateController {
    constructor(host, { initial = false, verify = null, verifyMs = VERIFY_MS, onCorrected = null } = {}) {
        this.host = host;
        this._following = initial;
        this._verify = verify;
        this._verifyMs = verifyMs;
        this._onCorrected = onCorrected;
        this._verifyTimers = new Set();
        host.addController(this);
    }

    get following() { return this._following; }

    set following(value) {
        if (value === this._following) return;
        this._following = value;
        this.host.requestUpdate();
    }

    hostDisconnected() {
        this._verifyTimers.forEach(clearTimeout);
        this._verifyTimers.clear();
    }

    /**
     * Resolves to whether the follow / unfollow worked.
     * @param {(follow: boolean) => Promise<boolean>} setFollowed
     * @param {*} [context]  passed to this toggle's re-check (`verify`)
     */
    async toggle(setFollowed, context) {
        const follow = !this._following;
        this.following = follow;
        if (!await setFollowed(follow)) {
            this.following = !follow;
            return false;
        }
        if (this._verify) this._verifyLater(follow, context);
        return true;
    }

    _verifyLater(follow, context) {
        const timer = setTimeout(async () => {
            this._verifyTimers.delete(timer);
            const confirmed = await this._verify(context);
            if (confirmed === null || confirmed === follow) return;
            this._onCorrected?.();
            this.following = confirmed;
        }, this._verifyMs);
        this._verifyTimers.add(timer);
    }
}
