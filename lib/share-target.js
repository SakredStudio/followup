// Pure ES module for the Web Share Target quick-add (v2).
// Android shares a contact / profile link / snippet into the app as GET params title/text/url.
// We only parse what was shared into an Add Lead draft; nothing is read from any other app.

import { normalizePhone, normalizeInstagramHandle } from './phone.js';

const IG_URL_RE = /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?/i;
const WA_URL_RE = /https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)\/?\??(?:phone=)?\+?(\d{10,15})/i;
const HANDLE_RE = /(?:^|[\s:,(])@([A-Za-z0-9._]{2,30})/;
const PHONE_RE = /(?:\+?91[\s-]?)?(?:\(?0\)?[\s-]?)?[6-9]\d{4}[\s-]?\d{5}|\+\d[\d\s-]{8,16}\d/;
const LABEL_RE = /^(?:name|naam|contact|tel|phone|mobile|mob|whatsapp|wa|ig|insta|instagram)\s*[:=-]\s*/i;

/** True when the URL carries share-target params worth handling. */
export function hasSharePayload(search = '') {
  const p = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  return ['title', 'text', 'url'].some((k) => String(p.get(k) || '').trim());
}

export function readSharePayload(search = '') {
  const p = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  return { title: p.get('title') || '', text: p.get('text') || '', url: p.get('url') || '' };
}

function cleanName(raw) {
  return String(raw || '')
    .replace(LABEL_RE, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function looksLikeName(s) {
  const v = String(s || '').trim();
  if (!v || v.length > 60) return false;
  if (/https?:\/\//i.test(v)) return false;
  if (/\d{5,}/.test(v)) return false;
  if (v.startsWith('@')) return false;
  return /^[\p{L}][\p{L}\p{M}\s.'-]*$/u.test(v);
}

/**
 * Parse a shared payload into an Add Lead draft.
 * @returns {{ handle: string, source: 'whatsapp'|'instagram'|'other', name: string, interest: string, matched: string }}
 */
export function parseSharedPayload({ title = '', text = '', url = '' } = {}) {
  const all = [url, text, title].map((x) => String(x || '')).join('\n');
  const out = { handle: '', source: 'other', name: '', interest: '', matched: 'none' };

  const ig = all.match(IG_URL_RE);
  if (ig && !['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'direct'].includes(ig[1].toLowerCase())) {
    out.handle = `@${normalizeInstagramHandle(ig[1])}`;
    out.source = 'instagram';
    out.matched = 'instagram_url';
  }

  if (!out.handle) {
    const wa = all.match(WA_URL_RE);
    if (wa) {
      out.handle = `+${normalizePhone(wa[1])}`;
      out.source = 'whatsapp';
      out.matched = 'wa_url';
    }
  }

  if (!out.handle) {
    const ph = all.match(PHONE_RE);
    if (ph) {
      const norm = normalizePhone(ph[0]);
      if (norm.length >= 12) {
        out.handle = `+${norm}`;
        out.source = 'whatsapp';
        out.matched = 'phone';
      }
    }
  }

  if (!out.handle) {
    const h = all.match(HANDLE_RE);
    if (h) {
      out.handle = `@${normalizeInstagramHandle(h[1])}`;
      out.source = 'instagram';
      out.matched = 'handle';
    }
  }

  // Name: explicit "Name: X" line, else a title that looks like a person, else first name-like line.
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const nameLine = lines.find((l) => /^(?:name|naam|contact)\s*[:=-]/i.test(l));
  if (nameLine) out.name = cleanName(nameLine);
  else if (looksLikeName(title)) out.name = cleanName(title);
  else {
    const candidate = lines.find((l) => looksLikeName(l));
    if (candidate) out.name = cleanName(candidate);
  }

  // Interest: leftover text without the handle / url / name lines, trimmed.
  const leftovers = lines
    .filter((l) => l !== nameLine)
    .map((l) => l.replace(/https?:\/\/\S+/g, '').replace(PHONE_RE, '').replace(HANDLE_RE, '').trim())
    .filter((l) => l && l !== out.name && !/^(?:tel|phone|mobile|mob|whatsapp|wa)\s*[:=-]?\s*$/i.test(l));
  out.interest = leftovers.join(' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!out.interest && !out.handle && looksLikeName(title) === false && title) out.interest = cleanName(title);

  return out;
}
