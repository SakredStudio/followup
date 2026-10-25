// Catalogue (v3): up to 10 products {name, price, photoId}; free tier 3, Pro 10.
// Product-card rendering (1080×1350 PNG via canvas) lives here too but only runs in a browser;
// the card *model* and message text are pure and tested in Node.

import { migrate, saveState } from './store.js';
import { buildFollowUpMessage, SHARE_LINE, APP_LINK } from './channels.js';
import { inr } from './format.js';

export const FREE_PRODUCT_LIMIT = 3;
export const PRO_PRODUCT_LIMIT = 10;
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

function makeId() {
  return `prd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function productLimit(settings) {
  return settings?.isPro ? PRO_PRODUCT_LIMIT : FREE_PRODUCT_LIMIT;
}

export function canAddProduct(state) {
  const cur = migrate(state);
  return (cur.catalogue || []).length < productLimit(cur.settings);
}

export function normalizeProduct(p, now = Date.now()) {
  const price = Math.round(Number(p?.price));
  return {
    id: String(p?.id || makeId()),
    name: String(p?.name || '').trim().slice(0, 60),
    price: Number.isFinite(price) && price >= 0 ? price : 0,
    photoId: p?.photoId ? String(p.photoId) : null,
    updatedAt: Number.isFinite(Number(p?.updatedAt)) ? Number(p.updatedAt) : now
  };
}

/** Add a product. Throws .code = 'PRODUCT_LIMIT' (free: PRO_PRODUCT_LIMIT hint) or 'PRODUCT_INVALID'. */
export function addProduct(state, input, storage = globalThis.localStorage, now = Date.now()) {
  const cur = migrate(state);
  const list = cur.catalogue || [];
  const p = normalizeProduct({ ...input, id: undefined, updatedAt: now }, now);
  if (!p.name) {
    const err = new Error('Product needs a name');
    err.code = 'PRODUCT_INVALID';
    throw err;
  }
  if (list.length >= productLimit(cur.settings)) {
    const err = new Error(`Catalogue limit ${productLimit(cur.settings)}`);
    err.code = cur.settings.isPro ? 'PRODUCT_LIMIT' : 'PRO_PRODUCT_LIMIT';
    throw err;
  }
  return saveState({ ...cur, catalogue: [...list, p] }, storage);
}

export function updateProduct(state, id, patch, storage = globalThis.localStorage, now = Date.now()) {
  const cur = migrate(state);
  const list = (cur.catalogue || []).map((p) => (p.id === id ? normalizeProduct({ ...p, ...patch, id, updatedAt: now }, now) : p));
  return saveState({ ...cur, catalogue: list }, storage);
}

export function removeProduct(state, id, storage = globalThis.localStorage) {
  const cur = migrate(state);
  return saveState({ ...cur, catalogue: (cur.catalogue || []).filter((p) => p.id !== id) }, storage);
}

/** Pure card model: what gets drawn. */
export function buildProductCardModel(product, settings = {}) {
  const seller = String(settings?.sellerName || '').trim();
  const biz = String(settings?.sellerBusiness || '').trim();
  return {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    name: String(product?.name || '').trim() || 'Product',
    priceText: inr(product?.price || 0),
    seller: [seller, biz].filter(Boolean).join(' · '),
    handle: String(settings?.sellerHandle || '').trim(),
    shareLine: `sent with FollowUp Buddy · ${APP_LINK}`,
    photoId: product?.photoId || null
  };
}

/** wa.me text for a product sent to a lead: greeting + product line + mandatory share line. */
export function buildProductMessage(lead, product, settings = {}) {
  const seller = String(settings?.sellerName || '').trim();
  const line = `${String(product?.name || '').trim()} — ${inr(product?.price || 0)}`;
  const tpl = `Hi {firstName}! ${seller ? `${seller} here. ` : ''}Here's the ${line}. Shall I book it for you? 😊`;
  const msg = buildFollowUpMessage(lead, true, tpl);
  if (!msg.endsWith(SHARE_LINE)) throw new Error('share line missing');
  return msg;
}

/** Suggested file name for the PNG. */
export function productCardFileName(product) {
  const slug = String(product?.name || 'product')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
  return `${slug || 'product'}-card.png`;
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
  }
  return lines;
}

/**
 * Draw the 1080×1350 card onto a canvas (browser only).
 * @param {HTMLCanvasElement} canvas
 * @param {object} model from buildProductCardModel
 * @param {ImageBitmap|HTMLImageElement|null} photo
 */
export function drawProductCard(canvas, model, photo) {
  canvas.width = model.width;
  canvas.height = model.height;
  const ctx = canvas.getContext('2d');
  const W = model.width;
  const H = model.height;
  const pad = 64;

  ctx.fillStyle = '#FAF7F2';
  ctx.fillRect(0, 0, W, H);

  // Photo area (square-ish top block)
  const photoH = 860;
  ctx.fillStyle = '#EEF6F3';
  ctx.fillRect(pad, pad, W - pad * 2, photoH);
  if (photo && photo.width && photo.height) {
    const scale = Math.max((W - pad * 2) / photo.width, photoH / photo.height);
    const dw = photo.width * scale;
    const dh = photo.height * scale;
    const dx = pad + ((W - pad * 2) - dw) / 2;
    const dy = pad + (photoH - dh) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad, pad, W - pad * 2, photoH);
    ctx.clip();
    ctx.drawImage(photo, dx, dy, dw, dh);
    ctx.restore();
  } else {
    ctx.fillStyle = '#0F6E5C';
    ctx.font = '600 72px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🛍️', W / 2, pad + photoH / 2 + 24);
    ctx.textAlign = 'left';
  }

  // Name + price
  let y = pad + photoH + 92;
  ctx.fillStyle = '#1A1A19';
  ctx.font = '800 64px "Plus Jakarta Sans", system-ui, sans-serif';
  const lines = wrapText(ctx, model.name, W - pad * 2 - 300, 2);
  lines.forEach((ln, i) => ctx.fillText(ln, pad, y + i * 74));
  ctx.fillStyle = '#0F6E5C';
  ctx.font = '800 72px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(model.priceText, W - pad, y);
  ctx.textAlign = 'left';

  // Seller
  y += lines.length * 74 + 40;
  ctx.fillStyle = '#4A4A47';
  ctx.font = '600 38px "Plus Jakarta Sans", system-ui, sans-serif';
  if (model.seller || model.handle) {
    ctx.fillText([model.seller, model.handle].filter(Boolean).join('  ·  ').slice(0, 60), pad, y);
  }

  // Share line (always)
  ctx.fillStyle = '#7A776F';
  ctx.font = '500 28px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(model.shareLine, pad, H - pad);
  return canvas;
}

/** Canvas → PNG Blob (browser only). */
export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
