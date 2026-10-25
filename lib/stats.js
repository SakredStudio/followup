// Pure ES module for the FollowUp Buddy Stats screen (v2): monthly order value, best tags,
// best source by conversion, follow-ups done this week. Everything is computed from the
// local state; nothing is sent anywhere.

import { startOfDay } from './categorize.js';
import { DAY_MS } from './format.js';

function toMs(v) {
  return v instanceof Date ? v.getTime() : Number(v);
}

function sameMonth(ts, ref) {
  const a = new Date(ts);
  return a.getFullYear() === ref.getFullYear() && a.getMonth() === ref.getMonth();
}

function orderedLeads(leads) {
  return (Array.isArray(leads) ? leads : []).filter((l) => l && l.status === 'converted');
}

/** Order value and count for this month and last month (by `convertedAt`). */
export function monthlyOrderValue(leads = [], now = Date.now()) {
  const ref = new Date(toMs(now));
  const last = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
  const sum = (filterFn) =>
    orderedLeads(leads)
      .filter((l) => Number.isFinite(Number(l.convertedAt)) && filterFn(Number(l.convertedAt)))
      .reduce(
        (acc, l) => ({ value: acc.value + (Number(l.convertedValue) || 0), orders: acc.orders + 1 }),
        { value: 0, orders: 0 }
      );
  return {
    thisMonth: sum((ts) => sameMonth(ts, ref)),
    lastMonth: sum((ts) => sameMonth(ts, last))
  };
}

/** Tags ranked by number of orders, then value. Only converted leads count. */
export function bestTags(leads = [], limit = 5) {
  const map = new Map();
  for (const l of orderedLeads(leads)) {
    for (const tag of Array.isArray(l.tags) ? l.tags : []) {
      const cur = map.get(tag) || { tag, orders: 0, value: 0 };
      cur.orders += 1;
      cur.value += Number(l.convertedValue) || 0;
      map.set(tag, cur);
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.orders - a.orders || b.value - a.value || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

/** Per source: leads, orders, conversion % (orders / leads). Archived leads still count. */
export function bestSources(leads = []) {
  const map = new Map();
  for (const l of Array.isArray(leads) ? leads : []) {
    if (!l) continue;
    const src = l.source || 'other';
    const cur = map.get(src) || { source: src, leads: 0, orders: 0, value: 0, conversion: 0 };
    cur.leads += 1;
    if (l.status === 'converted') {
      cur.orders += 1;
      cur.value += Number(l.convertedValue) || 0;
    }
    map.set(src, cur);
  }
  return Array.from(map.values())
    .map((s) => ({ ...s, conversion: s.leads ? Math.round((s.orders / s.leads) * 100) : 0 }))
    .sort((a, b) => b.conversion - a.conversion || b.orders - a.orders || a.source.localeCompare(b.source));
}

/** Monday 00:00 local of the week containing `now`. */
export function startOfWeek(now = Date.now()) {
  const d = startOfDay(new Date(toMs(now)));
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - dow * DAY_MS);
}

/** Follow-ups done this week = contacted + replied events since Monday. */
export function followUpsThisWeek(events = [], now = Date.now()) {
  const from = startOfWeek(now).getTime();
  const nowMs = toMs(now);
  let contacted = 0;
  let replied = 0;
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || e.at < from || e.at > nowMs) continue;
    if (e.kind === 'contacted') contacted += 1;
    else if (e.kind === 'replied') replied += 1;
  }
  return { contacted, replied, total: contacted + replied };
}

export function computeStats(state, now = Date.now()) {
  const leads = state?.leads || [];
  const events = state?.events || [];
  const active = leads.filter((l) => l && !l.archived && l.status === 'active').length;
  const ordered = orderedLeads(leads);
  return {
    monthly: monthlyOrderValue(leads, now),
    tags: bestTags(leads, 5),
    sources: bestSources(leads),
    week: followUpsThisWeek(events, now),
    totals: {
      leads: leads.length,
      active,
      orders: ordered.length,
      value: ordered.reduce((a, l) => a + (Number(l.convertedValue) || 0), 0)
    }
  };
}
