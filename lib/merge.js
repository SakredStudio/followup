// Pure ES module: merge two FollowUp Buddy states (v3 team of two / multi-device).
// Rule: union of leads by id, newest `updatedAt` per lead wins; events unioned by id;
// tags unioned by name; catalogue unioned by id (newest updatedAt wins); local settings win,
// except templates/tagTemplates which merge (remote fills gaps). Deterministic and symmetric
// for leads/events, so both phones converge after a sync.

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function leadStamp(l) {
  return Math.max(num(l?.updatedAt), num(l?.lastContactedAt), num(l?.createdAt));
}

/** Pick the newer lead; on a tie prefer `a` (local). */
export function pickNewerLead(a, b) {
  if (!a) return b;
  if (!b) return a;
  return leadStamp(b) > leadStamp(a) ? b : a;
}

export function mergeLeads(localLeads = [], remoteLeads = []) {
  const map = new Map();
  for (const l of Array.isArray(localLeads) ? localLeads : []) if (l && l.id) map.set(l.id, l);
  for (const r of Array.isArray(remoteLeads) ? remoteLeads : []) {
    if (!r || !r.id) continue;
    map.set(r.id, pickNewerLead(map.get(r.id), r));
  }
  return Array.from(map.values()).sort((x, y) => leadStamp(y) - leadStamp(x));
}

export function mergeEvents(localEvents = [], remoteEvents = []) {
  const map = new Map();
  for (const e of [...(Array.isArray(localEvents) ? localEvents : []), ...(Array.isArray(remoteEvents) ? remoteEvents : [])]) {
    if (!e || !e.id) continue;
    if (!map.has(e.id)) map.set(e.id, e);
  }
  return Array.from(map.values()).sort((a, b) => num(b.at) - num(a.at));
}

export function mergeTags(localTags = [], remoteTags = []) {
  const map = new Map();
  for (const tg of [...(localTags || []), ...(remoteTags || [])]) {
    const name = typeof tg === 'string' ? tg.trim() : String(tg?.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, typeof tg === 'string' ? { id: `tag_${key.replace(/\W+/g, '_')}`, name } : tg);
  }
  return Array.from(map.values());
}

export function mergeCatalogue(localList = [], remoteList = []) {
  const map = new Map();
  for (const p of Array.isArray(localList) ? localList : []) if (p && p.id) map.set(p.id, p);
  for (const r of Array.isArray(remoteList) ? remoteList : []) {
    if (!r || !r.id) continue;
    const cur = map.get(r.id);
    map.set(r.id, !cur || num(r.updatedAt) > num(cur.updatedAt) ? r : cur);
  }
  return Array.from(map.values()).slice(0, 10);
}

/**
 * Merge a remote state into the local one. Settings: local wins, remote fills missing
 * templates / tag assignments; the cloud block, Pro flag and device name are always local.
 */
export function mergeStates(local, remote) {
  const L = local || {};
  const R = remote || {};
  const ls = L.settings || {};
  const rs = R.settings || {};
  const templates = [...(ls.templates || [])];
  for (const tp of rs.templates || []) {
    if (templates.length >= 3) break;
    if (!templates.some((x) => x.id === tp.id)) templates.push(tp);
  }
  const tagTemplates = { ...(rs.tagTemplates || {}), ...(ls.tagTemplates || {}) };
  for (const k of Object.keys(tagTemplates)) {
    if (!templates.some((x) => x.id === tagTemplates[k])) delete tagTemplates[k];
  }
  return {
    ...L,
    leads: mergeLeads(L.leads, R.leads),
    events: mergeEvents(L.events, R.events),
    tags: mergeTags(L.tags, R.tags),
    catalogue: mergeCatalogue(L.catalogue, R.catalogue),
    settings: {
      ...rs,
      ...ls,
      templates,
      tagTemplates,
      cloud: ls.cloud,
      isPro: ls.isPro,
      deviceName: ls.deviceName
    }
  };
}

/** Who touched a lead last, from its events (newest `by`), or null. */
export function lastTouchedBy(leadId, events = []) {
  let best = null;
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || e.leadId !== leadId || !e.by) continue;
    if (!best || num(e.at) > num(best.at)) best = e;
  }
  return best ? { by: best.by, at: num(best.at), kind: best.kind } : null;
}
