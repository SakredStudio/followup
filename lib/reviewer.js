// Reviewer access code for Kal Pakka Pro (Google Play reviewers cannot buy subscriptions).
// Only the SHA-256 hash of the code lives in the app; the plain code is never stored or shipped.
// Pure module (Web Crypto only, no DOM): runs in the browser and in Node 20+.
//
// A correct code sets `settings.reviewerAccess` on this device (see store.hasPro). That flag is
// separate from the subscription entitlement `settings.isPro`, so a Play Billing sync that finds
// no subscription never switches it off; it is device-local and is not written to backups.

export const REVIEWER_CODE_SHA256 = 'fc4606d9dc20ae358d6c39d340ebdf24b20a159754a36f116ab3301199e05473';

/** Codes are upper-case letters, digits and hyphens: trim surrounding whitespace, upper-case. */
export function normalizeReviewerCode(input) {
  return String(input ?? '').trim().toUpperCase();
}

/** Lower-case hex SHA-256 of a UTF-8 string, via Web Crypto. */
export async function sha256Hex(text, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl || !cryptoImpl.subtle) throw new Error('Web Crypto unavailable');
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when the normalised input hashes to `expectedHash` (hex, any case). Empty input never matches. */
export async function matchesCodeHash(input, expectedHash, cryptoImpl = globalThis.crypto) {
  const code = normalizeReviewerCode(input);
  const want = String(expectedHash || '').trim().toLowerCase();
  if (!code || !/^[0-9a-f]{64}$/.test(want)) return false;
  return (await sha256Hex(code, cryptoImpl)) === want;
}

/** True when `input` is the reviewer access code. */
export async function isReviewerCode(input) {
  return matchesCodeHash(input, REVIEWER_CODE_SHA256);
}
