import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tomorrowAt, nextMondayAt, pickDateAt, snoozePresets } from '../lib/snooze.js';
import { nextDiwali, nextRakshaBandhan, afterDiwaliAt, activeFestivalWindow, coldLeads } from '../lib/festivals.js';

const D = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test('snooze: tomorrow 9 AM and next Monday with injected now', () => {
  const thu = D(2026, 10, 22, 18); // Thursday evening
  const tm = new Date(tomorrowAt(thu));
  assert.equal(tm.getDate(), 23);
  assert.equal(tm.getHours(), 9);

  const mon = new Date(nextMondayAt(thu));
  assert.equal(mon.getDay(), 1);
  assert.equal(mon.getDate(), 26);
  assert.equal(mon.getHours(), 9);

  // today is Monday → next week's Monday
  const onMonday = D(2026, 10, 26, 10);
  assert.equal(new Date(nextMondayAt(onMonday)).getDate(), 2);
  // Sunday → tomorrow
  assert.equal(new Date(nextMondayAt(D(2026, 10, 25))).getDate(), 26);
});

test('snooze: pick date validates and rejects past dates', () => {
  const now = D(2026, 10, 22);
  const p = new Date(pickDateAt('2026-12-01', now, 10));
  assert.equal(p.getMonth(), 11);
  assert.equal(p.getDate(), 1);
  assert.equal(p.getHours(), 10);
  assert.equal(pickDateAt('2026-10-01', now), null);
  assert.equal(pickDateAt('nope', now), null);
});

test('festivals: Diwali / Rakhi tables and after-Diwali preset', () => {
  const oct = D(2026, 10, 22);
  assert.equal(nextDiwali(oct).getDate(), 8);
  assert.equal(nextDiwali(oct).getMonth(), 10); // Nov
  const after = new Date(afterDiwaliAt(oct, 9));
  assert.equal(after.getDate(), 10);
  assert.equal(after.getHours(), 9);
  assert.equal(nextDiwali(D(2026, 11, 9)).getFullYear(), 2027);
  assert.equal(nextDiwali(D(2029, 1, 1)), null, 'past the table');
  assert.equal(nextRakshaBandhan(D(2026, 9, 1)).getFullYear(), 2027);

  const presets = snoozePresets(oct);
  assert.deepEqual(presets.map((p) => p.id), ['tomorrow', 'monday', 'after_diwali']);
  assert.deepEqual(snoozePresets(D(2029, 3, 1)).map((p) => p.id), ['tomorrow', 'monday']);
});

test('festivals: window detection (Diwali 30 days before, Rakhi 10, wedding Nov–Feb)', () => {
  assert.equal(activeFestivalWindow(D(2026, 10, 22)).id, 'diwali');
  assert.equal(activeFestivalWindow(D(2026, 10, 9)).id, 'diwali', 'first day of the 30-day window');
  assert.equal(activeFestivalWindow(D(2026, 10, 8)), null, 'October before the window, not wedding season');
  assert.equal(activeFestivalWindow(D(2026, 11, 10)).id, 'diwali', '2 days after still Diwali');
  assert.equal(activeFestivalWindow(D(2026, 11, 11)).id, 'wedding');
  assert.equal(activeFestivalWindow(D(2027, 2, 28)).id, 'wedding');
  assert.equal(activeFestivalWindow(D(2027, 3, 1)), null);
  assert.equal(activeFestivalWindow(D(2026, 8, 20)).id, 'rakhi');
  assert.equal(activeFestivalWindow(D(2026, 8, 5)), null);
  const w = activeFestivalWindow(D(2027, 1, 15));
  assert.equal(new Date(w.start).getMonth(), 10);
  assert.equal(new Date(w.start).getFullYear(), 2026);
});

test('festivals: cold lead selection (30+ days untouched, not lost, not archived)', () => {
  const now = D(2026, 10, 22);
  const day = 86400000;
  const leads = [
    { id: 'a', status: 'active', lastContactedAt: now - 45 * day, updatedAt: now - 45 * day },
    { id: 'b', status: 'active', lastContactedAt: now - 10 * day, updatedAt: now - 10 * day },
    { id: 'c', status: 'lost', lastContactedAt: now - 90 * day, updatedAt: now - 90 * day },
    { id: 'd', status: 'converted', lastContactedAt: now - 60 * day, updatedAt: now - 60 * day },
    { id: 'e', status: 'active', lastContactedAt: now - 60 * day, updatedAt: now - 60 * day, archived: true },
    { id: 'f', status: 'not_interested', lastContactedAt: now - 60 * day, updatedAt: now - 60 * day },
    { id: 'g', status: 'active', lastContactedAt: now - 40 * day, updatedAt: now - 2 * day } // touched recently
  ];
  assert.deepEqual(coldLeads(leads, now).map((l) => l.id), ['d', 'a']);
  assert.deepEqual(coldLeads(leads, now, 50).map((l) => l.id), ['d']);
});
