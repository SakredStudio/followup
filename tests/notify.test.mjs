import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isQuietHour,
  nextReminderAt,
  buildDigestSnapshot,
  buildDigestText,
  buildSelfDigestText,
  scheduleInAppReminder,
  canNotify,
  DEFAULT_QUIET_HOURS
} from '../lib/notify.js';

const leads = (n, prefix = 'L') => Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i + 1} Kumar`, interest: `item ${i + 1}` }));

test('notify: quiet hours wrap midnight (21:00–09:00 default)', () => {
  assert.equal(isQuietHour(22), true);
  assert.equal(isQuietHour(3), true);
  assert.equal(isQuietHour(8), true);
  assert.equal(isQuietHour(9), false);
  assert.equal(isQuietHour(14), false);
  assert.equal(isQuietHour(20), false);
  assert.equal(isQuietHour(12, { start: 10, end: 14 }), true);
  assert.equal(isQuietHour(15, { start: 10, end: 14 }), false);
});

test('notify: nextReminderAt picks today 9 AM before 9, tomorrow after', () => {
  const early = new Date(2026, 9, 25, 7, 30).getTime();
  const r1 = new Date(nextReminderAt(early, 9, DEFAULT_QUIET_HOURS));
  assert.equal(r1.getDate(), 25);
  assert.equal(r1.getHours(), 9);
  assert.equal(r1.getMinutes(), 0);

  const late = new Date(2026, 9, 25, 9, 0).getTime();
  const r2 = new Date(nextReminderAt(late, 9));
  assert.equal(r2.getDate(), 26);
  assert.equal(r2.getHours(), 9);

  // reminder hour inside quiet hours slides to quiet end
  const r3 = new Date(nextReminderAt(early, 7, { start: 21, end: 9 }));
  assert.equal(r3.getHours(), 9);
});

test('notify: digest snapshot + text builder in three languages', () => {
  const snap = buildDigestSnapshot({ today: leads(3), overdue: leads(2, 'O') }, 'en', 1000);
  assert.equal(snap.todayCount, 3);
  assert.equal(snap.overdueCount, 2);
  assert.deepEqual(snap.names, ['L1', 'L2', 'L3', 'O1', 'O2']);
  const text = buildDigestText(snap);
  assert.equal(text.title, '5 leads to follow up today ☀️');
  assert.ok(text.body.includes('L1 · L2'));
  assert.ok(text.body.includes('⚠ 2 overdue'));

  const hi = buildDigestText(buildDigestSnapshot({ today: leads(7) }, 'hi'));
  assert.ok(hi.title.startsWith('आज 7'));
  assert.ok(hi.body.includes('+2 और'));

  const hg = buildDigestText(buildDigestSnapshot({ today: leads(1) }, 'hinglish'));
  assert.equal(hg.title, 'Aaj 1 leads ko follow-up karna hai ☀️');

  assert.equal(buildDigestText(buildDigestSnapshot({ today: [], overdue: [] })), null);
});

test('notify: self digest text lists today and overdue leads', () => {
  const txt = buildSelfDigestText({ today: leads(2), overdue: leads(1, 'O') }, 'en', new Date(2026, 9, 25));
  assert.ok(txt.startsWith('FollowUp Buddy ·'));
  assert.ok(txt.includes('Today (2)'));
  assert.ok(txt.includes('• L1 Kumar — item 1'));
  assert.ok(txt.includes('Overdue (1)'));
  assert.ok(!txt.includes('sakredstudio.github.io'), 'self digest has no share line');
  assert.ok(buildSelfDigestText({ today: [], overdue: [] }, 'hi').includes('आज कुछ बाकी नहीं'));
});

test('notify: scheduleInAppReminder uses injected timers with the right delay', () => {
  let captured = null;
  const timers = {
    setTimeout: (fn, delay) => { captured = { fn, delay }; return 7; },
    clearTimeout: (id) => { captured = { cleared: id }; }
  };
  const now = new Date(2026, 9, 25, 8, 0).getTime();
  let fired = null;
  const cancel = scheduleInAppReminder({ now, reminderHour: 9, onFire: (at) => { fired = at; }, timers });
  assert.equal(captured.delay, 60 * 60 * 1000);
  captured.fn();
  assert.equal(new Date(fired).getHours(), 9);
  cancel();
  assert.deepEqual(captured, { cleared: 7 });
});

test('notify: canNotify reports honest capability', async () => {
  const none = await canNotify({ window: null, navigator: null, Notification: null, registration: null });
  assert.equal(none.mode, 'none');
  const open = await canNotify({ window: { matchMedia: () => ({ matches: false }) }, navigator: {}, Notification: { permission: 'granted' }, registration: {}, referrer: '' });
  assert.equal(open.mode, 'open');
  const periodic = await canNotify({ window: { matchMedia: () => ({ matches: true }) }, navigator: {}, Notification: { permission: 'default' }, registration: { periodicSync: {} }, referrer: '' });
  assert.equal(periodic.mode, 'periodic');
  assert.equal(periodic.installed, true);
});
