// FollowUp Buddy — Main Application Controller (P0 shell, wired through P1–P5)
import { registerTranslations, t } from './lib/i18n.js';
import { loadState, saveState } from './lib/store.js';

async function loadDictionaries() {
  const [enRes, hiRes] = await Promise.all([
    fetch('./i18n/en.json'),
    fetch('./i18n/hi.json')
  ]);
  const [enDict, hiDict] = await Promise.all([enRes.json(), hiRes.json()]);
  registerTranslations('en', enDict);
  registerTranslations('hi', hiDict);
}

export async function initApp() {
  await loadDictionaries();
  const state = loadState();
  saveState(state);
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML = `<div class="fub"><div class="fub-bar"><h1>${t(state.settings.language, 'app_name')}</h1></div></div>`;
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    initApp().catch((err) => console.error('FollowUp Buddy init failed:', err));
  });
}
