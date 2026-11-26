import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definedElement } from './helpers/elements.js';
import '../src/components/views/spotify-playlist-view.js';

// The playlist page's header "…" menu per role (D4/D5), its heart / follow
// items (B14: playlist-changed {follow|unfollow}) and the library's "Edit
// Playlist" landing on it in edit mode for a collaborator (autoEdit). A bare
// view instance (not rendered) with the fields those methods read.

const View = definedElement('spotify-playlist-view');

const BASE = {
    id: 'p5', type: 'playlist', uri: 'spotify:playlist:p5', name: 'Shared', description: 'desc', images: [{ url: 'a.png' }],
    owner: { id: 'someone', display_name: 'Someone' }, public: false, collaborative: true, tracksComplete: true,
};

function makeView(data, { isFollowing = false, pinEntity = 'sensor.s', isPinned = false, fail = false } = {}) {
    const view = Object.create(View.prototype);
    const events = [];
    const calls = [];
    const result = () => (fail ? { success: false } : { success: true });
    Object.assign(view, {
        data,
        _isFollowing: isFollowing,
        _editMode: false,
        _editSession: 0,
        _pin: { entity: pinEntity, isPinned, toggle: () => calls.push(['pin.toggle']), check: () => {} },
        api: {
            async followPlaylist(id) { calls.push(['followPlaylist', id]); return result(); },
            async unfollowPlaylist(id) { calls.push(['unfollowPlaylist', id]); return result(); },
        },
    });
    view.dispatchEvent = (e) => { events.push(e); return true; };
    return { view, events, calls };
}

const menuOf = (view, events) => {
    view._openHeaderMenu(null);
    return events.at(-1).detail;
};

test('header menu, owner: Edit, Make Private/Public, Make/Remove Collaborative, Pin, Delete', () => {
    const { view, events } = makeView({ ...BASE, owner: { id: 'me' }, isOwner: true, canEditItems: true });
    assert.deepEqual(menuOf(view, events).items.map(i => i.id), ['pm-edit', 'pm-toggle-public', 'pm-toggle-collab', 'pm-pin', 'pm-delete']);
    assert.deepEqual(menuOf(view, events).items.map(i => i.label), ['Edit Playlist', 'Make Public', 'Remove Collaborative', 'Pin to Home', 'Delete Playlist']);
});

test('header menu, collaborator (D5): Edit Playlist, Remove from Your Library, Pin', () => {
    const { view, events } = makeView({ ...BASE, isOwner: false, canEditItems: true }, { isFollowing: true, isPinned: true });
    assert.deepEqual(menuOf(view, events).items.map(i => i.label), ['Edit Playlist', 'Remove from Your Library', 'Unpin from Home']);
});

test('header menu, follower / not following: the follow item and Pin, no edit', () => {
    const followed = makeView({ ...BASE, collaborative: false, isOwner: false, canEditItems: false }, { isFollowing: true });
    assert.deepEqual(menuOf(followed.view, followed.events).items.map(i => i.label), ['Remove from Your Library', 'Pin to Home']);
    const not = makeView({ ...BASE, isOwner: false, canEditItems: false }, { isFollowing: false, pinEntity: null });
    assert.deepEqual(menuOf(not.view, not.events).items.map(i => i.label), ['Add to Your Library']);
});

test('the menu\'s Edit Playlist enters edit mode for a collaborator', () => {
    const { view, events } = makeView({ ...BASE, isOwner: false, canEditItems: true }, { isFollowing: true });
    menuOf(view, events).onAction('pm-edit');
    assert.equal(view._editMode, true);
    assert.equal(view._editPlaylistId, 'p5');
});

test('heart / menu follow (B14): toast, then playlist-changed {follow}; the page data follows, edit rights too', async () => {
    const data = { ...BASE, isOwner: false, canEditItems: false, isFollowing: false };
    const { view, events, calls } = makeView(data, { isFollowing: false });
    await view._toggleFollowPlaylist();
    assert.deepEqual(calls, [['followPlaylist', 'p5']]);
    assert.deepEqual(events.map(e => [e.type, e.detail]), [
        ['show-toast', { message: 'Added to your library.' }],
        ['playlist-changed', { playlistId: 'p5', action: 'follow' }],
    ]);
    assert.ok(events.every(e => e.bubbles && e.composed));
    assert.equal(view._isFollowing, true);
    assert.equal(data.isFollowing, true);
    assert.equal(data.canEditItems, true, 'a collaborative playlist you now follow');

    const from = events.length;
    menuOf(view, events).onAction('pm-unfollow');
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(events.slice(from + 1).map(e => [e.type, e.detail]), [
        ['show-toast', { message: 'Removed from your library.' }],
        ['playlist-changed', { playlistId: 'p5', action: 'unfollow' }],
    ]);
    assert.equal(data.isFollowing, false);
    assert.equal(data.canEditItems, false);
});

test('a failed follow: reverted, the failure toast, no playlist-changed', async () => {
    const data = { ...BASE, isOwner: false, canEditItems: false, isFollowing: false };
    const { view, events } = makeView(data, { fail: true });
    await view._toggleFollowPlaylist();
    assert.equal(view._isFollowing, false);
    assert.equal(data.isFollowing, false);
    assert.deepEqual(events.map(e => [e.type, e.detail]), [['show-toast', { message: 'Failed to follow playlist.' }]]);
});

test('Delete from the page: the shared confirmation, "Playlist deleted" on success', async () => {
    const { view, events, calls } = makeView({ ...BASE, owner: { id: 'me' }, isOwner: true, canEditItems: true });
    menuOf(view, events).onAction('pm-delete');
    const alert = events.at(-1);
    assert.deepEqual(Object.keys(alert.detail), ['title', 'message', 'confirmText', 'onConfirm']);
    const from = events.length;
    await alert.detail.onConfirm();
    assert.deepEqual(calls, [['unfollowPlaylist', 'p5']]);
    assert.deepEqual(events.slice(from).map(e => [e.type, e.detail]), [
        ['show-toast', { message: 'Playlist deleted' }],
        ['playlist-changed', { playlistId: 'p5', action: 'delete' }],
    ]);
});

test('autoEdit (library row "Edit Playlist") for a collaborator: waits for the follow check, then edit mode', () => {
    // The page loader's two commits: owner check first (no edit rights yet,
    // follow pending), then the follow answer with canEditItems.
    const first = { ...BASE, isOwner: false, canEditItems: false, followPending: true, autoEdit: true };
    const { view } = makeView(first);
    Object.assign(view, {
        _likes: { reset() {}, check() {} },
        _checkFollowStatus() {},
        _enrichGenres() {},
        _checkAlbumLike() {},
        _fetchArtistInfo() {},
    });
    view.updated(new Map([['data', undefined]]));
    assert.equal(view._editMode, false, 'no edit rights yet');

    const second = { ...first, canEditItems: true, followPending: false, isFollowing: true };
    view.data = second;
    view.updated(new Map([['data', first]]));
    assert.equal(view._editMode, true);
    assert.equal(second.autoEdit, false, 'one-shot');
});
