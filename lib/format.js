// Pure ES module for FollowUp Buddy avatars, relative dates, and INR currency formatting (no DOM)

export const AVATAR_PALETTE = [
  '#0F6E5C', '#F5A623', '#2C5FBF', '#D85A4A', '#7A4FB8',
  '#0F7E94', '#B9462D', '#5A8A2B', '#C13584', '#1FA855'
];

export const DAY_MS = 24 * 60 * 60 * 1000;

export function initials(name) {
  const str = String(name || '').trim();
  if (!str) return '?';
  return str
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0])
    .join('')
    .toUpperCase();
}

export function avatarColor(name) {
  const str = String(name || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function startOfLocalDayMs(tsOrDate) {
  const d = tsOrDate instanceof Date ? new Date(tsOrDate.getTime()) : new Date(Number(tsOrDate));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Relative time label matching design/data.js ('Today', 'Yesterday', 'Tomorrow', '2d overdue', 'in 3d', 'in 1w').
 * @param {number|Date|null} targetTs
 * @param {number|Date} [nowTs]
 * @returns {string}
 */
const REL = {
  en: { today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday', overdue: (n) => `${n}d overdue`, inDays: (n) => `in ${n}d`, inWeeks: (n) => `in ${n}w`, ago: (n) => `${n}d ago`, locale: 'en-IN' },
  hi: { today: 'आज', tomorrow: 'कल', yesterday: 'कल', overdue: (n) => `${n} दिन देर`, inDays: (n) => `${n} दिन में`, inWeeks: (n) => `${n} हफ़्ते में`, ago: (n) => `${n} दिन पहले`, locale: 'hi-IN' }
};
function rel(lang) { return REL[lang] || REL.en; }

export function relTime(targetTs, nowTs = Date.now(), lang = 'en') {
  if (targetTs === null || targetTs === undefined) return '';
  const r = rel(lang);
  const targetDay = startOfLocalDayMs(targetTs);
  const nowDay = startOfLocalDayMs(nowTs);
  const dd = Math.round((targetDay - nowDay) / DAY_MS);
  if (dd === 0) return r.today;
  if (dd === 1) return r.tomorrow;
  if (dd < 0) return r.overdue(-dd);
  if (dd < 7) return r.inDays(dd);
  if (dd < 30) return r.inWeeks(Math.round(dd / 7));
  const d = new Date(Number(targetTs));
  return d.toLocaleDateString(r.locale, { day: 'numeric', month: 'short' });
}

export function relPastTime(targetTs, nowTs = Date.now(), lang = 'en') {
  if (targetTs === null || targetTs === undefined) return '';
  const r = rel(lang);
  const targetDay = startOfLocalDayMs(targetTs);
  const nowDay = startOfLocalDayMs(nowTs);
  const dd = Math.round((targetDay - nowDay) / DAY_MS);
  if (dd === 0) return r.today;
  if (dd === -1) return r.yesterday;
  if (dd === 1) return r.tomorrow;
  if (dd < 0) return r.ago(-dd);
  return r.inDays(dd);
}

export function shortDate(targetTs, lang = 'en') {
  if (targetTs === null || targetTs === undefined) return '';
  const d = targetTs instanceof Date ? targetTs : new Date(Number(targetTs));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(rel(lang).locale, { day: 'numeric', month: 'short' });
}

export function formatHeaderDate(nowTs = Date.now(), lang = 'en') {
  const d = nowTs instanceof Date ? nowTs : new Date(Number(nowTs));
  return new Intl.DateTimeFormat(rel(lang).locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'

  })
    .format(d)
    .replace(/,/g, ' ·');
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

export function inr(rupees) {
  const num = Number(rupees) || 0;
  return inrFormatter.format(Math.round(num));
}
