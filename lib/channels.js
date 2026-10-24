import { normalizePhone, normalizeInstagramHandle } from './phone.js';

export const APP_LINK = 'https://sakred.in/followup';
export const SHARE_LINE = `\n\n— sent with FollowUp Buddy · ${APP_LINK}`;

export const DEFAULT_FOLLOWUP_TEMPLATE =
  'Hi {firstName}! Following up on the {interest}. Still interested? 😊';

/**
 * Builds the pre-filled follow-up message for a lead.
 * Truncates interest to 80 chars (77 + '…') and appends mandatory share line by default.
 * @param {object} lead
 * @param {boolean} [includeShareLine=true]
 * @param {string} [template=DEFAULT_FOLLOWUP_TEMPLATE]
 * @returns {string}
 */
export function buildFollowUpMessage(
  lead,
  includeShareLine = true,
  template = DEFAULT_FOLLOWUP_TEMPLATE
) {
  const nameStr = String(lead?.name || '').trim();
  const firstName = nameStr ? nameStr.split(/\s+/)[0] : 'there';
  const interestRaw = String(lead?.interest || '').trim() || 'your inquiry';
  const interest =
    interestRaw.length > 80 ? `${interestRaw.slice(0, 77)}…` : interestRaw;

  const body = String(template || DEFAULT_FOLLOWUP_TEMPLATE)
    .replace('{firstName}', firstName)
    .replace('{interest}', interest);

  return includeShareLine ? `${body}${SHARE_LINE}` : body;
}

/**
 * Builds a https://wa.me/<phone>?text=<encoded> deep link.
 * @param {string} handle
 * @param {string} message
 * @param {string} [defaultCountryCode='91']
 * @returns {string}
 */
export function buildWhatsAppUrl(handle, message = '', defaultCountryCode = '91') {
  const phone = normalizePhone(handle, defaultCountryCode);
  return `https://wa.me/${phone}?text=${encodeURIComponent(String(message || ''))}`;
}

/**
 * Builds Instagram web profile link https://instagram.com/<username>
 * @param {string} handle
 * @returns {string}
 */
export function buildInstagramWebUrl(handle) {
  const u = normalizeInstagramHandle(handle);
  return `https://instagram.com/${encodeURIComponent(u)}`;
}

/**
 * Builds Instagram native deep link instagram://user?username=<username>
 * @param {string} handle
 * @returns {string}
 */
export function buildInstagramDeepLink(handle) {
  const u = normalizeInstagramHandle(handle);
  return `instagram://user?username=${encodeURIComponent(u)}`;
}

/**
 * Builds a concise shareable summary of a lead for Web Share API / clipboard.
 * @param {object} lead
 * @returns {string}
 */
export function buildLeadSummaryText(lead) {
  const lines = [
    `Lead: ${lead?.name || 'Unnamed'}`,
    `Source: ${lead?.source || 'whatsapp'} (${lead?.handle || '—'})`,
    `Status: ${lead?.status || 'active'}${lead?.priority ? ' ★ Priority' : ''}`,
  ];
  if (lead?.interest) lines.push(`Interest: ${lead.interest}`);
  if (lead?.convertedValue) lines.push(`Value: ₹${Number(lead.convertedValue).toLocaleString('en-IN')}`);
  lines.push(`— via FollowUp Buddy · ${APP_LINK}`);
  return lines.join('\n');
}
