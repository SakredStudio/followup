// Pure ES module for snooze presets (v2): Tomorrow 9 AM, Monday, After Diwali, pick a date.
// All times are local; `hour` defaults to the seller's reminder hour (9).

import { DAY_MS } from './format.js';
import { afterDiwaliAt } from './festivals.js';

function toMs(v) {
  return v instanceof Date ? v.getTime() : Number(v);
}

function at(ms, hour) {
  const d = new Date(ms);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

export function tomorrowAt(now = Date.now(), hour = 9) {
  return at(toMs(now) + DAY_MS, hour);
}

/** Next Monday strictly after today (if today is Monday → next week). */
export function nextMondayAt(now = Date.now(), hour = 9) {
  const d = new Date(toMs(now));
  const dow = d.getDay(); // 0 Sun … 6 Sat
  const delta = ((8 - dow) % 7) || 7;
  return at(d.getTime() + delta * DAY_MS, hour);
}

/** A specific calendar date (YYYY-MM-DD) at `hour`. Returns null for an invalid or past date. */
export function pickDateAt(isoDate, now = Date.now(), hour = 9) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= toMs(now)) return null;
  return d.getTime();
}

/**
 * Presets available right now. `afterDiwali` is omitted when the table has no upcoming Diwali.
 * @returns {Array<{ id: string, at: number }>}
 */
export function snoozePresets(now = Date.now(), hour = 9) {
  const out = [
    { id: 'tomorrow', at: tomorrowAt(now, hour) },
    { id: 'monday', at: nextMondayAt(now, hour) }
  ];
  const diwali = afterDiwaliAt(now, hour);
  if (diwali && diwali > toMs(now)) out.push({ id: 'after_diwali', at: diwali });
  return out;
}
