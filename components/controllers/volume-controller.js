/**
 * Lit ReactiveController for a volume slider: one behaviour for every volume
 * UI (desktop sidebar overlay, mobile Connect sheet).
 *
 *   - Rate limiting (`devices.volume.rate_control`, default on): a leading +
 *     trailing throttle of THROTTLE_MS. The first change goes out at once,
 *     changes inside the window are coalesced and the latest one is sent when
 *     the window ends, so the final level is always sent. Off: every change is
 *     sent immediately.
 *   - Optimistic hold (`devices.volume.optimistic`, default on): after the user
 *     sets a level the slider shows it for HOLD_MS, whatever the player state
 *     says (Spotify can report a Cast speaker's old volume for a beat after a
 *     volume_set, which would snap the thumb back and then forward). When the
 *     hold ends the host is re-rendered once to show what the speaker settled
 *     on. Off: the slider always shows the player state.
 *
 * Values are percent (0..100). The host supplies `send(percent)`; how it
 * reaches the speaker (player controller, an event to the app) is its business.
 *
 *   this._vol = new VolumeController(this, {
 *       send: (pct) => this.playerController?.setVolume(pct / 100),
 *       getConfig: () => this.config?.devices?.volume,
 *   });
 *   slider @input  -> this._vol.input(pct)      (drag, tap on -/+)
 *   slider @change -> this._vol.commit(pct)     (release: send the final value now)
 *   render         -> this._vol.displayed(state.volume)
 */
export const THROTTLE_MS = 200;
export const HOLD_MS = 3000;

export class VolumeController {
    constructor(host, { send, getConfig = () => null, throttleMs = THROTTLE_MS, holdMs = HOLD_MS } = {}) {
        this.host = host;
        this._send = send;
        this._getConfig = getConfig;
        this.throttleMs = throttleMs;
        this.holdMs = holdMs;
        this._held = null;        // optimistic level, or null
        this._holdTimer = null;
        this._lastSendAt = -Infinity; // when the last value went out (throttle window start)
        this._lastSent = null;
        this._pending = null;     // value waiting for the trailing send
        this._trailingTimer = null;
        host.addController?.(this);
    }

    get rateControl() { return this._getConfig()?.rate_control !== false; }
    get optimistic() { return this._getConfig()?.optimistic !== false; }

    /** True while an optimistic value is being shown. */
    get holding() { return this._held !== null; }

    /** The level to show: the held value while the hold is live, else `stateVolume`. */
    displayed(stateVolume) {
        if (this._held !== null && this.optimistic) return this._held;
        return Number(stateVolume) || 0;
    }

    /** The user moved the slider (or tapped -/+): hold it and send, rate-limited. */
    input(value) {
        const v = Number(value);
        this._hold(v);
        if (!this.rateControl) { this._sendNow(v); return; }

        const now = Date.now();
        if (this._trailingTimer === null && now - this._lastSendAt >= this.throttleMs) {
            this._sendNow(v); // leading edge
            return;
        }
        this._pending = v;
        if (this._trailingTimer === null) {
            const wait = Math.max(0, this.throttleMs - (now - this._lastSendAt));
            this._trailingTimer = setTimeout(() => this._flush(), wait);
        }
    }

    /**
     * The user let go: hold the value and send it now, dropping any pending
     * trailing send (it would carry the same or an older value). Skipped when
     * exactly this value already went out and nothing is pending.
     */
    commit(value) {
        const v = Number(value);
        this._hold(v);
        const pending = this._trailingTimer !== null;
        this._clearTrailing();
        if (pending || this._lastSent !== v) this._sendNow(v);
    }

    hostDisconnected() {
        // Never drop the user's final level: flush a pending trailing send.
        if (this._trailingTimer !== null) this._flush();
        if (this._holdTimer) clearTimeout(this._holdTimer);
        this._holdTimer = null;
        this._held = null;
    }

    _hold(v) {
        if (!this.optimistic) return;
        this._held = v;
        if (this._holdTimer) clearTimeout(this._holdTimer);
        this._holdTimer = setTimeout(() => {
            this._holdTimer = null;
            this._held = null;
            this.host.requestUpdate();
        }, this.holdMs);
        this.host.requestUpdate();
    }

    _flush() {
        const v = this._pending;
        this._clearTrailing();
        if (v !== null) this._sendNow(v);
    }

    _clearTrailing() {
        if (this._trailingTimer !== null) clearTimeout(this._trailingTimer);
        this._trailingTimer = null;
        this._pending = null;
    }

    _sendNow(v) {
        this._lastSendAt = Date.now();
        this._lastSent = v;
        this._send?.(v);
    }
}
