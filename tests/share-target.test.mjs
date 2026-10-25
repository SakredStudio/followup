import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSharedPayload, hasSharePayload, readSharePayload } from '../lib/share-target.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('share-target: 8 shared-text shapes parse into a lead draft', () => {
  // 1. Instagram profile URL shared from the IG app (url param)
  let r = parseSharedPayload({ url: 'https://www.instagram.com/priya.bakes_indore/?igsh=abc' });
  assert.equal(r.handle, '@priya.bakes_indore');
  assert.equal(r.source, 'instagram');

  // 2. Instagram URL inside the text with a caption
  r = parseSharedPayload({ text: 'Check this seller https://instagram.com/aisha_styles.nag loved the organza saree' });
  assert.equal(r.handle, '@aisha_styles.nag');
  assert.equal(r.source, 'instagram');
  assert.ok(r.interest.includes('organza saree'));

  // 3. Plain @handle in text
  r = parseSharedPayload({ text: 'Follow up with @karan.fits about L size tees' });
  assert.equal(r.handle, '@karan.fits');
  assert.equal(r.source, 'instagram');
  assert.ok(r.interest.includes('L size tees'));

  // 4. Shared contact: name + Indian number with +91 and spaces
  r = parseSharedPayload({ text: 'Rohit Verma\n+91 98765 43210' });
  assert.equal(r.handle, '+919876543210');
  assert.equal(r.source, 'whatsapp');
  assert.equal(r.name, 'Rohit Verma');

  // 5. Bare 10-digit number with a note
  r = parseSharedPayload({ text: '9820911223 wants 2kg truffle cake Sunday' });
  assert.equal(r.handle, '+919820911223');
  assert.equal(r.source, 'whatsapp');
  assert.ok(r.interest.includes('2kg truffle cake'));

  // 6. wa.me link
  r = parseSharedPayload({ url: 'https://wa.me/919988722115', title: 'Vikram Singh' });
  assert.equal(r.handle, '+919988722115');
  assert.equal(r.source, 'whatsapp');
  assert.equal(r.name, 'Vikram Singh');

  // 7. vCard-ish labelled lines
  r = parseSharedPayload({ text: 'Name: Sneha Iyer\nPhone: 088665 41122\nDiwali hampers x25' });
  assert.equal(r.name, 'Sneha Iyer');
  assert.equal(r.handle, '+918866541122');
  assert.ok(r.interest.includes('Diwali hampers'));

  // 8. Free text with no handle at all → Other source, text kept as interest
  r = parseSharedPayload({ text: 'Bridal makeup trial, wedding 12 Dec, wants quote' });
  assert.equal(r.handle, '');
  assert.equal(r.source, 'other');
  assert.equal(r.matched, 'none');
  assert.ok(r.interest.startsWith('Bridal makeup trial'));
});

test('share-target: instagram post/reel links are not treated as a profile; url params detected', () => {
  const r = parseSharedPayload({ url: 'https://www.instagram.com/reel/Cxyz123/' });
  assert.equal(r.handle, '');
  assert.equal(hasSharePayload('?title=&text=&url='), false);
  assert.equal(hasSharePayload('?text=hi'), true);
  assert.deepEqual(readSharePayload('?title=A&text=B%20C&url=https%3A%2F%2Fx.y'), { title: 'A', text: 'B C', url: 'https://x.y' });
});

test('share-target: manifest declares a GET share_target with title/text/url', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.webmanifest'), 'utf8'));
  assert.ok(m.share_target, 'share_target present');
  assert.equal((m.share_target.method || 'GET').toUpperCase(), 'GET');
  assert.deepEqual(m.share_target.params, { title: 'title', text: 'text', url: 'url' });
  assert.ok(String(m.share_target.action).startsWith('./'));
});
