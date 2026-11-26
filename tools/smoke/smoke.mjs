// Browser smoke harness: loads a built bundle into headless Chromium against a
// stubbed Home Assistant (harness.html) and records SpotifyPlus call counts,
// per-component render counts, image sizes requested, router history and
// header state for a fixed walk through the app, on desktop and mobile.
//
// Usage: node tools/smoke/smoke.mjs <bundle.js> <outDir> [label]
//        node tools/smoke/summ.cjs <outDir>/<label>.json
// Needs `playwright` resolvable (e.g. via NODE_PATH) and a Chromium it can launch.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import path from 'node:path';
import fs from 'node:fs';
const [bundle, outDir, label = 'run'] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const browser = await chromium.launch();
const out = { label, errors: [], images: {}, phases: {} };
for (const vp of [{ name: 'desktop', width: 1400, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: vp.name === 'mobile', isMobile: vp.name === 'mobile' });
  const page = await ctx.newPage();
  const imgs = {};
  await page.route('https://img.test/**', (route) => { const m = route.request().url().match(/img\.test\/(\d+)\//); const k = m ? m[1] : '?'; imgs[k] = (imgs[k] || 0) + 1; route.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
  await page.route(/^https?:\/\/(?!img\.test)/, (route) => route.abort());
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) out.errors.push(`[${vp.name}] console: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => out.errors.push(`[${vp.name}] pageerror: ${String(e.stack || e).slice(0, 500)}`));
  await page.goto('file://' + path.join(here, 'harness.html'));
  await page.addScriptTag({ path: bundle });
  await page.waitForFunction(() => !!document.querySelector('spotify-browser-app'), null, { timeout: 15000 });
  await sleep(1500);

  const calls = () => page.evaluate(() => window.__calls.map(c => ({ kind: c.kind, service: c.service, n: c.data && c.data.ids ? String(c.data.ids).split(',').length : undefined })));
  const mark = async () => (await calls()).length;
  const since = async (from) => { const all = (await calls()).slice(from); const by = {}; let ids = 0; for (const c of all) { by[c.service] = (by[c.service] || 0) + 1; if (c.n) ids += c.n; } return { total: all.length, idsSent: ids, by }; };
  const P = (out.phases[vp.name] = {});

  // 1. Closed: boot cost, then 5 track changes with the overlay never opened.
  P.boot_closed = await since(0);
  let m = await mark();
  for (let i = 2; i <= 6; i++) { await page.evaluate((n) => window.__setHass(window.__makeHass(n)), i); await sleep(1400); }
  P.five_track_changes_closed = await since(m);

  // 2. Open → home.
  m = await mark();
  await page.evaluate(() => window.dispatchEvent(new Event('spotify-browser-open')));
  await sleep(2500);
  P.open_home = await since(m);
  await page.screenshot({ path: path.join(outDir, `${label}-${vp.name}-1-home.png`) });

  const nav = (id, data) => page.evaluate(([id, data]) => document.querySelector('spotify-browser-app').router.navigateTo(id, data), [id, data ?? null]);
  const back = () => page.evaluate(() => document.querySelector('spotify-browser-app').router.goBack());
  const cur = () => page.evaluate(() => { const r = document.querySelector('spotify-browser-app').router; return { page: r.currentPageId, history: [...r.history] }; });

  // 3. 500-track playlist page-in.
  m = await mark();
  await nav('playlist:pbig'); await sleep(4500);
  P.big_playlist = await since(m);
  P.big_playlist_rows = await page.evaluate(() => { const find = (root, sel, acc = []) => { for (const el of root.querySelectorAll('*')) { if (el.matches(sel)) acc.push(el); if (el.shadowRoot) find(el.shadowRoot, sel, acc); } return acc; }; return find(document.querySelector('spotify-browser-app').shadowRoot, '.track-row').length; });
  await page.screenshot({ path: path.join(outDir, `${label}-${vp.name}-2-playlist.png`) });


  // 3b. Phase-1 checks on the playlist page.
  const app = (fn, arg) => page.evaluate(new Function('arg', `const a = document.querySelector('spotify-browser-app'); const deep = (root, sel) => { for (const el of root.querySelectorAll('*')) { if (el.matches(sel)) return el; if (el.shadowRoot) { const r = deep(el.shadowRoot, sel); if (r) return r; } } return null; }; return (${fn})(a, deep, arg);`), arg);
  // Refresh Data menu item
  m = await mark();
  await app(`(a) => a._handleMenuItemClick({ detail: 'menu-refresh' })`); await sleep(2500);
  P.menu_refresh_on_playlist = (await since(m)).by;
  // Scroll the playlist, leave, come Back: header must be opaque + titled again.
  await app(`(a, deep) => { const v = deep(a.router.pageCache.get('playlist:pbig').shadowRoot, '.main-scroll-container'); v.scrollTop = 900; v.dispatchEvent(new Event('scroll')); }`); await sleep(400);
  P.header_scrolled = await app(`(a) => ({ alpha: a._headerAlpha, title: a._headerTitle })`);
  await nav('artist:ar2'); await sleep(1500);
  // a track change re-renders hidden cached pages; the header must stay the artist's
  await page.evaluate(() => window.__setHass(window.__makeHass(7))); await sleep(900);
  await nav('playlist:p3'); await sleep(1500);
  await page.evaluate(() => window.__setHass(window.__makeHass(8))); await sleep(900);
  P.header_on_p3_after_track_change = await app(`(a) => ({ alpha: a._headerAlpha, title: a._headerTitle })`);
  await back(); await sleep(700); await back(); await sleep(900);
  P.header_after_back_to_scrolled_playlist = { ...(await app(`(a) => ({ alpha: a._headerAlpha, title: a._headerTitle })`)), ...(await cur()) };
  if (vp.name === 'desktop') {
    await app(`(a) => { a._queueVisible = true; }`); await sleep(1200);
    P.queue_list_box = await app(`(a, deep) => { const t = deep(a.shadowRoot, 'spotify-sidebar-tracklist'); if (!t) return null; const r = t.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), rows: t.shadowRoot.querySelectorAll('.queue-item').length, pos: getComputedStyle(t).position, pe: getComputedStyle(t).pointerEvents }; }`);
    await page.screenshot({ path: path.join(outDir, `${label}-${vp.name}-2b-queue.png`) });
    await app(`(a) => { a._queueVisible = false; }`); await sleep(500);
  }

  // 5. Artist, search, library, back chain.
  m = await mark();
  await nav('artist:ar1'); await sleep(2500);
  P.artist = await since(m);
  await page.screenshot({ path: path.join(outDir, `${label}-${vp.name}-3-artist.png`) });
  await nav('search', { query: 'abc' }); await sleep(1200);
  await nav('search', { query: 'abcd' }); await sleep(1200);
  P.after_double_search = await cur();
  await back(); await sleep(600);
  P.after_one_back = await cur();
  await nav('library'); await sleep(1500);
  await page.screenshot({ path: path.join(outDir, `${label}-${vp.name}-4-library.png`) });
  await back(); await sleep(500); await back(); await sleep(500);
  P.end = await cur();



  // 5c. Mobile-only surfaces: mini-player present, open full-screen now-playing.
  if (vp.name === 'mobile') {
    P.mobile_layout = await page.evaluate(() => { const deep = (root, sel) => { for (const el of root.querySelectorAll('*')) { if (el.matches(sel)) return el; if (el.shadowRoot) { const r = deep(el.shadowRoot, sel); if (r) return r; } } return null; }; const a = document.querySelector('spotify-browser-app'); const sr = a.shadowRoot; const np = sr.querySelector('spotify-now-playing-mobile'); return { isDesktop: a._isDesktop, miniPlayer: !!deep(sr, '.mini-player-art'), nowPlayingEl: !!np }; });
    await page.evaluate(() => { const deep = (root, sel) => { for (const el of root.querySelectorAll('*')) { if (el.matches(sel)) return el; if (el.shadowRoot) { const r = deep(el.shadowRoot, sel); if (r) return r; } } return null; }; const mp = deep(document.querySelector('spotify-browser-app').shadowRoot, '.mini-player-art'); if (mp) mp.click(); });
    await sleep(1200);
    P.now_playing_open = await page.evaluate(() => { const np = document.querySelector('spotify-browser-app').shadowRoot.querySelector('spotify-now-playing-mobile'); return np ? { visible: !!np.visible, hasArt: !!np.shadowRoot.querySelector('img, [style*="background-image"]') } : null; });
    await page.screenshot({ path: path.join(outDir, `${label}-${vp.name}-5-nowplaying.png`) });
    await page.evaluate(() => { const np = document.querySelector('spotify-browser-app').shadowRoot.querySelector('spotify-now-playing-mobile'); if (np) np.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true })); });
    await sleep(600);
  }


  // 5d. Overlay gallery + secondary pages: screenshots for before/after
  // comparison, and a console-error sweep over surfaces the main walk skips.
  const shot = (name) => page.screenshot({ path: path.join(outDir, `${label}-${vp.name}-g-${name}.png`) });
  const flag = async (name, f, ms = 900) => { await page.evaluate((f) => { document.querySelector('spotify-browser-app')[f] = true; }, f); await sleep(ms); await shot(name); await page.evaluate((f) => { document.querySelector('spotify-browser-app')[f] = false; }, f); await sleep(400); };
  await page.evaluate(() => document.querySelector('spotify-browser-app')._openDevicePicker({ refresh: true })); await sleep(1500); await shot('device-picker');
  await page.evaluate(() => { document.querySelector('spotify-browser-app')._closeAllPopups(); }); await sleep(400);
  await flag('device-manager', '_deviceManagerVisible', 1500);
  await flag('reorder', '_reorderVisible');
  await flag('account', '_accountSheetVisible');
  if (vp.name === 'desktop') { await flag('queue', '_queueVisible', 1200); await flag('menu', '_menuVisible'); }
  else { await flag('connect', '_connectPanelVisible', 1200); await flag('mobile-queue', '_mobileQueueVisible', 1200); }
  await nav('playlist:p5'); await sleep(1800);
  await page.evaluate(() => { const deep = (root, sel) => { for (const el of root.querySelectorAll('*')) { if (el.matches(sel)) return el; if (el.shadowRoot) { const r = deep(el.shadowRoot, sel); if (r) return r; } } return null; }; const b = deep(document.querySelector('spotify-browser-app').shadowRoot, '.track-action-btn[data-action="menu"]'); if (b) b.click(); });
  await sleep(900); await shot('track-menu');
  await page.evaluate(() => { document.querySelector('spotify-browser-app')._closeAllPopups(); }); await sleep(400);
  await nav('section:favorites'); await sleep(1800); await shot('section');
  await nav('artist-discography:ar1', { id: 'ar1', name: 'Artist 1' }); await sleep(1800); await shot('discography');
  // Events from child views must reach the router exactly once each.
  P.child_event_delivery = await page.evaluate(async () => {
    const a = document.querySelector('spotify-browser-app'); const r = a.router; const wait = (ms) => new Promise(res => setTimeout(res, ms));
    const child = (pageId, tag) => r.pageCache.get(pageId)?.shadowRoot?.querySelector(tag);
    const out = {};
    const list = child('artist-discography:ar1', 'spotify-context-list');
    const h0 = r.history.length;
    if (list) { list.dispatchEvent(new CustomEvent('navigate', { detail: { pageId: 'album:al1', data: null }, bubbles: true, composed: true })); await wait(900); }
    out.navigate_from_discography = { hadChild: !!list, page: r.currentPageId, historyGrewBy: r.history.length - h0 };
    r.goBack(); await wait(600);
    const list2 = child('artist-discography:ar1', 'spotify-context-list');
    const h1 = r.history.length;
    if (list2) { list2.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true })); await wait(600); }
    out.back_from_discography = { hadChild: !!list2, page: r.currentPageId, historyShrankBy: h1 - r.history.length };
    const pv = child('playlist:p5', 'spotify-playlist-view');
    await r.navigateTo('playlist:p5'); await wait(900);
    const pv2 = child('playlist:p5', 'spotify-playlist-view'); const h2 = r.history.length;
    if (pv2) { pv2.dispatchEvent(new CustomEvent('navigate', { detail: { pageId: 'artist:ar3', data: null }, bubbles: true, composed: true })); await wait(1200); }
    out.navigate_from_playlist = { hadChild: !!pv2, page: r.currentPageId, historyGrewBy: r.history.length - h2 };
    r.goBack(); await wait(600); r.goBack(); await wait(600);
    return out;
  });
  P.gallery_history_before_backs = await cur();
  await back(); await sleep(500); await back(); await sleep(500); await back(); await sleep(700);
  P.gallery_after_three_backs = await cur();

  // 5b. Render counts per component: 10 unrelated ticks (player state object
  // identity preserved), then 10 player ticks (same track, new state object).
  const wrapAll = () => page.evaluate(() => { window.__renders = {}; const visit = (root) => { for (const el of root.querySelectorAll('*')) { if (el.localName.startsWith('spotify-') && !el.__w && typeof el.requestUpdate === 'function') { el.__w = 1; const name = el.localName; const u = el.updated ? el.updated.bind(el) : null; el.updated = function (c) { window.__renders[name] = (window.__renders[name] || 0) + 1; return u ? u(c) : undefined; }; } if (el.shadowRoot) visit(el.shadowRoot); } }; visit(document.body); });
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort((x, y) => y[1] - x[1]));
  await wrapAll();
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { const ha = document.querySelector('home-assistant'); const prev = ha.hass; const h = window.__makeHass(6); h.states['media_player.spotify_test'] = prev.states['media_player.spotify_test']; ha.hass = h; }); await sleep(260); }
  P.renders_10_unrelated_ticks = sorted(await page.evaluate(() => window.__renders));
  await page.evaluate(() => { window.__renders = {}; });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { const ha = document.querySelector('home-assistant'); const cur = ha.hass.states['media_player.spotify_test']; const n = Number(String(cur.attributes.media_content_id).replace(/\D/g, '')) || 6; ha.hass = window.__makeHass(n); }); await sleep(260); }
  P.renders_10_player_ticks = sorted(await page.evaluate(() => window.__renders));

  // A page whose read fails must show the failure, not spin, and must not
  // retry on every player change; returning to the page retries once.
  m = await mark();
  await nav('playlist:pfail'); await sleep(1500);
  const failCtx = () => page.evaluate(() => { const c = document.querySelector('spotify-browser-app').router.pageCache.get('playlist:pfail')?._contextData; return c ? { isLoading: c.isLoading, loadFailed: !!c.loadFailed, name: c.name } : null; });
  const failed1 = await failCtx();
  for (let i = 11; i <= 15; i++) { await page.evaluate((n) => window.__setHass(window.__makeHass(n)), i); await sleep(500); }
  const callsWhileFailed = (await since(m)).by.get_playlist || 0;
  await nav('home'); await sleep(600);
  await page.evaluate(() => { window.__pfailOk = true; });
  await back(); await sleep(1800);
  P.failed_load = { afterFailure: failed1, getPlaylistCallsOver5TrackChanges: callsWhileFailed, afterReturning: await failCtx() };
  await back(); await sleep(500);
  await page.evaluate(() => window.__setHass(window.__makeHass(9))); await sleep(800);

  // Playlist edit mode on a playlist we own: remove one track, move another,
  // save — and record exactly which playlist_* service calls that produces.
  await nav('playlist:pown'); await sleep(2000);
  const editView = `document.querySelector('spotify-browser-app').router.pageCache.get('playlist:pown').shadowRoot.querySelector('spotify-playlist-view')`;
  await page.evaluate(`${editView}._enterEditMode()`); await sleep(700);
  await page.screenshot({ path: path.join(outDir, `${label}-${vp.name}-g-edit-mode.png`) });
  await page.evaluate(`${editView}._editMode = false`); await sleep(400);
  P.playlist_edit = await page.evaluate(async () => {
    const wait = (ms) => new Promise(res => setTimeout(res, ms));
    const a = document.querySelector('spotify-browser-app');
    const view = a.router.pageCache.get('playlist:pown')?.shadowRoot?.querySelector('spotify-playlist-view');
    if (!view) return { error: 'no playlist view' };
    const before = window.__calls.length;
    view._enterEditMode(); await view.updateComplete; await wait(300);
    const ed = () => view.shadowRoot.querySelector('spotify-playlist-editor') || view;
    const rowsShown = (ed().shadowRoot || view.shadowRoot).querySelectorAll('.edit-row').length;
    const w = [...ed()._workingItems];
    w.splice(2, 1);                       // remove the 3rd track
    const [moved] = w.splice(5, 1); w.splice(1, 0, moved); // move one up
    ed()._workingItems = w; await wait(100);
    await ed()._saveEdits(); await wait(800);
    const calls = window.__calls.slice(before).filter(c => /^playlist_/.test(c.service)).map(c => { const d = { ...c.data }; delete d.entity_id; return [c.service, d]; });
    return { rowsShown, editModeAfterSave: !!view._editMode, calls };
  });
  await back(); await sleep(500);

  // Now-playing controls: click every button of the surface for this layout
  // and record which services each click calls (desktop sidebar / mobile view).
  P.player_buttons = await page.evaluate(async (isDesktop) => {
    const wait = (ms) => new Promise(res => setTimeout(res, ms));
    const a = document.querySelector('spotify-browser-app');
    const deep = (root, sel) => { for (const el of root.querySelectorAll('*')) { if (el.matches(sel)) return el; if (el.shadowRoot) { const r = deep(el.shadowRoot, sel); if (r) return r; } } return null; };
    const flag = isDesktop ? '_queueVisible' : '_nowPlayingVisible';
    const tag = isDesktop ? 'spotify-sidebar-nowplaying' : 'spotify-now-playing-mobile';
    a[flag] = true; await wait(1200);
    const out = [];
    const count = deep(a.shadowRoot, tag)?.shadowRoot.querySelectorAll('button').length || 0;
    for (let i = 0; i < count; i++) {
      a._closeAllPopups?.(); a[flag] = true; await wait(350);
      const el = deep(a.shadowRoot, tag); el.closeOverlays?.(); await wait(150);
      const btn = el.shadowRoot.querySelectorAll('button')[i]; if (!btn) { out.push([i, 'missing', []]); continue; }
      const from = window.__calls.length; const trackBefore = a.playerController?.state?.track?.id;
      btn.click(); await wait(2300);
      const services = window.__calls.slice(from).map(c => c.service).sort();
      out.push([i, (btn.className || '').split(' ')[0], services, a.playerController?.state?.track?.id !== trackBefore ? 'track-changed' : '']);
    }
    a._closeAllPopups?.(); a[flag] = false; await wait(400);
    return out;
  }, vp.name === 'desktop');
  await page.evaluate(() => window.__setHass(window.__makeHass(9))); await sleep(1500);

  // Escape with stacked overlays: only the top one should close per press.
  {
    const flags = (names) => page.evaluate((names) => { const a = document.querySelector('spotify-browser-app'); return Object.fromEntries(names.map(n => [n, !!a[n]])); }, names);
    const set = (name, v) => page.evaluate(([name, v]) => { document.querySelector('spotify-browser-app')[name] = v; }, [name, v]);
    const pair = ['_playlistPickerVisible', '_playlistDialogVisible'];
    await set(pair[0], true); await sleep(500); await set(pair[1], true); await sleep(700);
    const esc = {};
    await page.keyboard.press('Escape'); await sleep(600); esc.after_first_escape = await flags(pair);
    await page.keyboard.press('Escape'); await sleep(600); esc.after_second_escape = await flags(pair);
    await set(pair[0], false); await set(pair[1], false); await sleep(300);
    await set('_accountSheetVisible', true); await sleep(700);
    await page.keyboard.press('Escape'); await sleep(600); esc.account_sheet_after_escape = await flags(['_accountSheetVisible']);
    await set('_accountSheetVisible', false);
    await set('_reorderVisible', true); await sleep(700);
    await page.keyboard.press('Escape'); await sleep(600); esc.reorder_after_escape = await flags(['_reorderVisible']);
    await set('_reorderVisible', false); await sleep(300);
    esc.overlay_still_open = await page.evaluate(() => !!document.querySelector('spotify-browser-app')._isOpen);
    P.escape = esc;
  }

  // 6. Track change while open (expected to fetch).
  m = await mark();
  await page.evaluate(() => window.__setHass(window.__makeHass(9))); await sleep(2000);
  P.track_change_open = await since(m);

  // 7. Close, then one more track change.
  await page.evaluate(() => { const a = document.querySelector('spotify-browser-app'); (a.close ? a.close() : (a._isOpen = false)); });
  await sleep(1200); m = await mark();
  await page.evaluate(() => window.__setHass(window.__makeHass(10))); await sleep(2000);
  P.track_change_after_close = await since(m);

  out.images[vp.name] = imgs;
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
