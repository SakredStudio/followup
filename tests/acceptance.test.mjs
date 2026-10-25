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
  updateSettings,
  migrate
} from '../lib/store.js';
import { categorize, filterLeads } from '../lib/categorize.js';
import { buildFollowUpMessage, buildWhatsAppUrl, buildInstagramWebUrl, APP_LINK, SHARE_LINE } from '../lib/channels.js';
import { PROTOTYPE_ANCHOR_MS } from '../lib/seed.js';
import { groupByStage } from '../lib/pipeline.js';
import { computeStats } from '../lib/stats.js';
import { saveTemplate, assignTagTemplate, buildMessageForLead } from '../lib/templates.js';
import { parseSharedPayload } from '../lib/share-target.js';
import { addProduct, buildProductCardModel, buildProductMessage } from '../lib/catalogue.js';
import { mergeStates } from '../lib/merge.js';
import { encryptJson, decryptJson } from '../lib/cloud.js';
import { buildDigestText, buildDigestSnapshot, buildSelfDigestText } from '../lib/notify.js';
import { activeFestivalWindow, coldLeads } from '../lib/festivals.js';

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

test('acceptance v2/v3: seed → pipeline → stats → template → share-target → catalogue card → digest → merge → vault', async () => {
  const storage = mem2();
  const now = PROTOTYPE_ANCHOR_MS;
  let state = seedSampleLeads(createInitialState(), storage, now);
  state = updateSettings(state, { isPro: true, sellerName: 'Anjali', sellerBusiness: 'Sweet Tooth', deviceName: 'Anjali phone' }, storage);

  // Pipeline: seed data lands in lanes; logging outcomes moves a lead
  let lanes = groupByStage(state.leads, state.events);
  assert.equal(lanes.ordered.length, 1, 'converted seed lead sits in Ordered');
  assert.equal(lanes.lost.length, 2, 'lost + not interested sit in Lost');
  const riya = state.leads.find((l) => l.name === 'Riya Kapoor');
  assert.equal(riya.stage, 'new');
  state = logLeadEvent(state, riya.id, 'contacted', 'Sent WhatsApp follow-up', storage, now + 1000);
  state = logLeadEvent(state, riya.id, 'replied', 'Lead replied', storage, now + 2000);
  lanes = groupByStage(state.leads, state.events);
  assert.ok(lanes.interested.some((l) => l.id === riya.id));
  assert.equal(state.events.find((e) => e.text === 'Lead replied').by, 'Anjali phone');

  // Stats: convert Riya with a value → this month's total grows
  state = updateLeadStatus(state, riya.id, 'converted', 3200, storage, now + 3000);
  const stats = computeStats(state, now + 3000);
  assert.equal(stats.monthly.thisMonth.orders, 2);
  assert.equal(stats.monthly.thisMonth.value, 1400 + 3200);
  assert.deepEqual(stats.tags.slice(0, 2).map((x) => x.tag), ['Custom', 'Kurtas'], 'tie on orders → higher value, then name');
  assert.ok(stats.week.total >= 2, 'seed contacted events this week + our two');

  // Templates per tag (Pro): Kurtas opener used for Riya, default for a Cakes lead
  state = saveTemplate(state, { name: 'Kurta opener', text: 'Namaste {firstName}, {seller} here. {interest} ready hai!' }, storage);
  state = assignTagTemplate(state, 'Kurtas', state.settings.templates[0].id, storage);
  const riyaMsg = buildMessageForLead(state.leads.find((l) => l.id === riya.id), state.settings);
  assert.ok(riyaMsg.startsWith('Namaste Riya, Anjali here.'));
  assert.ok(riyaMsg.endsWith(SHARE_LINE));
  const priya = state.leads.find((l) => l.name === 'Priya Sharma');
  assert.ok(buildMessageForLead(priya, state.settings).startsWith('Hi Priya! Following up'));

  // Share target → prefilled lead
  const shared = parseSharedPayload({ title: 'Meera Joshi', text: '+91 90000 11111 wants 2 tiffins daily' });
  state = createLead(state, { name: shared.name, handle: shared.handle, source: shared.source, interest: shared.interest, tags: ['Tiffin'] }, storage, now + 4000);
  const meera = state.leads[0];
  assert.equal(meera.source, 'whatsapp');
  assert.equal(buildWhatsAppUrl(meera.handle, 'x').slice(0, 29), 'https://wa.me/919000011111?te');

  // Catalogue card
  state = addProduct(state, { name: 'Weekly tiffin plan', price: 1800 }, storage, now);
  const card = buildProductCardModel(state.catalogue[0], state.settings);
  assert.equal(card.priceText, '₹1,800');
  assert.ok(buildProductMessage(meera, state.catalogue[0], state.settings).includes('Weekly tiffin plan — ₹1,800'));

  // Digest text (notification + self digest)
  const buckets = categorize(state.leads, now);
  const digest = buildDigestText(buildDigestSnapshot(buckets, 'en', now));
  assert.ok(digest.title.includes('leads to follow up today'));
  assert.ok(buildSelfDigestText(buckets, 'hinglish', now).includes('Aaj ('));

  // Festival reactivation (anchor is 27 May → no window; late October → Diwali)
  assert.equal(activeFestivalWindow(now), null);
  const octNow = new Date(2026, 9, 25).getTime();
  assert.equal(activeFestivalWindow(octNow).id, 'diwali');
  assert.ok(coldLeads(state.leads, octNow).length > 0);

  // Team of two: assistant's copy adds a note on Meera and a new lead; merge keeps both
  const assistant = migrate(JSON.parse(exportBackupJson(state)));
  assistant.settings.deviceName = 'Assistant';
  const a2 = logLeadEvent(assistant, meera.id, 'note', 'Called, wants Jain', storage, now + 5000);
  const a3 = createLead(a2, { name: 'Kabir Rao', handle: '@kabir.rao', source: 'instagram' }, storage, now + 6000);
  const merged = mergeStates(state, a3);
  assert.equal(merged.leads.length, state.leads.length + 1);
  assert.ok(merged.events.some((e) => e.text === 'Called, wants Jain' && e.by === 'Assistant'));
  assert.equal(merged.settings.deviceName, 'Anjali phone', 'local device name kept');

  // Encrypted vault round trip of the merged backup
  const enc = await encryptJson(merged, { passphrase: 'ladoo-barfi-2026', updatedAt: now + 7000 });
  const dec = await decryptJson(enc, { passphrase: 'ladoo-barfi-2026' });
  assert.equal(dec.leads.length, merged.leads.length);
  await assert.rejects(decryptJson(enc, { passphrase: 'nope' }));
});

function mem2() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}
