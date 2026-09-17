import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// spotify-context-view.js is a LitElement component (imports lit.js, which
// touches `document`/`customElements` at module load time), so it can't be
// imported directly under plain `node --test` the way api.js can. These
// tests instead pin down the `include_groups` value at each get_artist_albums
// call site by inspecting the source, so a future edit that changes or drops
// one is caught the same way a unit test would catch it.

const sourcePath = fileURLToPath(new URL('../components/spotify-context-view.js', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');

// Grabs the `{ ... }` params object passed as the 2nd arg of each
// `fetchPaginated('get_artist_albums', { ... }` call, in source order.
function artistAlbumsCallParams(src) {
    const calls = [];
    const callRegex = /fetchPaginated\(\s*'get_artist_albums'\s*,\s*\{/g;
    let match;
    while ((match = callRegex.exec(src)) !== null) {
        const start = callRegex.lastIndex; // just past the opening `{`
        const closeIndex = src.indexOf('}', start);
        calls.push(src.slice(start, closeIndex));
    }
    return calls;
}

// Source order: _handleLoadMore's artist-discography branch appears before
// loadPageData's artist (rail) and artist-discography (initial load) branches.
test('artist page Albums rail requests include_groups=album,single', () => {
    const calls = artistAlbumsCallParams(source);
    assert.equal(calls.length, 3, 'expected 3 get_artist_albums call sites (discography load-more, rail, discography initial load)');

    const rail = calls[1];
    assert.match(rail, /include_groups:\s*'album,single'/);
    assert.doesNotMatch(rail, /compilation|appears_on/);
});

test('full discography page requests include_groups=album,single,compilation', () => {
    const calls = artistAlbumsCallParams(source);
    const discography = calls[2];
    assert.match(discography, /include_groups:\s*'album,single,compilation'/);
    assert.doesNotMatch(discography, /appears_on/);
});

test('discography "Load More" continuation uses the same include_groups as the initial discography load', () => {
    const calls = artistAlbumsCallParams(source);
    const loadMore = calls[0];
    assert.match(loadMore, /include_groups:\s*'album,single,compilation'/);
    assert.doesNotMatch(loadMore, /appears_on/);
});
