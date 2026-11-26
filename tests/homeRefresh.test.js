import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionFetchWindow, homeRefreshDue, HOME_PAGE_SIZE, HOME_REFRESH_COOLDOWN_MS } from '../src/components/controllers/home-content.js';

test('a normal fetch continues from the current offset with one page', () => {
    assert.deepEqual(sectionFetchWindow({ offset: 40, loaded: 40 }), { offset: 40, limit: HOME_PAGE_SIZE });
});

test('a refresh restarts at 0 and re-reads what was already loaded', () => {
    assert.deepEqual(sectionFetchWindow({ replace: true, offset: 40, loaded: 40 }), { offset: 0, limit: 40 });
});

test('a refresh never asks for less than one page', () => {
    assert.deepEqual(sectionFetchWindow({ replace: true, offset: 5, loaded: 5 }), { offset: 0, limit: HOME_PAGE_SIZE });
    assert.deepEqual(sectionFetchWindow({ replace: true, offset: 0, loaded: 0 }), { offset: 0, limit: HOME_PAGE_SIZE });
});

test('a refresh is capped at the Spotify API max of 50', () => {
    assert.deepEqual(sectionFetchWindow({ replace: true, offset: 120, loaded: 120 }), { offset: 0, limit: 50 });
});

test('refresh is due only once the cooldown has passed', () => {
    const t = 1_000_000;
    assert.equal(homeRefreshDue(t, t + 1000), false);
    assert.equal(homeRefreshDue(t, t + HOME_REFRESH_COOLDOWN_MS), true);
    assert.equal(homeRefreshDue(0, t), true);
});
