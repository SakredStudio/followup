import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TEMPLATES,
  resolveTemplate,
  renderSellerVars,
  buildMessageForLead,
  saveTemplate,
  deleteTemplate,
  assignTagTemplate,
  validateTemplateText
} from '../lib/templates.js';
import { SHARE_LINE, DEFAULT_FOLLOWUP_TEMPLATE } from '../lib/channels.js';
import { createInitialState, updateSettings, migrate } from '../lib/store.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

const lead = { id: 'l1', name: 'Priya Sharma', interest: 'red velvet 1kg', tags: ['Cakes', 'Eggless'] };

test('templates: free tier always resolves to the default, Pro resolves by tag order', () => {
  const storage = mem();
  let state = createInitialState();
  assert.throws(() => saveTemplate(state, { name: 'x', text: 'Hi {name}' }, storage), /Pro/);

  state = updateSettings(state, { isPro: true, sellerName: 'Anjali' }, storage);
  state = saveTemplate(state, { name: 'Cakes opener', text: 'Hi {firstName}, {seller} here from Sweet Tooth. Still want the {interest}?' }, storage);
  state = saveTemplate(state, { name: 'Eggless', text: 'Namaste {name}! Eggless {interest} ready hai.' }, storage);
  assert.equal(state.settings.templates.length, 2);

  // nothing assigned yet → default
  assert.equal(resolveTemplate(lead, state.settings).via, 'default');

  const cakesId = state.settings.templates[0].id;
  const egglessId = state.settings.templates[1].id;
  state = assignTagTemplate(state, 'Eggless', egglessId, storage);
  assert.equal(resolveTemplate(lead, state.settings).templateId, egglessId, 'only Eggless assigned');
  state = assignTagTemplate(state, 'Cakes', cakesId, storage);
  assert.equal(resolveTemplate(lead, state.settings).templateId, cakesId, 'first tag on the lead wins');

  // a lead whose tags have no template → default
  assert.equal(resolveTemplate({ ...lead, tags: ['Sarees'] }, state.settings).via, 'default');

  // Pro lapses → default again even though data is still there
  const free = updateSettings(state, { isPro: false }, storage);
  assert.equal(resolveTemplate(lead, free.settings).via, 'default');
});

test('templates: variables and mandatory share line', () => {
  const settings = {
    isPro: true,
    sellerName: 'Anjali',
    templates: [{ id: 't1', name: 'A', text: 'Hi {firstName} ({name}), {seller} here. About the {interest}.' }],
    tagTemplates: { Cakes: 't1' }
  };
  const msg = buildMessageForLead(lead, settings);
  assert.ok(msg.startsWith('Hi Priya (Priya Sharma), Anjali here. About the red velvet 1kg.'));
  assert.ok(msg.endsWith(SHARE_LINE), 'share line appended');

  assert.equal(renderSellerVars('{name}/{seller}', { lead: { name: '' }, seller: '' }), 'there/');

  const def = buildMessageForLead(lead, { isPro: false }, DEFAULT_FOLLOWUP_TEMPLATE);
  assert.ok(def.startsWith('Hi Priya! Following up on the red velvet 1kg.'));
  assert.ok(def.includes(SHARE_LINE));
});

test('templates: limit of 3, edit by id, delete clears assignments, migrate normalises', () => {
  const storage = mem();
  let state = updateSettings(createInitialState(), { isPro: true }, storage);
  for (let i = 0; i < MAX_TEMPLATES; i++) state = saveTemplate(state, { name: `T${i}`, text: `Text ${i}` }, storage);
  assert.throws(() => saveTemplate(state, { name: 'extra', text: 'x' }, storage), (e) => e.code === 'TEMPLATE_LIMIT');
  assert.throws(() => saveTemplate(state, { name: 'x', text: '   ' }, storage), (e) => e.code === 'TEMPLATE_EMPTY');
  assert.equal(validateTemplateText('a'.repeat(301)).ok, false);

  const id = state.settings.templates[1].id;
  state = saveTemplate(state, { id, name: 'Renamed', text: 'New text' }, storage);
  assert.equal(state.settings.templates.length, 3);
  assert.equal(state.settings.templates[1].name, 'Renamed');

  state = assignTagTemplate(state, 'Cakes', id, storage);
  assert.equal(state.settings.tagTemplates.Cakes, id);
  state = deleteTemplate(state, id, storage);
  assert.equal(state.settings.templates.length, 2);
  assert.equal(state.settings.tagTemplates.Cakes, undefined);

  const m = migrate({ leads: [], settings: { templates: [{ text: '' }, { text: 'ok' }], tagTemplates: { A: '', B: 'z' } } });
  assert.equal(m.settings.templates.length, 1);
  assert.deepEqual(m.settings.tagTemplates, { B: 'z' });
});
