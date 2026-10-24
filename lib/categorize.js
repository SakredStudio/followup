// Pure ES module for FollowUp Buddy Today/Overdue/Upcoming categorization,
// priority sorting, missed-days catch-up banner, morning summary formatting, and All Leads filtering (no DOM).

import { DAY_MS } from './format.js';

export function startOfDay(d) {
  const x = d instanceof Date ? new Date(d.getTime()) : new Date(Number(d));
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d) {
  const x = d instanceof Date ? new Date(d.getTime()) : new Date(Number(d));
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d, n) {
  const base = d instanceof Date ? d.getTime() : Number(d);
  return new Date(base + n * DAY_MS);
}

function sortByPriorityAndTime(a, b) {
  const pa = a.priority ? 1 : 0;
  const pb = b.priority ? 1 : 0;
  if (pb !== pa) return pb - pa;
  return (a.nextFollowUpAt || 0) - (b.nextFollowUpAt || 0);
}

/**
 * Categorize active leads into overdue, today, and upcoming (next 7 days) buckets.
 * Matches TYPES.ts and SCHEMA.sql ordering & LIMIT 50.
 * @param {Array<object>} leads
 * @param {Date|number} [now]
 */
export function categorize(leads = [], now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(Number(now));
  const dayStart = startOfDay(nowDate).getTime();
  const dayEnd = endOfDay(nowDate).getTime();
  const in7 = addDays(endOfDay(nowDate), 7).getTime();

  const active = (Array.isArray(leads) ? leads : []).filter(
    (l) =>
      l &&
      !l.archived &&
      l.status === 'active' &&
      l.nextFollowUpAt !== null &&
      l.nextFollowUpAt !== undefined
  );

  const overdue = active
    .filter((l) => l.nextFollowUpAt < dayStart)
    .sort(sortByPriorityAndTime)
    .slice(0, 50);

  const today = active
    .filter((l) => l.nextFollowUpAt >= dayStart && l.nextFollowUpAt <= dayEnd)
    .sort(sortByPriorityAndTime)
    .slice(0, 50);

  const upcoming = active
    .filter((l) => l.nextFollowUpAt > dayEnd && l.nextFollowUpAt <= in7)
    .sort((a, b) => (a.nextFollowUpAt || 0) - (b.nextFollowUpAt || 0))
    .slice(0, 50);

  return { overdue, today, upcoming };
}

/**
 * Filter leads for All Leads screen by search query (name + handle + interest + tags),
 * status filter, source filter, tag filter, and archived toggle.
 * @param {Array<object>} leads
 * @param {object} [opts]
 */
export function filterLeads(
  leads = [],
  { query = '', statusF = 'all', sourceF = 'all', tagF = 'all', showArchived = false } = {}
) {
  const q = String(query || '').trim().toLowerCase();
  return (Array.isArray(leads) ? leads : []).filter((l) => {
    if (!l) return false;
    if (showArchived ? !l.archived : Boolean(l.archived)) return false;
    if (q) {
      const tagsStr = Array.isArray(l.tags) ? l.tags.join(' ') : '';
      const haystack = `${l.name || ''} ${l.handle || ''} ${l.interest || ''} ${tagsStr}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (statusF !== 'all' && l.status !== statusF) return false;
    if (sourceF !== 'all' && l.source !== sourceF) return false;
    if (tagF !== 'all' && (!Array.isArray(l.tags) || !l.tags.includes(tagF))) return false;
    return true;
  });
}

/**
 * Compute missed-days catch-up banner when user opens the app after missing >= 1 day
 * and there are overdue leads waiting.
 */
export function computeCatchUpBanner(leads = [], settings = {}, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(Number(now));
  const lastOpenedAt = settings?.lastOpenedAt;
  if (!lastOpenedAt) return null;

  const currentDayStart = startOfDay(nowDate).getTime();
  const lastDayStart = startOfDay(new Date(Number(lastOpenedAt))).getTime();
  const missedDays = Math.round((currentDayStart - lastDayStart) / DAY_MS);
  if (missedDays < 1) return null;

  const { overdue } = categorize(leads, nowDate);
  if (overdue.length === 0) return null;

  return {
    missedDays,
    overdueCount: overdue.length,
    text: `You missed ${missedDays} ${missedDays === 1 ? 'day' : 'days'} of follow-ups — review now`
  };
}

/**
 * Build morning summary notification payload per README §8.
 */
export function buildDailySummaryNotification(leads = [], now = new Date()) {
  const { today, overdue } = categorize(leads, now);
  const combined = [...today, ...overdue];
  if (combined.length === 0) return null;

  const firstNames = combined.slice(0, 5).map((l) => String(l.name || '').split(' ')[0]);
  const extra = combined.length > 5 ? ` +${combined.length - 5} more` : '';
  return {
    title: `${combined.length} leads to follow up today ☀️`,
    body: `${firstNames.join(' · ')}${extra}`
  };
}
