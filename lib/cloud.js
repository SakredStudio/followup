// Encrypted cloud backup + multi-device (v3, Pro). Pure where possible; WebCrypto only.
// - key = PBKDF2(passphrase, salt, 200k, SHA-256) → AES-GCM-256
// - the server only ever sees {salt, iv, data} base64 + updatedAt; the vaultId (16 random
//   bytes, hex) is the only identifier. No account, no email, no analytics.
// - CLOUD_URL '' = not configured → the UI shows "Not available yet" and nothing is sent.

export const CLOUD_URL = 'https://followup-vault.mihir86-mp.workers.dev';
export const PBKDF2_ITERATIONS = 200000;
export const VAULT_ID_BYTES = 16;
export const MAX_BLOB_BYTES = 2 * 1024 * 1024;
export const AUTO_SYNC_DEBOUNCE_MS = 30 * 1000;

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('WebCrypto unavailable');
  return c.subtle;
}

export function randomBytes(n) {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(String(b64 || ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function isCloudConfigured(url = CLOUD_URL) {
  return typeof url === 'string' && /^https:\/\//.test(url);
}

export function newVaultId() {
  return bytesToHex(randomBytes(VAULT_ID_BYTES));
}

export function isValidVaultId(id) {
  return /^[0-9a-f]{32}$/.test(String(id || '').trim().toLowerCase());
}

/** Human-friendly vault code (groups of 4) ↔ raw id. */
export function formatVaultCode(id) {
  return String(id || '').toLowerCase().replace(/[^0-9a-f]/g, '').replace(/(.{4})(?=.)/g, '$1-');
}
export function parseVaultCode(code) {
  const id = String(code || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  return isValidVaultId(id) ? id : null;
}

/** Derive the AES-GCM key from a passphrase + salt (Uint8Array). */
export async function deriveKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  const enc = new TextEncoder();
  const base = await subtle().importKey('raw', enc.encode(String(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function exportKeyB64(key) {
  return bytesToBase64(new Uint8Array(await subtle().exportKey('raw', key)));
}

export async function importKeyB64(b64) {
  return subtle().importKey('raw', base64ToBytes(b64), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/**
 * Encrypt any JSON value. Returns { salt, iv, data } (base64) + updatedAt.
 * Pass either a passphrase (salt generated / reused) or a CryptoKey with its salt.
 */
export async function encryptJson(value, { passphrase, key, salt, updatedAt = Date.now() } = {}) {
  const saltBytes = salt instanceof Uint8Array ? salt : salt ? base64ToBytes(salt) : randomBytes(16);
  const k = key || (await deriveKey(passphrase, saltBytes));
  const iv = randomBytes(12);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, k, plain));
  return { salt: bytesToBase64(saltBytes), iv: bytesToBase64(iv), data: bytesToBase64(cipher), updatedAt: Number(updatedAt) };
}

/** Decrypt a payload with a passphrase or CryptoKey. Throws on a wrong passphrase / tampering. */
export async function decryptJson(payload, { passphrase, key } = {}) {
  if (!payload || !payload.salt || !payload.iv || !payload.data) throw new Error('Malformed vault payload');
  const saltBytes = base64ToBytes(payload.salt);
  const k = key || (await deriveKey(passphrase, saltBytes));
  let plain;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: base64ToBytes(payload.iv) }, k, base64ToBytes(payload.data));
  } catch {
    const err = new Error('Wrong passphrase or corrupted vault');
    err.code = 'DECRYPT_FAILED';
    throw err;
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

export function vaultUrl(vaultId, base = CLOUD_URL) {
  return `${base.replace(/\/$/, '')}/v1/vault/${vaultId}`;
}

/** PUT the encrypted payload. `fetchFn` injectable for tests. */
export async function pushVault(vaultId, payload, { base = CLOUD_URL, fetchFn = globalThis.fetch } = {}) {
  if (!isCloudConfigured(base)) {
    const err = new Error('Cloud backup not configured');
    err.code = 'CLOUD_UNCONFIGURED';
    throw err;
  }
  const body = JSON.stringify(payload);
  if (body.length > MAX_BLOB_BYTES) {
    const err = new Error('Backup too large (2 MB cap)');
    err.code = 'TOO_LARGE';
    throw err;
  }
  const res = await fetchFn(vaultUrl(vaultId, base), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
  if (!res.ok) {
    const err = new Error(`Cloud PUT failed (${res.status})`);
    err.code = res.status === 429 ? 'RATE_LIMITED' : 'PUT_FAILED';
    throw err;
  }
  return res.json().catch(() => ({ ok: true }));
}

/** GET the encrypted payload, or null when the vault does not exist. */
export async function pullVault(vaultId, { base = CLOUD_URL, fetchFn = globalThis.fetch } = {}) {
  if (!isCloudConfigured(base)) {
    const err = new Error('Cloud backup not configured');
    err.code = 'CLOUD_UNCONFIGURED';
    throw err;
  }
  const res = await fetchFn(vaultUrl(vaultId, base), { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`Cloud GET failed (${res.status})`);
    err.code = 'GET_FAILED';
    throw err;
  }
  return res.json();
}

export async function deleteVault(vaultId, { base = CLOUD_URL, fetchFn = globalThis.fetch } = {}) {
  if (!isCloudConfigured(base)) return false;
  const res = await fetchFn(vaultUrl(vaultId, base), { method: 'DELETE' });
  return res.ok;
}

/**
 * Conflict rule: newer updatedAt wins. Returns 'local' | 'remote' | 'same'.
 * The UI asks for a confirm before overwriting local data with a newer remote.
 */
export function resolveConflict(localUpdatedAt, remoteUpdatedAt) {
  const l = Number(localUpdatedAt) || 0;
  const r = Number(remoteUpdatedAt) || 0;
  if (r > l) return 'remote';
  if (l > r) return 'local';
  return 'same';
}

/** Latest change in a state (max of lead/event/catalogue updatedAt / at). */
export function stateUpdatedAt(state) {
  let m = 0;
  for (const l of state?.leads || []) m = Math.max(m, Number(l.updatedAt) || 0, Number(l.createdAt) || 0);
  for (const e of state?.events || []) m = Math.max(m, Number(e.at) || 0);
  for (const p of state?.catalogue || []) m = Math.max(m, Number(p.updatedAt) || 0);
  return m;
}
