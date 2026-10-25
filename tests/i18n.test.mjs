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
const hinglishJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../i18n/hinglish.json'), 'utf8'));

test('i18n: en.json, hi.json and hinglish.json have identical non-empty key sets', () => {
  const res = validateTranslationTables({ en: enJson, hi: hiJson, hinglish: hinglishJson });
  assert.equal(res.valid, true);
  assert.ok(res.keyCount >= 200, `Expected >= 200 keys, got ${res.keyCount}`);
  // Hinglish is Roman script: no Devanagari anywhere in the pack
  for (const [k, v] of Object.entries(hinglishJson)) {
    assert.ok(!/[ऀ-ॿ]/.test(v), `hinglish.${k} must be Roman script`);
  }
});

test('i18n: interpolates variables in English, Hindi and Hinglish', () => {
  registerTranslations('en', enJson);
  registerTranslations('hi', hiJson);
  registerTranslations('hinglish', hinglishJson);
  assert.equal(DEFAULT_LANG, 'en');
  assert.deepEqual(SUPPORTED_LANGS, ['en', 'hi', 'hinglish']);
  assert.equal(t('en', 'today_greet', { firstName: 'Priya' }), 'Good morning, Priya 👋');
  assert.equal(t('hi', 'today_greet', { firstName: 'Priya' }), 'सुप्रभात, Priya 👋');
  assert.equal(t('hinglish', 'today_stat_suffix'), 'ko aaj follow-up karna hai');
  assert.equal(t('hinglish', 'today_overdue_pill', { count: 3 }), '⚠ 3 overdue');
});
