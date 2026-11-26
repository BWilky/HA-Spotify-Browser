/**
 * Playlist actions shared by the playlist page (header "…" menu, hero pin
 * and heart buttons) and the library (row "…" menu): one menu, and the same
 * actions with the same messages from both places — ownership, edit,
 * public/collaborative, follow, pin and delete. The pin flow (togglePin)
 * also serves PinStateController, so every page's pin button.
 *
 * Plain functions, no element: each takes the element to dispatch from
 * (`host`), the api / pinned-items manager it needs and the playlist, and
 * returns (or resolves to) its result. Every event bubbles and is composed;
 * the app root handles them:
 *   open-context-menu  { header, items, anchor, onAction(id) }
 *   show-alert         { title, message, confirmText, size?, onConfirm? }
 *   show-toast         { message }
 *   playlist-changed   { playlistId, action: 'edit', patch } | { playlistId, action: 'delete' }
 *                      (the app invalidates the cached page, leaves a deleted
 *                      playlist's page, unpins it and updates the library)
 *                      | { playlistId, action: 'follow' | 'unfollow' }
 *                      (only the library list changes)
 *   pinned-changed     (no detail: refresh Home's pinned row)
 *   navigate           { pageId, data }
 */

/** Spotify's rule, and the page loader's: you own a playlist when its owner id is yours. */
export function isPlaylistOwner(playlist, userId) {
    return !!userId && playlist?.owner?.id === userId;
}

/**
 * Where you may edit a playlist's tracks: your own, or a collaborative one
 * you follow (the page loader's `canEditItems`). Name, privacy,
 * collaborative and delete stay the owner's.
 * @param {{collaborative?: boolean|null}|null|undefined} playlist
 * @param {{isOwner?: boolean, isFollowing?: boolean}} state
 */
export function canEditPlaylistItems(playlist, { isOwner = false, isFollowing } = {}) {
    return isOwner || (!!playlist?.collaborative && isFollowing === true);
}

/**
 * The "…" menu items for a playlist, in order — the same on the playlist
 * page and a library row. An item is shown only when it applies:
 *   Edit Playlist                      canEdit (the owner, or a collaborator)
 *   Make Private / Make Public         the owner, when the settings are known
 *   Make / Remove Collaborative        the owner, when the settings are known
 *   Add to / Remove from Your Library  anyone else, when isFollowing is known
 *   Pin to / Unpin from Home           canPin (the user may edit pins)
 *   Delete Playlist                    the owner
 * "The settings are known": `public` and `collaborative` are booleans and
 * `description` is present — togglePlaylistFlag sends all of them (a missing
 * one would be overwritten with a guess).
 * @param {{public?: boolean|null, collaborative?: boolean|null, description?: string|null}|null|undefined} playlist
 * @param {object} [state]
 * @param {boolean} [state.isOwner]
 * @param {boolean} [state.canEdit]      may edit the tracks (canEditPlaylistItems)
 * @param {boolean} [state.isFollowing]  undefined: not known, no follow item
 * @param {boolean} [state.canPin]
 * @param {boolean} [state.isPinned]
 * @returns {Array<{id: string, label: string, icon: string, danger?: boolean}>}
 */
export function playlistMenuItems(playlist, { isOwner = false, canEdit = false, isFollowing, canPin = false, isPinned = false } = {}) {
    const items = [];
    if (isOwner || canEdit) items.push({ id: 'pm-edit', label: 'Edit Playlist', icon: 'pencil' });
    if (isOwner && playlist && typeof playlist.public === 'boolean' && typeof playlist.collaborative === 'boolean'
        && playlist.description !== undefined) {
        items.push({ id: 'pm-toggle-public', label: playlist.public ? 'Make Private' : 'Make Public', icon: 'lock' });
        items.push({ id: 'pm-toggle-collab', label: playlist.collaborative ? 'Remove Collaborative' : 'Make Collaborative', icon: 'people' });
    }
    if (!isOwner && typeof isFollowing === 'boolean') {
        items.push(isFollowing
            ? { id: 'pm-unfollow', label: 'Remove from Your Library', icon: 'heart-filled' }
            : { id: 'pm-follow', label: 'Add to Your Library', icon: 'heart' });
    }
    if (canPin) items.push({ id: 'pm-pin', label: isPinned ? 'Unpin from Home' : 'Pin to Home', icon: 'pin' });
    if (isOwner) items.push({ id: 'pm-delete', label: 'Delete Playlist', icon: 'trash', danger: true });
    return items;
}

/** The action of a menu item id ('pm-toggle-public' -> 'toggle-public', 'lm-artist' -> 'artist'). */
export function menuActionKey(id) {
    return String(id).replace(/^(pm|lm)-/, '');
}

/**
 * The menu state of a playlist that is not open as a page (a library row):
 * one user-id lookup and one pinned-list read, in parallel; then, for a
 * playlist you do not own whose follow state the caller does not know, one
 * follow check. A failed lookup counts as "not owner" / "not pinned"; a
 * failed follow check leaves isFollowing unknown (no follow item, no edit).
 * @param {object} api
 * @param {object|null|undefined} pinned
 * @param {{id: string, owner?: {id?: string}, collaborative?: boolean|null}} playlist
 * @param {{isFollowing?: boolean}} [known]  isFollowing when the caller knows it (a Playlists-filter row)
 * @returns {Promise<{isOwner: boolean, isFollowing?: boolean, canEdit: boolean, canPin: boolean, isPinned: boolean}>}
 */
export async function playlistMenuState(api, pinned, playlist, { isFollowing } = {}) {
    const canPin = !!(pinned?.canEdit() && pinned.sensorEntity);
    const [userId, pinnedItems] = await Promise.all([
        api.getCurrentUserId().catch(() => null),
        canPin ? pinned.getItems().catch(() => []) : Promise.resolve([]),
    ]);
    const isOwner = isPlaylistOwner(playlist, userId);
    if (!isOwner && isFollowing === undefined && userId) {
        try {
            const follows = await api.checkUserFollowsPlaylist(playlist.id, userId);
            if (Array.isArray(follows) && follows.length > 0) isFollowing = !!follows[0];
        } catch (_) { /* unknown */ }
    }
    return {
        isOwner,
        ...(isOwner || isFollowing === undefined ? {} : { isFollowing }),
        canEdit: canEditPlaylistItems(playlist, { isOwner, isFollowing }),
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
 * The toast for a pin that pushed the oldest one off the full list
 * (PinnedItemsManager.add's `evicted`), or null when none was.
 * @param {{evicted?: {name?: string, title?: string}|null}|null|undefined} result
 * @returns {string|null}
 */
export function evictedPinMessage(result) {
    const evicted = result?.evicted;
    if (!evicted) return null;
    const name = evicted.name || evicted.title;
    return name ? `Removed ${name} to make room` : 'Removed the oldest pin to make room';
}

/**
 * Pin or unpin through the pinned-items manager. Success: `pinned-changed`
 * (Home's pinned row refreshes now, not on the sensor's round trip), then
 * "Removed <name> to make room" when the pin pushed the oldest one off.
 * Failure: a "Pinning Failed" alert with the reason. Resolves to the
 * manager's result.
 */
export async function togglePin(host, pinned, item) {
    const result = await pinned.toggle(item);
    if (result.success) {
        emit(host, 'pinned-changed');
        const evicted = evictedPinMessage(result);
        if (evicted) toast(host, evicted);
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
 * Add a playlist to Your Library or remove it from there (Spotify's follow /
 * unfollow). Toasts the outcome; on success `playlist-changed`
 * {action: 'follow' | 'unfollow'} lets the app update the library list.
 * Resolves to whether it worked.
 * @param {EventTarget} host
 * @param {{followPlaylist(id: string): Promise<{success?: boolean}|null|undefined>, unfollowPlaylist(id: string): Promise<{success?: boolean}|null|undefined>}} api
 * @param {{id: string}} playlist
 * @param {boolean} follow
 */
export async function setPlaylistFollowed(host, api, playlist, follow) {
    const { id } = playlist;
    const res = follow ? await api.followPlaylist(id) : await api.unfollowPlaylist(id);
    if (!res?.success) {
        toast(host, `Failed to ${follow ? 'follow' : 'unfollow'} playlist.`);
        return false;
    }
    toast(host, `${follow ? 'Added to' : 'Removed from'} your library.`);
    emit(host, 'playlist-changed', { playlistId: id, action: follow ? 'follow' : 'unfollow' });
    return true;
}

/**
 * Ask, then delete an owned playlist (Spotify deletes by unfollowing). The
 * playlist is captured now: confirming deletes the one the dialog named.
 * Confirmed: api.unfollowPlaylist(id); success -> "Playlist deleted" then
 * `playlist-changed` {action: 'delete'}; failure -> "Couldn't delete playlist".
 * @param {EventTarget} host
 * @param {{unfollowPlaylist(id: string): Promise<{success?: boolean}|null|undefined>}} api
 * @param {{id: string, name?: string}} playlist
 */
export function confirmDeletePlaylist(host, api, playlist) {
    const { id, name } = playlist;
    emit(host, 'show-alert', {
        title: 'Delete playlist?',
        message: `"${name}" will be removed from Your Library.`,
        confirmText: 'Delete',
        onConfirm: async () => {
            const res = await api.unfollowPlaylist(id);
            if (!res?.success) {
                toast(host, "Couldn't delete playlist");
                return false;
            }
            toast(host, 'Playlist deleted');
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
