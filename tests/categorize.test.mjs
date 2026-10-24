import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  categorize,
  computeCatchUpBanner,
  buildDailySummaryNotification
} from '../lib/categorize.js';
import { buildSeedDataset, PROTOTYPE_ANCHOR_MS } from '../lib/seed.js';
import { DAY_MS } from '../lib/format.js';

test('categorize: buckets 14 seed leads into overdue (2), today (4), and upcoming (5) with priority sorting', () => {
  const { leads } = buildSeedDataset(PROTOTYPE_ANCHOR_MS);
  const buckets = categorize(leads, new Date(PROTOTYPE_ANCHOR_MS));

  // Overdue: Sneha Iyer (-1d, priority) and Aisha Khan (-2d)
  assert.equal(buckets.overdue.length, 2);
  assert.equal(buckets.overdue[0].name, 'Sneha Iyer'); // priority bubbles first
  assert.equal(buckets.overdue[1].name, 'Aisha Khan');

  // Today: Priya Sharma (0d, priority), Vikram Singh (0d, priority), Rohit Verma (0d), Manoj Patil (0d)
  assert.equal(buckets.today.length, 4);
  assert.equal(buckets.today[0].priority, true);
  assert.equal(buckets.today[1].priority, true);

  // Upcoming (1d..7d): Kavita Nair (1d), Karan Mehta (2d), Divya Reddy (3d), Riya Kapoor (5d), Pooja Desai (7d)
  assert.equal(buckets.upcoming.length, 5);
  assert.equal(buckets.upcoming[0].name, 'Kavita Nair');
  assert.equal(buckets.upcoming[4].name, 'Pooja Desai');
});

test('categorize: handles clock changes and past follow-ups immediately as overdue', () => {
  const now = PROTOTYPE_ANCHOR_MS;
  const leads = [
    { id: '1', name: 'Past Lead', status: 'active', priority: false, nextFollowUpAt: now - 3 * DAY_MS }
  ];
  const b1 = categorize(leads, now);
  assert.equal(b1.overdue.length, 1);

  // User moves clock back 4 days -> lead is now 1 day in the future (upcoming)
  const b2 = categorize(leads, now - 4 * DAY_MS);
  assert.equal(b2.overdue.length, 0);
  assert.equal(b2.upcoming.length, 1);
});

test('categorize: computeCatchUpBanner and buildDailySummaryNotification', () => {
  const { leads } = buildSeedDataset(PROTOTYPE_ANCHOR_MS);
  const banner = computeCatchUpBanner(
    leads,
    { lastOpenedAt: PROTOTYPE_ANCHOR_MS - 3 * DAY_MS },
    PROTOTYPE_ANCHOR_MS
  );
  assert.ok(banner);
  assert.equal(banner.missedDays, 3);
  assert.equal(banner.text, 'You missed 3 days of follow-ups — review now');

  const notif = buildDailySummaryNotification(leads, PROTOTYPE_ANCHOR_MS);
  assert.equal(notif.title, '6 leads to follow up today ☀️');
  assert.ok(notif.body.includes('Priya'));
  assert.ok(notif.body.includes('+1 more'));
});
