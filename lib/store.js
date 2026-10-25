// Pure ES module for FollowUp Buddy localStorage persistence ('fub.v1'),
// lead/event/tag CRUD, trg_event_touch behavior, free tier limits, and JSON/CSV export (no DOM).

import { DEFAULT_LANG, normalizeLang } from './i18n.js';
import { DAY_MS } from './format.js';
import { buildSeedDataset, SEED_TAGS } from './seed.js';
import { deriveStage, stageAfterOutcome, isValidStage } from './pipeline.js';

export const STORAGE_KEY = 'fub.v1';
export const CURRENT_SCHEMA_VERSION = 2;
export const FREE_ACTIVE_LEAD_LIMIT = 50;
export const FREE_TAG_LIMIT = 5;
export const FREE_PRIORITY_LIMIT = 3;

const VALID_SOURCES = ['whatsapp', 'instagram', 'other'];
const VALID_STATUSES = ['new', 'active', 'converted', 'not_interested', 'lost'];
const VALID_EVENT_KINDS = ['note', 'contacted', 'replied', 'status_change', 'follow_up_set'];

function makeId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createInitialState(nowMs = Date.now()) {
  const ts = nowMs instanceof Date ? nowMs.getTime() : Number(nowMs);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    leads: [],
    events: [],
    catalogue: [],
    tags: SEED_TAGS.slice(0, 5).map((name, i) => ({ id: `tag_${i + 1}`, name })),
    settings: {
      sellerName: '',
      sellerHandle: '',
      language: DEFAULT_LANG,
      defaultFollowUpDays: 2,
      followUpDelayOptions: [1, 2, 7, 30],
      reminderEnabled: true,
      reminderHour: 9,
      morningSummary: true,
      quietHours: { start: 21, end: 9 },
      templates: [],
      tagTemplates: {},
      deviceName: '',
      cloud: { vaultId: null, salt: null, keyB64: null, autoSync: false, lastSyncAt: 0 },
      isPro: false,
      hasOnboarded: false,
      density: 'comfy',
      theme: 'light',
      lastOpenedAt: ts
    }
  };
}

function normalizeLead(l) {
  if (!l || typeof l !== 'object') {
    throw new Error('Invalid lead entry');
  }
  const source = VALID_SOURCES.includes(l.source) ? l.source : 'whatsapp';
  const status = VALID_STATUSES.includes(l.status) ? l.status : 'active';
  const createdAt = Number(l.createdAt ?? l.created_at ?? Date.now());
  const nextFollowUpAt =
    l.nextFollowUpAt !== undefined && l.nextFollowUpAt !== null
      ? Number(l.nextFollowUpAt)
      : l.next_follow_up_at !== undefined && l.next_follow_up_at !== null
        ? Number(l.next_follow_up_at)
        : null;
  const lastContactedAt =
    l.lastContactedAt !== undefined && l.lastContactedAt !== null
      ? Number(l.lastContactedAt)
      : l.last_contacted_at !== undefined && l.last_contacted_at !== null
        ? Number(l.last_contacted_at)
        : createdAt;

  const out = {
    id: String(l.id || makeId('lead')),
    name: String(l.name || '').trim() || 'New lead',
    handle: String(l.handle || '').trim(),
    source,
    interest: String(l.interest || '').trim(),
    status,
    priority: Boolean(l.priority),
    tags: Array.isArray(l.tags)
      ? Array.from(new Set(l.tags.map((t) => String(t).trim()).filter(Boolean)))
      : [],
    createdAt,
    nextFollowUpAt: status === 'active' || status === 'new' ? nextFollowUpAt : null,
    lastContactedAt,
    updatedAt: Number.isFinite(Number(l.updatedAt)) ? Number(l.updatedAt) : Math.max(createdAt, lastContactedAt)
  };
  if (isValidStage(l.stage)) {
    out.stage = l.stage;
  }
  if (l.archived) {
    out.archived = true;
  }
  if (l.convertedAt !== undefined && l.convertedAt !== null) {
    out.convertedAt = Number(l.convertedAt);
  }
  if (l.convertedValue !== undefined && l.convertedValue !== null && Number.isFinite(Number(l.convertedValue))) {
    out.convertedValue = Math.round(Number(l.convertedValue));
  }
  return out;
}

function normalizeEvent(e) {
  if (!e || typeof e !== 'object') {
    throw new Error('Invalid event entry');
  }
  const kind = VALID_EVENT_KINDS.includes(e.kind) ? e.kind : 'note';
  const out = {
    id: String(e.id || makeId('evt')),
    leadId: String(e.leadId ?? e.lead_id ?? ''),
    at: Number(e.at ?? e.when ?? Date.now()),
    kind,
    text: String(e.text ?? e.what ?? '').trim()
  };
  if (e.by) out.by = String(e.by).trim().slice(0, 40);
  return out;
}

function normalizeQuietHours(q) {
  const start = Number.isInteger(Number(q?.start)) ? ((Number(q.start) % 24) + 24) % 24 : 21;
  const end = Number.isInteger(Number(q?.end)) ? ((Number(q.end) % 24) + 24) % 24 : 9;
  return { start, end };
}

function normalizeTemplates(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && typeof x === 'object' && String(x.text || '').trim())
    .slice(0, 3)
    .map((x, i) => ({
      id: String(x.id || makeId('tpl')),
      name: String(x.name || '').trim() || `Template ${i + 1}`,
      text: String(x.text).trim().slice(0, 300)
    }));
}

function normalizeCloud(c) {
  const src = c && typeof c === 'object' ? c : {};
  return {
    vaultId: /^[0-9a-f]{32}$/.test(String(src.vaultId || '')) ? String(src.vaultId) : null,
    salt: src.salt ? String(src.salt) : null,
    keyB64: src.keyB64 ? String(src.keyB64) : null,
    autoSync: Boolean(src.autoSync),
    lastSyncAt: Number.isFinite(Number(src.lastSyncAt)) ? Number(src.lastSyncAt) : 0
  };
}

function normalizeTagTemplates(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  const out = {};
  for (const k of Object.keys(map)) {
    if (map[k]) out[String(k)] = String(map[k]);
  }
  return out;
}

export function migrate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid state data: must be an object');
  }
  const base = createInitialState();
  const sIn = data.settings && typeof data.settings === 'object' ? data.settings : {};

  const events = Array.isArray(data.events) ? data.events.map(normalizeEvent) : [];
  const leads = Array.isArray(data.leads)
    ? data.leads.map(normalizeLead).map((l) => ({ ...l, stage: deriveStage(l, events) }))
    : [];

  // Rebuild tags from data.tags + any lead.tags (matches README §8 restore rule)
  const tagMap = new Map();
  if (Array.isArray(data.tags)) {
    for (const tg of data.tags) {
      const name = typeof tg === 'string' ? tg.trim() : String(tg?.name || '').trim();
      if (name && !tagMap.has(name)) {
        tagMap.set(name, {
          id: typeof tg === 'object' && tg?.id ? String(tg.id) : makeId('tag'),
          name,
          ...(typeof tg === 'object' && tg?.color ? { color: String(tg.color) } : {})
        });
      }
    }
  }
  for (const l of leads) {
    for (const tName of l.tags) {
      if (tName && !tagMap.has(tName)) {
        tagMap.set(tName, { id: makeId('tag'), name: tName });
      }
    }
  }
  const tags = tagMap.size > 0 ? Array.from(tagMap.values()) : base.tags;

  const catalogue = Array.isArray(data.catalogue)
    ? data.catalogue
        .filter((p) => p && typeof p === 'object' && String(p.name || '').trim())
        .slice(0, 10)
        .map((p) => {
          const price = Math.round(Number(p.price));
          return {
            id: String(p.id || makeId('prd')),
            name: String(p.name).trim().slice(0, 60),
            price: Number.isFinite(price) && price >= 0 ? price : 0,
            photoId: p.photoId ? String(p.photoId) : null,
            updatedAt: Number.isFinite(Number(p.updatedAt)) ? Number(p.updatedAt) : Date.now()
          };
        })
    : [];

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    leads,
    events,
    catalogue,
    tags,
    settings: {
      ...base.settings,
      ...sIn,
      language: normalizeLang(sIn.language || base.settings.language),
      defaultFollowUpDays: Number(sIn.defaultFollowUpDays) > 0 ? Math.round(Number(sIn.defaultFollowUpDays)) : 2,
      followUpDelayOptions: Array.isArray(sIn.followUpDelayOptions) ? sIn.followUpDelayOptions : [1, 2, 7, 30],
      reminderEnabled: sIn.reminderEnabled !== undefined ? Boolean(sIn.reminderEnabled) : true,
      reminderHour: Number.isFinite(Number(sIn.reminderHour)) ? Number(sIn.reminderHour) : 9,
      morningSummary: sIn.morningSummary !== undefined ? Boolean(sIn.morningSummary) : true,
      quietHours: normalizeQuietHours(sIn.quietHours),
      templates: normalizeTemplates(sIn.templates),
      tagTemplates: normalizeTagTemplates(sIn.tagTemplates),
      deviceName: String(sIn.deviceName || '').trim().slice(0, 40),
      cloud: normalizeCloud(sIn.cloud),
      isPro: Boolean(sIn.isPro),
      hasOnboarded: Boolean(sIn.hasOnboarded),
      density: sIn.density === 'compact' ? 'compact' : 'comfy',
      theme: ['light', 'dark', 'system'].includes(sIn.theme) ? sIn.theme : 'light',
      lastOpenedAt: Number(sIn.lastOpenedAt || base.settings.lastOpenedAt)
    }
  };
}

export function loadState(storage = globalThis.localStorage) {
  if (!storage || typeof storage.getItem !== 'function') {
    return createInitialState();
  }
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    return createInitialState();
  }
  try {
    return migrate(JSON.parse(raw));
  } catch {
    return createInitialState();
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  const migrated = migrate(state);
  if (storage && typeof storage.setItem === 'function') {
    storage.setItem(STORAGE_KEY, JSON.stringify(migrated));
  }
  return migrated;
}

export function updateSettings(state, patch, storage = globalThis.localStorage) {
  const current = migrate(state);
  const next = migrate({
    ...current,
    settings: {
      ...current.settings,
      ...(patch || {})
    }
  });
  return saveState(next, storage);
}

export function getActiveLeadCount(state) {
  const current = migrate(state);
  return current.leads.filter((l) => l.status === 'active').length;
}

export function canAddActiveLead(state) {
  const current = migrate(state);
  if (current.settings.isPro) return true;
  return getActiveLeadCount(current) < FREE_ACTIVE_LEAD_LIMIT;
}

export function getPriorityLeadCount(state) {
  const current = migrate(state);
  return current.leads.filter((l) => l.status === 'active' && l.priority).length;
}

export function canAddTag(state) {
  const current = migrate(state);
  if (current.settings.isPro) return true;
  return current.tags.length < FREE_TAG_LIMIT;
}

export function addTag(state, tagName, storage = globalThis.localStorage) {
  const current = migrate(state);
  const cleanName = String(tagName || '').trim();
  if (!cleanName) {
    throw new Error('Tag name cannot be empty');
  }
  if (current.tags.some((t) => t.name.toLowerCase() === cleanName.toLowerCase())) {
    return current;
  }
  if (!canAddTag(current)) {
    const err = new Error(`Free plan supports up to ${FREE_TAG_LIMIT} active tags. Upgrade to Pro.`);
    err.code = 'PRO_TAG_LIMIT';
    throw err;
  }
  const next = migrate({
    ...current,
    tags: [...current.tags, { id: makeId('tag'), name: cleanName }]
  });
  return saveState(next, storage);
}

/**
 * Create a new lead with initial 'Lead added' event.
 * Enforces 50 active leads free cap and 3 priority leads free cap unless `settings.isPro` is true.
 */
export function createLead(state, input, storage = globalThis.localStorage, nowMs = Date.now()) {
  const current = migrate(state);
  if (!canAddActiveLead(current)) {
    const err = new Error(`Free plan limit of ${FREE_ACTIVE_LEAD_LIMIT} active leads reached. Upgrade to FollowUp Buddy Pro.`);
    err.code = 'PRO_LIMIT_REACHED';
    throw err;
  }

  const wantsPriority = Boolean(input?.priority);
  if (wantsPriority && !current.settings.isPro && getPriorityLeadCount(current) >= FREE_PRIORITY_LIMIT) {
    const err = new Error(`Free plan supports up to ${FREE_PRIORITY_LIMIT} priority leads. Upgrade to Pro.`);
    err.code = 'PRO_PRIORITY_LIMIT';
    throw err;
  }

  const now = nowMs instanceof Date ? nowMs.getTime() : Number(nowMs);
  const followUpDays = Number.isFinite(Number(input?.followUpDays))
    ? Number(input.followUpDays)
    : current.settings.defaultFollowUpDays;
  const nextFollowUpAt =
    input?.nextFollowUpAt !== undefined
      ? Number(input.nextFollowUpAt)
      : now + followUpDays * DAY_MS;

  const lead = normalizeLead({
    id: input?.id || makeId('lead'),
    name: String(input?.name || '').trim() || 'New lead',
    handle: String(input?.handle || '').trim(),
    source: input?.source || 'whatsapp',
    interest: String(input?.interest || '').trim(),
    status: 'active',
    priority: wantsPriority,
    tags: Array.isArray(input?.tags) ? input.tags : [],
    createdAt: now,
    nextFollowUpAt,
    lastContactedAt: now
  });

  const initialEvent = normalizeEvent({
    id: makeId('evt'),
    leadId: lead.id,
    at: now,
    kind: 'note',
    text: 'Lead added'
  });

  const next = migrate({
    ...current,
    leads: [lead, ...current.leads],
    events: [initialEvent, ...current.events]
  });
  return saveState(next, storage);
}

/**
 * Append a history event and mirror SQLite trigger `trg_event_touch`
 * (updates `lead.lastContactedAt` when `kind` is `'contacted'` or `'note'`).
 * Supports both `logLeadEvent(state, { leadId, kind, text, at }, storage)`
 * and `logLeadEvent(state, leadId, kind, text, storage, at)`.
 */
export function logLeadEvent(state, arg1, arg2, arg3, arg4, arg5) {
  const current = migrate(state);
  let leadId, kind, text, at, storage;
  let by = current.settings.deviceName || undefined;
  if (arg1 && typeof arg1 === 'object') {
    leadId = arg1.leadId;
    kind = arg1.kind || 'note';
    text = arg1.text || '';
    at = arg1.at !== undefined ? arg1.at : Date.now();
    if (arg1.by) by = arg1.by;
    storage = arg2 !== undefined ? arg2 : globalThis.localStorage;
  } else {
    leadId = arg1;
    kind = arg2 || 'note';
    text = arg3 || '';
    storage = arg4 !== undefined ? arg4 : globalThis.localStorage;
    at = arg5 !== undefined ? arg5 : Date.now();
  }
  const ts = at instanceof Date ? at.getTime() : Number(at);
  const evt = normalizeEvent({
    id: makeId('evt'),
    leadId,
    at: ts,
    kind,
    text,
    by
  });

  const shouldTouch = kind === 'contacted' || kind === 'note' || kind === 'replied';
  const movesStage = kind === 'contacted' || kind === 'replied';
  const nextLeads = current.leads.map((l) => {
    if (l.id !== leadId) return l;
    const stage = movesStage ? stageAfterOutcome(l.stage, kind) : l.stage;
    return shouldTouch ? { ...l, stage, lastContactedAt: ts, updatedAt: ts } : { ...l, stage, updatedAt: ts };
  });

  return saveState(
    {
      ...current,
      leads: nextLeads,
      events: [evt, ...current.events]
    },
    storage
  );
}

/**
 * Update a lead's terminal or active status (`converted`, `not_interested`, `lost`, `active`)
 * and write a `status_change` history event.
 */
export function setLeadStatus(state, leadId, status, meta = {}, storage = globalThis.localStorage, nowMs = Date.now()) {
  const current = migrate(state);
  const ts = nowMs instanceof Date ? nowMs.getTime() : Number(nowMs);
  const isTerminal = ['converted', 'not_interested', 'lost'].includes(status);
  const convVal =
    typeof meta === 'number'
      ? meta
      : meta && meta.convertedValue !== undefined && meta.convertedValue !== null && meta.convertedValue !== ''
        ? Number(meta.convertedValue)
        : null;

  const nextLeads = current.leads.map((l) => {
    if (l.id !== leadId) return l;
    const outcome = status === 'converted' ? 'ordered' : status === 'active' ? 'reopen' : status;
    const updated = {
      ...l,
      status,
      stage: stageAfterOutcome(l.stage, outcome),
      updatedAt: ts,
      nextFollowUpAt: isTerminal ? null : l.nextFollowUpAt
    };
    if (status === 'converted') {
      updated.convertedAt = ts;
      if (convVal !== null && Number.isFinite(convVal) && convVal > 0) {
        updated.convertedValue = Math.round(convVal);
      }
    }
    return updated;
  });

  const labelMap = {
    converted: convVal ? `Marked as Converted (₹${Math.round(convVal)})` : 'Marked as Converted',
    not_interested: 'Marked as Not interested',
    lost: 'Marked as Lost',
    active: 'Reopened as Active'
  };

  const evt = normalizeEvent({
    id: makeId('evt'),
    leadId,
    at: ts,
    kind: 'status_change',
    text: labelMap[status] || `Status changed to ${status}`,
    by: current.settings.deviceName || undefined
  });

  return saveState(
    {
      ...current,
      leads: nextLeads,
      events: [evt, ...current.events]
    },
    storage
  );
}

export const updateLeadStatus = setLeadStatus;

/**
 * Archive or unarchive a lead.
 */
export function archiveLead(state, leadId, archived = true, storage = globalThis.localStorage) {
  const current = migrate(state);
  const nextLeads = current.leads.map((l) =>
    l.id === leadId ? { ...l, archived: Boolean(archived), updatedAt: Date.now() } : l
  );
  return saveState({ ...current, leads: nextLeads }, storage);
}

/**
 * Reschedule a lead's `nextFollowUpAt` (accepts either a relative day count <= 365 or an epoch timestamp)
 * and record a `follow_up_set` event.
 */
export function rescheduleFollowUp(state, leadId, nextFollowUpAtOrDays, storage = globalThis.localStorage, nowMs = Date.now()) {
  const current = migrate(state);
  const ts = nowMs instanceof Date ? nowMs.getTime() : Number(nowMs);
  const rawNum = nextFollowUpAtOrDays instanceof Date ? nextFollowUpAtOrDays.getTime() : Number(nextFollowUpAtOrDays);
  const targetMs = rawNum <= 365 ? ts + rawNum * DAY_MS : rawNum;

  const nextLeads = current.leads.map((l) => {
    if (l.id !== leadId) return l;
    return {
      ...l,
      status: 'active',
      nextFollowUpAt: targetMs,
      updatedAt: ts
    };
  });

  const dStr = new Date(targetMs).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const evt = normalizeEvent({
    id: makeId('evt'),
    leadId,
    at: ts,
    kind: 'follow_up_set',
    text: `Follow-up rescheduled to ${dStr}`,
    by: current.settings.deviceName || undefined
  });

  return saveState(
    {
      ...current,
      leads: nextLeads,
      events: [evt, ...current.events]
    },
    storage
  );
}

export function getLeadEvents(state, leadId) {
  const current = migrate(state);
  return current.events
    .filter((e) => e.leadId === leadId)
    .slice()
    .sort((a, b) => b.at - a.at)
    .map((e) => ({
      ...e,
      createdAt: e.at,
      body: e.text
    }));
}

export function seedSampleLeads(state, storage = globalThis.localStorage, anchorNowMs = Date.now()) {
  const current = migrate(state);
  const { leads, events, tags } = buildSeedDataset(anchorNowMs);
  const next = migrate({
    ...current,
    leads,
    events,
    tags,
    settings: {
      ...current.settings,
      hasOnboarded: true
    }
  });
  return saveState(next, storage);
}

/**
 * Wipe everything from storage and return a fresh initial state (onboarding shows again).
 */
export function clearAllData(storage = globalThis.localStorage) {
  if (storage && typeof storage.removeItem === 'function') {
    storage.removeItem(STORAGE_KEY);
  }
  return createInitialState();
}

/** Backup payload: full state minus the on-device cloud key (never leaves this phone in a file/vault). */
export function backupPayload(state) {
  const clean = migrate(state);
  const { cloud, ...settings } = clean.settings;
  return { ...clean, settings: { ...settings, cloud: { vaultId: cloud.vaultId, salt: cloud.salt, keyB64: null, autoSync: false, lastSyncAt: 0 } } };
}

export function exportBackupJson(state) {
  return JSON.stringify(backupPayload(state), null, 2);
}

export function importBackupJson(jsonString, storage = globalThis.localStorage) {
  if (typeof jsonString !== 'string' || !jsonString.trim()) {
    throw new Error('Backup content must be a non-empty JSON string');
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error('Invalid JSON in backup file');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Backup root must be a JSON object');
  }
  if (!Array.isArray(parsed.leads)) {
    throw new Error('Backup missing required leads array');
  }
  const migrated = migrate(parsed);
  return saveState(migrated, storage);
}

export function exportLeadsCsv(state) {
  const current = migrate(state);
  if (!current.settings.isPro) {
    const err = new Error('CSV export requires FollowUp Buddy Pro');
    err.code = 'PRO_REQUIRED';
    throw err;
  }
  const header = ['Name', 'Handle', 'Source', 'Status', 'Priority', 'Interest', 'Tags', 'ConvertedValue'];
  const rows = [header.join(',')];
  for (const l of current.leads) {
    rows.push(
      [
        `"${String(l.name).replace(/"/g, '""')}"`,
        `"${String(l.handle).replace(/"/g, '""')}"`,
        l.source,
        l.status,
        l.priority ? '1' : '0',
        `"${String(l.interest).replace(/"/g, '""')}"`,
        `"${l.tags.join(';').replace(/"/g, '""')}"`,
        l.convertedValue ?? ''
      ].join(',')
    );
  }
  return rows.join('\n');
}
