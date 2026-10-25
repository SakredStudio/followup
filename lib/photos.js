// Browser-only IndexedDB wrapper for catalogue product photos (v3).
// Photos never leave the device: they are resized on-device (max 800 px) and stored as Blobs
// in IndexedDB 'fub-photos'. localStorage only keeps the photo id.

export const PHOTO_DB = 'fub-photos';
export const PHOTO_STORE = 'photos';
export const MAX_PHOTO_PX = 800;

function openDb(idb = typeof indexedDB !== 'undefined' ? indexedDB : null) {
  return new Promise((resolve, reject) => {
    if (!idb) return reject(new Error('IndexedDB unavailable'));
    const req = idb.open(PHOTO_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(PHOTO_STORE, mode);
    const store = t.objectStore(PHOTO_STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error || new Error('IndexedDB transaction failed'));
    t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
  });
}

export function makePhotoId() {
  return `ph_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function putPhoto(id, blob) {
  const db = await openDb();
  try {
    await tx(db, 'readwrite', (s) => s.put(blob, id));
  } finally {
    db.close();
  }
  return id;
}

export async function getPhoto(id) {
  if (!id) return null;
  let db;
  try {
    db = await openDb();
    const res = await tx(db, 'readonly', (s) => s.get(id));
    return res || null;
  } catch {
    return null;
  } finally {
    if (db) db.close();
  }
}

export async function deletePhoto(id) {
  if (!id) return;
  let db;
  try {
    db = await openDb();
    await tx(db, 'readwrite', (s) => s.delete(id));
  } catch {
    /* ignore */
  } finally {
    if (db) db.close();
  }
}

export async function clearPhotos() {
  let db;
  try {
    db = await openDb();
    await tx(db, 'readwrite', (s) => s.clear());
  } catch {
    /* ignore */
  } finally {
    if (db) db.close();
  }
}

/** Fit (w, h) inside max × max, never upscaling. Pure; exported for tests via catalogue.js. */
export function fitWithin(w, h, max = MAX_PHOTO_PX) {
  const scale = Math.min(1, max / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Resize an image File/Blob on device to max 800 px (longest side) as JPEG. */
export async function resizeImage(file, max = MAX_PHOTO_PX, quality = 0.86) {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('resize failed'))), 'image/jpeg', quality);
  });
}

/** Import a picked file: resize, store, return the photo id. */
export async function importPhoto(file) {
  const blob = await resizeImage(file);
  const id = makePhotoId();
  await putPhoto(id, blob);
  return id;
}
