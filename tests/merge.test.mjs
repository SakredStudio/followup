import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeStates, mergeLeads, mergeEvents, lastTouchedBy } from '../lib/merge.js';
import { createInitialState, createLead, logLeadEvent, migrate } from '../lib/store.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

const lead = (id, updatedAt, extra = {}) => ({ id, name: `L${id}`, status: 'active', createdAt: 1, lastContactedAt: 1, updatedAt, ...extra });

test('merge: six conflict fixtures for leads', () => {
  // 1. only local
  assert.deepEqual(mergeLeads([lead('a', 10)], []).map((l) => l.id), ['a']);
  // 2. only remote
  assert.deepEqual(mergeLeads([], [lead('b', 10)]).map((l) => l.id), ['b']);
  // 3. same id, remote newer → remote wins
  let m = mergeLeads([lead('c', 10, { name: 'old' })], [lead('c', 20, { name: 'new' })]);
  assert.equal(m[0].name, 'new');
  // 4. same id, local newer → local wins
  m = mergeLeads([lead('d', 30, { name: 'mine' })], [lead('d', 20, { name: 'theirs' })]);
  assert.equal(m[0].name, 'mine');
  // 5. tie → local wins
  m = mergeLeads([lead('e', 20, { name: 'local' })], [lead('e', 20, { name: 'remote' })]);
  assert.equal(m[0].name, 'local');
  // 6. disjoint sets → union sorted newest first
  m = mergeLeads([lead('f', 5), lead('g', 50)], [lead('h', 25)]);
  assert.deepEqual(m.map((l) => l.id), ['g', 'h', 'f']);
  // bonus: archived locally but remote edited later → remote (unarchived) wins by updatedAt
  m = mergeLeads([lead('i', 10, { archived: true })], [lead('i', 11)]);
  assert.equal(Boolean(m[0].archived), false);
});

test('merge: events union by id, tags by name, catalogue by id, settings local-first', () => {
  const ev = mergeEvents(
    [{ id: 'e1', leadId: 'a', at: 5, kind: 'note', text: 'x' }, { id: 'e2', leadId: 'a', at: 9, kind: 'contacted', text: 'y', by: 'Phone A' }],
    [{ id: 'e2', leadId: 'a', at: 9, kind: 'contacted', text: 'dupe' }, { id: 'e3', leadId: 'a', at: 7, kind: 'replied', text: 'z', by: 'Phone B' }]
  );
  assert.deepEqual(ev.map((e) => e.id), ['e2', 'e3', 'e1']);
  assert.equal(ev[0].text, 'y', 'first copy kept on id collision');

  const local = {
    leads: [lead('a', 10)],
    events: [],
    tags: [{ id: 't1', name: 'Cakes' }],
    catalogue: [{ id: 'p1', name: 'A', price: 1, updatedAt: 5 }],
    settings: { language: 'hi', isPro: true, deviceName: 'Anjali phone', cloud: { vaultId: 'x' }, templates: [{ id: 'tA', name: 'A', text: 'a' }], tagTemplates: { Cakes: 'tA' } }
  };
  const remote = {
    leads: [lead('b', 20)],
    events: [{ id: 'e9', leadId: 'b', at: 20, kind: 'contacted', text: 'q', by: 'Assistant' }],
    tags: [{ id: 't9', name: 'cakes' }, { id: 't2', name: 'Sarees' }],
    catalogue: [{ id: 'p1', name: 'A2', price: 2, updatedAt: 9 }, { id: 'p2', name: 'B', price: 3, updatedAt: 1 }],
    settings: { language: 'en', isPro: false, deviceName: 'Assistant', cloud: { vaultId: 'y' }, templates: [{ id: 'tB', name: 'B', text: 'b' }], tagTemplates: { Sarees: 'tB', Cakes: 'tB' } }
  };
  const m = mergeStates(local, remote);
  assert.deepEqual(m.leads.map((l) => l.id), ['b', 'a']);
  assert.equal(m.events.length, 1);
  assert.deepEqual(m.tags.map((x) => x.name), ['Cakes', 'Sarees'], 'case-insensitive tag union');
  assert.equal(m.catalogue.find((p) => p.id === 'p1').name, 'A2', 'newer catalogue row wins');
  assert.equal(m.catalogue.length, 2);
  assert.equal(m.settings.language, 'hi');
  assert.equal(m.settings.isPro, true);
  assert.equal(m.settings.deviceName, 'Anjali phone');
  assert.equal(m.settings.cloud.vaultId, 'x');
  assert.deepEqual(m.settings.templates.map((x) => x.id), ['tA', 'tB']);
  assert.deepEqual(m.settings.tagTemplates, { Sarees: 'tB', Cakes: 'tA' }, 'local assignment wins, remote fills');

  // merged output survives migrate()
  const ok = migrate(m);
  assert.equal(ok.leads.length, 2);
});

test('merge: lastTouchedBy reads the newest event with a device name; store stamps `by`', () => {
  const storage = mem();
  let state = createLead(createInitialState(), { name: 'Neha', handle: '9820911223' }, storage, 1000);
  const id = state.leads[0].id;
  state = logLeadEvent(state, { leadId: id, kind: 'contacted', text: 'Sent WA', at: 2000, by: 'Anjali phone' }, storage);
  state = logLeadEvent(state, { leadId: id, kind: 'note', text: 'Will call', at: 3000, by: 'Assistant' }, storage);
  const who = lastTouchedBy(id, state.events);
  assert.equal(who.by, 'Assistant');
  assert.equal(who.at, 3000);
  assert.equal(lastTouchedBy('nope', state.events), null);
  assert.equal(state.events.find((e) => e.text === 'Will call').by, 'Assistant');
});
