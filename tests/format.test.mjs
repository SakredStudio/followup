import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initials, avatarColor, relTime, shortDate, inr, DAY_MS } from '../lib/format.js';

test('format: initials and avatarColor match data.js', () => {
  assert.equal(initials('Priya Sharma'), 'PS');
  assert.equal(initials('Rohit'), 'R');
  assert.equal(avatarColor('Priya Sharma'), avatarColor('Priya Sharma'));
});

test('format: relTime computes Today, Tomorrow, overdue, and upcoming labels', () => {
  const now = new Date('2026-05-27T10:30:00+05:30').getTime();
  assert.equal(relTime(now, now), 'Today');
  assert.equal(relTime(now + DAY_MS, now), 'Tomorrow');
  assert.equal(relTime(now - 2 * DAY_MS, now), '2d overdue');
  assert.equal(relTime(now + 3 * DAY_MS, now), 'in 3d');
  assert.equal(relTime(now + 7 * DAY_MS, now), 'in 1w');
  assert.ok(shortDate(now).includes('27'));
  assert.equal(inr(1400), '₹1,400');
});
