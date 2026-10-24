import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY,
  FREE_ACTIVE_LEAD_LIMIT,
  createInitialState,
  loadState,
  saveState,
  updateSettings,
  createLead,
  logLeadEvent,
  setLeadStatus,
  rescheduleFollowUp,
  getLeadEvents,
  seedSampleLeads,
  exportBackupJson,
  importBackupJson,
  exportLeadsCsv
} from '../lib/store.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    clear() { map.clear(); }
  };
}

test('store: createInitialState and save/load round-trip on fub.v1', () => {
  const mem = createMemoryStorage();
  const s0 = createInitialState(1700000000000);
  assert.equal(STORAGE_KEY, 'fub.v1');
  saveState(s0, mem);
  assert.deepEqual(loadState(mem), s0);
});

test('store: trg_event_touch updates lastContactedAt on note/contacted but not status_change', () => {
  const mem = createMemoryStorage();
  let state = createInitialState(1000);
  state = createLead(state, { id: 'l1', name: 'Priya Sharma', handle: '+91 98765 43210', source: 'whatsapp' }, mem, 1000);
  assert.equal(state.leads[0].lastContactedAt, 1000);

  state = logLeadEvent(state, { leadId: 'l1', kind: 'contacted', text: 'Sent menu', at: 5000 }, mem);
  assert.equal(state.leads[0].lastContactedAt, 5000);

  state = setLeadStatus(state, 'l1', 'converted', { convertedValue: 1200 }, mem, 9000);
  const lead = state.leads[0];
  assert.equal(lead.status, 'converted');
  assert.equal(lead.convertedValue, 1200);
  assert.equal(lead.nextFollowUpAt, null);
  assert.equal(lead.lastContactedAt, 5000); // unchanged by status_change
  assert.equal(getLeadEvents(state, 'l1').length, 3);
});

test('store: enforces 50 active leads free limit and 3 priority leads free limit', () => {
  const mem = createMemoryStorage();
  let state = createInitialState(1000);

  // Add 3 priority leads
  for (let i = 1; i <= 3; i++) {
    state = createLead(state, { name: `Priority ${i}`, priority: true }, mem, 1000);
  }
  assert.throws(
    () => createLead(state, { name: 'Priority 4', priority: true }, mem, 1000),
    (err) => err.code === 'PRO_PRIORITY_LIMIT'
  );

  // Fill up to 50 active leads
  for (let i = 4; i <= FREE_ACTIVE_LEAD_LIMIT; i++) {
    state = createLead(state, { name: `Lead ${i}`, priority: false }, mem, 1000);
  }
  assert.throws(
    () => createLead(state, { name: 'Lead 51', priority: false }, mem, 1000),
    (err) => err.code === 'PRO_LIMIT_REACHED'
  );

  // Unlock Pro -> 51st lead succeeds
  state = updateSettings(state, { isPro: true }, mem);
  state = createLead(state, { name: 'Lead 51', priority: true }, mem, 1000);
  assert.equal(state.leads.length, 51);
});

test('store: enforces 5 active tags free limit and unlocks with Pro', async () => {
  const { addTag, canAddTag } = await import('../lib/store.js');
  const mem = createMemoryStorage();
  let state = createInitialState(1000);
  // Initial state already has 5 tags
  assert.equal(state.tags.length, 5);
  assert.equal(canAddTag(state), false);
  assert.throws(
    () => addTag(state, 'CustomTag6', mem),
    (err) => err.code === 'PRO_TAG_LIMIT'
  );
  state = updateSettings(state, { isPro: true }, mem);
  state = addTag(state, 'CustomTag6', mem);
  assert.equal(state.tags.length, 6);
});

test('store: seedSampleLeads(14), rescheduleFollowUp, JSON backup round-trip, and Pro CSV export', () => {
  const mem = createMemoryStorage();
  let state = seedSampleLeads(createInitialState(1000), mem, 1000);
  assert.equal(state.leads.length, 14);

  state = rescheduleFollowUp(state, 'lead_1', 999000, mem, 2000);
  assert.equal(state.leads.find((l) => l.id === 'lead_1').nextFollowUpAt, 999000);

  const json = exportBackupJson(state);
  const mem2 = createMemoryStorage();
  const restored = importBackupJson(json, mem2);
  assert.equal(restored.leads.length, 14);

  assert.throws(() => exportLeadsCsv(restored), (err) => err.code === 'PRO_REQUIRED');
  const proState = updateSettings(restored, { isPro: true }, mem2);
  assert.ok(exportLeadsCsv(proState).includes('Priya Sharma'));
});
