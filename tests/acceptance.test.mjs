import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createInitialState,
  seedSampleLeads,
  createLead,
  updateLeadStatus,
  rescheduleFollowUp,
  logLeadEvent,
  archiveLead,
  exportBackupJson,
  importBackupJson,
  exportLeadsCsv,
  updateSettings
} from '../lib/store.js';
import { categorize, filterLeads } from '../lib/categorize.js';
import { buildFollowUpMessage, buildWhatsAppUrl, buildInstagramWebUrl, APP_LINK } from '../lib/channels.js';
import { PROTOTYPE_ANCHOR_MS } from '../lib/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');

function makeMemStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

test('acceptance: zero external CDN requests and all sw.js precache assets exist on disk', () => {
  const filesToScan = [
    'index.html',
    'privacy.html',
    'styles.css',
    'app.js',
    'sw.js',
    'fonts/fonts.css'
  ];

  for (const rel of filesToScan) {
    const full = path.join(APP_DIR, rel);
    assert.ok(fs.existsSync(full), `Missing file: ${rel}`);
    const content = fs.readFileSync(full, 'utf8');
    assert.ok(!content.includes('fonts.googleapis.com'), `${rel} must not use Google Fonts CDN`);
    assert.ok(!content.includes('fonts.gstatic.com'), `${rel} must not use gstatic CDN`);
    assert.ok(!content.includes('unpkg.com'), `${rel} must not use unpkg CDN`);
    assert.ok(!content.includes('cdn.jsdelivr.net'), `${rel} must not use jsdelivr CDN`);
  }

  // Verify every asset in sw.js PRECACHE_ASSETS exists
  const swSource = fs.readFileSync(path.join(APP_DIR, 'sw.js'), 'utf8');
  const match = swSource.match(/PRECACHE_ASSETS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(match, 'PRECACHE_ASSETS array found in sw.js');
  const urls = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(urls.length >= 25);
  for (const u of urls) {
    if (u === './') continue;
    const diskPath = path.join(APP_DIR, u.replace(/^\.\//, ''));
    assert.ok(fs.existsSync(diskPath), `Precache asset missing on disk: ${u}`);
  }
});

test('acceptance: end-to-end seller workflow (seed -> categorize -> add lead -> contact -> reschedule -> convert -> export)', () => {
  const storage = makeMemStorage();
  let state = createInitialState();
  state = seedSampleLeads(state, storage, PROTOTYPE_ANCHOR_MS);

  // 1. Seed dataset has 14 Indian leads and 15 tags
  assert.equal(state.leads.length, 14);
  assert.equal(state.tags.length, 15);

  // 2. Categorize at anchor date gives 2 overdue, 4 today, 5 upcoming
  const buckets = categorize(state.leads, PROTOTYPE_ANCHOR_MS);
  assert.equal(buckets.overdue.length, 2);
  assert.equal(buckets.today.length, 4);
  assert.equal(buckets.upcoming.length, 5);

  // 3. Add a new WhatsApp lead with 2d delay
  state = createLead(
    state,
    {
      name: 'Neha Kulkarni',
      handle: '98209 11223',
      source: 'whatsapp',
      interest: '2kg Belgian chocolate truffle cake for anniversary party on Sunday',
      followUpDays: 2,
      tags: ['Cakes', 'Custom'],
      priority: false
    },
    storage,
    PROTOTYPE_ANCHOR_MS
  );
  const neha = state.leads[0];
  assert.equal(neha.name, 'Neha Kulkarni');

  // 4. Channel deep links & message template
  const msg = buildFollowUpMessage(neha, true);
  assert.ok(msg.includes('Hi Neha!'));
  assert.ok(msg.includes(APP_LINK));
  const waUrl = buildWhatsAppUrl(neha.handle, msg);
  assert.ok(waUrl.startsWith('https://wa.me/919820911223?text='));
  const igUrl = buildInstagramWebUrl('@neha.bakes');
  assert.equal(igUrl, 'https://instagram.com/neha.bakes');

  // 5. Log contact event -> updates lastContactedAt
  assert.equal(neha.lastContactedAt, PROTOTYPE_ANCHOR_MS);
  state = logLeadEvent(state, neha.id, 'contacted', 'Sent WhatsApp follow-up', storage, PROTOTYPE_ANCHOR_MS + 5000);
  const nehaAfterTouch = state.leads.find((l) => l.id === neha.id);
  assert.equal(nehaAfterTouch.lastContactedAt, PROTOTYPE_ANCHOR_MS + 5000);

  // 6. Reschedule to 7 days
  state = rescheduleFollowUp(state, neha.id, 7, storage, PROTOTYPE_ANCHOR_MS);
  const nehaRescheduled = state.leads.find((l) => l.id === neha.id);
  assert.ok(nehaRescheduled.nextFollowUpAt > PROTOTYPE_ANCHOR_MS);

  // 7. Convert with ₹2800 order value -> clears nextFollowUpAt
  state = updateLeadStatus(state, neha.id, 'converted', 2800, storage, PROTOTYPE_ANCHOR_MS + 10000);
  const nehaConverted = state.leads.find((l) => l.id === neha.id);
  assert.equal(nehaConverted.status, 'converted');
  assert.equal(nehaConverted.convertedValue, 2800);
  assert.equal(nehaConverted.nextFollowUpAt, null);

  // 8. Archive and filter
  state = archiveLead(state, neha.id, true, storage);
  assert.equal(filterLeads(state.leads, { showArchived: true }).length, 1);

  // 9. JSON backup & restore + Pro CSV export
  const json = exportBackupJson(state);
  const restored = importBackupJson(json, storage);
  assert.equal(restored.leads.length, 15);

  const proState = updateSettings(restored, { isPro: true }, storage);
  const csv = exportLeadsCsv(proState);
  assert.ok(csv.includes('Neha Kulkarni'));
});
