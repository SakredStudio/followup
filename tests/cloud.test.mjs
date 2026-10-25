import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptJson,
  decryptJson,
  deriveKey,
  exportKeyB64,
  importKeyB64,
  newVaultId,
  isValidVaultId,
  formatVaultCode,
  parseVaultCode,
  pushVault,
  pullVault,
  resolveConflict,
  isCloudConfigured,
  stateUpdatedAt,
  base64ToBytes
} from '../lib/cloud.js';
import { handleRequest, rateLimited } from '../../worker/src/index.js';

test('cloud: encrypt → decrypt round trip, wrong passphrase fails, key export/import', async () => {
  const value = { leads: [{ id: 'l1', name: 'Priya', updatedAt: 5 }], settings: { language: 'hi' } };
  const enc = await encryptJson(value, { passphrase: 'chai-samosa-2026', updatedAt: 1234 });
  assert.ok(enc.salt && enc.iv && enc.data);
  assert.equal(enc.updatedAt, 1234);
  assert.equal(base64ToBytes(enc.salt).length, 16);
  assert.equal(base64ToBytes(enc.iv).length, 12);
  assert.ok(!enc.data.includes('Priya'), 'ciphertext does not leak plaintext');

  const dec = await decryptJson(enc, { passphrase: 'chai-samosa-2026' });
  assert.deepEqual(dec, value);

  await assert.rejects(decryptJson(enc, { passphrase: 'wrong' }), (e) => e.code === 'DECRYPT_FAILED');
  const tampered = { ...enc, data: enc.data.slice(0, -4) + 'AAAA' };
  await assert.rejects(decryptJson(tampered, { passphrase: 'chai-samosa-2026' }));

  // Derived key can be exported (auto-sync keeps it on-device) and reused with the same salt.
  const key = await deriveKey('chai-samosa-2026', base64ToBytes(enc.salt));
  const key2 = await importKeyB64(await exportKeyB64(key));
  assert.deepEqual(await decryptJson(enc, { key: key2 }), value);
  const enc2 = await encryptJson(value, { key: key2, salt: enc.salt });
  assert.equal(enc2.salt, enc.salt);
  assert.deepEqual(await decryptJson(enc2, { passphrase: 'chai-samosa-2026' }), value);
});

test('cloud: vault ids, codes, conflict rule, configuration guard', async () => {
  const id = newVaultId();
  assert.equal(id.length, 32);
  assert.ok(isValidVaultId(id));
  assert.equal(parseVaultCode(formatVaultCode(id)), id);
  assert.equal(parseVaultCode('nope'), null);
  assert.equal(resolveConflict(10, 20), 'remote');
  assert.equal(resolveConflict(20, 10), 'local');
  assert.equal(resolveConflict(5, 5), 'same');
  assert.equal(isCloudConfigured(''), false);
  assert.equal(isCloudConfigured('http://x'), false);
  assert.equal(isCloudConfigured('https://x.workers.dev'), true);
  await assert.rejects(pushVault(id, {}, { base: '' }), (e) => e.code === 'CLOUD_UNCONFIGURED');
  assert.equal(stateUpdatedAt({ leads: [{ updatedAt: 3 }], events: [{ at: 9 }], catalogue: [{ updatedAt: 4 }] }), 9);
});

// Fake D1: prepare(sql).bind(...).first()/run()
function fakeD1() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.startsWith('SELECT')) {
                const r = rows.get(args[0]);
                return r ? { blob: r.blob, updated_at: r.updated_at } : null;
              }
              return null;
            },
            async run() {
              if (sql.startsWith('INSERT')) rows.set(args[0], { blob: args[1], updated_at: args[2], size: args[3] });
              if (sql.startsWith('DELETE')) rows.delete(args[0]);
              return { success: true };
            }
          };
        }
      };
    }
  };
}

test('cloud worker: PUT/GET/DELETE with a fake D1, CORS, cap, conflict, rate limit', async () => {
  const DB = fakeD1();
  const env = { DB, ALLOWED_ORIGIN: 'https://sakredstudio.github.io', MAX_BLOB_BYTES: '2097152', RATE_LIMIT_PER_MIN: '30' };
  const id = newVaultId();
  const base = 'https://vault.example.workers.dev';
  const store = new Map();
  const opts = { store };
  const hdr = { Origin: 'https://sakredstudio.github.io', 'CF-Connecting-IP': '1.2.3.4' };
  const enc = await encryptJson({ hello: 'world' }, { passphrase: 'p', updatedAt: 100 });

  // preflight
  const pre = await handleRequest(new Request(`${base}/v1/vault/${id}`, { method: 'OPTIONS', headers: hdr }), env, opts);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://sakredstudio.github.io');

  // 404 before PUT
  const miss = await handleRequest(new Request(`${base}/v1/vault/${id}`, { headers: hdr }), env, opts);
  assert.equal(miss.status, 404);

  // bad id / bad payload
  assert.equal((await handleRequest(new Request(`${base}/v1/vault/xyz`, { headers: hdr }), env, opts)).status, 404);
  const bad = await handleRequest(new Request(`${base}/v1/vault/${id}`, { method: 'PUT', headers: hdr, body: JSON.stringify({ salt: 'a', iv: 'b' }) }), env, opts);
  assert.equal(bad.status, 400);

  // PUT then GET round trip through the app's client helpers
  const fetchFn = (url, init) => handleRequest(new Request(url, { ...init, headers: { ...(init?.headers || {}), ...hdr } }), env, opts);
  const put = await pushVault(id, enc, { base, fetchFn });
  assert.equal(put.ok, true);
  const got = await pullVault(id, { base, fetchFn });
  assert.equal(got.updatedAt, 100);
  assert.deepEqual(await decryptJson(got, { passphrase: 'p' }), { hello: 'world' });

  // Older PUT is rejected (newer wins), newer accepted
  const older = await encryptJson({ hello: 'old' }, { passphrase: 'p', updatedAt: 50 });
  const conflict = await fetchFn(`${base}/v1/vault/${id}`, { method: 'PUT', body: JSON.stringify(older) });
  assert.equal(conflict.status, 409);
  const newer = await encryptJson({ hello: 'new' }, { passphrase: 'p', updatedAt: 200 });
  assert.equal((await pushVault(id, newer, { base, fetchFn })).updatedAt, 200);

  // 2 MB cap
  const big = { ...newer, data: 'A'.repeat(2 * 1024 * 1024 + 10), updatedAt: 300 };
  const tooBig = await fetchFn(`${base}/v1/vault/${id}`, { method: 'PUT', body: JSON.stringify(big) });
  assert.equal(tooBig.status, 413);

  // DELETE
  const del = await fetchFn(`${base}/v1/vault/${id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal(await pullVault(id, { base, fetchFn }), null);

  // rate limit: 31st request in a minute from the same IP is refused
  const rl = new Map();
  for (let i = 0; i < 30; i++) assert.equal(rateLimited('9.9.9.9', 30, 1000, rl), false);
  assert.equal(rateLimited('9.9.9.9', 30, 1000, rl), true);
  assert.equal(rateLimited('9.9.9.9', 30, 1000 + 60000, rl), false, 'window resets');
  const rl2 = new Map();
  for (let i = 0; i < 30; i++) rateLimited('8.8.8.8', 30, 1000, rl2);
  const limited = await handleRequest(new Request(`${base}/v1/vault/${id}`, { headers: { ...hdr, 'CF-Connecting-IP': '8.8.8.8' } }), env, { store: rl2, now: 1000 });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '60');
});
