// FollowUp Buddy — Main Application Controller (P0–P1: Onboarding + Today screen)
import { registerTranslations, t } from './lib/i18n.js';
import { initials, avatarColor, relTime, formatHeaderDate } from './lib/format.js';
import {
  loadState,
  saveState,
  updateSettings,
  getActiveLeadCount,
  seedSampleLeads,
  FREE_ACTIVE_LEAD_LIMIT
} from './lib/store.js';
import { categorize, computeCatchUpBanner, startOfDay } from './lib/categorize.js';

let appState = null;
let uiState = {
  tab: 'today', // 'today' | 'all' | 'settings'
  screen: 'today', // 'onboarding' | 'today' | 'detail' | 'all' | 'settings'
  onbStep: 0, // 0, 1, 2
  selectedLeadId: null,
  addSheetOpen: false,
  snackMessage: null
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadDictionaries() {
  const [enRes, hiRes] = await Promise.all([
    fetch('./i18n/en.json'),
    fetch('./i18n/hi.json')
  ]);
  const [enDict, hiDict] = await Promise.all([enRes.json(), hiRes.json()]);
  registerTranslations('en', enDict);
  registerTranslations('hi', hiDict);
}

function applyThemeAndDensity() {
  if (!appState) return;
  const root = document.documentElement;
  if (appState.settings.theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.setAttribute('data-density', appState.settings.density || 'comfy');
  }
}

function renderChannelChip(source, lang) {
  if (source === 'whatsapp') {
    return `<span class="chip wa">💬 ${escapeHtml(t(lang, 'source_whatsapp'))}</span>`;
  }
  if (source === 'instagram') {
    return `<span class="chip ig">📸 ${escapeHtml(t(lang, 'source_instagram'))}</span>`;
  }
  return `<span class="chip">${escapeHtml(t(lang, 'source_other'))}</span>`;
}

function renderStatusPill(status, lang) {
  const cls = status === 'not_interested' ? 'not' : status;
  const key = `status_${status}`;
  return `<span class="statusPill ${escapeHtml(cls)}">${escapeHtml(t(lang, key))}</span>`;
}

export function renderLeadRow(lead, { showFollowUp = true, now = Date.now(), lang = 'en' } = {}) {
  const dayStart = startOfDay(now).getTime();
  const isOverdue =
    lead.status === 'active' &&
    lead.nextFollowUpAt !== null &&
    lead.nextFollowUpAt < dayStart;
  const ini = initials(lead.name);
  const bg = avatarColor(lead.name);
  const tags = Array.isArray(lead.tags) ? lead.tags : [];

  return `
    <button type="button" class="lead ${lead.priority ? 'priority' : ''} ${isOverdue && showFollowUp ? 'overdue' : ''}"
      data-lead-id="${escapeHtml(lead.id)}">
      <div class="avatar" style="background:${bg};">${escapeHtml(ini)}</div>
      <div class="lead-body">
        <div class="lead-name">${escapeHtml(lead.name)}</div>
        <div class="lead-meta">
          ${renderChannelChip(lead.source, lang)}
          ${lead.priority ? '<span style="color:var(--fub-marigold); font-size:13px;" aria-label="Priority">★</span>' : ''}
        </div>
        <div class="lead-notes">${escapeHtml(lead.interest)}</div>
        ${
          tags.length > 0
            ? `<div class="lead-tags">
                 ${tags
                   .slice(0, 3)
                   .map((tg) => `<span class="chip tag">${escapeHtml(tg)}</span>`)
                   .join('')}
                 ${tags.length > 3 ? `<span class="chip">+${tags.length - 3}</span>` : ''}
               </div>`
            : ''
        }
      </div>
      <div class="lead-right">
        ${
          showFollowUp && lead.nextFollowUpAt
            ? `<div class="lead-time">${escapeHtml(relTime(lead.nextFollowUpAt, now))}</div>`
            : !showFollowUp
              ? renderStatusPill(lead.status, lang)
              : ''
        }
        <span style="color:var(--fub-ink-3); font-size:16px;" aria-hidden="true">›</span>
      </div>
    </button>
  `;
}

function renderOnboardingScreen(lang) {
  const step = uiState.onbStep;
  if (step === 0) {
    return `
      <div class="fub" data-screen="onboarding">
        <div class="onb">
          <div style="display:flex; justify-content:flex-end; margin-bottom:8px;">
            <button type="button" id="btn-onb-skip" class="btn flat sm">${escapeHtml(t(lang, 'onb_skip'))}</button>
          </div>
          <div class="onb-art a">
            <div style="text-align:center;">
              <div style="font-size:72px; margin-bottom:8px;">📱→📋</div>
              <div style="font-size:14px; color:var(--fub-ink-2); font-weight:600; background:#fff; padding:8px 14px; border-radius:999px; display:inline-block;">
                ${escapeHtml(t(lang, 'onb_1_quote'))}
              </div>
            </div>
          </div>
          <h2>${escapeHtml(t(lang, 'onb_1_title'))}</h2>
          <p>${escapeHtml(t(lang, 'onb_1_sub'))}</p>
          <div class="onb-dots"><span class="on"></span><span></span><span></span></div>
          <button type="button" id="btn-onb-next" class="btn primary block">${escapeHtml(t(lang, 'onb_next'))}</button>
        </div>
      </div>
    `;
  }
  if (step === 1) {
    return `
      <div class="fub" data-screen="onboarding">
        <div class="onb">
          <div style="display:flex; justify-content:flex-end; margin-bottom:8px;">
            <button type="button" id="btn-onb-skip" class="btn flat sm">${escapeHtml(t(lang, 'onb_skip'))}</button>
          </div>
          <div class="onb-art b">
            <div style="width:180px; background:var(--fub-card); border-radius:18px; padding:12px; box-shadow:0 12px 32px rgba(0,0,0,.18); transform:rotate(-3deg);">
              <div style="font-size:11px; font-weight:700; padding-bottom:6px; color:var(--fub-emerald-deep);">Today · 5 to follow up</div>
              <div style="font-size:11px; padding:4px 0; border-bottom:1px solid var(--fub-line-soft);">Priya S · Red velvet cake</div>
              <div style="font-size:11px; padding:4px 0; border-bottom:1px solid var(--fub-line-soft);">Rohit V · Tiffin plan</div>
              <div style="font-size:11px; padding:4px 0;">Sneha I · Diwali hampers</div>
            </div>
          </div>
          <h2>${escapeHtml(t(lang, 'onb_2_title'))}</h2>
          <p>${escapeHtml(t(lang, 'onb_2_sub'))}</p>
          <div class="onb-dots"><span></span><span class="on"></span><span></span></div>
          <button type="button" id="btn-onb-next" class="btn primary block">${escapeHtml(t(lang, 'onb_next'))}</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="fub" data-screen="onboarding">
      <div class="onb">
        <div class="onb-art c">
          <div style="text-align:center;">
            <div style="display:flex; gap:10px; justify-content:center; margin-bottom:14px;">
              <div style="width:56px; height:56px; border-radius:16px; background:#fff; display:flex; align-items:center; justify-content:center; font-size:26px; box-shadow:0 8px 24px rgba(0,0,0,.1);">💬</div>
              <div style="width:56px; height:56px; border-radius:16px; background:#fff; display:flex; align-items:center; justify-content:center; font-size:26px; box-shadow:0 8px 24px rgba(0,0,0,.1);">📸</div>
            </div>
            <div style="font-size:13px; color:var(--fub-ink-2); font-weight:600; background:#fff; padding:8px 14px; border-radius:999px; display:inline-block;">
              ${escapeHtml(t(lang, 'onb_3_pill'))}
            </div>
          </div>
        </div>
        <h2>${escapeHtml(t(lang, 'onb_3_title'))}</h2>
        <p>${escapeHtml(t(lang, 'onb_3_sub'))}</p>
        <div class="onb-dots"><span></span><span></span><span class="on"></span></div>
        <button type="button" id="btn-onb-finish" class="btn primary block">${escapeHtml(t(lang, 'onb_start'))}</button>
      </div>
    </div>
  `;
}

function renderTodayScreen(lang) {
  const now = Date.now();
  const { overdue, today, upcoming } = categorize(appState.leads, now);
  const catchUp = computeCatchUpBanner(appState.leads, appState.settings, now);
  const activeCount = getActiveLeadCount(appState);
  const firstName = (appState.settings.sellerName || 'Priya').split(' ')[0];
  const isEmpty = overdue.length === 0 && today.length === 0 && upcoming.length === 0;
  const showProCard = !appState.settings.isPro && activeCount / FREE_ACTIVE_LEAD_LIMIT >= 0.8;

  return `
    <div class="fub" data-screen="today">
      <div class="fub-bar">
        <div style="flex:1;">
          <h1>${escapeHtml(t(lang, 'today_title'))}</h1>
          <div class="sub">${escapeHtml(formatHeaderDate(now))}</div>
        </div>
        <button type="button" class="btn icon flat" id="btn-today-search" aria-label="Search">🔍</button>
      </div>

      <div class="fub-content">
        ${
          catchUp
            ? `<div style="background:var(--fub-marigold-soft); color:#5e3d02; border-radius:12px; padding:10px 14px; margin-bottom:10px; font-size:13px; font-weight:600;">
                 ⚠ ${escapeHtml(catchUp.text)}
               </div>`
            : ''
        }

        <div class="today-hero">
          <div class="greet">${escapeHtml(t(lang, 'today_greet', { firstName }))}</div>
          <div class="stat">
            <span id="today-hero-count">${today.length}</span>
            <small>${escapeHtml(t(lang, 'today_stat_suffix'))}</small>
          </div>
          <div class="row">
            ${
              overdue.length > 0
                ? `<span class="pill warn" id="today-overdue-pill">${escapeHtml(t(lang, 'today_overdue_pill', { count: overdue.length }))}</span>`
                : ''
            }
            <span class="pill" id="today-upcoming-pill">${escapeHtml(t(lang, 'today_upcoming_pill', { count: upcoming.length }))}</span>
          </div>
        </div>

        ${
          isEmpty
            ? `<div class="empty">
                 <div style="font-size:56px;">🍵</div>
                 <h3>${escapeHtml(t(lang, 'empty_today_title'))}</h3>
                 <p>${escapeHtml(t(lang, 'empty_today_sub'))}</p>
                 <button type="button" id="btn-empty-add-lead" class="btn primary" style="margin-top:14px;">
                   + ${escapeHtml(t(lang, 'empty_today_cta'))}
                 </button>
               </div>`
            : `
              ${
                overdue.length > 0
                  ? `<div class="fub-section">
                       <h2>${escapeHtml(t(lang, 'section_overdue'))}</h2>
                       <span class="count">${overdue.length}</span>
                     </div>
                     ${overdue.map((l) => renderLeadRow(l, { showFollowUp: true, now, lang })).join('')}`
                  : ''
              }

              <div class="fub-section">
                <h2>${escapeHtml(t(lang, 'section_today'))}</h2>
                <span class="count">${today.length}</span>
              </div>
              ${today.map((l) => renderLeadRow(l, { showFollowUp: true, now, lang })).join('')}

              <div class="fub-section">
                <h2>${escapeHtml(t(lang, 'section_upcoming'))}</h2>
                <span class="count">${upcoming.length}</span>
              </div>
              ${upcoming.map((l) => renderLeadRow(l, { showFollowUp: true, now, lang })).join('')}
            `
        }

        ${
          showProCard
            ? `<div class="pro-card" style="margin-top:20px;">
                 <h3>${escapeHtml(t(lang, 'pro_card_today_title'))}</h3>
                 <p>${escapeHtml(t(lang, 'pro_card_today_body', { used: activeCount }))}</p>
                 <button type="button" class="btn sm" id="btn-today-pro-upsell">
                   ${escapeHtml(t(lang, 'pro_card_today_cta'))}
                 </button>
               </div>`
            : ''
        }
      </div>

      <button type="button" class="fab large" id="btn-fab-add">
        <span>+</span>
        <span>${escapeHtml(t(lang, 'fab_add_lead'))}</span>
      </button>
    </div>
  `;
}

function renderTabBar(lang) {
  const tabs = [
    { id: 'today', label: t(lang, 'tab_today'), icon: '☀️' },
    { id: 'all', label: t(lang, 'tab_leads'), icon: '📋' },
    { id: 'add', label: t(lang, 'tab_add'), icon: '➕' },
    { id: 'settings', label: t(lang, 'tab_settings'), icon: '⚙️' }
  ];
  return `
    <nav class="fub-tabs" aria-label="Main Tabs">
      ${tabs
        .map((tb) => {
          const active = uiState.tab === tb.id;
          return `
            <button type="button" class="fub-tab ${active ? 'active' : ''}" data-tab="${tb.id}">
              <span class="pill" aria-hidden="true">${tb.icon}</span>
              <span>${escapeHtml(tb.label)}</span>
            </button>
          `;
        })
        .join('')}
    </nav>
  `;
}

export function renderApp() {
  const root = document.getElementById('app');
  if (!root || !appState) return;
  applyThemeAndDensity();

  const lang = appState.settings.language;

  if (!appState.settings.hasOnboarded && uiState.screen === 'onboarding') {
    root.innerHTML = renderOnboardingScreen(lang);
    bindEvents();
    return;
  }

  root.innerHTML = `
    ${renderTodayScreen(lang)}
    ${uiState.snackMessage ? `<div class="snack">${escapeHtml(uiState.snackMessage)}</div>` : ''}
    ${renderTabBar(lang)}
  `;
  bindEvents();
}

function bindEvents() {
  const root = document.getElementById('app');
  if (!root) return;

  const onbSkip = root.querySelector('#btn-onb-skip');
  if (onbSkip) {
    onbSkip.addEventListener('click', () => {
      uiState.onbStep = 2;
      renderApp();
    });
  }

  const onbNext = root.querySelector('#btn-onb-next');
  if (onbNext) {
    onbNext.addEventListener('click', () => {
      uiState.onbStep = Math.min(2, uiState.onbStep + 1);
      renderApp();
    });
  }

  const onbFinish = root.querySelector('#btn-onb-finish');
  if (onbFinish) {
    onbFinish.addEventListener('click', () => {
      appState = updateSettings(appState, { hasOnboarded: true });
      uiState.screen = 'today';
      renderApp();
    });
  }

  root.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      if (tabId === 'add') {
        uiState.addSheetOpen = true;
        renderApp();
        return;
      }
      uiState.tab = tabId;
      uiState.screen = tabId;
      renderApp();
    });
  });
}

export async function initApp() {
  await loadDictionaries();
  appState = loadState();
  if (appState.leads.length === 0 && !appState.settings.hasOnboarded) {
    appState = seedSampleLeads(appState, globalThis.localStorage, Date.now());
  }
  uiState.screen = appState.settings.hasOnboarded ? 'today' : 'onboarding';
  saveState(appState);
  renderApp();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    initApp().catch((err) => console.error('FollowUp Buddy init failed:', err));
  });
}
