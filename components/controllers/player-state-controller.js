/**
 * Lit ReactiveController that keeps a host element in step with a
 * PlayerController (an EventTarget whose `state` object is replaced, never
 * mutated, and announced with a `state-changed` event).
 *
 * Use this instead of having the app mirror the player state and pass it down
 * as a property: the host subscribes itself, re-renders when the state changes,
 * and reads it through `.state`. Nothing above the host has to re-render.
 *
 *   this._player = new PlayerStateController(this);              // host.playerController
 *   this._player = new PlayerStateController(this, { isActive: () => this.visible });
 *   ...
 *   const track = this._player.state?.track;
 *
 * Options:
 *   getController  where to find the PlayerController (default: host.playerController).
 *                  It is re-read on every host update, so a controller that is
 *                  assigned late or replaced (account switch) is picked up and
 *                  the old one released.
 *   isActive       return false while the host is hidden: state changes then do
 *                  not schedule renders. The host renders with the current state
 *                  anyway when whatever makes it active changes.
 *   onChange       optional callback(state) for side effects on each change
 *                  (called even while inactive).
 */
export class PlayerStateController {
    constructor(host, { getController = () => host.playerController, isActive = () => true, onChange = null } = {}) {
        this.host = host;
        this._getController = getController;
        this._isActive = isActive;
        this._onChange = onChange;
        this._controller = null;
        this._handle = (e) => {
            if (this._onChange) this._onChange(e.detail);
            if (this._isActive()) this.host.requestUpdate();
        };
        host.addController(this);
    }

    /** The current PlayerController state, or null before a controller exists. */
    get state() {
        return this._controller?.state || null;
    }

    /** The PlayerController currently subscribed to (or null). */
    get controller() {
        return this._controller;
    }

    hostConnected() {
        this._sync();
    }

    hostUpdated() {
        this._sync();
    }

    hostDisconnected() {
        this._subscribe(null);
    }

    _sync() {
        const next = this._getController() || null;
        if (next === this._controller) return;
        this._subscribe(next);
        // A controller arrived (or changed): show its state.
        if (next) this.host.requestUpdate();
    }

    _subscribe(controller) {
        if (this._controller) this._controller.removeEventListener('state-changed', this._handle);
        this._controller = controller;
        if (controller) controller.addEventListener('state-changed', this._handle);
    }
}
