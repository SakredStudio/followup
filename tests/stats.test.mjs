import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyOrderValue, bestTags, bestSources, followUpsThisWeek, startOfWeek, computeStats } from '../lib/stats.js';

// Fixture: "now" is Thursday 2026-10-22 15:00 local.
const NOW = new Date(2026, 9, 22, 15, 0).getTime();
const d = (y, m, day) => new Date(y, m - 1, day, 12).getTime();

const leads = [
  { id: '1', source: 'whatsapp', status: 'converted', convertedAt: d(2026, 10, 3), convertedValue: 1400, tags: ['Cakes', 'Repeat'] },
  { id: '2', source: 'whatsapp', status: 'converted', convertedAt: d(2026, 10, 20), convertedValue: 2800, tags: ['Cakes'] },
  { id: '3', source: 'instagram', status: 'converted', convertedAt: d(2026, 9, 28), convertedValue: 900, tags: ['Sarees'] },
  { id: '4', source: 'instagram', status: 'converted', convertedAt: d(2026, 9, 2), tags: ['Sarees'] }, // no value
  { id: '5', source: 'instagram', status: 'active', tags: ['Sarees'] },
  { id: '6', source: 'instagram', status: 'lost', tags: ['T-shirts'] },
  { id: '7', source: 'whatsapp', status: 'active', tags: ['Cakes'], archived: true },
  { id: '8', source: 'other', status: 'not_interested', tags: [] }
];

test('stats: monthly order value this month and last month', () => {
  const m = monthlyOrderValue(leads, NOW);
  assert.deepEqual(m.thisMonth, { value: 4200, orders: 2 });
  assert.deepEqual(m.lastMonth, { value: 900, orders: 2 });
  assert.deepEqual(monthlyOrderValue([], NOW).thisMonth, { value: 0, orders: 0 });
});

test('stats: best tags ranked by orders then value', () => {
  const tags = bestTags(leads);
  assert.deepEqual(tags[0], { tag: 'Cakes', orders: 2, value: 4200 });
  assert.deepEqual(tags[1], { tag: 'Sarees', orders: 2, value: 900 });
  assert.deepEqual(tags[2], { tag: 'Repeat', orders: 1, value: 1400 });
  assert.equal(tags.length, 3, 'tags without orders are not listed');
  assert.equal(bestTags(leads, 1).length, 1);
});

test('stats: best source by conversion %', () => {
  const s = bestSources(leads);
  assert.equal(s[0].source, 'whatsapp');
  assert.equal(s[0].leads, 3);
  assert.equal(s[0].orders, 2);
  assert.equal(s[0].conversion, 67);
  const ig = s.find((x) => x.source === 'instagram');
  assert.equal(ig.leads, 4);
  assert.equal(ig.orders, 2);
  assert.equal(ig.conversion, 50);
  const other = s.find((x) => x.source === 'other');
  assert.equal(other.conversion, 0);
});

test('stats: follow-ups this week count contacted + replied since Monday', () => {
  const mon = startOfWeek(NOW);
  assert.equal(mon.getDay(), 1);
  assert.equal(mon.getDate(), 19);
  const events = [
    { kind: 'contacted', at: mon.getTime() + 1000 },
    { kind: 'contacted', at: NOW - 3600 * 1000 },
    { kind: 'replied', at: NOW - 60 * 1000 },
    { kind: 'contacted', at: mon.getTime() - 1000 }, // last week
    { kind: 'note', at: NOW - 1000 }, // not a follow-up
    { kind: 'contacted', at: NOW + 86400000 } // future
  ];
  assert.deepEqual(followUpsThisWeek(events, NOW), { contacted: 2, replied: 1, total: 3 });
  // Sunday still belongs to the week that started the previous Monday
  const sun = new Date(2026, 9, 25, 10).getTime();
  assert.equal(startOfWeek(sun).getDate(), 19);
});

test('stats: computeStats bundles totals', () => {
  const s = computeStats({ leads, events: [] }, NOW);
  assert.equal(s.totals.leads, 8);
  assert.equal(s.totals.active, 1, 'archived active lead is excluded');
  assert.equal(s.totals.orders, 4);
  assert.equal(s.totals.value, 5100);
  assert.equal(s.sources.length, 3);
  assert.equal(s.week.total, 0);
});
