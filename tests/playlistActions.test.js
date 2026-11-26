import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isPlaylistOwner, canEditPlaylistItems, playlistMenuItems, menuActionKey, playlistMenuState, openActionMenu,
    playlistPinItem, evictedPinMessage, togglePin, togglePlaylistFlag, setPlaylistFollowed, confirmDeletePlaylist,
    openPlaylistEditor,
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

function makeApi({ fail = false, userId = 'me', userIdFails = false, unfollowResult, follows = [true], followsFails = false } = {}) {
    const calls = [];
    const command = (name) => async (id) => {
        calls.push([name, id]);
        return fail ? { success: false, error: new Error('boom') } : { success: true };
    };
    return {
        calls,
        async changePlaylistDetails(id, opts) {
            calls.push(['changePlaylistDetails', id, opts]);
            return fail ? { success: false, error: new Error('boom') } : { success: true };
        },
        followPlaylist: command('followPlaylist'),
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
        async checkUserFollowsPlaylist(id, user) {
            calls.push(['checkUserFollowsPlaylist', id, user]);
            if (followsFails) throw new Error('no answer');
            return follows;
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

/** A PinnedItemsManager over an in-memory store. */
function realManager(pinned_items = []) {
    const store = { pinned_items };
    const storage = {
        writeStatus: () => 'ok', sensorEntity: 'sensor.spotify_browser_data',
        getData: (k) => store[k],
        async saveData(k, v) { store[k] = v; return { success: true }; },
    };
    return { store, pinned: new PinnedItemsManager(null, { entity: 'media_player.spotify' }, storage) };
}

const OWNED = { id: 'p1', name: 'Mine', uri: 'spotify:playlist:p1', images: [{ url: 'a.png' }], description: 'd', owner: { id: 'me' }, public: true, collaborative: false };
const OTHER = { id: 'p2', name: 'Theirs', uri: 'spotify:playlist:p2', images: [], description: '', owner: { id: 'someone' }, public: true, collaborative: false };
const SHARED = { ...OTHER, id: 'p5', name: 'Shared', public: false, collaborative: true };

const labels = (items) => items.map(i => i.label);

// The playlist page's menu as it was built by hand before playlist-actions.js
// (copied verbatim; `this` became parameters). The one menu still matches it
// for everyone but a collaborator (D5), when the settings are known.
function legacyPageItems(data, isFollowing, pinEntity, pinIsPinned) {
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
}

// ---- Ownership and edit rights ----------------------------------------------

test('isPlaylistOwner: owner id matches a known user id', () => {
    assert.equal(isPlaylistOwner(OWNED, 'me'), true);
    assert.equal(isPlaylistOwner(OTHER, 'me'), false);
    assert.equal(isPlaylistOwner(OWNED, null), false, 'unknown user owns nothing');
    assert.equal(isPlaylistOwner({ id: 'x' }, 'me'), false, 'no owner field');
    assert.equal(isPlaylistOwner({ owner: { id: undefined } }, undefined), false);
    assert.equal(isPlaylistOwner(null, 'me'), false);
});

test('canEditPlaylistItems: the owner, or a collaborative playlist you follow (the page loader\'s rule)', () => {
    assert.equal(canEditPlaylistItems(OWNED, { isOwner: true }), true);
    assert.equal(canEditPlaylistItems(SHARED, { isFollowing: true }), true);
    assert.equal(canEditPlaylistItems(SHARED, { isFollowing: false }), false);
    assert.equal(canEditPlaylistItems(SHARED, {}), false, 'follow state unknown: no');
    assert.equal(canEditPlaylistItems(OTHER, { isFollowing: true }), false, 'not collaborative');
    assert.equal(canEditPlaylistItems(null, { isFollowing: true }), false);
});

// ---- The one menu -----------------------------------------------------------

test('menu, owner: edit, privacy, collaborative, pin, delete', () => {
    assert.deepEqual(playlistMenuItems(OWNED, { isOwner: true, canEdit: true, canPin: true, isPinned: false }), [
        { id: 'pm-edit', label: 'Edit Playlist', icon: 'pencil' },
        { id: 'pm-toggle-public', label: 'Make Private', icon: 'lock' },
        { id: 'pm-toggle-collab', label: 'Make Collaborative', icon: 'people' },
        { id: 'pm-pin', label: 'Pin to Home', icon: 'pin' },
        { id: 'pm-delete', label: 'Delete Playlist', icon: 'trash', danger: true },
    ]);
    const priv = playlistMenuItems({ ...OWNED, public: false, collaborative: true }, { isOwner: true, canPin: true, isPinned: true });
    assert.deepEqual(labels(priv), ['Edit Playlist', 'Make Public', 'Remove Collaborative', 'Unpin from Home', 'Delete Playlist']);
    assert.deepEqual(labels(playlistMenuItems(OWNED, { isOwner: true })), ['Edit Playlist', 'Make Private', 'Make Collaborative', 'Delete Playlist'],
        'no pin item without pin rights; the owner never gets the follow item');
});

test('menu, owner: the settings items need public, collaborative and description (they are all sent)', () => {
    const settings = (p) => labels(playlistMenuItems(p, { isOwner: true })).filter(l => /Private|Public|Collaborative/.test(l));
    assert.deepEqual(settings(OWNED), ['Make Private', 'Make Collaborative']);
    assert.deepEqual(settings({ ...OWNED, description: null }), ['Make Private', 'Make Collaborative'], 'a null description is known (empty)');
    for (const missing of ['public', 'collaborative', 'description']) {
        const p = { ...OWNED };
        delete p[missing];
        assert.deepEqual(settings(p), [], `no ${missing}: no settings items`);
    }
    assert.deepEqual(settings({ ...OWNED, public: null }), [], 'public null: not known');
    assert.deepEqual(labels(playlistMenuItems({ id: 'x' }, { isOwner: true })), ['Edit Playlist', 'Delete Playlist']);
    assert.deepEqual(labels(playlistMenuItems(null, { isOwner: true })), ['Edit Playlist', 'Delete Playlist']);
});

test('menu, collaborator (D5): Edit Playlist first, then the follow item and pin; never settings or delete', () => {
    assert.deepEqual(playlistMenuItems(SHARED, { canEdit: true, isFollowing: true, canPin: true }), [
        { id: 'pm-edit', label: 'Edit Playlist', icon: 'pencil' },
        { id: 'pm-unfollow', label: 'Remove from Your Library', icon: 'heart-filled' },
        { id: 'pm-pin', label: 'Pin to Home', icon: 'pin' },
    ]);
});

test('menu, follower and non-follower: the follow item, then pin; never edit, settings or delete', () => {
    assert.deepEqual(playlistMenuItems(OTHER, { isFollowing: true, canPin: true, isPinned: true }), [
        { id: 'pm-unfollow', label: 'Remove from Your Library', icon: 'heart-filled' },
        { id: 'pm-pin', label: 'Unpin from Home', icon: 'pin' },
    ]);
    assert.deepEqual(playlistMenuItems(OTHER, { isFollowing: false, canPin: true }), [
        { id: 'pm-follow', label: 'Add to Your Library', icon: 'heart' },
        { id: 'pm-pin', label: 'Pin to Home', icon: 'pin' },
    ]);
    assert.deepEqual(labels(playlistMenuItems(OTHER, { canPin: true })), ['Pin to Home'], 'follow state unknown: no follow item');
    assert.deepEqual(playlistMenuItems(OTHER, {}), [], 'nothing to offer: no menu');
});

test('menu, owner or plain follower: unchanged from the page\'s hand-built menu for every combination', () => {
    for (const isOwner of [true, false, undefined])
        for (const isFollowing of [true, false])
            for (const pinEntity of ['sensor.x', null])
                for (const isPinned of [true, false])
                    for (const pub of [true, false])
                        for (const collaborative of [true, false]) {
                            const data = { ...OWNED, isOwner, public: pub, collaborative, canEditItems: !!isOwner };
                            assert.deepEqual(
                                playlistMenuItems(data, { isOwner: !!data.isOwner, canEdit: data.canEditItems, isFollowing, canPin: !!pinEntity, isPinned }),
                                legacyPageItems(data, isFollowing, pinEntity, isPinned),
                                JSON.stringify({ isOwner, isFollowing, pinEntity, isPinned, pub, collaborative }));
                        }
});

test('one menu: a library row\'s state gives the playlist page\'s items (owner, collaborator, follower)', async () => {
    const pinnedItems = [{ id: 'p1' }];
    const cases = [
        // [playlist, the page's data flags, the user]
        [OWNED, { isOwner: true, canEditItems: true }, 'me', undefined],
        [SHARED, { isOwner: false, canEditItems: true }, 'me', [true]],
        [OTHER, { isOwner: false, canEditItems: false }, 'me', [true]],
        [OTHER, { isOwner: false, canEditItems: false }, 'me', [false]],
    ];
    for (const [playlist, page, userId, follows] of cases) {
        const state = await playlistMenuState(makeApi({ userId, follows }), makePinned({ items: pinnedItems }), playlist);
        const pageItems = playlistMenuItems({ ...playlist, ...page }, {
            isOwner: page.isOwner, canEdit: page.canEditItems, isFollowing: follows?.[0] ?? false,
            canPin: true, isPinned: playlist.id === 'p1',
        });
        assert.deepEqual(playlistMenuItems(playlist, state), pageItems, playlist.name);
    }
});

// ---- Menu state (library rows) ----------------------------------------------

test('playlistMenuState, owner: one user lookup and one pinned read, no follow check', async () => {
    const api = makeApi();
    const pinned = makePinned({ items: [{ id: 'user-library' }, { id: 'p1' }] });
    assert.deepEqual(await playlistMenuState(api, pinned, OWNED), { isOwner: true, canEdit: true, canPin: true, isPinned: true });
    assert.deepEqual(api.calls, [['getCurrentUserId']]);
    assert.deepEqual(pinned.calls, [['getItems']]);
});

test('playlistMenuState, not owner: a known follow state is used as is; an unknown one is checked once', async () => {
    const known = makeApi();
    assert.deepEqual(await playlistMenuState(known, makePinned(), SHARED, { isFollowing: true }),
        { isOwner: false, isFollowing: true, canEdit: true, canPin: true, isPinned: false });
    assert.deepEqual(known.calls, [['getCurrentUserId']], 'no follow check');

    const asked = makeApi({ follows: [true] });
    assert.deepEqual(await playlistMenuState(asked, makePinned(), SHARED),
        { isOwner: false, isFollowing: true, canEdit: true, canPin: true, isPinned: false });
    assert.deepEqual(asked.calls, [['getCurrentUserId'], ['checkUserFollowsPlaylist', 'p5', 'me']]);

    assert.deepEqual(await playlistMenuState(makeApi({ follows: [false] }), makePinned(), SHARED),
        { isOwner: false, isFollowing: false, canEdit: false, canPin: true, isPinned: false });
    assert.deepEqual(await playlistMenuState(makeApi({ follows: [true] }), makePinned(), OTHER),
        { isOwner: false, isFollowing: true, canEdit: false, canPin: true, isPinned: false }, 'following but not collaborative');
});

test('playlistMenuState: a failed or empty follow check leaves the follow state unknown (no follow item, no edit)', async () => {
    for (const api of [makeApi({ followsFails: true }), makeApi({ follows: null }), makeApi({ follows: [] })]) {
        const state = await playlistMenuState(api, makePinned(), SHARED);
        assert.deepEqual(state, { isOwner: false, canEdit: false, canPin: true, isPinned: false });
        assert.deepEqual(labels(playlistMenuItems(SHARED, state)), ['Pin to Home']);
    }
    const noUser = makeApi({ userId: null });
    assert.deepEqual(await playlistMenuState(noUser, makePinned(), SHARED), { isOwner: false, canEdit: false, canPin: true, isPinned: false });
    assert.deepEqual(noUser.calls, [['getCurrentUserId']], 'no follow check without a user id');
});

test('playlistMenuState: failures count as no; no pinned read when the user cannot pin', async () => {
    assert.deepEqual(await playlistMenuState(makeApi({ userIdFails: true }), makePinned({ getItemsFails: true }), OWNED),
        { isOwner: false, canEdit: false, canPin: true, isPinned: false });
    const readOnly = makePinned({ canEdit: false, items: [{ id: 'p1' }] });
    assert.deepEqual(await playlistMenuState(makeApi(), readOnly, OWNED), { isOwner: true, canEdit: true, canPin: false, isPinned: false });
    assert.deepEqual(readOnly.calls, [], 'no pinned read when the user cannot pin');
    assert.deepEqual(await playlistMenuState(makeApi(), null, OWNED), { isOwner: true, canEdit: true, canPin: false, isPinned: false });
});

test('menuActionKey strips the menu prefix', () => {
    assert.equal(menuActionKey('pm-toggle-public'), 'toggle-public');
    assert.equal(menuActionKey('pm-delete'), 'delete');
    assert.equal(menuActionKey('pm-unfollow'), 'unfollow');
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

test('evictedPinMessage: names the pin pushed off by name, else title; null when none was', () => {
    assert.equal(evictedPinMessage({ success: true, evicted: { id: 'a', name: 'Old Mix', title: 'Other' } }), 'Removed Old Mix to make room');
    assert.equal(evictedPinMessage({ success: true, evicted: { id: 'a', name: '', title: 'Old Album' } }), 'Removed Old Album to make room');
    assert.equal(evictedPinMessage({ success: true, evicted: { id: 'a' } }), 'Removed the oldest pin to make room');
    assert.equal(evictedPinMessage({ success: true }), null);
    assert.equal(evictedPinMessage({ success: false, error: 'x' }), null);
    assert.equal(evictedPinMessage(null), null);
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

test('togglePin success that pushed a pin off (D2): pinned-changed, then "Removed <name> to make room"', async () => {
    const host = makeHost();
    const evicted = { id: 'old', name: 'Old Mix', title: 'Old Mix' };
    const res = await togglePin(host, makePinned({ toggleResult: { success: true, evicted } }), playlistPinItem(OTHER));
    assert.equal(res.evicted, evicted);
    assert.deepEqual(host.log(), [['pinned-changed', null], ['show-toast', { message: 'Removed Old Mix to make room' }]]);
    assert.ok(host.events.every(e => e.bubbles && e.composed));
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
    const { store, pinned } = realManager();
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

test('togglePin against the real manager, list full: the oldest pin goes and the toast names it', async () => {
    // Stored newest first, legacy pins without pinnedAt: the bottom one is the oldest.
    const seven = Array.from({ length: 7 }, (_, i) => ({ id: 'u' + i, type: 'album', name: 'Album ' + i, title: 'Album ' + i }));
    const { store, pinned } = realManager(seven);
    const host = makeHost();
    const res = await togglePin(host, pinned, playlistPinItem(OWNED));
    assert.equal(res.success, true);
    assert.equal(res.evicted.id, 'u6');
    assert.deepEqual(store.pinned_items.map(i => i.id), ['user-library', 'p1', 'u0', 'u1', 'u2', 'u3', 'u4', 'u5']);
    assert.deepEqual(host.log(), [['pinned-changed', null], ['show-toast', { message: 'Removed Album 6 to make room' }]]);
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

// ---- Follow -----------------------------------------------------------------

test('setPlaylistFollowed: follow -> followPlaylist, toast, playlist-changed {action: follow}', async () => {
    const host = makeHost();
    const api = makeApi();
    assert.equal(await setPlaylistFollowed(host, api, OTHER, true), true);
    assert.deepEqual(api.calls, [['followPlaylist', 'p2']]);
    assert.deepEqual(host.log(), [
        ['show-toast', { message: 'Added to your library.' }],
        ['playlist-changed', { playlistId: 'p2', action: 'follow' }],
    ]);
    assert.ok(host.events.every(e => e.bubbles && e.composed));
});

test('setPlaylistFollowed: unfollow -> unfollowPlaylist, toast, playlist-changed {action: unfollow}', async () => {
    const host = makeHost();
    const api = makeApi();
    assert.equal(await setPlaylistFollowed(host, api, OTHER, false), true);
    assert.deepEqual(api.calls, [['unfollowPlaylist', 'p2']]);
    assert.deepEqual(host.log(), [
        ['show-toast', { message: 'Removed from your library.' }],
        ['playlist-changed', { playlistId: 'p2', action: 'unfollow' }],
    ]);
});

test('setPlaylistFollowed failure: the failure toast only (also for an empty answer)', async () => {
    for (const [follow, message] of [[true, 'Failed to follow playlist.'], [false, 'Failed to unfollow playlist.']]) {
        const host = makeHost();
        assert.equal(await setPlaylistFollowed(host, makeApi({ fail: true }), OTHER, follow), false);
        assert.deepEqual(host.log(), [['show-toast', { message }]]);
    }
    const host = makeHost();
    assert.equal(await setPlaylistFollowed(host, makeApi({ unfollowResult: null }), OTHER, false), false);
    assert.deepEqual(host.log(), [['show-toast', { message: 'Failed to unfollow playlist.' }]]);
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
});

test('confirmDeletePlaylist confirmed (page and library alike): unfollow, "Playlist deleted", then playlist-changed', async () => {
    const host = makeHost();
    const api = makeApi();
    confirmDeletePlaylist(host, api, OWNED);
    assert.equal(await host.events[0].detail.onConfirm(), true);
    assert.deepEqual(api.calls, [['unfollowPlaylist', 'p1']]);
    assert.deepEqual(host.log().slice(1), [
        ['show-toast', { message: 'Playlist deleted' }],
        ['playlist-changed', { playlistId: 'p1', action: 'delete' }],
    ]);
    assert.ok(host.events.every(e => e.bubbles && e.composed));
});

test('confirmDeletePlaylist failure: a toast, no playlist-changed (also for an empty answer)', async () => {
    for (const api of [makeApi({ fail: true }), makeApi({ unfollowResult: null }), makeApi({ unfollowResult: {} })]) {
        const host = makeHost();
        confirmDeletePlaylist(host, api, OWNED);
        assert.equal(await host.events[0].detail.onConfirm(), false);
        assert.deepEqual(host.log().slice(1), [['show-toast', { message: "Couldn't delete playlist" }]]);
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
    assert.equal(host.events[2].detail.playlistId, 'p1');
});

// ---- Edit -------------------------------------------------------------------

test('openPlaylistEditor: navigates to the playlist page with autoEdit', () => {
    const host = makeHost();
    openPlaylistEditor(host, OWNED);
    assert.deepEqual(host.log(), [['navigate', { pageId: 'playlist:p1', data: { title: 'Mine', type: 'playlist', autoEdit: true } }]]);
    assert.equal(host.events[0].bubbles && host.events[0].composed, true);
});
