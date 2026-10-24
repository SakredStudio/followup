// Pure ES module for normalizing Indian WhatsApp numbers (91XXXXXXXXXX) and Instagram handles (no DOM)

/**
 * Normalize an Indian or international phone number for WhatsApp `wa.me`:
 * - 10-digit Indian mobile (`98765 43210`, `09876543210`, `+91 98765 43210`) -> `'919876543210'`
 * @param {string} rawInput
 * @returns {string}
 */
export function normalizePhone(rawInput) {
  const str = String(rawInput ?? '').trim();
  if (!str) return '';

  const compact = str.replace(/[\s\-().\u00A0]/g, '');

  if (compact.startsWith('+') || compact.startsWith('00')) {
    const withoutPlus = compact.startsWith('+') ? compact.slice(1) : compact.slice(2);
    const digitsOnly = withoutPlus.replace(/\D/g, '');
    if (digitsOnly.startsWith('91')) {
      let rest = digitsOnly.slice(2);
      if (rest.length === 11 && rest.startsWith('0')) {
        rest = rest.slice(1);
      }
      if (rest.length === 10) {
        return `91${rest}`;
      }
    }
    return digitsOnly;
  }

  const digits = compact.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return `91${digits.slice(1)}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }
  if (digits.length === 13 && digits.startsWith('910')) {
    return `91${digits.slice(3)}`;
  }
  return digits;
}

export const normalize = normalizePhone;

/**
 * Clean an Instagram handle (strips leading '@', URL prefixes, and whitespace).
 * @param {string} rawHandle
 * @returns {string} username without '@'
 */
export function normalizeInstagramHandle(rawHandle) {
  const str = String(rawHandle ?? '').trim();
  if (!str) return '';
  const withoutUrl = str.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '');
  return withoutUrl.replace(/^@+/, '').trim();
}
