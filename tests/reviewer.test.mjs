import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  REVIEWER_CODE_SHA256,
  normalizeReviewerCode,
  sha256Hex,
  matchesCodeHash,
  isReviewerCode
} from '../lib/reviewer.js';
import {
  FREE_ACTIVE_LEAD_LIMIT,
  createInitialState,
  loadState,
  saveState,
  updateSettings,
  createLead,
  hasPro,
  canAddActiveLead,
  canAddTag,
  addTag,
  backupPayload,
  exportBackupJson,
  importBackupJson,
  exportLeadsCsv
} from '../lib/store.js';
import { activeProPlan, subscriptionPatch, PRO_SKUS } from '../lib/billing.js';
import { productLimit, PRO_PRODUCT_LIMIT, FREE_PRODUCT_LIMIT } from '../lib/catalogue.js';
import { saveTemplate, resolveTemplate } from '../lib/templates.js';
import { mergeStates } from '../lib/merge.js';

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// A test-only code (same shape as the real one: 14 chars of A-Z, 0-9 and hyphens). The real code is not in the repo.
const TEST_CODE = 'TEST-CODE-0001';
const TEST_HASH = createHash('sha256').update(TEST_CODE, 'utf8').digest('hex');

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); }
  };
}

function billingWindow(purchases) {
  const svc = { getDetails: async () => [], listPurchases: async () => purchases };
  return { getDigitalGoodsService: async () => svc, PaymentRequest: class {} };
}

test('reviewer: sha256Hex is lower-case hex SHA-256 (Web Crypto) and matches node:crypto', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256Hex(TEST_CODE), TEST_HASH);
  await assert.rejects(sha256Hex('abc', {}), /Web Crypto unavailable/);
});

test('reviewer: only a code whose hash matches is accepted', async () => {
  assert.equal(TEST_CODE.length, 14);
  assert.equal(await matchesCodeHash(TEST_CODE, TEST_HASH), true);
  assert.equal(await matchesCodeHash(TEST_CODE, TEST_HASH.toUpperCase()), true);
  assert.equal(await matchesCodeHash('TEST-CODE-0002', TEST_HASH), false);
  assert.equal(await matchesCodeHash('TEST-CODE-000', TEST_HASH), false);
  assert.equal(await matchesCodeHash('TEST CODE 0001', TEST_HASH), false);
  assert.equal(await matchesCodeHash(TEST_HASH, TEST_HASH), false);
  for (const empty of ['', '   ', null, undefined]) {
    assert.equal(await matchesCodeHash(empty, TEST_HASH), false);
  }
  // A missing / malformed expected hash never matches anything.
  assert.equal(await matchesCodeHash(TEST_CODE, ''), false);
  assert.equal(await matchesCodeHash(TEST_CODE, 'abc123'), false);
  assert.equal(await matchesCodeHash('', await sha256Hex('')), false);
});

test('reviewer: input is trimmed and upper-cased before hashing', async () => {
  assert.equal(normalizeReviewerCode('  test-code-0001\n'), TEST_CODE);
  assert.equal(await matchesCodeHash('test-code-0001', TEST_HASH), true);
  assert.equal(await matchesCodeHash(' \tTest-Code-0001  \n', TEST_HASH), true);
});

test('reviewer: the app ships only the hash; isReviewerCode compares against it', async () => {
  assert.equal(REVIEWER_CODE_SHA256, 'fc4606d9dc20ae358d6c39d340ebdf24b20a159754a36f116ab3301199e05473');
  assert.match(REVIEWER_CODE_SHA256, /^[0-9a-f]{64}$/);
  assert.notEqual(REVIEWER_CODE_SHA256, TEST_HASH);
  for (const wrong of ['', TEST_CODE, 'KALPAKKA', REVIEWER_CODE_SHA256]) {
    assert.equal(await isReviewerCode(wrong), false);
  }
  const sw = fs.readFileSync(path.join(APP_DIR, 'sw.js'), 'utf8');
  assert.ok(sw.includes("'./lib/reviewer.js'"), 'lib/reviewer.js is precached by sw.js');
});

test('reviewer: hasPro honours the reviewer flag at every Pro gate, and it survives a reload', () => {
  const mem = createMemoryStorage();
  let state = createInitialState(1700000000000);
  assert.equal(state.settings.reviewerAccess, false);
  assert.equal(hasPro(state.settings), false);
  assert.equal(hasPro(null), false);
  assert.equal(hasPro({ isPro: true }), true);
  assert.equal(hasPro({ reviewerAccess: true }), true);

  for (let i = 0; i < FREE_ACTIVE_LEAD_LIMIT; i += 1) {
    state = createLead(state, { name: `Lead ${i}` }, mem, 1700000000000 + i);
  }
  for (const name of ['t6', 't7']) {
    if (canAddTag(state)) state = addTag(state, name, mem);
  }
  // Free tier: every gate is closed.
  assert.equal(canAddActiveLead(state), false);
  assert.equal(canAddTag(state), false);
  assert.throws(() => createLead(state, { name: 'One more' }, mem), (e) => e.code === 'PRO_LIMIT_REACHED');
  assert.throws(() => exportLeadsCsv(state), (e) => e.code === 'PRO_REQUIRED');
  assert.throws(() => saveTemplate(state, { name: 'A', text: 'Hi {name}' }, mem), (e) => e.code === 'PRO_REQUIRED');
  assert.equal(productLimit(state.settings), FREE_PRODUCT_LIMIT);

  // Reviewer unlock: Pro everywhere, with no subscription.
  state = updateSettings(state, { reviewerAccess: true }, mem);
  assert.equal(state.settings.isPro, false);
  assert.equal(hasPro(state.settings), true);
  assert.equal(canAddActiveLead(state), true);
  assert.equal(canAddTag(state), true);
  state = createLead(state, { name: 'One more', priority: true, tags: ['Cakes'] }, mem);
  for (let i = 0; i < 4; i += 1) state = createLead(state, { name: `Priority ${i}`, priority: true }, mem);
  assert.ok(exportLeadsCsv(state).startsWith('Name,Handle'));
  assert.equal(productLimit(state.settings), PRO_PRODUCT_LIMIT);
  state = saveTemplate(state, { name: 'A', text: 'Hi {name}' }, mem);
  const tplId = state.settings.templates[0].id;
  const resolved = resolveTemplate({ tags: ['Cakes'] }, { ...state.settings, tagTemplates: { Cakes: tplId } });
  assert.equal(resolved.via, 'tag');

  // Reload from storage: still unlocked.
  const reloaded = loadState(mem);
  assert.equal(reloaded.settings.reviewerAccess, true);
  assert.equal(hasPro(reloaded.settings), true);
});

test('reviewer: a billing sync that finds no subscription does not clear reviewer access', async () => {
  const mem = createMemoryStorage();
  let state = updateSettings(createInitialState(), { reviewerAccess: true }, mem);

  // Play Billing reports no purchases at all.
  const plan = await activeProPlan(billingWindow([]));
  assert.equal(plan, null);
  assert.equal(subscriptionPatch(state.settings, plan), null);

  // A subscription that later lapses clears only the subscription entitlement.
  const yearly = await activeProPlan(billingWindow([{ itemId: PRO_SKUS.yearly, purchaseToken: 'x' }]));
  assert.deepEqual(subscriptionPatch(state.settings, yearly), { isPro: true, proPlan: 'yearly' });
  state = updateSettings(state, subscriptionPatch(state.settings, yearly), mem);
  assert.equal(state.settings.isPro, true);
  assert.equal(subscriptionPatch(state.settings, yearly), null);

  const lapsed = subscriptionPatch(state.settings, null);
  assert.deepEqual(lapsed, { isPro: false, proPlan: null });
  assert.ok(!('reviewerAccess' in lapsed));
  state = updateSettings(state, lapsed, mem);
  assert.equal(state.settings.isPro, false);
  assert.equal(state.settings.reviewerAccess, true);
  assert.equal(hasPro(state.settings), true);
  assert.equal(hasPro(loadState(mem).settings), true);

  // Without the reviewer flag the same result does end Pro.
  let plain = updateSettings(createInitialState(), { isPro: true, proPlan: 'monthly' }, createMemoryStorage());
  plain = updateSettings(plain, subscriptionPatch(plain.settings, null), createMemoryStorage());
  assert.equal(hasPro(plain.settings), false);
});

test('reviewer: the flag stays on its device (not in backups, not through a restore or a team merge)', () => {
  const reviewerPhone = createMemoryStorage();
  let state = updateSettings(createInitialState(), { reviewerAccess: true, sellerName: 'Anjali' }, reviewerPhone);
  state = createLead(state, { name: 'Meera' }, reviewerPhone);

  // Export: the flag is not written.
  assert.ok(!('reviewerAccess' in backupPayload(state).settings));
  const json = exportBackupJson(state);
  assert.ok(!json.includes('reviewerAccess'));

  // Restore on another phone: data arrives, the unlock does not.
  const otherPhone = createMemoryStorage();
  const restored = importBackupJson(json, otherPhone);
  assert.equal(restored.leads.length, 1);
  assert.equal(restored.settings.sellerName, 'Anjali');
  assert.equal(restored.settings.reviewerAccess, false);
  assert.equal(hasPro(restored.settings), false);

  // A hand-edited backup cannot switch it on either.
  const forged = JSON.parse(json);
  forged.settings.reviewerAccess = true;
  assert.equal(importBackupJson(JSON.stringify(forged), createMemoryStorage()).settings.reviewerAccess, false);

  // An old backup (no such field) restored on the reviewer's phone keeps that phone's unlock.
  const oldBackup = JSON.stringify({ leads: [], events: [], tags: [], settings: { language: 'hi' } });
  const afterOld = importBackupJson(oldBackup, reviewerPhone);
  assert.equal(afterOld.settings.language, 'hi');
  assert.equal(afterOld.settings.reviewerAccess, true);
  assert.equal(loadState(reviewerPhone).settings.reviewerAccess, true);

  // Old stored state without the field normalises to false.
  const legacy = createMemoryStorage();
  const legacyState = createInitialState();
  delete legacyState.settings.reviewerAccess;
  legacy.setItem('fub.v1', JSON.stringify(legacyState));
  assert.equal(loadState(legacy).settings.reviewerAccess, false);
  assert.equal(saveState(loadState(legacy), legacy).settings.reviewerAccess, false);

  // Team / cloud merge: always the local value, whatever the remote copy says.
  const local = createInitialState();
  const remote = createInitialState();
  remote.settings.reviewerAccess = true;
  assert.equal(mergeStates(local, remote).settings.reviewerAccess, false);
  assert.equal(mergeStates(remote, local).settings.reviewerAccess, true);
  assert.equal(mergeStates({ settings: {} }, remote).settings.reviewerAccess, false);
});
