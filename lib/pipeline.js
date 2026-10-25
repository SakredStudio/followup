// Pure ES module for the FollowUp Buddy pipeline (v2): New → Contacted → Interested → Ordered → Lost.
// `stage` lives next to the v1 `status` field. status drives Today/filters; stage drives the swimlanes.
// A lead moves lanes only when the seller logs something (a message opened, an outcome) — never by itself.

export const STAGES = ['new', 'contacted', 'interested', 'ordered', 'lost'];

export const OUTCOMES = ['contacted', 'replied', 'no_reply', 'ordered', 'lost', 'not_interested', 'reopen'];

export function isValidStage(stage) {
  return STAGES.includes(stage);
}

/** Stage forced by a terminal v1 status, or null when the status leaves the stage free. */
export function stageForStatus(status) {
  if (status === 'converted') return 'ordered';
  if (status === 'lost' || status === 'not_interested') return 'lost';
  return null;
}

/**
 * Derive the stage for a lead (used by migrate() for v1 data that has no `stage`).
 * Terminal statuses win; otherwise a saved valid stage; otherwise the history decides:
 * a `replied` event → interested, a `contacted` event → contacted, nothing → new.
 */
export function deriveStage(lead, events = []) {
  if (!lead) return 'new';
  const forced = stageForStatus(lead.status);
  if (forced) return forced;
  if (isValidStage(lead.stage)) return lead.stage;
  const mine = (Array.isArray(events) ? events : []).filter((e) => e && e.leadId === lead.id);
  if (mine.some((e) => e.kind === 'replied')) return 'interested';
  if (mine.some((e) => e.kind === 'contacted')) return 'contacted';
  return 'new';
}

/**
 * Transition table. `outcome`:
 *  - contacted: the seller opened WhatsApp/Instagram for this lead → New becomes Contacted
 *  - replied: the lead answered → New becomes Contacted, Contacted becomes Interested
 *  - no_reply: nothing moves (the seller reschedules instead)
 *  - ordered: → Ordered;  lost / not_interested: → Lost;  reopen: → Contacted
 * Ordered and Lost never move on contacted/replied/no_reply (the seller reopens explicitly).
 */
export function stageAfterOutcome(stage, outcome) {
  const cur = isValidStage(stage) ? stage : 'new';
  switch (outcome) {
    case 'ordered':
      return 'ordered';
    case 'lost':
    case 'not_interested':
      return 'lost';
    case 'reopen':
      return 'contacted';
    case 'contacted':
      if (cur === 'new') return 'contacted';
      return cur;
    case 'replied':
      if (cur === 'new') return 'contacted';
      if (cur === 'contacted') return 'interested';
      return cur;
    case 'no_reply':
    default:
      return cur;
  }
}

/** Group non-archived leads into lanes, newest activity first. Always returns every lane. */
export function groupByStage(leads = [], events = []) {
  const lanes = Object.fromEntries(STAGES.map((s) => [s, []]));
  for (const l of Array.isArray(leads) ? leads : []) {
    if (!l || l.archived) continue;
    const st = deriveStage(l, events);
    lanes[st].push(l);
  }
  for (const s of STAGES) {
    lanes[s].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  }
  return lanes;
}
