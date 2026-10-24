import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, normalizeInstagramHandle } from '../lib/phone.js';

test('phone: normalizes Indian phone numbers to 91XXXXXXXXXX', () => {
  assert.equal(normalizePhone('+91 98765 43210'), '919876543210');
  assert.equal(normalizePhone('98765-43210'), '919876543210');
  assert.equal(normalizePhone('09876543210'), '919876543210');
  assert.equal(normalizePhone('919876543210'), '919876543210');
});

test('phone: normalizes Instagram handles by stripping @ and URL prefix', () => {
  assert.equal(normalizeInstagramHandle('@priya.bakes_indore'), 'priya.bakes_indore');
  assert.equal(normalizeInstagramHandle('https://instagram.com/aisha_styles.nag/'), 'aisha_styles.nag');
});
