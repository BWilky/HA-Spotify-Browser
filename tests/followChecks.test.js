import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definedElement } from './helpers/elements.js';
import { normalized } from './helpers/lit-env.js';
import '../src/components/views/spotify-artist-view.js';
import '../src/components/views/spotify-playlist-view.js';
import { VERIFY_MS } from '../src/components/controllers/track-likes-controller.js';

// B15 (stale follow answers) and B16 (the artist follow re-check reading
// whichever artist is open 3 s later). Real view instances, built by their
// constructors (so the FollowStateController wiring is the view's own), with
// Lit's update cycle switched off: nothing renders; `data` is set directly and
// the checks updated() would start are called by hand.

globalThis.matchMedia ??= () => ({ matches: false }); // the playlist view's HeroScrollController

const flush = () => new Promise(r => setImmediate(r));

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

/** A view built by its constructor, with Lit's update cycle switched off. */
function makeView(name) {
    class Quiet extends definedElement(name) { scheduleUpdate() {} }
    const view = new Quiet();
    view.dispatchEvent = () => true;
    return view;
}

/** Stub api whose reads stay pending until answer(name, key, value). */
function stubApi(writes = {}) {
    const calls = [];
    const pending = new Map();
    const read = (name, key) => {
        const d = deferred();
        const k = `${name}:${key}`;
        if (!pending.has(k)) pending.set(k, []);
        pending.get(k).push(d);
        return d.promise;
    };
    return {
        calls,
        async answer(name, key, value) {
            const queue = pending.get(`${name}:${key}`);
            assert.ok(queue?.length, `a ${name} read for ${key} is pending`);
            queue.shift().resolve(value);
            await flush();
        },
        checkArtistsFollowing(id) { calls.push(['checkArtistsFollowing', id]); return read('checkArtistsFollowing', id); },
        async followArtist(id) { calls.push(['followArtist', id]); return { success: true }; },
        async unfollowArtist(id) { calls.push(['unfollowArtist', id]); return { success: true }; },
        getCurrentUserId() { calls.push(['getCurrentUserId']); return read('getCurrentUserId', ''); },
        checkUserFollowsPlaylist(id, user) { calls.push(['checkUserFollowsPlaylist', id, user]); return read('checkUserFollowsPlaylist', id); },
        async followPlaylist(id) { calls.push(['followPlaylist', id]); return { success: true }; },
        async unfollowPlaylist(id) { calls.push(['unfollowPlaylist', id]); return { success: true }; },
        ...writes,
    };
}

const reads = (api, name) => api.calls.filter(c => c[0] === name);

/* --- Artist page --- */

function artistView() {
    const view = makeView('spotify-artist-view');
    view.api = stubApi();
    return { view, api: view.api };
}

test('artist, B15: a late follow answer for the previous artist does not set the next one\'s button', async () => {
    const { view, api } = artistView();
    view.data = { id: 'A' };
    const a = view._checkFollowStatus();
    view.data = { id: 'B' };
    const b = view._checkFollowStatus();
    await api.answer('checkArtistsFollowing', 'B', true);
    await b;
    assert.equal(view._follow.following, true);
    await api.answer('checkArtistsFollowing', 'A', false);
    await a;
    assert.equal(view._follow.following, true, 'A\'s answer is dropped');
});

test('artist, B15: of two checks for the same artist only the later applies; a toggle supersedes a check on its way', async () => {
    const { view, api } = artistView();
    view.data = { id: 'A' };
    view._checkFollowStatus();
    view._checkFollowStatus();                       // e.g. refresh() of the same artist
    // The stub answers reads in the order they were sent.
    await api.answer('checkArtistsFollowing', 'A', true);  // the older read: dropped
    assert.equal(view._follow.following, false);
    await api.answer('checkArtistsFollowing', 'A', true);  // the newer read: applies
    assert.equal(view._follow.following, true);

    // A toggle while a check is on its way: the check's (pre-toggle) answer is dropped.
    view._follow.following = false;
    view._checkFollowStatus();
    await view._toggleFollow();
    assert.equal(view._follow.following, true);
    await api.answer('checkArtistsFollowing', 'A', false);
    assert.equal(view._follow.following, true, 'the toggle stands');
});

test('artist, B16: a re-check is for the artist toggled; skipped while another artist is shown', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'warn', () => {});
    const { view, api } = artistView();

    view.data = { id: 'A' };
    await view._toggleFollow();                      // t=0: follow A
    assert.deepEqual(api.calls, [['followArtist', 'A']]);
    t.mock.timers.tick(1000);
    view.data = { id: 'B' };
    view._follow.following = false;                  // B's own state, as its check would set it
    await view._toggleFollow();                      // t=1000: follow B
    assert.equal(view._follow.following, true);

    t.mock.timers.tick(VERIFY_MS - 1000);            // t=3000: A's re-check
    await flush();
    assert.deepEqual(reads(api, 'checkArtistsFollowing'), [], 'A\'s re-check is skipped (B shown), and B\'s is not read early');
    t.mock.timers.tick(1000);                        // t=4000: B's re-check
    await flush();
    assert.deepEqual(reads(api, 'checkArtistsFollowing'), [['checkArtistsFollowing', 'B']]);
    await api.answer('checkArtistsFollowing', 'B', false);
    assert.equal(view._follow.following, false, 'B\'s own re-check still corrects B');
    assert.equal(console.warn.mock.callCount(), 1);
});

test('artist, B16: a re-check answer that lands after the page changed corrects nothing; same page still corrects', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'warn', () => {});
    const { view, api } = artistView();

    view.data = { id: 'A' };
    await view._toggleFollow();                      // follow A
    t.mock.timers.tick(VERIFY_MS);
    await flush();
    assert.deepEqual(reads(api, 'checkArtistsFollowing'), [['checkArtistsFollowing', 'A']]);
    view.data = { id: 'B' };
    view._follow.following = true;                   // B shown as followed
    await api.answer('checkArtistsFollowing', 'A', false);
    assert.equal(view._follow.following, true, 'A\'s answer does not touch B');
    assert.equal(console.warn.mock.callCount(), 0);

    view.data = { id: 'A' };
    view._follow.following = false;
    await view._toggleFollow();                      // follow A again, A stays shown
    t.mock.timers.tick(VERIFY_MS);
    await flush();
    await api.answer('checkArtistsFollowing', 'A', false);
    assert.equal(view._follow.following, false, 'corrected');
    assert.equal(console.warn.mock.callCount(), 1);
});

test('artist, B16: a failed toggle schedules no re-check; disconnect drops a pending one', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { view, api } = artistView();
    api.followArtist = async (id) => { api.calls.push(['followArtist', id]); return { success: false }; };

    view.data = { id: 'A' };
    await view._toggleFollow();
    assert.equal(view._follow.following, false, 'reverted');
    assert.equal(view._follow._verifyTimers.size, 0);

    api.followArtist = async (id) => { api.calls.push(['followArtist', id]); return { success: true }; };
    await view._toggleFollow();
    assert.equal(view._follow._verifyTimers.size, 1);
    view.disconnectedCallback();
    assert.equal(view._follow._verifyTimers.size, 0);

    // Shown again for B: B's toggle gets B's re-check (not A's leftover id).
    view.data = { id: 'B' };
    view._follow.following = false;
    await view._toggleFollow();
    t.mock.timers.tick(VERIFY_MS);
    await flush();
    assert.deepEqual(reads(api, 'checkArtistsFollowing'), [['checkArtistsFollowing', 'B']]);
});

/* --- Playlist page --- */

function playlistView() {
    const view = makeView('spotify-playlist-view');
    view.api = stubApi();
    return { view, api: view.api };
}

const PL = (id, extra = {}) => ({ id, type: 'playlist', uri: `spotify:playlist:${id}`, isOwner: false, ...extra });

test('playlist: _currentUserId is a plain field (never rendered), fetched once and reused', async () => {
    const View = definedElement('spotify-playlist-view');
    assert.equal('_currentUserId' in View.properties, false);
    const { view, api } = playlistView();
    view.data = PL('A');
    const a = view._checkFollowStatus();
    await api.answer('getCurrentUserId', '', 'me');
    await api.answer('checkUserFollowsPlaylist', 'A', [true]);
    await a;
    assert.equal(view._follow.following, true);
    view.data = PL('B');
    const b = view._checkFollowStatus();
    await api.answer('checkUserFollowsPlaylist', 'B', [false]);
    await b;
    assert.equal(view._follow.following, false);
    assert.equal(reads(api, 'getCurrentUserId').length, 1);
    assert.equal(view._currentUserId, 'me');
});

test('playlist, B15: a late network answer for the previous playlist does not set the next page\'s heart', async () => {
    const { view, api } = playlistView();
    view._currentUserId = 'me';
    view.data = PL('A');                             // no isFollowing: the network path
    const a = view._checkFollowStatus();
    view.data = PL('B', { isFollowing: true });      // answered by the page loader
    await view._checkFollowStatus();
    assert.equal(view._follow.following, true);
    await api.answer('checkUserFollowsPlaylist', 'A', [false]);
    await a;
    assert.equal(view._follow.following, true, 'A\'s answer is dropped');

    // Also when the next page is your own playlist, or the same page re-checked.
    view.data = PL('C');
    const c = view._checkFollowStatus();
    view.data = PL('D', { isOwner: true });
    await view._checkFollowStatus();
    await api.answer('checkUserFollowsPlaylist', 'C', [true]);
    await c;
    assert.equal(view._follow.following, false);
});

test('playlist, B15: the page changes while the user id is fetched: no follow read for the old page', async () => {
    const { view, api } = playlistView();
    view.data = PL('A');
    const a = view._checkFollowStatus();
    view.data = { id: 'X', type: 'album' };
    await api.answer('getCurrentUserId', '', 'me');
    await a;
    assert.deepEqual(api.calls, [['getCurrentUserId']]);
    assert.equal(view._currentUserId, 'me', 'still cached for the next check');
    assert.equal(view._follow.following, false);
});

test('playlist, B15: a toggle supersedes a follow check on its way', async () => {
    const { view, api } = playlistView();
    view._currentUserId = 'me';
    view.data = PL('A');
    const a = view._checkFollowStatus();
    await view._toggleFollowPlaylist();
    assert.equal(view._follow.following, true);
    await api.answer('checkUserFollowsPlaylist', 'A', [false]);
    await a;
    assert.equal(view._follow.following, true, 'the toggle stands');
});

test('playlist: the follow heart is styled by class (follow-heart, following), no inline style', () => {
    const { view } = playlistView();
    view.data = PL('A', { name: 'A', images: [{ url: 'a.png' }], owner: { display_name: 'Someone' }, tracks: { items: [], total: 0 } });
    const heart = () => {
        view.willUpdate();
        const m = normalized(view.render()).match(/<button class="hero-btn-fav[^"]*"[^>]*>/);
        assert.ok(m, 'the heart renders for a playlist you do not own');
        return m[0];
    };
    assert.equal(heart(), '<button class="hero-btn-fav follow-heart" @click=[fn]>');
    view._follow.following = true;
    assert.equal(heart(), '<button class="hero-btn-fav follow-heart following" @click=[fn]>');
});
