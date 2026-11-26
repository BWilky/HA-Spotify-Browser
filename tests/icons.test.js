import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalized } from './helpers/lit-env.js';
import { html } from '../src/lit.js';
import {
    menuIcon, playPauseIcon, shuffleIcon, previousIcon, nextIcon, volumeUpIcon, closeIcon,
    checkIcon, sortIcon, speakerOutlineIcon, staticBarsIcon, deviceTypeIcon,
    heroShuffleIcon, searchIcon,
} from '../src/components/common/icons.js';
import { deviceIconFor } from '../src/components/devices/device-row.js';

// Each shared icon against the inline markup it replaced, copied verbatim
// from the call sites (whitespace between tags is collapsed by normalized()).

const PLAY = 'M8 5v14l11-7z';
const PAUSE = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';
const legacyPlayPause = (playing) => html`<svg viewBox="0 0 24 24"><path d="${playing ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z'}"/></svg>`;
const legacyPlayPauseFilled = (playing) => html`<svg viewBox="0 0 24 24"><path fill="currentColor" d="${playing ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z'}"/></svg>`;

test('playPauseIcon: queue sheet / now-playing sheet markup, and the fill-on-path markup of the sidebar and mini-player', () => {
    for (const playing of [true, false, undefined]) {
        assert.equal(normalized(playPauseIcon(playing)), normalized(legacyPlayPause(playing)));
        assert.equal(normalized(playPauseIcon(playing, true)), normalized(legacyPlayPauseFilled(playing)));
    }
    assert.ok(normalized(playPauseIcon(true)).includes(PAUSE));
    assert.ok(normalized(playPauseIcon(false)).includes(PLAY));
});

test('shuffle / previous / next: now-playing sheet (no path fill) and sidebar (fill on path)', () => {
    assert.equal(normalized(shuffleIcon()), normalized(html`<svg viewBox="0 0 24 24"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>`));
    assert.equal(normalized(shuffleIcon(true)), normalized(html`<svg viewBox="0 0 24 24"><path fill="currentColor" d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>`));
    assert.equal(normalized(previousIcon()), normalized(html`<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>`));
    assert.equal(normalized(previousIcon(true)), normalized(html`<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>`));
    assert.equal(normalized(nextIcon()), normalized(html`<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>`));
    assert.equal(normalized(nextIcon(true)), normalized(html`<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>`));
});

test('heroShuffleIcon: the playlist view\'s album and Liked Songs hero shuffle buttons', () => {
    // The view's copies listed height before width.
    assert.equal(normalized(heroShuffleIcon), normalized(html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>`));
});

test('searchIcon: the library (24) and header (20) markup; the search bar and the picker get theirs from CSS', () => {
    assert.equal(normalized(searchIcon(24)), normalized(html`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`));
    // The header's copy listed viewBox last.
    assert.equal(normalized(searchIcon(20)), normalized(html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`));
});

test('volumeUpIcon(true): the sidebar volume button and slider overlay markup', () => {
    assert.equal(normalized(volumeUpIcon(true)), normalized(html`<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`));
});

test('closeIcon: unsized (device picker, create sheet) and 24px with fill (reorder dialog)', () => {
    assert.equal(normalized(closeIcon()), normalized(html`<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`));
    assert.equal(normalized(closeIcon(24)), normalized(html`<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`));
});

test('static icons match their former inline copies', () => {
    assert.equal(normalized(checkIcon), normalized(html`<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`));
    assert.equal(normalized(sortIcon), normalized(html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v14m0 0l-3-3m3 3l3-3M17 20V6m0 0l-3 3m3-3l3 3"/></svg>`));
    // Connect sheet's _speakerOutline() (the mini-player's copy differed only in indentation).
    assert.equal(normalized(speakerOutlineIcon), normalized(html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="6" y="2" width="12" height="20" rx="2.5"/>
            <circle cx="12" cy="6.5" r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="12" cy="14.5" r="3.2"/>
        </svg>`));
    assert.equal(normalized(staticBarsIcon), normalized(html`<svg viewBox="0 0 24 24"><rect x="3" y="10" width="4" height="11" rx="1"/><rect x="10" y="5" width="4" height="16" rx="1"/><rect x="17" y="13" width="4" height="8" rx="1"/></svg>`));
    // The header's "..." menu button had menuIcon's markup inline.
    assert.equal(normalized(menuIcon), normalized(html`<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>`));
});

test('deviceIconFor: custom icon by id, then name; otherwise the fallback, else the device-type icon', () => {
    const config = { devices: { icons: [{ id: 'd1', icon: 'mdi:speaker' }, { name: 'Office', icon: 'https://img.test/o.png' }] } };
    assert.equal(normalized(deviceIconFor({ id: 'd1', name: 'X', type: 'TV' }, config)), '<ha-icon icon="mdi:speaker"></ha-icon>');
    assert.equal(normalized(deviceIconFor({ id: 'd2', name: 'Office' }, config, speakerOutlineIcon)), '<img src="https://img.test/o.png" alt="">');
    assert.equal(deviceIconFor({ id: 'd3', name: 'Kitchen', type: 'TV' }, config, speakerOutlineIcon), speakerOutlineIcon);
    assert.equal(deviceIconFor({ id: 'd3', name: 'Kitchen', type: 'TV' }, {}, speakerOutlineIcon), speakerOutlineIcon);
    assert.equal(normalized(deviceIconFor({ id: 'd3', name: 'Kitchen', type: 'TV' }, config)), normalized(deviceTypeIcon('TV')));
});
