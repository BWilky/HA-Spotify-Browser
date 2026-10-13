import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigParser } from '../config_parser.js';

const parse = (home) => ConfigParser.parse({ entity: 'media_player.x', home }).home;

test('home.pinned: true enables pins with no config items', () => {
    const home = parse({ pinned: true });
    assert.deepEqual(home.pinned, { enabled: true, scope: 'shared', items: [] });
});

test('home.pinned defaults to disabled', () => {
    assert.deepEqual(parse({}).pinned, { enabled: false, scope: 'shared', items: [] });
});

test('home.pinned.items flattens every made_for_you entry shape into {id, type, ...}', () => {
    const home = parse({
        pinned: {
            items: [
                { likedsongs: true },
                { playlists_recommended: [{ id: 'dm1', title: 'Daily Mix 1' }] },
                { playlists: ['pl1', 'pl2'] },
                'pl3',
                { id: 'al1', title: 'Top Hits', type: 'album' },
            ],
        },
    });
    assert.equal(home.pinned.enabled, true);
    assert.deepEqual(home.pinned.items, [
        { id: 'dm1', type: 'playlist', title: 'Daily Mix 1', recommended: true },
        { id: 'pl1', type: 'playlist' },
        { id: 'pl2', type: 'playlist' },
        { id: 'pl3', type: 'playlist' },
        { id: 'al1', type: 'album', title: 'Top Hits' },
    ]);
});

test('home.pinned as a bare list is treated as items', () => {
    const home = parse({ pinned: ['pl1'] });
    assert.equal(home.pinned.enabled, true);
    assert.deepEqual(home.pinned.items, [{ id: 'pl1', type: 'playlist' }]);
});

test('legacy home.made_for_you folds into pinned.items and enables pins', () => {
    const home = parse({
        pinned: false,
        made_for_you: { content: ['pl1'], pills: true },
    });
    assert.equal(home.pinned.enabled, true);
    assert.deepEqual(home.pinned.items, [{ id: 'pl1', type: 'playlist' }]);
    assert.equal('made_for_you' in home, false);
});

test('legacy made_for_you items come after explicit pinned.items', () => {
    const home = parse({
        pinned: { items: ['a'] },
        made_for_you: ['b'],
    });
    assert.deepEqual(home.pinned.items.map(i => i.id), ['a', 'b']);
});

test('default sort has no made_for_you section', () => {
    assert.deepEqual(parse({}).sort, ['pinned', 'recent', 'favorites', 'artists', 'albums']);
});

test('sort token made_for_you is dropped, keeping the rest of the order', () => {
    const home = parse({ sort: ['recently_played', 'made_for_you', 'pinned'] });
    assert.deepEqual(home.sort, ['recent', 'pinned']);
});

test('home.pinned.scope defaults to shared and accepts account', () => {
    assert.equal(parse({ pinned: true }).pinned.scope, 'shared');
    assert.equal(parse({ pinned: { scope: 'account' } }).pinned.scope, 'account');
    assert.equal(parse({ pinned: { scope: 'bogus' } }).pinned.scope, 'shared');
});

test('accounts[].pinned is flattened like home.pinned.items', () => {
    const cfg = ConfigParser.parse({
        accounts: [
            { entity: 'media_player.a', name: 'A', pinned: ['pl1', { playlists_recommended: [{ id: 'dm', title: 'Daily Mix' }] }] },
            { entity: 'media_player.b', name: 'B' },
        ],
    });
    assert.deepEqual(cfg.accounts[0].pinned, [
        { id: 'pl1', type: 'playlist' },
        { id: 'dm', type: 'playlist', title: 'Daily Mix', recommended: true },
    ]);
    assert.deepEqual(cfg.accounts[1].pinned, []);
});

test('accounts[].pinned also accepts the {items: [...]} object form', () => {
    const cfg = ConfigParser.parse({ accounts: [{ entity: 'media_player.a', pinned: { items: ['pl1'] } }] });
    assert.deepEqual(cfg.accounts[0].pinned, [{ id: 'pl1', type: 'playlist' }]);
});
