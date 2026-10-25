// Pure ES module for per-tag message templates (v2, Pro).
// Up to 3 saved templates with {name} {firstName} {interest} {seller}; a template can be
// assigned to a tag; the lead's first tag with a template wins, else the default template.
// The share line is always appended by channels.buildFollowUpMessage — never here, never skipped.

import { buildFollowUpMessage, DEFAULT_FOLLOWUP_TEMPLATE } from './channels.js';
import { migrate, saveState } from './store.js';

export const MAX_TEMPLATES = 3;
export const MAX_TEMPLATE_CHARS = 300;
export const TEMPLATE_VARS = ['name', 'firstName', 'interest', 'seller'];

function makeId() {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function validateTemplateText(text) {
  const s = String(text || '').trim();
  if (!s) return { ok: false, reason: 'empty' };
  if (s.length > MAX_TEMPLATE_CHARS) return { ok: false, reason: 'too_long' };
  return { ok: true };
}

/**
 * Pick the template text for a lead.
 * Returns { text, templateId, via: 'tag' | 'default' }.
 * Free tier always gets the default (templates are a Pro feature) even if data lingers.
 */
export function resolveTemplate(lead, settings = {}, fallback = DEFAULT_FOLLOWUP_TEMPLATE) {
  const def = { text: fallback || DEFAULT_FOLLOWUP_TEMPLATE, templateId: null, via: 'default' };
  if (!settings || !settings.isPro) return def;
  const templates = Array.isArray(settings.templates) ? settings.templates : [];
  const map = settings.tagTemplates && typeof settings.tagTemplates === 'object' ? settings.tagTemplates : {};
  if (templates.length === 0) return def;
  for (const tag of Array.isArray(lead?.tags) ? lead.tags : []) {
    const id = map[tag];
    if (!id) continue;
    const tpl = templates.find((x) => x.id === id);
    if (tpl && String(tpl.text || '').trim()) return { text: tpl.text, templateId: tpl.id, via: 'tag' };
  }
  return def;
}

/** Replace {name} and {seller}; {firstName} and {interest} are handled by channels.js. */
export function renderSellerVars(text, { lead, seller } = {}) {
  const name = String(lead?.name || '').trim() || 'there';
  const sellerName = String(seller || '').trim();
  return String(text || '')
    .replace(/\{name\}/g, name)
    .replace(/\{seller\}/g, sellerName);
}

/** Full outgoing message for a lead: resolved template + variables + mandatory share line. */
export function buildMessageForLead(lead, settings = {}, fallback = DEFAULT_FOLLOWUP_TEMPLATE) {
  const { text } = resolveTemplate(lead, settings, fallback);
  const rendered = renderSellerVars(text, { lead, seller: settings.sellerName });
  return buildFollowUpMessage(lead, true, rendered);
}

/** Create or update a template (Pro only, max 3). Throws with .code on limits. */
export function saveTemplate(state, input, storage = globalThis.localStorage) {
  const current = migrate(state);
  if (!current.settings.isPro) {
    const err = new Error('Message templates require FollowUp Buddy Pro');
    err.code = 'PRO_REQUIRED';
    throw err;
  }
  const v = validateTemplateText(input?.text);
  if (!v.ok) {
    const err = new Error(`Invalid template: ${v.reason}`);
    err.code = v.reason === 'empty' ? 'TEMPLATE_EMPTY' : 'TEMPLATE_TOO_LONG';
    throw err;
  }
  const list = Array.isArray(current.settings.templates) ? current.settings.templates.slice() : [];
  const id = input?.id ? String(input.id) : null;
  const name = String(input?.name || '').trim() || `Template ${list.length + 1}`;
  const text = String(input.text).trim();
  const idx = id ? list.findIndex((x) => x.id === id) : -1;
  if (idx >= 0) {
    list[idx] = { ...list[idx], name, text };
  } else {
    if (list.length >= MAX_TEMPLATES) {
      const err = new Error(`Up to ${MAX_TEMPLATES} templates`);
      err.code = 'TEMPLATE_LIMIT';
      throw err;
    }
    list.push({ id: makeId(), name, text });
  }
  return saveState({ ...current, settings: { ...current.settings, templates: list } }, storage);
}

export function deleteTemplate(state, templateId, storage = globalThis.localStorage) {
  const current = migrate(state);
  const list = (current.settings.templates || []).filter((x) => x.id !== templateId);
  const map = { ...(current.settings.tagTemplates || {}) };
  for (const k of Object.keys(map)) if (map[k] === templateId) delete map[k];
  return saveState({ ...current, settings: { ...current.settings, templates: list, tagTemplates: map } }, storage);
}

/** Assign (templateId) or clear (null) the template for a tag. */
export function assignTagTemplate(state, tagName, templateId, storage = globalThis.localStorage) {
  const current = migrate(state);
  const map = { ...(current.settings.tagTemplates || {}) };
  const tag = String(tagName || '').trim();
  if (!tag) return current;
  if (templateId && (current.settings.templates || []).some((x) => x.id === templateId)) {
    map[tag] = templateId;
  } else {
    delete map[tag];
  }
  return saveState({ ...current, settings: { ...current.settings, tagTemplates: map } }, storage);
}
