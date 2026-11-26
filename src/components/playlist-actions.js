/**
 * Playlist actions shared by the playlist page (header "…" menu, hero pin
 * button) and the library (row "…" menu): the menu items, ownership, pin,
 * public/collaborative, edit and delete.
 *
 * Plain functions, no element: each takes the element to dispatch from
 * (`host`), the api / pinned-items manager it needs and the playlist, and
 * returns (or resolves to) its result. Every event bubbles and is composed;
 * the app root handles them:
 *   open-context-menu  { header, items, anchor, onAction(id) }
 *   show-alert         { title, message, confirmText, cancelText?, size?, onConfirm? }
 *   show-toast         { message }
 *   playlist-changed   { playlistId, action: 'edit', patch } | { playlistId, action: 'delete' }
 *                      (the app invalidates the cached page, leaves a deleted
 *                      playlist's page, unpins it and refreshes the library)
 *   pinned-changed     (no detail: refresh Home's pinned row)
 *   navigate           { pageId, data }
 *
 * Where the two surfaces still differ (menu order, what each offers, the
 * delete confirmation's success toast) the difference is an explicit
 * option or layout below, not a guess.
 */

/** Spotify's rule, and the page loader's: you own a playlist when its owner id is yours. */
export function isPlaylistOwner(playlist, userId) {
    return !!userId && playlist?.owner?.id === userId;
}

/**
 * What each surface's menu offers, in order. An entry is shown only when it
 * applies: edit / public / collab / delete for the owner, follow for anyone
 * else, pin when the user may edit pins. Item ids are `<prefix><action>`.
 *   page: the playlist page header — owner settings first, delete last.
 *   row:  a library row — pin first; no public/collaborative, no follow.
 */
const MENU_LAYOUTS = {
    page: { prefix: 'pm-', entries: ['edit', 'public', 'collab', 'follow', 'pin', 'delete'] },
    row: { prefix: 'lm-', entries: ['pin', 'edit', 'delete'] },
};

/**
 * The "…" menu items for a playlist.
 * @param {object} playlist  reads `public` and `collaborative` (owner settings labels)
 * @param {object} [opts]
 * @param {'page'|'row'} [opts.surface]  which surface's layout (MENU_LAYOUTS)
 * @param {boolean} [opts.isOwner]
 * @param {boolean} [opts.isFollowing]  non-owner, page: the follow item's direction
 * @param {boolean} [opts.canPin]       the user may edit pins
 * @param {boolean} [opts.isPinned]
 * @returns {Array<{id: string, label: string, icon: string, danger?: boolean}>}
 */
export function playlistMenuItems(playlist, { surface = 'page', isOwner = false, isFollowing = false, canPin = false, isPinned = false } = {}) {
    const { prefix, entries } = MENU_LAYOUTS[surface];
    const items = [];
    for (const entry of entries) {
        switch (entry) {
            case 'edit':
                if (isOwner) items.push({ id: `${prefix}edit`, label: 'Edit Playlist', icon: 'pencil' });
                break;
            case 'public':
                if (isOwner) items.push({ id: `${prefix}toggle-public`, label: playlist?.public !== false ? 'Make Private' : 'Make Public', icon: 'lock' });
                break;
            case 'collab':
                if (isOwner) items.push({ id: `${prefix}toggle-collab`, label: playlist?.collaborative ? 'Remove Collaborative' : 'Make Collaborative', icon: 'people' });
                break;
            case 'follow':
                if (!isOwner) {
                    items.push(isFollowing
                        ? { id: `${prefix}unfollow`, label: 'Remove from Your Library', icon: 'heart-filled' }
                        : { id: `${prefix}follow`, label: 'Add to Your Library', icon: 'heart' });
                }
                break;
            case 'pin':
                if (canPin) items.push({ id: `${prefix}pin`, label: isPinned ? 'Unpin from Home' : 'Pin to Home', icon: 'pin' });
                break;
            case 'delete':
                if (isOwner) items.push({ id: `${prefix}delete`, label: 'Delete Playlist', icon: 'trash', danger: true });
                break;
        }
    }
    return items;
}

/** The action of a menu item id ('pm-toggle-public' -> 'toggle-public', 'lm-artist' -> 'artist'). */
export function menuActionKey(id) {
    return String(id).replace(/^(pm|lm)-/, '');
}

/**
 * Ownership and pin state of a playlist that is not open as a page (a
 * library row): one user-id lookup and one pinned-list read, in parallel.
 * Either failing counts as "not owner" / "not pinned".
 * @returns {Promise<{isOwner: boolean, canPin: boolean, isPinned: boolean}>}
 */
export async function playlistMenuState(api, pinned, playlist) {
    const canPin = !!(pinned?.canEdit() && pinned.sensorEntity);
    const [userId, pinnedItems] = await Promise.all([
        api.getCurrentUserId().catch(() => null),
        canPin ? pinned.getItems().catch(() => []) : Promise.resolve([]),
    ]);
    return {
        isOwner: isPlaylistOwner(playlist, userId),
        canPin,
        isPinned: canPin && !!pinnedItems.find(p => p.id === playlist.id),
    };
}

/**
 * Open the app's action menu. `actions` maps an action (menuActionKey of an
 * item id) to what it does; choosing an item runs it.
 * @param {EventTarget} host
 * @param {{header: object, items: Array<object>, anchor?: DOMRect|null, actions: Record<string, Function>}} menu
 */
export function openActionMenu(host, { header, items, anchor = null, actions }) {
    emit(host, 'open-context-menu', {
        header,
        items,
        anchor,
        onAction: (id) => actions[menuActionKey(id)]?.(),
    });
}

/** What a pin of a playlist stores (PinnedItemsManager.toggle). */
export function playlistPinItem(playlist) {
    return {
        id: playlist.id,
        type: 'playlist',
        name: playlist.name,
        images: playlist.images,
        uri: playlist.uri,
        description: playlist.description
    };
}

/**
 * Pin or unpin through the pinned-items manager. Success: `pinned-changed`
 * (Home's pinned row refreshes now, not on the sensor's round trip).
 * Failure: a "Pinning Failed" alert with the reason. Resolves to the
 * manager's result. (PinStateController.toggle does the same for the page's
 * own pin state.)
 */
export async function togglePin(host, pinned, item) {
    const result = await pinned.toggle(item);
    if (result.success) {
        emit(host, 'pinned-changed');
    } else {
        emit(host, 'show-alert', { title: 'Pinning Failed', message: result.error || 'Unknown error', confirmText: 'OK', size: 'mini' });
    }
    return result;
}

/**
 * Flip an owned playlist's public or collaborative flag (Spotify's "Make
 * private"). playlist_change needs all four fields, so the current name and
 * description ride along. Spotify keeps collaborative playlists private:
 * making one public turns collaborative off, making one collaborative makes
 * it private. Toasts the outcome; on success `playlist-changed` carries the
 * new flags as a patch. Resolves to whether it worked (undefined when there
 * was nothing to do).
 * @param {'public'|'collaborative'} flag
 */
export async function togglePlaylistFlag(host, api, playlist, flag) {
    if (!playlist?.id || !api) return undefined;
    let isPublic = playlist.public !== false;
    let collaborative = !!playlist.collaborative;
    if (flag === 'public') {
        isPublic = !isPublic;
        if (isPublic) collaborative = false;
    } else {
        collaborative = !collaborative;
        if (collaborative) isPublic = false;
    }
    const res = await api.changePlaylistDetails(playlist.id, {
        name: playlist.name,
        description: playlist.description || '',
        isPublic,
        collaborative
    });
    if (!res.success) {
        toast(host, "Couldn't update playlist settings");
        return false;
    }
    const finalPublic = collaborative ? false : isPublic;
    toast(host, flag === 'public'
        ? (finalPublic ? 'Playlist is now public' : 'Playlist is now private')
        : (collaborative ? 'Playlist is now collaborative' : 'Collaborative turned off'));
    emit(host, 'playlist-changed', {
        playlistId: playlist.id,
        action: 'edit',
        patch: { public: finalPublic, collaborative }
    });
    return true;
}

/**
 * Ask, then delete an owned playlist (Spotify deletes by unfollowing). The
 * playlist is captured now: confirming deletes the one the dialog named.
 * Confirmed: api.unfollowPlaylist(id); success -> [successToast] then
 * `playlist-changed` {action: 'delete'}; failure -> "Couldn't delete playlist".
 *   successToast  toast after a delete (the playlist page says 'Playlist deleted'; the library says nothing)
 *   cancelText    passed through to the alert when given (it defaults to 'Cancel' there)
 * @param {EventTarget} host
 * @param {{unfollowPlaylist(id: string): Promise<{success?: boolean}|null|undefined>}} api
 * @param {{id: string, name?: string}} playlist
 * @param {{successToast?: string|null, cancelText?: string}} [opts]
 */
export function confirmDeletePlaylist(host, api, playlist, { successToast = null, cancelText } = {}) {
    const { id, name } = playlist;
    emit(host, 'show-alert', {
        title: 'Delete playlist?',
        message: `"${name}" will be removed from Your Library.`,
        confirmText: 'Delete',
        ...(cancelText !== undefined ? { cancelText } : {}),
        onConfirm: async () => {
            const res = await api.unfollowPlaylist(id);
            if (!res?.success) {
                toast(host, "Couldn't delete playlist");
                return false;
            }
            if (successToast) toast(host, successToast);
            emit(host, 'playlist-changed', { playlistId: id, action: 'delete' });
            return true;
        }
    });
}

/** Open a playlist's page straight into edit mode (it waits for the full track list). */
export function openPlaylistEditor(host, playlist) {
    emit(host, 'navigate', {
        pageId: `playlist:${playlist.id}`,
        data: { title: playlist.name, type: 'playlist', autoEdit: true }
    });
}

function toast(host, message) {
    emit(host, 'show-toast', { message });
}

function emit(host, type, detail) {
    host.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}
