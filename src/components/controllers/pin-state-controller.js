import { togglePin } from '../playlist-actions.js';

/**
 * Pin-to-Home state of the page shown, for its pin button (and the playlist
 * header menu's "Pin to Home"), against the PinnedItemsManager.
 *
 *   this._pin = new PinStateController(this, {
 *       getPinId: () => this.data.id,                      // read after getItems()
 *       getPinItem: () => ({ id, type, name, images, uri }) // what toggle() stores
 *   });
 *   page identity changed / pinned sensor changed -> this._pin.check()
 *   button: shown while this._pin.entity, .pinned class while this._pin.isPinned,
 *           @click=${this._pin.toggle}
 *
 * `entity` is the pinned-items sensor entity once a check found that the user
 * may edit pins (null otherwise: no button). `isPinned` is whether the page is
 * in the pinned row as Home shows it: `getItems()` (Liked Songs, config pins,
 * then at most MAX_PINNED_OTHERS stored pins). The manager's isPinned() now
 * reads the same capped list; this stays async because getItems() is.
 *
 * toggle(): togglePin (playlist-actions.js) — the manager's toggle, a
 * bubbling `pinned-changed` that refreshes Home's pinned row at once and the
 * "Removed <name> to make room" toast when the pin pushed the oldest one off,
 * or a `show-alert` saying why it failed; on success the state flips here.
 */
export class PinStateController {
    constructor(host, { getPinned = () => host.pinned, hasPage = () => !!host.data, getPinId, getPinItem }) {
        this.host = host;
        this._getPinned = getPinned;
        this._hasPage = hasPage;
        this._getPinId = getPinId;
        this._getPinItem = getPinItem;
        this._isPinned = false;
        this._entity = null;
        // Bound: used directly as the button's @click listener.
        this.toggle = this.toggle.bind(this);
        host.addController(this);
    }

    get isPinned() { return this._isPinned; }

    /** The pinned-items sensor entity while the user may edit pins, else null. */
    get entity() { return this._entity; }

    async check() {
        const pinned = this._getPinned();
        if (!pinned || !this._hasPage()) return;

        // The pin button is an edit action — only for users who can write.
        if (!pinned.canEdit()) {
            this._setEntity(null);
            return;
        }

        const items = await pinned.getItems();
        const id = this._getPinId();
        this._setPinned(!!items.find(i => i.id === id));
        this._setEntity(this._getPinned().sensorEntity);
    }

    async toggle() {
        const pinned = this._getPinned();
        if (!this._entity || !pinned) return;

        const result = await togglePin(this.host, pinned, this._getPinItem());
        if (result.success) this._setPinned(!this._isPinned);
    }

    _setPinned(value) {
        if (value === this._isPinned) return;
        this._isPinned = value;
        this.host.requestUpdate();
    }

    _setEntity(value) {
        if (value === this._entity) return;
        this._entity = value;
        this.host.requestUpdate();
    }
}
