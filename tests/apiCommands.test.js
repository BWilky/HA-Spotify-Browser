// Characterization suite for SpotifyApi's command / check / playlist-items
// wrappers and the fetchSpotifyPlus flag handling. Written against the code
// as it stood before those wrappers were folded into shared helpers: every
// expectation here records what the methods did then (which HA call, with
// what data, what came back, what was logged), so the refactor must keep it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpotifyApi } from '../src/api.js';

const ENTITY = 'media_player.spotifyplus_test';

// A Home Assistant stand-in that records every call in order. `svc` answers
// hass.callService, `ws` answers hass.callWS; throwing from either fails it.
function makeApi({ svc = () => undefined, ws = () => ({ response: {} }), states = {} } = {}) {
    const calls = [];
    const hass = {
        states,
        callService: async (domain, service, data) => {
            calls.push(['callService', domain, service, data]);
            return svc(domain, service, data);
        },
        callWS: async (payload) => {
            calls.push(['callWS', payload]);
            return ws(payload);
        }
    };
    const api = new SpotifyApi(hass, ENTITY);
    return { api, calls, hass };
}

function haError(message = 'boom', code = 'home_assistant_error') {
    return Object.assign(new Error(message), { code });
}

function failWith(err) {
    return () => { throw err; };
}

// Capture console.error / console.warn for one test.
function captureConsole(t) {
    const error = t.mock.method(console, 'error', () => {});
    const warn = t.mock.method(console, 'warn', () => {});
    return {
        errors: () => error.mock.calls.map(c => c.arguments),
        warns: () => warn.mock.calls.map(c => c.arguments)
    };
}

// Replace the uncached transport with a recorder, so the exact flags every
// internal call site resolves to can be checked independently of how the
// call site spells them.
function spyTransport(api, reply = () => true) {
    const seen = [];
    api._callSpotifyPlus = async (service, params, expectResponse, logError, throwOnError) => {
        seen.push({ service, params, expectResponse, logError, throwOnError });
        return reply(service, params);
    };
    return seen;
}

// ---------------------------------------------------------------------------
// Command wrappers (callService on the spotifyplus domain)
// ---------------------------------------------------------------------------

const COMMANDS = [
    {
        name: 'followPlaylist', args: ['pl1'], service: 'follow_playlist', label: 'Follow Playlist',
        data: { entity_id: ENTITY, playlist_id: 'pl1', public: true }
    },
    {
        name: 'followPlaylist', args: ['pl1', false], service: 'follow_playlist', label: 'Follow Playlist',
        data: { entity_id: ENTITY, playlist_id: 'pl1', public: false }
    },
    {
        name: 'unfollowPlaylist', args: ['pl1'], service: 'unfollow_playlist', label: 'Unfollow Playlist',
        data: { entity_id: ENTITY, playlist_id: 'pl1' }
    },
    {
        name: 'followArtist', args: ['a1'], service: 'follow_artists', label: 'Follow Artist',
        data: { entity_id: ENTITY, ids: 'a1' }
    },
    {
        name: 'followArtist', args: [['a1', 'a2']], service: 'follow_artists', label: 'Follow Artist',
        data: { entity_id: ENTITY, ids: 'a1,a2' }
    },
    {
        name: 'unfollowArtist', args: [['a1', 'a2']], service: 'unfollow_artists', label: 'Unfollow Artist',
        data: { entity_id: ENTITY, ids: 'a1,a2' }
    },
    {
        name: 'saveTrackFavorites', args: ['t1'], service: 'save_track_favorites', label: 'Save Track Favorites',
        data: { entity_id: ENTITY, ids: 't1' }
    },
    {
        name: 'removeTrackFavorites', args: [['t1', 't2']], service: 'remove_track_favorites', label: 'Remove Track Favorites',
        data: { entity_id: ENTITY, ids: 't1,t2' }
    },
    {
        name: 'saveAlbumFavorites', args: [['al1']], service: 'save_album_favorites', label: 'Save Album Favorites',
        data: { entity_id: ENTITY, ids: 'al1' }
    },
    {
        name: 'removeAlbumFavorites', args: ['al1,al2'], service: 'remove_album_favorites', label: 'Remove Album Favorites',
        data: { entity_id: ENTITY, ids: 'al1,al2' }
    },
    {
        name: 'changePlaylistDetails', args: ['pl1', { name: 'N' }], service: 'playlist_change', label: 'Change Playlist Details',
        data: { entity_id: ENTITY, playlist_id: 'pl1', name: 'N', description: '', public: true, collaborative: false }
    },
    {
        name: 'changePlaylistDetails',
        args: ['pl1', { name: 'N', description: 'D', isPublic: true, collaborative: true }],
        service: 'playlist_change', label: 'Change Playlist Details',
        data: { entity_id: ENTITY, playlist_id: 'pl1', name: 'N', description: 'D', public: false, collaborative: true }
    },
    {
        name: 'changePlaylistDetails',
        args: ['pl1', { name: 'N', isPublic: false }],
        service: 'playlist_change', label: 'Change Playlist Details',
        data: { entity_id: ENTITY, playlist_id: 'pl1', name: 'N', description: '', public: false, collaborative: false }
    }
];

for (const c of COMMANDS) {
    const tag = `${c.name}(${JSON.stringify(c.args)})`;

    test(`${tag} makes exactly one spotifyplus callService and returns { success: true }`, async (t) => {
        const con = captureConsole(t);
        const { api, calls } = makeApi({ svc: () => ({ ignored: true }) });
        const res = await api[c.name](...c.args);
        assert.deepEqual(res, { success: true });
        assert.deepEqual(calls, [['callService', 'spotifyplus', c.service, c.data]]);
        // Key order is part of the payload HA receives; keep it stable too.
        assert.deepEqual(Object.keys(calls[0][3]), Object.keys(c.data));
        assert.deepEqual(con.errors(), []);
        assert.deepEqual(con.warns(), []);
    });

    test(`${tag} on failure logs one console.error and returns { success: false, error }`, async (t) => {
        const con = captureConsole(t);
        const err = haError('nope');
        const { api, calls } = makeApi({ svc: failWith(err) });
        const res = await api[c.name](...c.args);
        assert.equal(res.success, false);
        assert.equal(res.error, err);
        assert.deepEqual(Object.keys(res), ['success', 'error']);
        assert.equal(calls.length, 1);
        assert.deepEqual(con.errors(), [[`${c.label} failed:`, err]]);
        assert.deepEqual(con.warns(), []);
    });

    test(`${tag} without hass returns early and calls nothing`, async () => {
        const { api, calls } = makeApi();
        api.hass = null;
        assert.deepEqual(await api[c.name](...c.args), c.name === 'changePlaylistDetails'
            ? { success: false, error: new Error('Playlist id and name are required') }
            : { success: false });
        assert.equal(calls.length, 0);
    });
}

test('command wrappers bail out on a missing id with no call', async () => {
    const { api, calls } = makeApi();
    for (const name of ['followPlaylist', 'unfollowPlaylist', 'followArtist', 'unfollowArtist',
        'saveTrackFavorites', 'removeTrackFavorites', 'saveAlbumFavorites', 'removeAlbumFavorites']) {
        for (const bad of [undefined, null, '']) {
            assert.deepEqual(await api[name](bad), { success: false }, `${name}(${bad})`);
        }
    }
    const r1 = await api.changePlaylistDetails('', { name: 'N' });
    const r2 = await api.changePlaylistDetails('pl1', { name: '' });
    for (const r of [r1, r2]) {
        assert.equal(r.success, false);
        assert.ok(r.error instanceof Error);
        assert.equal(r.error.message, 'Playlist id and name are required');
    }
    assert.equal(calls.length, 0);
});

test('an empty id array is not a missing id: the call goes out with ids ""', async () => {
    const { api, calls } = makeApi();
    assert.deepEqual(await api.saveTrackFavorites([]), { success: true });
    assert.deepEqual(calls, [['callService', 'spotifyplus', 'save_track_favorites', { entity_id: ENTITY, ids: '' }]]);
});

test('an id list that cannot be joined still resolves to { success: false } with a console.error', async (t) => {
    const con = captureConsole(t);
    const { api, calls } = makeApi();
    const res = await api.followArtist([Symbol('x')]);
    assert.equal(res.success, false);
    assert.ok(res.error instanceof TypeError);
    assert.equal(calls.length, 0);
    assert.equal(con.errors().length, 1);
    assert.equal(con.errors()[0][0], 'Follow Artist failed:');
});

// ---------------------------------------------------------------------------
// Check wrappers (callWS check_* with return_response)
// ---------------------------------------------------------------------------

function checkPayload(service, ids) {
    return {
        type: 'call_service', domain: 'spotifyplus', service,
        service_data: { entity_id: ENTITY, ids }, return_response: true
    };
}

// [label, ids argument, ids sent, ws reply, expected result]
const SIMPLE_CHECK_CASES = [
    ['single id, dict keyed by id (true)', 'x1', 'x1', { response: { result: { x1: true } } }, true],
    ['single id, dict keyed by id (false)', 'x1', 'x1', { response: { result: { x1: false } } }, false],
    ['single id, dict not keyed by it', 'x1', 'x1', { response: { result: { other: true } } }, undefined],
    ['single id, list of booleans', 'x1', 'x1', { response: { result: [true] } }, undefined],
    ['single id, empty dict', 'x1', 'x1', { response: { result: {} } }, undefined],
    ['single id, JSON string result', 'x1', 'x1', { response: { result: '{"x1":true}' } }, undefined],
    ['single id, string "true" value', 'x1', 'x1', { response: { result: { x1: 'true' } } }, 'true'],
    ['single id in an array, dict', ['x1'], 'x1', { response: { result: { x1: true } } }, { x1: true }],
    ['two ids, dict', ['x1', 'x2'], 'x1,x2', { response: { result: { x1: true, x2: false } } }, { x1: true, x2: false }],
    ['two ids, list', ['x1', 'x2'], 'x1,x2', { response: { result: [true, false] } }, [true, false]],
    ['comma string, dict', 'x1,x2', 'x1,x2', { response: { result: { x1: true } } }, { x1: true }],
    ['two ids, JSON string', ['x1', 'x2'], 'x1,x2', { response: { result: '[true]' } }, '[true]'],
    ['result false', 'x1', 'x1', { response: { result: false } }, null],
    ['result null', 'x1', 'x1', { response: { result: null } }, null],
    ['result 0', ['x1', 'x2'], 'x1,x2', { response: { result: 0 } }, null],
    ['no result key', 'x1', 'x1', { response: { other: 1 } }, null],
    ['empty response (whole ws reply returned)', 'x1', 'x1', { response: null }, null],
    ['ws reply with result at top level', 'x1', 'x1', { result: { x1: true } }, true],
    ['empty array input', [], '', { response: { result: { a: true } } }, { a: true }]
];

const SIMPLE_CHECKS = [
    { name: 'checkArtistsFollowing', service: 'check_artists_following', label: 'Check Artists Following' },
    { name: 'checkAlbumFavorites', service: 'check_album_favorites', label: 'Check Album Favorites' }
];

for (const m of SIMPLE_CHECKS) {
    for (const [label, ids, sent, reply, expected] of SIMPLE_CHECK_CASES) {
        test(`${m.name}: ${label}`, async (t) => {
            const con = captureConsole(t);
            const { api, calls } = makeApi({ ws: () => reply });
            const res = await api[m.name](ids);
            assert.deepEqual(res, expected);
            assert.deepEqual(calls, [['callWS', checkPayload(m.service, sent)]]);
            assert.deepEqual(con.errors(), []);
            assert.deepEqual(con.warns(), []);
        });
    }

    test(`${m.name}: missing ids or hass returns null with no call`, async () => {
        const { api, calls } = makeApi();
        for (const bad of [undefined, null, '']) assert.equal(await api[m.name](bad), null);
        api.hass = null;
        assert.equal(await api[m.name]('x1'), null);
        assert.equal(calls.length, 0);
    });

    test(`${m.name}: a failed call warns once (via fetchSpotifyPlus) and returns null`, async (t) => {
        const con = captureConsole(t);
        const err = haError('down');
        const { api, calls } = makeApi({ ws: failWith(err) });
        assert.equal(await api[m.name](['x1', 'x2']), null);
        assert.equal(calls.length, 1);
        assert.deepEqual(con.errors(), []);
        assert.deepEqual(con.warns(), [[`[SpotifyAPI] Failed Call [${m.service}]:`, JSON.stringify(err, null, 2)]]);
    });

    test(`${m.name}: a non-string, non-array id that gets a result logs console.error and returns null`, async (t) => {
        const con = captureConsole(t);
        const { api, calls } = makeApi({ ws: () => ({ response: { result: { 5: true } } }) });
        assert.equal(await api[m.name](5), null);
        assert.deepEqual(calls, [['callWS', checkPayload(m.service, 5)]]);
        assert.equal(con.errors().length, 1);
        assert.equal(con.errors()[0][0], `${m.label} failed:`);
        assert.ok(con.errors()[0][1] instanceof TypeError);
    });
}

const TRACK_CHECK_CASES = [
    ['single id, dict', 't1', 't1', { response: { result: { t1: true } } }, true],
    ['single id, dict false', 't1', 't1', { response: { result: { t1: false } } }, false],
    ['single id, dict "true" string', 't1', 't1', { response: { result: { t1: 'true' } } }, true],
    ['single id, list', 't1', 't1', { response: { result: [true] } }, true],
    ['single id, boolean', 't1', 't1', { response: { result: true } }, true],
    ['single id, boolean false', 't1', 't1', { response: { result: false } }, false],
    ['single id, dict not keyed (falls back to order)', 't1', 't1', { response: { result: { zzz: true } } }, true],
    ['single id, JSON string list', 't1', 't1', { response: { result: '[true]' } }, true],
    ['single id, unparsable string', 't1', 't1', { response: { result: 'garbage' } }, false],
    ['single id, number', 't1', 't1', { response: { result: 7 } }, false],
    ['single id, result null (whole response used)', 't1', 't1', { response: { result: null } }, false],
    ['single id, response null (whole ws reply used)', 't1', 't1', { response: null }, false],
    ['single id, response without result', 't1', 't1', { response: { t1: true } }, true],
    ['single in array, dict', ['t1'], 't1', { response: { result: { t1: true } } }, { t1: true }],
    ['two ids, list', ['t1', 't2'], 't1,t2', { response: { result: [true, 'false'] } }, { t1: true, t2: false }],
    ['two ids, list short', ['t1', 't2'], 't1,t2', { response: { result: [true] } }, { t1: true, t2: false }],
    ['two ids, dict', ['t1', 't2'], 't1,t2', { response: { result: { t1: true, t2: false } } }, { t1: true, t2: false }],
    ['two ids, partial dict', ['t1', 't2'], 't1,t2', { response: { result: { t2: 'true' } } }, { t2: true }],
    ['two ids, unkeyed dict', ['t1', 't2'], 't1,t2', { response: { result: { a: false, b: true } } }, { t1: false, t2: true }],
    ['two ids, boolean', ['t1', 't2'], 't1,t2', { response: { result: true } }, { t1: true }],
    ['two ids, JSON string dict', ['t1', 't2'], 't1,t2', { response: { result: '{"t1":true}' } }, { t1: true }],
    ['comma string, list', 't1,t2', 't1,t2', { response: { result: [false, true] } }, { t1: false, t2: true }],
    ['empty array input, list', [], '', { response: { result: [true] } }, {}],
    ['empty array input, dict', [], '', { response: { result: { a: true } } }, { a: true }]
];

for (const [label, ids, sent, reply, expected] of TRACK_CHECK_CASES) {
    test(`checkTrackFavorites: ${label}`, async (t) => {
        const con = captureConsole(t);
        const { api, calls } = makeApi({ ws: () => reply });
        assert.deepEqual(await api.checkTrackFavorites(ids), expected);
        assert.deepEqual(calls, [['callWS', checkPayload('check_track_favorites', sent)]]);
        assert.deepEqual(con.errors(), []);
        assert.deepEqual(con.warns(), []);
    });
}

test('checkTrackFavorites: missing ids or hass returns null with no call', async () => {
    const { api, calls } = makeApi();
    for (const bad of [undefined, null, '']) assert.equal(await api.checkTrackFavorites(bad), null);
    api.hass = null;
    assert.equal(await api.checkTrackFavorites('t1'), null);
    assert.equal(calls.length, 0);
});

test('checkTrackFavorites: a failed call warns once and returns null', async (t) => {
    const con = captureConsole(t);
    const err = haError('down');
    const { api } = makeApi({ ws: failWith(err) });
    assert.equal(await api.checkTrackFavorites(['t1', 't2']), null);
    assert.deepEqual(con.errors(), []);
    assert.deepEqual(con.warns(), [['[SpotifyAPI] Failed Call [check_track_favorites]:', JSON.stringify(err, null, 2)]]);
});

test('checkUserFollowsPlaylist: payload, values of the result, null otherwise', async (t) => {
    const con = captureConsole(t);
    const { api, calls } = makeApi({ ws: () => ({ response: { result: { u1: true, u2: false } } }) });
    assert.deepEqual(await api.checkUserFollowsPlaylist('pl1', ['u1', 'u2']), [true, false]);
    assert.deepEqual(calls, [['callWS', {
        type: 'call_service', domain: 'spotifyplus', service: 'check_playlist_followers',
        service_data: { entity_id: ENTITY, playlist_id: 'pl1', user_ids: 'u1,u2' }, return_response: true
    }]]);
    const { api: api2 } = makeApi({ ws: () => ({ response: { result: null } }) });
    assert.equal(await api2.checkUserFollowsPlaylist('pl1', 'u1'), null);
    const { api: api3 } = makeApi();
    assert.equal(await api3.checkUserFollowsPlaylist('pl1', ''), null);
    assert.equal(await api3.checkUserFollowsPlaylist('', 'u1'), null);
    assert.deepEqual(con.errors(), []);
});

// ---------------------------------------------------------------------------
// Playlist items (uri normalisation + chunking + snapshot threading)
// ---------------------------------------------------------------------------

function itemsPayload(service, data) {
    return {
        type: 'call_service', domain: 'spotifyplus', service,
        service_data: { entity_id: ENTITY, ...data }, return_response: true
    };
}

const MISSING_URIS = 'Playlist id and track URIs are required';

for (const [name, extra] of [['addPlaylistItems', []], ['removePlaylistItems', []], ['replacePlaylistItems', []]]) {
    test(`${name}: empty / blank / missing input bails out with the same error and no call`, async () => {
        const { api, calls } = makeApi();
        const results = [
            await api[name]('pl1', [], ...extra),
            await api[name]('pl1', [null, '', undefined], ...extra),
            await api[name]('pl1', '', ...extra),
            await api[name]('pl1', null, ...extra),
            await api[name]('', ['spotify:track:a'], ...extra)
        ];
        api.hass = null;
        results.push(await api[name]('pl1', ['spotify:track:a'], ...extra));
        for (const r of results) {
            assert.deepEqual(Object.keys(r), ['success', 'error']);
            assert.equal(r.success, false);
            assert.ok(r.error instanceof Error);
            assert.equal(r.error.message, MISSING_URIS);
        }
        assert.equal(calls.length, 0);
    });
}

test('addPlaylistItems: single uri string, blanks dropped, snapshot from a string result', async () => {
    const { api, calls } = makeApi({ ws: () => ({ response: { result: 'snap1' } }) });
    assert.deepEqual(await api.addPlaylistItems('pl1', 'spotify:track:a'), { success: true, snapshotId: 'snap1' });
    assert.deepEqual(await api.addPlaylistItems('pl1', ['spotify:track:a', '', 'spotify:track:b'], 3),
        { success: true, snapshotId: 'snap1' });
    assert.deepEqual(calls.map(c => c[1]), [
        itemsPayload('playlist_items_add', { playlist_id: 'pl1', uris: 'spotify:track:a' }),
        itemsPayload('playlist_items_add', { playlist_id: 'pl1', uris: 'spotify:track:a,spotify:track:b', position: 3 })
    ]);
});

test('addPlaylistItems: chunks of 100 with positions advanced; non-string result keeps snapshot null', async () => {
    const uris = Array.from({ length: 205 }, (_, i) => `spotify:track:${i}`);
    const { api, calls } = makeApi({ ws: () => ({ response: { result: { not: 'a string' } } }) });
    assert.deepEqual(await api.addPlaylistItems('pl1', uris, 0), { success: true, snapshotId: null });
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map(c => c[1].service_data.position), [0, 100, 200]);
    assert.deepEqual(calls.map(c => c[1].service_data.uris.split(',').length), [100, 100, 5]);
    // Non-integer position is ignored.
    const { api: api2, calls: calls2 } = makeApi();
    await api2.addPlaylistItems('pl1', ['spotify:track:a'], 1.5);
    assert.equal('position' in calls2[0][1].service_data, false);
});

test('addPlaylistItems: a failure throws through fetchSpotifyPlus (no warn) and is logged as console.error', async (t) => {
    const con = captureConsole(t);
    const err = haError('bad uri');
    const { api } = makeApi({ ws: failWith(err) });
    const res = await api.addPlaylistItems('pl1', ['spotify:track:a']);
    assert.deepEqual(res, { success: false, error: err });
    assert.deepEqual(con.errors(), [['Add Playlist Items failed:', err]]);
    assert.deepEqual(con.warns(), []);
});

test('removePlaylistItems: snapshot id threaded between chunks', async () => {
    const uris = Array.from({ length: 150 }, (_, i) => `spotify:track:${i}`);
    let n = 0;
    const { api, calls } = makeApi({ ws: () => ({ response: { result: `snap${++n}` } }) });
    assert.deepEqual(await api.removePlaylistItems('pl1', uris, 'snap0'), { success: true, snapshotId: 'snap2' });
    assert.deepEqual(calls.map(c => c[1].service_data.snapshot_id), ['snap0', 'snap1']);
    assert.equal(calls[0][1].service, 'playlist_items_remove');
    assert.equal(calls[0][1].return_response, true);

    const { api: api2, calls: calls2 } = makeApi({ ws: () => ({ response: { result: 5 } }) });
    assert.deepEqual(await api2.removePlaylistItems('pl1', 'spotify:track:a'), { success: true, snapshotId: null });
    assert.deepEqual(calls2[0][1].service_data, { entity_id: ENTITY, playlist_id: 'pl1', uris: 'spotify:track:a' });
});

test('removePlaylistItems: failure is logged as console.error', async (t) => {
    const con = captureConsole(t);
    const err = haError('x');
    const { api } = makeApi({ ws: failWith(err) });
    assert.deepEqual(await api.removePlaylistItems('pl1', ['spotify:track:a']), { success: false, error: err });
    assert.deepEqual(con.errors(), [['Remove Playlist Items failed:', err]]);
    assert.deepEqual(con.warns(), []);
});

test('replacePlaylistItems: one call, >100 rejected, failure logged', async (t) => {
    const con = captureConsole(t);
    const { api, calls } = makeApi({ ws: () => ({ response: { result: 'snapR' } }) });
    assert.deepEqual(await api.replacePlaylistItems('pl1', ['spotify:track:a', null, 'spotify:track:b']),
        { success: true, snapshotId: 'snapR' });
    assert.deepEqual(calls.map(c => c[1]), [
        itemsPayload('playlist_items_replace', { playlist_id: 'pl1', uris: 'spotify:track:a,spotify:track:b' })
    ]);

    const tooMany = await api.replacePlaylistItems('pl1', Array.from({ length: 101 }, (_, i) => `u${i}`));
    assert.equal(tooMany.success, false);
    assert.equal(tooMany.error.message, 'playlist_items_replace is limited to 100 tracks');
    assert.equal(calls.length, 1);

    const err = haError('x');
    const { api: api2 } = makeApi({ ws: failWith(err) });
    assert.deepEqual(await api2.replacePlaylistItems('pl1', 'spotify:track:a'), { success: false, error: err });
    assert.deepEqual(con.errors(), [['Replace Playlist Items failed:', err]]);
    assert.deepEqual(con.warns(), []);
});

test('reorderPlaylistItems: payload, snapshot, failure', async (t) => {
    const con = captureConsole(t);
    const { api, calls } = makeApi({ ws: () => ({ response: { result: 'snapO' } }) });
    assert.deepEqual(await api.reorderPlaylistItems('pl1', 3, 1, 2, 'snapI'), { success: true, snapshotId: 'snapO' });
    assert.deepEqual(calls[0][1], itemsPayload('playlist_items_reorder', {
        playlist_id: 'pl1', range_start: 3, insert_before: 1, range_length: 2, snapshot_id: 'snapI'
    }));
    const err = haError('x');
    const { api: api2 } = makeApi({ ws: failWith(err) });
    assert.deepEqual(await api2.reorderPlaylistItems('pl1', 1, 2), { success: false, error: err });
    assert.deepEqual(con.errors(), [['Reorder Playlist Items failed:', err]]);
    assert.deepEqual(con.warns(), []);
});

test('createPlaylist: payload, playlist result, failure', async (t) => {
    const con = captureConsole(t);
    const { api, calls } = makeApi({ ws: () => ({ response: { result: { id: 'new' } } }) });
    assert.deepEqual(await api.createPlaylist({ name: 'N', collaborative: true }), { success: true, playlist: { id: 'new' } });
    assert.deepEqual(calls[0][1], itemsPayload('playlist_create', {
        name: 'N', description: '', public: false, collaborative: true
    }));
    const err = haError('x');
    const { api: api2 } = makeApi({ ws: failWith(err) });
    assert.deepEqual(await api2.createPlaylist({ name: 'N' }), { success: false, error: err });
    assert.deepEqual(con.errors(), [['Create Playlist failed:', err]]);
    assert.deepEqual(con.warns(), []);
});

// ---------------------------------------------------------------------------
// The flags every internal fetchSpotifyPlus call site resolves to
// ---------------------------------------------------------------------------

const FLAGS = (expectResponse, logError, throwOnError) => ({ expectResponse, logError, throwOnError });

test('internal call sites: flags reaching the transport', async () => {
    const states = { [ENTITY]: { state: 'playing', attributes: { media_title: 'Song' } } };
    const { api } = makeApi({ states });
    api.triggerScan = () => {};
    const seen = spyTransport(api, () => ({ result: 'snap', user_profile: { id: 'me' } }));
    const flags = () => seen.map(s => [s.service, s.expectResponse, s.logError, s.throwOnError]);

    await api.playMedia('spotify:playlist:p', 'playlist');
    await api.playMedia('spotify:collection', 'likedsongs');
    await api.playMedia(['spotify:track:1'], 'track');
    await api.transferPlayback({ id: 'dev1' }, { play: false });
    await api.addToQueue('spotify:track:q');
    await api.getCurrentUserProfile();
    await api.checkUserFollowsPlaylist('pl1', 'u1');
    await api.createPlaylist({ name: 'N' });
    await api.addPlaylistItems('pl1', ['u']);
    await api.removePlaylistItems('pl1', ['u']);
    await api.reorderPlaylistItems('pl1', 1, 2);
    await api.replacePlaylistItems('pl1', ['u']);
    await api.checkArtistsFollowing('a');
    await api.checkTrackFavorites('t');
    await api.checkAlbumFavorites('al');

    assert.deepEqual(flags(), [
        ['player_media_play_context', false, true, true],
        ['player_media_play_track_favorites', false, true, true],
        ['player_media_play_tracks', false, true, true],
        ['player_transfer_playback', false, true, true],
        ['add_player_queue_items', false, true, false],
        ['get_playlist_favorites', true, true, false],
        ['check_playlist_followers', true, true, false],
        ['playlist_create', true, true, true],
        ['playlist_items_add', true, true, true],
        ['playlist_items_remove', true, true, true],
        ['playlist_items_reorder', true, true, true],
        ['playlist_items_replace', true, true, true],
        ['check_artists_following', true, true, false],
        ['check_track_favorites', true, true, false],
        ['check_album_favorites', true, true, false]
    ]);
    assert.deepEqual(seen[0].params, { context_uri: 'spotify:playlist:p' });
    assert.deepEqual(seen[1].params, { shuffle: true });
    assert.deepEqual(seen[2].params, { uris: 'spotify:track:1' });
    assert.deepEqual(seen[3].params, { device_id: 'dev1', play: false });
    assert.deepEqual(seen[4].params, { uris: 'spotify:track:q' });
    assert.deepEqual(seen[5].params, { limit_total: 1 });
});

test('_playSonosLocal: Liked Songs collection loads favorites with expectResponse=false', async () => {
    const { api } = makeApi();
    api.triggerScan = () => {};
    api.sonosBridge = { jumpWhenLoaded: () => {} };
    const seen = spyTransport(api);
    assert.equal(await api._playSonosLocal('media_player.sonos', 'spotify:user:me:collection', 0, null), true);
    assert.deepEqual(seen, [{
        service: 'player_media_play_track_favorites', params: { shuffle: false },
        ...FLAGS(false, true, false)
    }]);
});

// ---------------------------------------------------------------------------
// fetchSpotifyPlus: positional flags
// ---------------------------------------------------------------------------

// Run one fetchSpotifyPlus call against a fresh api and record everything
// observable about it.
async function observe(t, { service = 'get_playlist', reply, fail }, args) {
    const error = t.mock.method(console, 'error', () => {});
    const warn = t.mock.method(console, 'warn', () => {});
    const err = fail ? haError(fail) : null;
    const { api, calls } = makeApi({ ws: err ? failWith(err) : () => reply });
    let value, thrown = null;
    try {
        value = await api.fetchSpotifyPlus(service, { playlist_id: 'p' }, ...args);
    } catch (e) { thrown = e === err ? 'the HA error' : e; }
    const out = {
        value, thrown,
        calls: calls.map(c => c[1]),
        errors: error.mock.calls.map(c => c.arguments),
        warns: warn.mock.calls.map(c => c.arguments)
    };
    error.mock.restore();
    warn.mock.restore();
    return out;
}

const OK = { response: { result: { id: 'p' } } };

test('fetchSpotifyPlus positional: defaults ask for a response and return response.response', async (t) => {
    const o = await observe(t, { reply: OK }, []);
    assert.deepEqual(o.value, { result: { id: 'p' } });
    assert.equal(o.calls[0].return_response, true);
    assert.deepEqual(o.calls[0].service_data, { entity_id: ENTITY, playlist_id: 'p' });
});

test('fetchSpotifyPlus positional: expectResponse=false omits return_response and returns true', async (t) => {
    const o = await observe(t, { reply: OK }, [false]);
    assert.equal(o.value, true);
    assert.equal('return_response' in o.calls[0], false);
});

test('fetchSpotifyPlus positional: failure warns and returns null by default', async (t) => {
    const o = await observe(t, { fail: 'x' }, []);
    assert.equal(o.value, null);
    assert.equal(o.thrown, null);
    assert.equal(o.warns.length, 1);
    assert.equal(o.warns[0][0], '[SpotifyAPI] Failed Call [get_playlist]:');
});

test('fetchSpotifyPlus positional: logError=false is quiet; throwOnError=true throws without warning', async (t) => {
    const quiet = await observe(t, { fail: 'x' }, [true, false]);
    assert.deepEqual([quiet.value, quiet.thrown, quiet.warns], [null, null, []]);
    const loud = await observe(t, { fail: 'x' }, [true, true, true]);
    assert.deepEqual([loud.value, loud.thrown, loud.warns], [undefined, 'the HA error', []]);
});

test('fetchSpotifyPlus positional: null / undefined third argument', async (t) => {
    const asNull = await observe(t, { reply: OK }, [null]);
    assert.equal(asNull.value, true);
    assert.equal('return_response' in asNull.calls[0], false);
    const asUndef = await observe(t, { reply: OK }, [undefined, undefined, undefined]);
    assert.deepEqual(asUndef.value, { result: { id: 'p' } });
});

test('fetchSpotifyPlus positional: cached read services honour the flags too', async (t) => {
    const cached = await observe(t, { service: 'get_artist', fail: 'x' }, [true, true, true]);
    assert.equal(cached.thrown, 'the HA error');
    const uncached = await observe(t, { service: 'get_artist', reply: OK }, [false]);
    assert.equal(uncached.value, true);
    assert.equal('return_response' in uncached.calls[0], false);
});

// ---------------------------------------------------------------------------
// fetchSpotifyPlus: the options-object form (added with the refactor) must
// behave exactly like the positional form it stands for.
// ---------------------------------------------------------------------------

const FORMS = [
    [[], [{}]],
    [[true], [{ expectResponse: true }]],
    [[false], [{ expectResponse: false }]],
    [[true, false], [{ logError: false }]],
    [[true, true, true], [{ throwOnError: true }]],
    [[false, true, true], [{ expectResponse: false, throwOnError: true }]],
    [[false, false, false], [{ expectResponse: false, logError: false, throwOnError: false }]],
    [[true, false, true], [{ logError: false, throwOnError: true }]],
    [[undefined, undefined, undefined], [{ expectResponse: undefined, logError: undefined, throwOnError: undefined }]]
];

for (const service of ['get_playlist', 'get_artist', 'player_media_play_tracks']) {
    for (const [positional, options] of FORMS) {
        for (const scenario of [{ reply: OK }, { reply: { response: null } }, { fail: 'x' }, { fail: 'no active Spotify player device' }]) {
            test(`fetchSpotifyPlus ${service}: ${JSON.stringify(options[0])} === positional ${JSON.stringify(positional)} (${scenario.fail ? 'fail ' + scenario.fail : 'ok'})`, async (t) => {
                const a = await observe(t, { service, ...scenario }, positional);
                const b = await observe(t, { service, ...scenario }, options);
                assert.deepEqual(b, a);
            });
        }
    }
}

test('fetchSpotifyPlus options form ignores trailing positional flags', async (t) => {
    const o = await observe(t, { fail: 'x' }, [{}, false, true]);
    assert.deepEqual([o.value, o.thrown, o.warns.length], [null, null, 1]);
});
