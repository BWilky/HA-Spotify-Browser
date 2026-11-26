import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isPlaylistOwner, playlistMenuItems, menuActionKey, playlistMenuState, openActionMenu,
    playlistPinItem, togglePin, togglePlaylistFlag, confirmDeletePlaylist, openPlaylistEditor,
} from '../src/components/playlist-actions.js';
import { PinnedItemsManager } from '../src/components/controllers/pinned-items-manager.js';

// ---- Stubs ------------------------------------------------------------------

/** An element stand-in that records what it dispatches. */
function makeHost() {
    const events = [];
    return {
        events,
        dispatchEvent(e) { events.push(e); return true; },
        /** [type, detail] pairs, for comparisons. */
        log() { return events.map(e => [e.type, e.detail]); },
    };
}

function makeApi({ fail = false, userId = 'me', userIdFails = false, unfollowResult } = {}) {
    const calls = [];
    return {
        calls,
        async changePlaylistDetails(id, opts) {
            calls.push(['changePlaylistDetails', id, opts]);
            return fail ? { success: false, error: new Error('boom') } : { success: true };
        },
        async unfollowPlaylist(id) {
            calls.push(['unfollowPlaylist', id]);
            if (unfollowResult !== undefined) return unfollowResult;
            return fail ? { success: false, error: new Error('boom') } : { success: true };
        },
        async getCurrentUserId() {
            calls.push(['getCurrentUserId']);
            if (userIdFails) throw new Error('no profile');
            return userId;
        },
    };
}

function makePinned({ canEdit = true, items = [], toggleResult = { success: true }, getItemsFails = false } = {}) {
    const calls = [];
    return {
        calls,
        sensorEntity: 'sensor.spotify_browser_data',
        canEdit: () => canEdit,
        async getItems() {
            calls.push(['getItems']);
            if (getItemsFails) throw new Error('unreadable');
            return items;
        },
        async toggle(item) { calls.push(['toggle', item]); return toggleResult; },
    };
}

const OWNED = { id: 'p1', name: 'Mine', uri: 'spotify:playlist:p1', images: [{ url: 'a.png' }], description: 'd', owner: { id: 'me' }, public: true, collaborative: false };
const OTHER = { id: 'p2', name: 'Theirs', uri: 'spotify:playlist:p2', images: [], owner: { id: 'someone' } };

// The menus as each surface built them by hand before playlist-actions.js
// (copied verbatim; `this` became parameters).
const legacy = {
    // spotify-playlist-view.js _openHeaderMenu
    pageItems(data, isFollowing, pinEntity, pinIsPinned) {
        const isOwner = !!data.isOwner;
        const items = [];
        if (isOwner) {
            items.push({ id: 'pm-edit', label: 'Edit Playlist', icon: 'pencil' });
            items.push(data.public !== false
                ? { id: 'pm-toggle-public', label: 'Make Private', icon: 'lock' }
                : { id: 'pm-toggle-public', label: 'Make Public', icon: 'lock' });
            items.push(data.collaborative
                ? { id: 'pm-toggle-collab', label: 'Remove Collaborative', icon: 'people' }
                : { id: 'pm-toggle-collab', label: 'Make Collaborative', icon: 'people' });
        } else {
            items.push(isFollowing
                ? { id: 'pm-unfollow', label: 'Remove from Your Library', icon: 'heart-filled' }
                : { id: 'pm-follow', label: 'Add to Your Library', icon: 'heart' });
        }
        if (pinEntity) {
            items.push({ id: 'pm-pin', label: pinIsPinned ? 'Unpin from Home' : 'Pin to Home', icon: 'pin' });
        }
        if (isOwner) {
            items.push({ id: 'pm-delete', label: 'Delete Playlist', icon: 'trash', danger: true });
        }
        return items;
    },
    // spotify-library.js _openRowMenu, playlist branch
    async rowItems(api, pinned, item) {
        const items = [];
        const canPin = !!(pinned?.canEdit() && pinned.sensorEntity);
        const [userId, pinnedItems] = await Promise.all([
            api.getCurrentUserId().catch(() => null),
            canPin ? pinned.getItems().catch(() => []) : Promise.resolve([]),
        ]);
        if (canPin) {
            const isPinned = !!pinnedItems.find(p => p.id === item.id);
            items.push({ id: 'lm-pin', label: isPinned ? 'Unpin from Home' : 'Pin to Home', icon: 'pin' });
        }
        if (userId && item.owner?.id === userId) {
            items.push({ id: 'lm-edit', label: 'Edit Playlist', icon: 'pencil' });
            items.push({ id: 'lm-delete', label: 'Delete Playlist', icon: 'trash', danger: true });
        }
        return items;
    },
};

// ---- Ownership and menus ----------------------------------------------------

test('isPlaylistOwner: owner id matches a known user id', () => {
    assert.equal(isPlaylistOwner(OWNED, 'me'), true);
    assert.equal(isPlaylistOwner(OTHER, 'me'), false);
    assert.equal(isPlaylistOwner(OWNED, null), false, 'unknown user owns nothing');
    assert.equal(isPlaylistOwner({ id: 'x' }, 'me'), false, 'no owner field');
    assert.equal(isPlaylistOwner({ owner: { id: undefined } }, undefined), false);
    assert.equal(isPlaylistOwner(null, 'me'), false);
});

test('page menu, owner: edit, privacy, collaborative, pin, delete', () => {
    assert.deepEqual(playlistMenuItems(OWNED, { surface: 'page', isOwner: true, canPin: true, isPinned: false }), [
        { id: 'pm-edit', label: 'Edit Playlist', icon: 'pencil' },
        { id: 'pm-toggle-public', label: 'Make Private', icon: 'lock' },
        { id: 'pm-toggle-collab', label: 'Make Collaborative', icon: 'people' },
        { id: 'pm-pin', label: 'Pin to Home', icon: 'pin' },
        { id: 'pm-delete', label: 'Delete Playlist', icon: 'trash', danger: true },
    ]);
    const priv = playlistMenuItems({ ...OWNED, public: false, collaborative: true }, { isOwner: true, canPin: true, isPinned: true });
    assert.deepEqual(priv.map(i => i.label), ['Edit Playlist', 'Make Public', 'Remove Collaborative', 'Unpin from Home', 'Delete Playlist']);
    assert.equal(playlistMenuItems({ id: 'x' }, { isOwner: true })[1].label, 'Make Private', 'public unknown counts as public');
});

test('page menu, not owner: follow toggle, then pin; never edit or delete', () => {
    assert.deepEqual(playlistMenuItems(OTHER, { surface: 'page', isFollowing: false, canPin: true }), [
        { id: 'pm-follow', label: 'Add to Your Library', icon: 'heart' },
        { id: 'pm-pin', label: 'Pin to Home', icon: 'pin' },
    ]);
    assert.deepEqual(playlistMenuItems(OTHER, { surface: 'page', isFollowing: true }), [
        { id: 'pm-unfollow', label: 'Remove from Your Library', icon: 'heart-filled' },
    ]);
});

test('row menu: pin first, edit and delete only for the owner; no settings or follow', () => {
    assert.deepEqual(playlistMenuItems(OWNED, { surface: 'row', isOwner: true, canPin: true, isPinned: true }), [
        { id: 'lm-pin', label: 'Unpin from Home', icon: 'pin' },
        { id: 'lm-edit', label: 'Edit Playlist', icon: 'pencil' },
        { id: 'lm-delete', label: 'Delete Playlist', icon: 'trash', danger: true },
    ]);
    assert.deepEqual(playlistMenuItems(OWNED, { surface: 'row', isOwner: true }).map(i => i.id), ['lm-edit', 'lm-delete']);
    assert.deepEqual(playlistMenuItems(OTHER, { surface: 'row', canPin: true, isFollowing: true }), [
        { id: 'lm-pin', label: 'Pin to Home', icon: 'pin' },
    ]);
    assert.deepEqual(playlistMenuItems(OTHER, { surface: 'row' }), [], 'nothing to offer: no menu');
});

test('page menu matches the hand-built one for every combination', () => {
    for (const isOwner of [true, false, undefined])
        for (const isFollowing of [true, false])
            for (const pinEntity of ['sensor.x', null])
                for (const isPinned of [true, false])
                    for (const pub of [true, false, undefined])
                        for (const collaborative of [true, false, undefined]) {
                            const data = { ...OWNED, isOwner, public: pub, collaborative };
                            assert.deepEqual(
                                playlistMenuItems(data, { surface: 'page', isOwner: !!data.isOwner, isFollowing, canPin: !!pinEntity, isPinned }),
                                legacy.pageItems(data, isFollowing, pinEntity, isPinned),
                                JSON.stringify({ isOwner, isFollowing, pinEntity, isPinned, pub, collaborative }));
                        }
});

test('row menu (state + items) matches the hand-built one for every combination', async () => {
    const pinnedVariants = [
        () => makePinned({ items: [{ id: 'p1' }] }),
        () => makePinned({ items: [{ id: 'zz' }] }),
        () => makePinned({ canEdit: false, items: [{ id: 'p1' }] }),
        () => makePinned({ getItemsFails: true }),
        () => null,
    ];
    const apiVariants = [() => makeApi(), () => makeApi({ userId: 'someone' }), () => makeApi({ userId: null }), () => makeApi({ userIdFails: true })];
    for (const item of [OWNED, OTHER, { id: 'p3', name: 'No owner' }]) {
        for (const mkPinned of pinnedVariants) {
            for (const mkApi of apiVariants) {
                const state = await playlistMenuState(mkApi(), mkPinned(), item);
                assert.deepEqual(
                    playlistMenuItems(item, { surface: 'row', ...state }),
                    await legacy.rowItems(mkApi(), mkPinned(), item));
            }
        }
    }
});

test('playlistMenuState: one user lookup and one pinned read; failures count as no', async () => {
    const api = makeApi();
    const pinned = makePinned({ items: [{ id: 'user-library' }, { id: 'p1' }] });
    assert.deepEqual(await playlistMenuState(api, pinned, OWNED), { isOwner: true, canPin: true, isPinned: true });
    assert.deepEqual(api.calls, [['getCurrentUserId']]);
    assert.deepEqual(pinned.calls, [['getItems']]);

    assert.deepEqual(await playlistMenuState(makeApi(), makePinned(), OTHER), { isOwner: false, canPin: true, isPinned: false });
    assert.deepEqual(await playlistMenuState(makeApi({ userIdFails: true }), makePinned({ getItemsFails: true }), OWNED),
        { isOwner: false, canPin: true, isPinned: false });

    const readOnly = makePinned({ canEdit: false, items: [{ id: 'p1' }] });
    assert.deepEqual(await playlistMenuState(makeApi(), readOnly, OWNED), { isOwner: true, canPin: false, isPinned: false });
    assert.deepEqual(readOnly.calls, [], 'no pinned read when the user cannot pin');
    assert.deepEqual(await playlistMenuState(makeApi(), null, OWNED), { isOwner: true, canPin: false, isPinned: false });
});

test('menuActionKey strips the surface prefix', () => {
    assert.equal(menuActionKey('pm-toggle-public'), 'toggle-public');
    assert.equal(menuActionKey('pm-delete'), 'delete');
    assert.equal(menuActionKey('lm-pin'), 'pin');
    assert.equal(menuActionKey('lm-artist'), 'artist');
    assert.equal(menuActionKey('tm-queue'), 'tm-queue', 'other menus are left alone');
});

test('openActionMenu: one bubbling open-context-menu; the chosen item runs its action', () => {
    const host = makeHost();
    const ran = [];
    const items = playlistMenuItems(OWNED, { isOwner: true });
    const anchor = { x: 1, y: 2, width: 3, height: 4 };
    const header = { image: 'a.png', name: 'Mine', subtitle: 'Me' };
    openActionMenu(host, { header, items, anchor, actions: { 'edit': () => ran.push('edit'), 'toggle-public': () => ran.push('public'), 'artist': () => ran.push('artist') } });
    assert.equal(host.events.length, 1);
    const e = host.events[0];
    assert.equal(e.type, 'open-context-menu');
    assert.equal(e.bubbles && e.composed, true);
    assert.deepEqual(Object.keys(e.detail), ['header', 'items', 'anchor', 'onAction']);
    assert.equal(e.detail.header, header);
    assert.equal(e.detail.items, items);
    assert.equal(e.detail.anchor, anchor);
    e.detail.onAction('pm-edit');
    e.detail.onAction('pm-toggle-public');
    e.detail.onAction('lm-artist');
    e.detail.onAction('pm-delete'); // no handler: nothing happens
    assert.deepEqual(ran, ['edit', 'public', 'artist']);

    openActionMenu(host, { header, items: [], actions: {} });
    assert.equal(host.events[1].detail.anchor, null, 'anchor defaults to null');
});

// ---- Pin --------------------------------------------------------------------

test('playlistPinItem: what a library row pin stores', () => {
    assert.deepEqual(playlistPinItem(OWNED), { id: 'p1', type: 'playlist', name: 'Mine', images: [{ url: 'a.png' }], uri: 'spotify:playlist:p1', description: 'd' });
});

test('togglePin success: the manager toggles the item, Home is told (no detail)', async () => {
    const host = makeHost();
    const pinned = makePinned({ toggleResult: { success: true } });
    const item = playlistPinItem(OTHER);
    const res = await togglePin(host, pinned, item);
    assert.deepEqual(res, { success: true });
    assert.deepEqual(pinned.calls, [['toggle', item]]);
    assert.equal(host.events.length, 1);
    assert.equal(host.events[0].type, 'pinned-changed');
    assert.equal(host.events[0].detail, null);
    assert.equal(host.events[0].bubbles && host.events[0].composed, true);
});

test('togglePin failure: a mini alert with the reason, nothing else', async () => {
    const host = makeHost();
    const res = await togglePin(host, makePinned({ toggleResult: { success: false, error: 'Full' } }), playlistPinItem(OTHER));
    assert.deepEqual(res, { success: false, error: 'Full' });
    assert.deepEqual(host.log(), [['show-alert', { title: 'Pinning Failed', message: 'Full', confirmText: 'OK', size: 'mini' }]]);
    assert.equal(host.events[0].bubbles && host.events[0].composed, true);

    const h2 = makeHost();
    await togglePin(h2, makePinned({ toggleResult: { success: false } }), playlistPinItem(OTHER));
    assert.equal(h2.events[0].detail.message, 'Unknown error');
});

test('togglePin against the real manager: pins then unpins the playlist', async () => {
    const store = { pinned_items: [] };
    const storage = {
        writeStatus: () => 'ok', sensorEntity: 'sensor.spotify_browser_data',
        getData: (k) => store[k],
        async saveData(k, v) { store[k] = v; return { success: true }; },
    };
    const pinned = new PinnedItemsManager(null, { entity: 'media_player.spotify' }, storage);
    const host = makeHost();
    await togglePin(host, pinned, playlistPinItem(OWNED));
    const stored = store.pinned_items.find(i => i.id === 'p1');
    assert.equal(stored.type, 'playlist');
    assert.equal(stored.name, 'Mine');
    assert.equal(stored.subtitle, 'd');
    assert.equal((await playlistMenuState(makeApi(), pinned, OWNED)).isPinned, true);
    await togglePin(host, pinned, playlistPinItem(OWNED));
    assert.equal(store.pinned_items.some(i => i.id === 'p1'), false);
    assert.deepEqual(host.events.map(e => e.type), ['pinned-changed', 'pinned-changed']);
});

// ---- Public / collaborative -----------------------------------------------

test('togglePlaylistFlag public -> private: all four fields sent, toast, patch', async () => {
    const host = makeHost();
    const api = makeApi();
    assert.equal(await togglePlaylistFlag(host, api, OWNED, 'public'), true);
    assert.deepEqual(api.calls, [['changePlaylistDetails', 'p1', { name: 'Mine', description: 'd', isPublic: false, collaborative: false }]]);
    assert.deepEqual(host.log(), [
        ['show-toast', { message: 'Playlist is now private' }],
        ['playlist-changed', { playlistId: 'p1', action: 'edit', patch: { public: false, collaborative: false } }],
    ]);
    assert.ok(host.events.every(e => e.bubbles && e.composed));
});

test('togglePlaylistFlag private -> public also turns collaborative off', async () => {
    const host = makeHost();
    const api = makeApi();
    await togglePlaylistFlag(host, api, { ...OWNED, public: false, collaborative: true, description: undefined }, 'public');
    assert.deepEqual(api.calls[0][2], { name: 'Mine', description: '', isPublic: true, collaborative: false });
    assert.deepEqual(host.log(), [
        ['show-toast', { message: 'Playlist is now public' }],
        ['playlist-changed', { playlistId: 'p1', action: 'edit', patch: { public: true, collaborative: false } }],
    ]);
});

test('togglePlaylistFlag collaborative on makes it private; off keeps it private', async () => {
    const on = makeHost();
    const api = makeApi();
    await togglePlaylistFlag(on, api, OWNED, 'collaborative');
    assert.deepEqual(api.calls[0][2], { name: 'Mine', description: 'd', isPublic: false, collaborative: true });
    assert.deepEqual(on.log(), [
        ['show-toast', { message: 'Playlist is now collaborative' }],
        ['playlist-changed', { playlistId: 'p1', action: 'edit', patch: { public: false, collaborative: true } }],
    ]);

    const off = makeHost();
    await togglePlaylistFlag(off, makeApi(), { ...OWNED, public: false, collaborative: true }, 'collaborative');
    assert.deepEqual(off.log(), [
        ['show-toast', { message: 'Collaborative turned off' }],
        ['playlist-changed', { playlistId: 'p1', action: 'edit', patch: { public: false, collaborative: false } }],
    ]);
});

test('togglePlaylistFlag failure: one toast, no playlist-changed', async () => {
    const host = makeHost();
    assert.equal(await togglePlaylistFlag(host, makeApi({ fail: true }), OWNED, 'public'), false);
    assert.deepEqual(host.log(), [['show-toast', { message: "Couldn't update playlist settings" }]]);
});

test('togglePlaylistFlag without a playlist id or api does nothing', async () => {
    const host = makeHost();
    const api = makeApi();
    assert.equal(await togglePlaylistFlag(host, api, { name: 'x' }, 'public'), undefined);
    assert.equal(await togglePlaylistFlag(host, api, null, 'public'), undefined);
    assert.equal(await togglePlaylistFlag(host, null, OWNED, 'public'), undefined);
    assert.deepEqual(api.calls, []);
    assert.equal(host.events.length, 0);
});

// ---- Delete -----------------------------------------------------------------

test('confirmDeletePlaylist asks first: the alert names the playlist; nothing is called yet', () => {
    const host = makeHost();
    const api = makeApi();
    confirmDeletePlaylist(host, api, OWNED);
    assert.equal(host.events.length, 1);
    const e = host.events[0];
    assert.equal(e.type, 'show-alert');
    assert.equal(e.bubbles && e.composed, true);
    assert.deepEqual(Object.keys(e.detail), ['title', 'message', 'confirmText', 'onConfirm']);
    assert.equal(e.detail.title, 'Delete playlist?');
    assert.equal(e.detail.message, '"Mine" will be removed from Your Library.');
    assert.equal(e.detail.confirmText, 'Delete');
    assert.equal(typeof e.detail.onConfirm, 'function');
    assert.deepEqual(api.calls, []);

    const lib = makeHost();
    confirmDeletePlaylist(lib, api, OWNED, { cancelText: 'Cancel' });
    assert.deepEqual(Object.keys(lib.events[0].detail), ['title', 'message', 'confirmText', 'cancelText', 'onConfirm']);
    assert.equal(lib.events[0].detail.cancelText, 'Cancel');
});

test('confirmDeletePlaylist confirmed (playlist page): unfollow, "Playlist deleted", then playlist-changed', async () => {
    const host = makeHost();
    const api = makeApi();
    confirmDeletePlaylist(host, api, OWNED, { successToast: 'Playlist deleted' });
    assert.equal(await host.events[0].detail.onConfirm(), true);
    assert.deepEqual(api.calls, [['unfollowPlaylist', 'p1']]);
    assert.deepEqual(host.log().slice(1), [
        ['show-toast', { message: 'Playlist deleted' }],
        ['playlist-changed', { playlistId: 'p1', action: 'delete' }],
    ]);
    assert.ok(host.events.every(e => e.bubbles && e.composed));
});

test('confirmDeletePlaylist confirmed (library): no success toast, just playlist-changed', async () => {
    const host = makeHost();
    confirmDeletePlaylist(host, makeApi(), OWNED, { cancelText: 'Cancel' });
    await host.events[0].detail.onConfirm();
    assert.deepEqual(host.log().slice(1), [['playlist-changed', { playlistId: 'p1', action: 'delete' }]]);
});

test('confirmDeletePlaylist failure: a toast, no playlist-changed (also for an empty answer)', async () => {
    for (const api of [makeApi({ fail: true }), makeApi({ unfollowResult: null }), makeApi({ unfollowResult: {} })]) {
        for (const opts of [{ successToast: 'Playlist deleted' }, { cancelText: 'Cancel' }]) {
            const host = makeHost();
            confirmDeletePlaylist(host, api, OWNED, opts);
            assert.equal(await host.events[0].detail.onConfirm(), false);
            assert.deepEqual(host.log().slice(1), [['show-toast', { message: "Couldn't delete playlist" }]]);
        }
    }
});

test('confirmDeletePlaylist deletes the playlist the dialog named', async () => {
    const host = makeHost();
    const api = makeApi();
    const data = { ...OWNED };
    confirmDeletePlaylist(host, api, data);
    data.id = 'other'; // the page's data swapped while the dialog was open
    await host.events[0].detail.onConfirm();
    assert.deepEqual(api.calls, [['unfollowPlaylist', 'p1']]);
    assert.equal(host.events[1].detail.playlistId, 'p1');
});

// ---- Edit -------------------------------------------------------------------

test('openPlaylistEditor: navigates to the playlist page with autoEdit', () => {
    const host = makeHost();
    openPlaylistEditor(host, OWNED);
    assert.deepEqual(host.log(), [['navigate', { pageId: 'playlist:p1', data: { title: 'Mine', type: 'playlist', autoEdit: true } }]]);
    assert.equal(host.events[0].bubbles && host.events[0].composed, true);
});
