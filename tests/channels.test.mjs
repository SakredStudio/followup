import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_LINK,
  SHARE_LINE,
  buildFollowUpMessage,
  buildWhatsAppUrl,
  buildInstagramWebUrl,
  buildInstagramDeepLink,
  buildLeadSummaryText,
} from '../lib/channels.js';

test('channels: buildFollowUpMessage interpolates firstName, truncates interest > 80 chars, and appends share line', () => {
  const lead = {
    name: 'Ananya Verma',
    interest: 'Custom mirror-work lehenga — sage green, S/M, delivery before Nov 28',
  };
  const msg = buildFollowUpMessage(lead, true);
  assert.ok(msg.startsWith('Hi Ananya! Following up on the Custom mirror-work lehenga'));
  assert.ok(msg.endsWith(SHARE_LINE));
  assert.ok(msg.includes(APP_LINK));

  // Long interest (>80 chars) gets truncated to 77 chars + '…' (78 chars total)
  const longInterest = 'A'.repeat(100);
  const longMsg = buildFollowUpMessage({ name: 'Rohan', interest: longInterest }, false);
  const expectedInterest = 'A'.repeat(77) + '…';
  assert.equal(longMsg, `Hi Rohan! Following up on the ${expectedInterest}. Still interested? 😊`);
});

test('channels: buildWhatsAppUrl and buildInstagramWebUrl normalize handles and URL-encode text', () => {
  const waUrl = buildWhatsAppUrl('+91 98201 44510', 'Hi Ananya! Still interested?');
  assert.equal(
    waUrl,
    'https://wa.me/919820144510?text=Hi%20Ananya!%20Still%20interested%3F'
  );

  const igWeb = buildInstagramWebUrl('@meera.styles_');
  assert.equal(igWeb, 'https://instagram.com/meera.styles_');

  const igDeep = buildInstagramDeepLink('https://instagram.com/divya.Creates/');
  assert.equal(igDeep, 'instagram://user?username=divya.Creates');
});

test('channels: buildLeadSummaryText includes lead details and app link', () => {
  const summary = buildLeadSummaryText({
    name: 'Kabir Mehta',
    source: 'whatsapp',
    handle: '+91 97690 88210',
    status: 'converted',
    priority: true,
    interest: '3BHK interior design',
    convertedValue: 45000,
  });
  assert.ok(summary.includes('Kabir Mehta'));
  assert.ok(summary.includes('₹45,000'));
  assert.ok(summary.includes(APP_LINK));
});
