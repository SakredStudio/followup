// Pure-ish ES module for FollowUp Buddy daily reminders.
// - schedule math for the next 9 AM local reminder (quiet hours respected)
// - digest text builder shared by the in-app notification, the service worker and the
//   "send me today's list" wa.me self-digest
// - capability detection (`canNotify`) so Settings can show what really works
// - digest snapshot written to the Cache API so sw.js (which cannot read localStorage) can
//   show a notification from Periodic Background Sync.
// Nothing here sends a message to anyone; notifications are shown only to the seller.

import { DAY_MS } from './format.js';

export const DIGEST_CACHE = 'fub-digest';
export const DIGEST_URL = '/__fub_digest.json';
export const PERIODIC_TAG = 'daily-digest';
export const PERIODIC_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_QUIET_HOURS = { start: 21, end: 9 };

const TEXT = {
  en: {
    title: (n) => (n === 1 ? '1 lead to follow up today ☀️' : `${n} leads to follow up today ☀️`),
    overdue: (n) => `${n} overdue`,
    none: 'No follow-ups today. Chai pi lo ☕',
    more: (n) => `+${n} more`,
    selfTitle: (d) => `FollowUp Buddy · ${d}`,
    today: 'Today',
    overdueHead: 'Overdue',
    empty: 'Nothing due today.'
  },
  hi: {
    title: (n) => `आज ${n} लीड्स को फ़ॉलो-अप करना है ☀️`,
    overdue: (n) => `${n} बकाया`,
    none: 'आज कोई फ़ॉलो-अप नहीं। चाय पी लो ☕',
    more: (n) => `+${n} और`,
    selfTitle: (d) => `FollowUp Buddy · ${d}`,
    today: 'आज',
    overdueHead: 'बकाया',
    empty: 'आज कुछ बाकी नहीं।'
  },
  hinglish: {
    title: (n) => `Aaj ${n} leads ko follow-up karna hai ☀️`,
    overdue: (n) => `${n} overdue`,
    none: 'Aaj koi follow-up nahi. Chai pi lo ☕',
    more: (n) => `+${n} aur`,
    selfTitle: (d) => `FollowUp Buddy · ${d}`,
    today: 'Aaj',
    overdueHead: 'Overdue',
    empty: 'Aaj kuch baaki nahi.'
  }
};

function tx(lang) {
  return TEXT[lang] || TEXT.en;
}

function toMs(v) {
  return v instanceof Date ? v.getTime() : Number(v);
}

/** True when `hour` (0-23) falls inside quiet hours. Wraps midnight when start > end. */
export function isQuietHour(hour, quiet = DEFAULT_QUIET_HOURS) {
  const h = ((Number(hour) % 24) + 24) % 24;
  const s = Number(quiet?.start ?? DEFAULT_QUIET_HOURS.start);
  const e = Number(quiet?.end ?? DEFAULT_QUIET_HOURS.end);
  if (s === e) return false;
  if (s < e) return h >= s && h < e;
  return h >= s || h < e;
}

/**
 * Next reminder instant (local time) at `reminderHour`:00, strictly after `now`.
 * If that hour sits inside quiet hours, the reminder slides to the end of quiet hours.
 */
export function nextReminderAt(now = Date.now(), reminderHour = 9, quiet = DEFAULT_QUIET_HOURS) {
  const nowMs = toMs(now);
  let hour = Number.isFinite(Number(reminderHour)) ? Number(reminderHour) : 9;
  if (isQuietHour(hour, quiet)) hour = Number(quiet.end);
  const d = new Date(nowMs);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= nowMs) d.setTime(d.getTime() + DAY_MS);
  // DST safety: re-pin the hour after adding a day.
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/**
 * Lightweight digest snapshot from categorize() buckets. Serialisable; this is what
 * app.js writes to the Cache API for the service worker.
 */
export function buildDigestSnapshot(buckets, lang = 'en', now = Date.now()) {
  const today = Array.isArray(buckets?.today) ? buckets.today : [];
  const overdue = Array.isArray(buckets?.overdue) ? buckets.overdue : [];
  const names = [...today, ...overdue].slice(0, 5).map((l) => String(l?.name || '').split(/\s+/)[0]).filter(Boolean);
  return {
    todayCount: today.length,
    overdueCount: overdue.length,
    names,
    lang: TEXT[lang] ? lang : 'en',
    writtenAt: toMs(now)
  };
}

/** Notification title/body from a snapshot. Returns null when there is nothing to say. */
export function buildDigestText(snapshot) {
    const s = snapshot || {};
  const total = Number(s.todayCount || 0) + Number(s.overdueCount || 0);
  const L = tx(s.lang);
  if (total === 0) return null;
  const names = Array.isArray(s.names) ? s.names : [];
  const extra = total > names.length && names.length > 0 ? ` ${L.more(total - names.length)}` : '';
  const parts = [];
  if (names.length) parts.push(`${names.join(' · ')}${extra}`);
  if (Number(s.overdueCount) > 0) parts.push(`⚠ ${L.overdue(Number(s.overdueCount))}`);
  return { title: L.title(total), body: parts.join(' · ') };
}

/**
 * Plain-text digest the seller can send to themselves on WhatsApp (v3 self-digest).
 * Lists today's and overdue leads with their interest, no share line (it is their own chat).
 */
export function buildSelfDigestText(buckets, lang = 'en', now = Date.now()) {
  const L = tx(lang);
  const today = Array.isArray(buckets?.today) ? buckets.today : [];
  const overdue = Array.isArray(buckets?.overdue) ? buckets.overdue : [];
  const dateStr = new Date(toMs(now)).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
  const lines = [L.selfTitle(dateStr)];
  const row = (l) => `• ${l.name}${l.interest ? ` — ${String(l.interest).slice(0, 60)}` : ''}`;
  if (today.length === 0 && overdue.length === 0) {
    lines.push(L.empty);
    return lines.join('\n');
  }
  if (today.length) {
    lines.push('', `${L.today} (${today.length})`);
    today.forEach((l) => lines.push(row(l)));
  }
  if (overdue.length) {
    lines.push('', `${L.overdueHead} (${overdue.length})`);
    overdue.forEach((l) => lines.push(row(l)));
  }
  return lines.join('\n');
}

/**
 * What kind of daily reminder this environment can deliver.
 * mode: 'periodic' (installed + Periodic Background Sync, fires while closed),
 *       'open' (Notification API while the app is open), 'none'.
 */
export async function canNotify(env = {}) {
  const win = env.window !== undefined ? env.window : typeof window !== 'undefined' ? window : null;
  const nav = env.navigator !== undefined ? env.navigator : typeof navigator !== 'undefined' ? navigator : null;
  const NotificationCtor = env.Notification !== undefined ? env.Notification : typeof Notification !== 'undefined' ? Notification : null;
  const out = { supported: false, permission: 'unsupported', installed: false, periodic: false, mode: 'none' };
  if (!NotificationCtor) return out;
  out.supported = true;
  out.permission = NotificationCtor.permission || 'default';
  try {
    out.installed = Boolean(
      (win && win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) ||
        (nav && nav.standalone) ||
        (env.referrer || (typeof document !== 'undefined' ? document.referrer : '')).startsWith('android-app://')
    );
  } catch {
    out.installed = false;
  }
  try {
    const reg = env.registration !== undefined ? env.registration : nav && nav.serviceWorker ? await nav.serviceWorker.ready : null;
    out.periodic = Boolean(reg && 'periodicSync' in reg);
  } catch {
    out.periodic = false;
  }
  out.mode = out.periodic && out.installed ? 'periodic' : 'open';
  return out;
}

/** Register the daily digest with Periodic Background Sync, when the browser offers it. */
export async function registerPeriodicDigest(registration) {
  if (!registration || !('periodicSync' in registration)) return false;
  try {
    const tags = await registration.periodicSync.getTags();
    if (tags.includes(PERIODIC_TAG)) return true;
    await registration.periodicSync.register(PERIODIC_TAG, { minInterval: PERIODIC_MIN_INTERVAL_MS });
    return true;
  } catch {
    return false;
  }
}

export async function unregisterPeriodicDigest(registration) {
  if (!registration || !('periodicSync' in registration)) return;
  try {
    await registration.periodicSync.unregister(PERIODIC_TAG);
  } catch {
    /* ignore */
  }
}

/** Write the snapshot where sw.js can read it (Cache API is shared with the SW; localStorage is not). */
export async function writeDigestSnapshot(snapshot, cacheStorage = typeof caches !== 'undefined' ? caches : null) {
  if (!cacheStorage) return false;
  try {
    const cache = await cacheStorage.open(DIGEST_CACHE);
    await cache.put(DIGEST_URL, new Response(JSON.stringify(snapshot), { headers: { 'Content-Type': 'application/json' } }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Arm the in-app reminder: fires `onFire()` at the next reminder time while the page is open.
 * Returns a cancel function. `timers` is injectable for tests.
 */
export function scheduleInAppReminder({ now = Date.now(), reminderHour = 9, quiet = DEFAULT_QUIET_HOURS, onFire, timers = globalThis } = {}) {
  const at = nextReminderAt(now, reminderHour, quiet);
  const delay = Math.max(0, at - toMs(now));
  // setTimeout caps at ~24.8 days; our delay is < 25 h so this is safe.
  const id = timers.setTimeout(() => {
    if (typeof onFire === 'function') onFire(at);
  }, delay);
  return () => timers.clearTimeout(id);
}

/** Show a notification to the seller via the SW registration when possible, else the page API. */
export async function showReminderNotification(text, registration) {
  if (!text) return false;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  const opts = { body: text.body, icon: './icons/icon-192.png', badge: './icons/icon-192.png', tag: PERIODIC_TAG, renotify: true };
  try {
    if (registration && registration.showNotification) {
      await registration.showNotification(text.title, opts);
    } else {
      new Notification(text.title, opts);
    }
    return true;
  } catch {
    return false;
  }
}
