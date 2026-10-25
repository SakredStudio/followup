// Google Play Billing for FollowUp Buddy Pro, via the Digital Goods API + Payment Request.
// Only works inside the Play-installed TWA (androidbrowserhelper billing bridge); everywhere else
// every function reports "unavailable" and the app sells nothing (Play policy: no external paywall).
// No backend. Pro is an auto-renewing subscription with two plans (monthly / yearly). Play
// acknowledges the purchase when PaymentResponse.complete('success') is called; the entitlement
// is restored from listPurchases(), which lists only active (non-expired) subscriptions.

export const PLAY_BILLING_METHOD = 'https://play.google.com/billing';
export const PRO_SKUS = {
  monthly: 'fub_pro_monthly',
  yearly: 'fub_pro_yearly'
};
export const PRO_PRICE_FALLBACK = { monthly: '₹149', yearly: '₹999' };

export class PurchaseError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function getWindow(w) {
  return w !== undefined ? w : typeof window !== 'undefined' ? window : null;
}

const serviceCache = new WeakMap();

async function service(w) {
  const win = getWindow(w);
  if (!win || typeof win.getDigitalGoodsService !== 'function') return null;
  if (serviceCache.has(win)) return serviceCache.get(win);
  let svc = null;
  try {
    svc = await win.getDigitalGoodsService(PLAY_BILLING_METHOD);
  } catch {
    svc = null;
  }
  serviceCache.set(win, svc || null);
  return svc || null;
}

/** True only inside the Play TWA with the billing bridge. */
export async function isPlayBillingAvailable(w) {
  const win = getWindow(w);
  if (!win || typeof win.PaymentRequest !== 'function') return false;
  return (await service(w)) !== null;
}

/** Localised Play prices for both plans, or the fallbacks when unavailable. */
export async function getProPrices(w) {
  const svc = await service(w);
  if (!svc) return { ...PRO_PRICE_FALLBACK };
  try {
    const details = await svc.getDetails(Object.values(PRO_SKUS));
    const out = { ...PRO_PRICE_FALLBACK };
    for (const plan of Object.keys(PRO_SKUS)) {
      const d = Array.isArray(details) ? details.find((x) => x.itemId === PRO_SKUS[plan]) : null;
      if (d && d.price) out[plan] = formatPrice(d.price);
    }
    return out;
  } catch {
    return { ...PRO_PRICE_FALLBACK };
  }
}

export function formatPrice(price) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: price.currency, maximumFractionDigits: 2 })
      .format(Number(price.value))
      .replace(/\.00$/, '');
  } catch {
    return `${price.currency} ${price.value}`;
  }
}

/** Active Pro subscription on this Google account? Returns the plan name or null. */
export async function activeProPlan(w) {
  const svc = await service(w);
  if (!svc) return null;
  try {
    const list = await svc.listPurchases();
    if (!Array.isArray(list)) return null;
    for (const plan of Object.keys(PRO_SKUS)) {
      if (list.some((p) => p.itemId === PRO_SKUS[plan])) return plan;
    }
    return null;
  } catch {
    return null;
  }
}

/** Convenience boolean for callers that only need the entitlement. */
export async function hasProPurchase(w) {
  return (await activeProPlan(w)) !== null;
}

/** Subscribe to Pro inside the Play app. plan = 'monthly' | 'yearly'. */
export async function buyPro(plan, w) {
  const sku = PRO_SKUS[plan];
  if (!sku) throw new PurchaseError('bad_plan');
  const win = getWindow(w);
  if (!(await isPlayBillingAvailable(w))) throw new PurchaseError('unavailable');
  const request = new win.PaymentRequest(
    [{ supportedMethods: PLAY_BILLING_METHOD, data: { sku } }],
    // Play ignores this total and uses the Console price.
    { total: { label: sku, amount: { currency: 'INR', value: '0' } } }
  );
  let response;
  try {
    response = await request.show();
  } catch (e) {
    throw new PurchaseError(e && e.name === 'AbortError' ? 'cancelled' : 'show_failed', e && e.message);
  }
  const details = response.details || {};
  const token = details.purchaseToken || details.token;
  if (!token) {
    await response.complete('fail').catch(() => null);
    throw new PurchaseError('no_token');
  }
  await response.complete('success');
  return true;
}

/** Deep link to Play's manage-subscriptions page for this app (Play policy: must be reachable). */
export const MANAGE_SUBSCRIPTIONS_URL =
  'https://play.google.com/store/account/subscriptions?package=com.sakredstudio.followupbuddy';
