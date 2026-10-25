import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FREE_PRODUCT_LIMIT,
  PRO_PRODUCT_LIMIT,
  addProduct,
  updateProduct,
  removeProduct,
  canAddProduct,
  buildProductCardModel,
  buildProductMessage,
  productCardFileName
} from '../lib/catalogue.js';
import { fitWithin } from '../lib/photos.js';
import { SHARE_LINE } from '../lib/channels.js';
import { createInitialState, updateSettings, migrate, exportBackupJson, importBackupJson } from '../lib/store.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('catalogue: free 3 products, Pro 10, CRUD and backup round-trip', () => {
  const storage = mem();
  let state = createInitialState();
  assert.deepEqual(state.catalogue, []);
  for (let i = 0; i < FREE_PRODUCT_LIMIT; i++) state = addProduct(state, { name: `P${i}`, price: 100 + i }, storage, 1000 + i);
  assert.equal(canAddProduct(state), false);
  assert.throws(() => addProduct(state, { name: 'extra', price: 1 }, storage), (e) => e.code === 'PRO_PRODUCT_LIMIT');

  state = updateSettings(state, { isPro: true }, storage);
  for (let i = FREE_PRODUCT_LIMIT; i < PRO_PRODUCT_LIMIT; i++) state = addProduct(state, { name: `P${i}`, price: '250.6' }, storage);
  assert.equal(state.catalogue.length, 10);
  assert.equal(state.catalogue[9].price, 251, 'price rounded to rupees');
  assert.throws(() => addProduct(state, { name: 'extra', price: 1 }, storage), (e) => e.code === 'PRODUCT_LIMIT');
  assert.throws(() => addProduct(removeProduct(state, state.catalogue[0].id, storage), { name: '  ', price: 1 }, storage), (e) => e.code === 'PRODUCT_INVALID');

  const id = state.catalogue[1].id;
  state = updateProduct(state, id, { name: 'Renamed', photoId: 'ph_1' }, storage, 5000);
  const p = state.catalogue.find((x) => x.id === id);
  assert.equal(p.name, 'Renamed');
  assert.equal(p.photoId, 'ph_1');
  assert.equal(p.updatedAt, 5000);

  state = removeProduct(state, id, storage);
  assert.equal(state.catalogue.length, 9);

  const restored = importBackupJson(exportBackupJson(state), storage);
  assert.equal(restored.catalogue.length, 9);
  assert.equal(migrate({ leads: [], catalogue: [{ name: 'x', price: -5 }, { name: '' }, 'junk'] }).catalogue.length, 1, 'invalid rows dropped');
  assert.equal(migrate({ leads: [], catalogue: Array.from({ length: 14 }, (_, i) => ({ name: `n${i}` })) }).catalogue.length, PRO_PRODUCT_LIMIT, 'capped at 10');
});

test('catalogue: card model, product message with share line, file name, photo fit', () => {
  const product = { id: 'p1', name: 'Red velvet cake 1 kg', price: 1200, photoId: 'ph_9' };
  const settings = { sellerName: 'Anjali', sellerBusiness: 'Sweet Tooth', sellerHandle: '@sweettooth.indore' };
  const model = buildProductCardModel(product, settings);
  assert.equal(model.width, 1080);
  assert.equal(model.height, 1350);
  assert.equal(model.priceText, '₹1,200');
  assert.equal(model.seller, 'Anjali · Sweet Tooth');
  assert.ok(model.shareLine.includes('followup.sakredstudio.ca'));
  assert.equal(model.photoId, 'ph_9');

  const msg = buildProductMessage({ name: 'Priya Sharma', interest: 'cake' }, product, settings);
  assert.ok(msg.startsWith('Hi Priya! Anjali here. Here\'s the Red velvet cake 1 kg — ₹1,200.'));
  assert.ok(msg.endsWith(SHARE_LINE));

  assert.equal(productCardFileName(product), 'red-velvet-cake-1-kg-card.png');
  assert.deepEqual(fitWithin(4000, 3000), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(300, 500), { width: 300, height: 500 }, 'never upscales');
});
