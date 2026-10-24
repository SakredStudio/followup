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
export function relTime(targetTs, nowTs = Date.now()) {
  if (targetTs === null || targetTs === undefined) return '';
  const targetDay = startOfLocalDayMs(targetTs);
  const nowDay = startOfLocalDayMs(nowTs);
  const dd = Math.round((targetDay - nowDay) / DAY_MS);
  if (dd === 0) return 'Today';
  if (dd === -1) return '1d overdue';
  if (dd === 1) return 'Tomorrow';
  if (dd < 0) return `${-dd}d overdue`;
  if (dd < 7) return `in ${dd}d`;
  if (dd < 30) return `in ${Math.round(dd / 7)}w`;
  const d = new Date(Number(targetTs));
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function relPastTime(targetTs, nowTs = Date.now()) {
  if (targetTs === null || targetTs === undefined) return '';
  const targetDay = startOfLocalDayMs(targetTs);
  const nowDay = startOfLocalDayMs(nowTs);
  const dd = Math.round((targetDay - nowDay) / DAY_MS);
  if (dd === 0) return 'Today';
  if (dd === -1) return 'Yesterday';
  if (dd === 1) return 'Tomorrow';
  if (dd < 0) return `${-dd}d ago`;
  return `in ${dd}d`;
}

export function shortDate(targetTs) {
  if (targetTs === null || targetTs === undefined) return '';
  const d = targetTs instanceof Date ? targetTs : new Date(Number(targetTs));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatHeaderDate(nowTs = Date.now()) {
  const d = nowTs instanceof Date ? nowTs : new Date(Number(nowTs));
  return new Intl.DateTimeFormat('en-IN', {
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
