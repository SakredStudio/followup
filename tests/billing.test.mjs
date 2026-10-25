import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlayBillingAvailable, getProPrices, activeProPlan, hasProPurchase, buyPro, PRO_SKUS, PRO_PRICE_FALLBACK } from '../lib/billing.js';

function fakeWindow({ purchases = [], showResult = 'ok' } = {}) {
  const completed = [];
  const prices = { [PRO_SKUS.monthly]: '149.00', [PRO_SKUS.yearly]: '999.00' };
  const svc = {
    getDetails: async (ids) => ids.map((itemId) => ({ itemId, price: { currency: 'INR', value: prices[itemId] } })),
    listPurchases: async () => purchases
  };
  class PaymentRequest {
    constructor(methods) { this.sku = methods[0].data.sku; }
    async show() {
      if (showResult === 'abort') { const e = new Error('user closed'); e.name = 'AbortError'; throw e; }
      return { details: { purchaseToken: 'tok_' + this.sku }, complete: async (r) => { completed.push(r); } };
    }
  }
  return { win: { getDigitalGoodsService: async () => svc, PaymentRequest }, completed };
}

test('billing: unavailable outside the Play TWA (no window / no bridge)', async () => {
  assert.equal(await isPlayBillingAvailable(null), false);
  assert.equal(await isPlayBillingAvailable({}), false);
  assert.deepEqual(await getProPrices({}), PRO_PRICE_FALLBACK);
  assert.equal(await activeProPlan({}), null);
  assert.equal(await hasProPurchase({}), false);
  await assert.rejects(buyPro('monthly', {}), (e) => e.code === 'unavailable');
  await assert.rejects(buyPro('weekly', {}), (e) => e.code === 'bad_plan');
});

test('billing: both plan prices from Play; yearly subscription restores; buy acknowledges', async () => {
  const { win, completed } = fakeWindow({ purchases: [{ itemId: PRO_SKUS.yearly, purchaseToken: 'x' }] });
  assert.equal(await isPlayBillingAvailable(win), true);
  assert.deepEqual(await getProPrices(win), { monthly: '₹149', yearly: '₹999' });
  assert.equal(await activeProPlan(win), 'yearly');
  assert.equal(await hasProPurchase(win), true);
  assert.equal(await buyPro('monthly', win), true);
  assert.deepEqual(completed, ['success']);
});

test('billing: user cancel surfaces as code "cancelled"', async () => {
  const { win } = fakeWindow({ showResult: 'abort' });
  await assert.rejects(buyPro('yearly', win), (e) => e.code === 'cancelled');
});
