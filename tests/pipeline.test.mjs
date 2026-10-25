import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, deriveStage, stageAfterOutcome, groupByStage, stageForStatus } from '../lib/pipeline.js';
import { createInitialState, createLead, logLeadEvent, setLeadStatus, migrate } from '../lib/store.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('pipeline: status transitions follow the table', () => {
  assert.deepEqual(STAGES, ['new', 'contacted', 'interested', 'ordered', 'lost']);
  assert.equal(stageAfterOutcome('new', 'contacted'), 'contacted');
  assert.equal(stageAfterOutcome('contacted', 'contacted'), 'contacted');
  assert.equal(stageAfterOutcome('interested', 'contacted'), 'interested');
  assert.equal(stageAfterOutcome('new', 'replied'), 'contacted');
  assert.equal(stageAfterOutcome('contacted', 'replied'), 'interested');
  assert.equal(stageAfterOutcome('interested', 'replied'), 'interested');
  assert.equal(stageAfterOutcome('interested', 'no_reply'), 'interested');
  assert.equal(stageAfterOutcome('contacted', 'ordered'), 'ordered');
  assert.equal(stageAfterOutcome('interested', 'lost'), 'lost');
  assert.equal(stageAfterOutcome('new', 'not_interested'), 'lost');
  assert.equal(stageAfterOutcome('ordered', 'replied'), 'ordered', 'terminal lanes do not move on replies');
  assert.equal(stageAfterOutcome('lost', 'contacted'), 'lost');
  assert.equal(stageAfterOutcome('lost', 'reopen'), 'contacted');
  assert.equal(stageAfterOutcome('garbage', 'no_reply'), 'new');
});

test('pipeline: deriveStage maps v1 statuses and history', () => {
  assert.equal(stageForStatus('converted'), 'ordered');
  assert.equal(stageForStatus('not_interested'), 'lost');
  assert.equal(stageForStatus('active'), null);
  const ev = [
    { id: 'e1', leadId: 'a', kind: 'contacted' },
    { id: 'e2', leadId: 'b', kind: 'replied' }
  ];
  assert.equal(deriveStage({ id: 'a', status: 'active' }, ev), 'contacted');
  assert.equal(deriveStage({ id: 'b', status: 'active' }, ev), 'interested');
  assert.equal(deriveStage({ id: 'c', status: 'active' }, ev), 'new');
  assert.equal(deriveStage({ id: 'c', status: 'active', stage: 'interested' }, ev), 'interested');
  assert.equal(deriveStage({ id: 'c', status: 'converted', stage: 'new' }, ev), 'ordered');
});

test('pipeline: migrate fills stage for v1 data; store mutations move lanes', () => {
  const storage = mem();
  const v1 = {
    leads: [
      { id: 'l1', name: 'A', status: 'active', createdAt: 1 },
      { id: 'l2', name: 'B', status: 'converted', createdAt: 1, convertedValue: 500 },
      { id: 'l3', name: 'C', status: 'active', createdAt: 1 }
    ],
    events: [{ id: 'e1', leadId: 'l3', kind: 'contacted', at: 2, text: 'x' }]
  };
  const m = migrate(v1);
  assert.equal(m.leads.find((l) => l.id === 'l1').stage, 'new');
  assert.equal(m.leads.find((l) => l.id === 'l2').stage, 'ordered');
  assert.equal(m.leads.find((l) => l.id === 'l3').stage, 'contacted');

  let state = createLead(createInitialState(), { name: 'Neha', handle: '9820911223' }, storage, 1000);
  const id = state.leads[0].id;
  assert.equal(state.leads[0].stage, 'new');
  state = logLeadEvent(state, id, 'contacted', 'Sent WhatsApp follow-up', storage, 2000);
  assert.equal(state.leads[0].stage, 'contacted');
  state = logLeadEvent(state, id, 'replied', 'Lead replied', storage, 3000);
  assert.equal(state.leads[0].stage, 'interested');
  assert.equal(state.leads[0].lastContactedAt, 3000, 'replied touches lastContactedAt');
  state = setLeadStatus(state, id, 'converted', 900, storage, 4000);
  assert.equal(state.leads[0].stage, 'ordered');
  state = setLeadStatus(state, id, 'active', {}, storage, 5000);
  assert.equal(state.leads[0].stage, 'contacted');
  state = setLeadStatus(state, id, 'lost', {}, storage, 6000);
  assert.equal(state.leads[0].stage, 'lost');

  const lanes = groupByStage(state.leads, state.events);
  assert.equal(lanes.lost.length, 1);
  assert.equal(lanes.new.length, 0);
  assert.deepEqual(Object.keys(lanes), STAGES);
});

test('pipeline: groupByStage skips archived and sorts newest first', () => {
  const lanes = groupByStage([
    { id: '1', status: 'active', stage: 'new', updatedAt: 10 },
    { id: '2', status: 'active', stage: 'new', updatedAt: 30 },
    { id: '3', status: 'active', stage: 'new', updatedAt: 20, archived: true }
  ]);
  assert.deepEqual(lanes.new.map((l) => l.id), ['2', '1']);
});
