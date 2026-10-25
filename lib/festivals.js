// Pure ES module: Indian festival dates (2026–2028) for snooze presets and the
// "Reactivate cold leads" card. Dates are local-calendar days; times are local midnight-based.

import { DAY_MS } from './format.js';
import { startOfDay } from './categorize.js';

// Diwali (Lakshmi Puja day) and Raksha Bandhan, 2026–2028. [year, month(1-12), day]
export const DIWALI = { 2026: [2026, 11, 8], 2027: [2027, 10, 29], 2028: [2028, 10, 17] };
export const RAKSHA_BANDHAN = { 2026: [2026, 8, 28], 2027: [2027, 8, 17], 2028: [2028, 8, 5] };

export const WINDOWS = {
  diwali: { daysBefore: 30, daysAfter: 2 },
  rakhi: { daysBefore: 10, daysAfter: 1 },
  wedding: { fromMonth: 11, toMonth: 2 } // Nov → Feb (inclusive)
};

function toMs(v) {
  return v instanceof Date ? v.getTime() : Number(v);
}

function localDate([y, m, d], hour = 0, dayOffset = 0) {
  // Calendar arithmetic (not DAY_MS) so DST shifts never move a festival day.
  return new Date(y, m - 1, d + dayOffset, hour, 0, 0, 0);
}

/** Next Diwali on/after `now` (local date), or null when past the table. */
export function nextDiwali(now = Date.now()) {
  const nowDay = startOfDay(new Date(toMs(now))).getTime();
  for (const y of Object.keys(DIWALI).map(Number).sort()) {
    const d = localDate(DIWALI[y]);
    if (d.getTime() >= nowDay) return d;
  }
  return null;
}

export function nextRakshaBandhan(now = Date.now()) {
  const nowDay = startOfDay(new Date(toMs(now))).getTime();
  for (const y of Object.keys(RAKSHA_BANDHAN).map(Number).sort()) {
    const d = localDate(RAKSHA_BANDHAN[y]);
    if (d.getTime() >= nowDay) return d;
  }
  return null;
}

/** "After Diwali" snooze target: 2 days after Diwali at `hour` local. Null when no Diwali known. */
export function afterDiwaliAt(now = Date.now(), hour = 9) {
  const d = nextDiwali(now);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + WINDOWS.diwali.daysAfter, hour, 0, 0, 0).getTime();
}

/**
 * Active festival / season window at `now`.
 * @returns {{ id: 'diwali'|'rakhi'|'wedding', start: number, end: number, festivalAt?: number } | null}
 */
export function activeFestivalWindow(now = Date.now()) {
  const nowMs = toMs(now);
  const nowDay = startOfDay(new Date(nowMs)).getTime();
  const tables = [
    ['diwali', DIWALI],
    ['rakhi', RAKSHA_BANDHAN]
  ];
  for (const [id, table] of tables) {
    const w = WINDOWS[id];
    for (const y of Object.keys(table).map(Number)) {
      const f = localDate(table[y]).getTime();
      const start = localDate(table[y], 0, -w.daysBefore).getTime();
      const end = localDate(table[y], 0, w.daysAfter + 1).getTime() - 1;
      if (nowDay >= start && nowMs <= end) return { id, start, end, festivalAt: f };
    }
  }
  const month = new Date(nowMs).getMonth() + 1;
  const { fromMonth, toMonth } = WINDOWS.wedding;
  const inSeason = fromMonth > toMonth ? month >= fromMonth || month <= toMonth : month >= fromMonth && month <= toMonth;
  if (inSeason) {
    const y = new Date(nowMs).getFullYear();
    const startYear = month >= fromMonth ? y : y - 1;
    const start = new Date(startYear, fromMonth - 1, 1).getTime();
    const end = new Date(startYear + 1, toMonth, 0, 23, 59, 59, 999).getTime();
    return { id: 'wedding', start, end };
  }
  return null;
}

/**
 * Cold leads: not Lost / Not interested / archived, no touch (lastContactedAt / updatedAt)
 * in `days`+ days. Converted customers count too — they are the best re-order leads.
 */
export function coldLeads(leads = [], now = Date.now(), days = 30) {
  const cutoff = toMs(now) - days * DAY_MS;
  return (Array.isArray(leads) ? leads : [])
    .filter((l) => l && !l.archived && l.status !== 'lost' && l.status !== 'not_interested')
    .filter((l) => Math.max(Number(l.lastContactedAt) || 0, Number(l.updatedAt) || 0) < cutoff)
    .sort((a, b) => (Number(a.lastContactedAt) || 0) - (Number(b.lastContactedAt) || 0));
}
