import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    HeroScrollController, fixedHeaderFade, heroHeightHeaderFade, HERO_PAGE_CLASS
} from '../src/components/controllers/hero-scroll-controller.js';

/*
 * Reference formulas, copied verbatim from the views before the header logic
 * moved into HeroScrollController. The controller's pure functions must give
 * bit-identical results (Object.is, so -0 vs 0 counts) at every scroll offset.
 */
function refPlaylistDesktop(scrollTop) {
    const alpha = Math.min(scrollTop / 200, 1);
    const textAlpha = Math.max(0, Math.min((scrollTop - 220) / 60, 1));
    return { alpha, textAlpha };
}
function refPlaylistMobile(scrollTop, heroHeight) {
    const fadeEnd = Math.max(heroHeight - 100, 1); // ~header height below the hero
    const fadeStart = Math.max(fadeEnd - 80, 0);
    const alpha = Math.max(0, Math.min((scrollTop - fadeStart) / (fadeEnd - fadeStart), 1));
    const textAlpha = Math.max(0, Math.min((scrollTop - fadeEnd) / 50, 1));
    return { alpha, textAlpha };
}
function refArtist(scrollTop) {
    const fadeEnd = 200; // Pixel value where header becomes fully opaque
    let alpha = Math.min(1, scrollTop / fadeEnd);
    let textAlpha = 0;
    if (scrollTop > fadeEnd - 50) {
        textAlpha = Math.min(1, (scrollTop - (fadeEnd - 50)) / 50);
    }
    return { alpha, textAlpha };
}

const PLAYLIST_FADE = { textStart: 220, textSpan: 60 };
const ARTIST_FADE = { textStart: 150, textSpan: 50 };

function scrollOffsets() {
    const out = [-0, 0, 1e-9, -1e-9, 149.999, 150, 150.0001, 199.5, 200, 200.5, 219.99, 220, 220.01, 279.9, 280, 900, 5000];
    for (let s = -400; s <= 1500; s += 0.25) out.push(s);
    for (let s = 0; s <= 400; s += 1 / 3) out.push(s);
    return out;
}
const HERO_HEIGHTS = [0, 1, 50, 80, 99, 100, 101, 150, 180, 181, 200, 300, 375, 512, 640, 1000];

function assertSame(actual, expected, where) {
    assert.ok(Object.is(actual.alpha, expected.alpha), `alpha ${actual.alpha} !== ${expected.alpha} at ${where}`);
    assert.ok(Object.is(actual.textAlpha, expected.textAlpha), `textAlpha ${actual.textAlpha} !== ${expected.textAlpha} at ${where}`);
}

test('fixedHeaderFade matches the playlist view\'s desktop formula at every offset', () => {
    for (const s of scrollOffsets()) assertSame(fixedHeaderFade(s, PLAYLIST_FADE), refPlaylistDesktop(s), s);
});

test('fixedHeaderFade matches the artist view\'s formula at every offset', () => {
    for (const s of scrollOffsets()) assertSame(fixedHeaderFade(s, ARTIST_FADE), refArtist(s), s);
});

test('heroHeightHeaderFade matches the playlist view\'s mobile formula for every hero height', () => {
    for (const h of HERO_HEIGHTS) {
        for (const s of scrollOffsets()) assertSame(heroHeightHeaderFade(s, h), refPlaylistMobile(s, h), `${s} / hero ${h}`);
    }
});

test('known points: opaque + titled when scrolled far, transparent at the top, unclamped on over-scroll', () => {
    assert.deepEqual(fixedHeaderFade(900, PLAYLIST_FADE), { alpha: 1, textAlpha: 1 });
    assert.deepEqual(fixedHeaderFade(0, PLAYLIST_FADE), { alpha: 0, textAlpha: 0 });
    assert.deepEqual(fixedHeaderFade(100, ARTIST_FADE), { alpha: 0.5, textAlpha: 0 });
    assert.deepEqual(fixedHeaderFade(175, ARTIST_FADE), { alpha: 0.875, textAlpha: 0.5 });
    assert.equal(fixedHeaderFade(-50, PLAYLIST_FADE).alpha, -0.25, 'negative while rubber-banding, as before');
    // Mobile: a 600px hero fades the header in over [420, 500], the title over [500, 550].
    assert.deepEqual(heroHeightHeaderFade(460, 600), { alpha: 0.5, textAlpha: 0 });
    assert.deepEqual(heroHeightHeaderFade(525, 600), { alpha: 1, textAlpha: 0.5 });
    assert.deepEqual(heroHeightHeaderFade(-30, 600), { alpha: 0, textAlpha: 0 });
});

/* --- Controller, against a minimal fake DOM --- */

function makeEl(props = {}) {
    return { isConnected: true, style: {}, ...props };
}

function makeContainer({ scrollTop = 0, clientHeight = 800, scrollHeight = 4000, hero = true, visible = true } = {}) {
    const classes = new Set(['main-scroll-container', ...(hero ? [HERO_PAGE_CLASS] : [])]);
    return makeEl({
        scrollTop, clientHeight, scrollHeight,
        classList: { contains: (c) => classes.has(c) },
        visible,
        getClientRects() { return { length: this.visible ? 1 : 0 }; },
    });
}

function setup(t, options = {}, { mobile = false, dom = {} } = {}) {
    const frames = new Map();
    let nextFrame = 1;
    globalThis.requestAnimationFrame = (cb) => { const id = nextFrame++; frames.set(id, cb); return id; };
    globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
    globalThis.window = { matchMedia: (q) => ({ media: q, matches: mobile }) };
    t.after(() => { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; delete globalThis.window; });
    t.mock.timers.enable({ apis: ['setTimeout'] });

    const events = [];
    const container = dom.container || makeContainer();
    const els = {
        '.main-scroll-container': container,
        '.hero-banner .hero-bg img': makeEl(),
        '.hero-content': makeEl(),
        '.hero-banner': makeEl({ offsetHeight: 600 }),
        ...dom,
    };
    const host = {
        title: 'Mix',
        controllers: [],
        shadowRoot: { querySelector: (sel) => els[sel] || null },
        addController(c) { this.controllers.push(c); },
        dispatchEvent(e) { events.push(e); return true; },
    };
    const nearBottom = [];
    const ctrl = new HeroScrollController(host, {
        getTitle: () => host.title,
        heroImage: '.hero-banner .hero-bg img',
        fade: PLAYLIST_FADE,
        onNearBottom: () => nearBottom.push(true),
        ...options,
    });
    const flush = () => { const cbs = [...frames.values()]; frames.clear(); cbs.forEach(cb => cb()); };
    const scroll = (top) => { container.scrollTop = top; ctrl.onScroll({ currentTarget: container, target: container }); flush(); };
    const headers = () => events.filter(e => e.type === 'header-scroll');
    return { ctrl, host, els, container, events, headers, nearBottom, frames, flush, scroll, tick: (ms) => t.mock.timers.tick(ms) };
}

test('registers with the host', (t) => {
    const { ctrl, host } = setup(t);
    assert.equal(host.controllers[0], ctrl);
});

test('header-scroll: bubbling, composed, from the host, with { alpha, textAlpha, title }', (t) => {
    const { headers, scroll } = setup(t);
    scroll(250);
    const [e] = headers();
    assert.equal(e.bubbles, true);
    assert.equal(e.composed, true);
    assert.deepEqual(Object.keys(e.detail).sort(), ['alpha', 'textAlpha', 'title']);
    assert.deepEqual(e.detail, { alpha: 1, textAlpha: 0.5, title: 'Mix' });
});

test('a burst of scroll events does one frame of work', (t) => {
    const { ctrl, container, frames, flush, headers } = setup(t);
    container.scrollTop = 100;
    for (let i = 0; i < 5; i++) ctrl.onScroll({ currentTarget: container, target: container });
    assert.equal(frames.size, 1);
    flush();
    assert.equal(headers().length, 1);
});

test('dedupe: an unchanged header is not re-sent, a title change is; updateHeaderState always sends', (t) => {
    const { ctrl, host, headers, scroll } = setup(t, { dedupe: true });
    scroll(100); scroll(100);
    assert.equal(headers().length, 1, 'same position twice -> one dispatch');
    host.title = 'Renamed';
    scroll(100);
    assert.equal(headers().length, 2);
    ctrl.updateHeaderState();
    assert.equal(headers().length, 3, 'forced');
    assert.deepEqual(headers()[2].detail, { alpha: 0.5, textAlpha: 0, title: 'Renamed' });
});

test('without dedupe every frame dispatches (the artist page)', (t) => {
    const { headers, scroll } = setup(t, { fade: ARTIST_FADE });
    scroll(100); scroll(100); scroll(100);
    assert.equal(headers().length, 3);
});

test('a hidden page (no layout box) never drives the header, even when forced', (t) => {
    const { ctrl, container, headers, scroll } = setup(t, { dedupe: true });
    container.visible = false;
    scroll(300);
    ctrl.updateHeaderState();
    ctrl.syncSoon();
    assert.equal(headers().length, 0);
});

test('a container without the hero class: no header, no hero fade, no load-more (parallax still runs)', (t) => {
    const container = makeContainer({ hero: false, scrollTop: 0 });
    const { ctrl, els, headers, nearBottom, scroll } = setup(t, { heroContent: '.hero-content' }, { dom: { container } });
    scroll(-40);
    assert.equal(headers().length, 0);
    assert.equal(nearBottom.length, 0);
    assert.equal(els['.hero-content'].style.opacity, undefined);
    assert.match(els['.hero-banner .hero-bg img'].style.transform, /translateY\(-40px\)/);
    ctrl.updateHeaderState();
    assert.equal(headers().length, 0);
});

test('near-bottom: the callback runs on each frame within 200px of the end, after the header', (t) => {
    const container = makeContainer({ clientHeight: 800, scrollHeight: 2000 });
    const { events, nearBottom, scroll } = setup(t, {}, { dom: { container } });
    scroll(999);   // 999 + 800 = 1799 < 1800
    assert.equal(nearBottom.length, 0);
    scroll(1000);  // 1800 >= 1800
    scroll(1001);
    assert.equal(nearBottom.length, 2);
    assert.equal(events[events.length - 1].type, 'header-scroll', 'header dispatched before the callback ran');
});

test('parallax: over-scroll stretches the hero image; scrolling back clears it; the hero text fades and shrinks', (t) => {
    const { els, scroll } = setup(t, { heroContent: '.hero-content' });
    const img = els['.hero-banner .hero-bg img'];
    const content = els['.hero-content'];
    scroll(-75);
    assert.equal(img.style.transform, `translateY(-75px) scale(${1 + 75 / 375})`);
    assert.equal(img.style.transformOrigin, 'top center');
    scroll(100);
    assert.equal(img.style.transform, '');
    assert.equal(img.style.transformOrigin, '');
    assert.equal(content.style.opacity, 0.5);
    assert.equal(content.style.transform, 'scale(0.9)');
    scroll(300); // scale 0.7 is not applied: the last one sticks
    assert.equal(content.style.opacity, 0);
    assert.equal(content.style.transform, 'scale(0.9)');
});

test('lite profile: no parallax, header and near-bottom still run', (t) => {
    const container = makeContainer({ clientHeight: 800, scrollHeight: 900 });
    const { els, headers, nearBottom, scroll } = setup(t, { heroContent: '.hero-content', isLite: () => true }, { dom: { container } });
    scroll(-20);
    assert.equal(els['.hero-banner .hero-bg img'].style.transform, undefined);
    scroll(50);
    assert.equal(els['.hero-content'].style.opacity, undefined);
    assert.equal(headers().length, 2);
    assert.equal(nearBottom.length, 2);
});

test('mobile: the fade follows the hero banner height; without a banner it falls back to 375', (t) => {
    const { headers, scroll, els } = setup(t, { mobileFade: { query: '(max-width: 768px)', heroBanner: '.hero-banner' } }, { mobile: true });
    scroll(460); // banner 600 -> fade over [420, 500]
    assert.deepEqual(headers()[0].detail, { alpha: 0.5, textAlpha: 0, title: 'Mix' });
    els['.hero-banner'].isConnected = false;
    els['.hero-banner'] = null;
    scroll(235); // 375 -> fade over [195, 275]
    assert.deepEqual(headers()[1].detail, { alpha: 0.5, textAlpha: 0, title: 'Mix' });
});

test('mobileFade does not apply while the query does not match', (t) => {
    const { headers, scroll } = setup(t, { mobileFade: { query: '(max-width: 768px)', heroBanner: '.hero-banner' } }, { mobile: false });
    scroll(250);
    assert.deepEqual(headers()[0].detail, { ...fixedHeaderFade(250, PLAYLIST_FADE), title: 'Mix' });
});

test('detached cached elements are re-queried', (t) => {
    const { els, scroll } = setup(t);
    const first = els['.hero-banner .hero-bg img'];
    scroll(-10);
    first.isConnected = false;
    const second = makeEl();
    els['.hero-banner .hero-bg img'] = second;
    scroll(-20);
    assert.match(second.style.transform, /translateY\(-20px\)/);
    assert.match(first.style.transform, /translateY\(-10px\)/);
});

test('syncSoon dispatches after the current task; one per call', (t) => {
    const { ctrl, container, headers, tick } = setup(t, { fade: ARTIST_FADE });
    container.scrollTop = 175;
    ctrl.syncSoon(); ctrl.syncSoon();
    assert.equal(headers().length, 0);
    tick(0);
    assert.equal(headers().length, 2);
    assert.deepEqual(headers()[0].detail, { alpha: 0.875, textAlpha: 0.5, title: 'Mix' });
});

test('disconnect cancels a pending frame and pending syncs', (t) => {
    const { ctrl, container, frames, headers, tick } = setup(t);
    ctrl.onScroll({ currentTarget: container, target: container });
    ctrl.syncSoon();
    ctrl.hostDisconnected();
    assert.equal(frames.size, 0);
    tick(10);
    assert.equal(headers().length, 0);
    // A scroll after reconnecting schedules a fresh frame.
    ctrl.onScroll({ currentTarget: container, target: container });
    assert.equal(frames.size, 1);
});
