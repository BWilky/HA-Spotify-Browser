// <spotify-search>'s top-result follow check (B15 in docs/TODO.md): a slow
// check for an earlier search's top artist must not set the button once a
// newer search has run. The element is never connected or rendered; its
// search methods run as Lit would call them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/lit-env.js';

// The module exports nothing: take the class it registers.
const defined = new Map();
globalThis.customElements = { define: (name, cls) => defined.set(name, cls), get: (name) => defined.get(name) };
globalThis.window.matchMedia ??= () => ({ matches: false });
await import('../src/components/spotify-search.js');
const SpotifySearch = defined.get('spotify-search');

const flush = () => new Promise(r => setImmediate(r));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

/** Search results whose top (first) artist is named after the query. */
const results = (name) => ({ artists: { items: [{ id: `id-${name}`, name, uri: `spotify:artist:id-${name}` }] }, tracks: { items: [] } });

function makeSearch() {
    const checks = [];
    const api = {
        searches: [],
        async fetchSpotifyPlus(service, params) {
            api.searches.push([service, params]);
            return { result: results(params.criteria) };
        },
        checkArtistsFollowing(id) {
            const d = deferred();
            checks.push({ id, d });
            return d.promise;
        },
    };
    const el = new SpotifySearch();
    el.api = api;
    el.requestUpdate = () => {};
    return { el, api, checks };
}

async function searchFor(el, query) {
    el.search(query);
    await el._performSearch(query);
    await flush();
}

test('a follow check that lands after a newer search does not set the button', async () => {
    const { el, checks } = makeSearch();
    await searchFor(el, 'alpha');
    await searchFor(el, 'beta');
    assert.deepEqual(checks.map(c => c.id), ['id-alpha', 'id-beta']);

    checks[1].d.resolve(false);   // beta: not followed
    await flush();
    assert.equal(el._topFollow.following, false);
    checks[0].d.resolve(true);    // alpha's slow answer
    await flush();
    assert.equal(el._topFollow.following, false, 'the stale answer is dropped');
});

test('a follow check that lands after a newer search has no top artist leaves it unknown', async () => {
    const { el, api, checks } = makeSearch();
    await searchFor(el, 'alpha');
    api.fetchSpotifyPlus = async () => ({ result: { artists: { items: [] } } });
    await searchFor(el, 'zzz');
    checks[0].d.resolve(true);
    await flush();
    assert.equal(el._topFollow.following, null);
});

test('the current search still sets the button, in each answer shape', async () => {
    for (const [answer, want] of [[true, true], [false, false], [[true], true], [{ 'id-alpha': true }, true], [null, null]]) {
        const { el, checks } = makeSearch();
        await searchFor(el, 'alpha');
        checks[0].d.resolve(answer);
        await flush();
        assert.equal(el._topFollow.following, want, JSON.stringify(answer));
    }
});

test('a refresh of the same query supersedes the check in flight', async () => {
    const { el, checks } = makeSearch();
    await searchFor(el, 'alpha');
    el.refresh();
    await flush();
    assert.equal(checks.length, 2);
    checks[1].d.resolve(false);
    checks[0].d.resolve(true);
    await flush();
    assert.equal(el._topFollow.following, false);
});
