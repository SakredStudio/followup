import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUPPORTED_LANGS,
  DEFAULT_LANG,
  registerTranslations,
  t,
  validateTranslationTables
} from '../lib/i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../i18n/en.json'), 'utf8'));
const hiJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../i18n/hi.json'), 'utf8'));

test('i18n: en.json and hi.json have identical non-empty key sets', () => {
  const res = validateTranslationTables({ en: enJson, hi: hiJson });
  assert.equal(res.valid, true);
  assert.ok(res.keyCount >= 80, `Expected >= 80 keys, got ${res.keyCount}`);
});

test('i18n: interpolates variables in English and Hindi', () => {
  registerTranslations('en', enJson);
  registerTranslations('hi', hiJson);
  assert.equal(DEFAULT_LANG, 'en');
  assert.deepEqual(SUPPORTED_LANGS, ['en', 'hi']);
  assert.equal(t('en', 'today_greet', { firstName: 'Priya' }), 'Good morning, Priya 👋');
  assert.equal(t('hi', 'today_greet', { firstName: 'Priya' }), 'सुप्रभात, Priya 👋');
});
