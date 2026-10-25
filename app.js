// FollowUp Buddy — Main Application Controller (P0–P5: Onboarding, Today, AddLeadSheet, LeadDetail, AllLeadsScreen, Settings, PWA)
import { registerTranslations, t, normalizeLang, LANG_LABELS } from './lib/i18n.js';
import { isPlayBillingAvailable, getProPrices, activeProPlan, buyPro, MANAGE_SUBSCRIPTIONS_URL } from './lib/billing.js';
import { initials, avatarColor, relTime, relPastTime, shortDate, formatHeaderDate, inr as formatINR } from './lib/format.js';
import {
  loadState,
  updateSettings,
  clearAllData,
  getActiveLeadCount,
  canAddActiveLead,
  canAddTag,
  addTag,
  createLead,
  updateLeadStatus,
  rescheduleFollowUp,
  logLeadEvent,
  archiveLead,
  getLeadEvents,
  exportBackupJson,
  importBackupJson,
  backupPayload,
  saveState,
  migrate,
  exportLeadsCsv,
  seedSampleLeads,
  FREE_ACTIVE_LEAD_LIMIT
} from './lib/store.js';
import { categorize, filterLeads, computeCatchUpBanner, startOfDay } from './lib/categorize.js';
import {

  buildWhatsAppUrl,
  buildInstagramWebUrl,
  buildLeadSummaryText
} from './lib/channels.js';
import { normalizePhone } from './lib/phone.js';
import { STAGES, groupByStage, deriveStage } from './lib/pipeline.js';
import { computeStats } from './lib/stats.js';
import { hasSharePayload, readSharePayload, parseSharedPayload } from './lib/share-target.js';
import { snoozePresets, pickDateAt } from './lib/snooze.js';
import {
  productLimit,
  addProduct,
  updateProduct,
  removeProduct,
  buildProductCardModel,
  buildProductMessage,
  productCardFileName,
  drawProductCard,
  canvasToPngBlob
} from './lib/catalogue.js';
import { importPhoto, getPhoto, deletePhoto, clearPhotos } from './lib/photos.js';
import { mergeStates, lastTouchedBy } from './lib/merge.js';
import {

  AUTO_SYNC_DEBOUNCE_MS,
  isCloudConfigured,
  newVaultId,
  formatVaultCode,
  parseVaultCode,
  deriveKey,
  exportKeyB64,
  importKeyB64,
  encryptJson,
  decryptJson,
  pushVault,
  pullVault,
  deleteVault,
  resolveConflict,
  stateUpdatedAt,
  randomBytes,
  bytesToBase64,
  base64ToBytes
} from './lib/cloud.js';
import { MAX_TEMPLATES, buildMessageForLead, resolveTemplate, saveTemplate, deleteTemplate, assignTagTemplate } from './lib/templates.js';
import {
  canNotify,
  nextReminderAt,
  buildDigestSnapshot,
  buildDigestText,
  writeDigestSnapshot,
  registerPeriodicDigest,
  unregisterPeriodicDigest,
  scheduleInAppReminder,
  showReminderNotification
} from './lib/notify.js';

let appState = null;
let snackTimer = null;
let digestTimer = null;
let cancelReminder = null;
let swRegistration = null;
let cloudTimer = null;
let cloudBusy = false;
let uiState = {
  tab: 'today', // 'today' | 'all' | 'settings'
  screen: 'today', // 'onboarding' | 'today' | 'detail' | 'all' | 'settings'
  prevScreen: 'today',
  onbStep: 0,
  selectedLeadId: null,
  addSheetOpen: false,
  proSheetOpen: false,
  billingAvailable: false,
  billingBusy: false,
  billingNotice: '',
  proPrices: { monthly: '₹149', yearly: '₹999' },
  rescheduleSheetOpen: false,
  convertedSheetOpen: false,
  backupSheetOpen: false,
  profileSheetOpen: false,
  notifyCap: null, // result of canNotify()
  templateSheetOpen: false,
  templateDraft: { id: null, name: '', text: '' },
  productSheetOpen: false,
  productDraft: { id: null, name: '', price: '', photoId: null },
  productPickerOpen: false,
  cardBusy: false,
  cloudMode: null, // null | 'create' | 'restore'
  cloudStatus: '',
  photoUrls: {}, // photoId -> object URL (browser cache for thumbnails)
  convertedValueDraft: '',
  noteDraft: '',
  snackMessage: null,
  catchUp: null,
  // All Leads filters
  allView: 'list', // 'list' | 'pipeline'
  searchQuery: '',
  statusFilter: 'all',
  sourceFilter: 'all',
  tagFilter: 'all',
  showArchived: false,
  // Add Lead draft
  draftName: '',
  draftHandle: '',
  draftSource: 'whatsapp',
  draftInterest: '',
  draftFollowUpDays: 2,
  draftCustomDate: '',
  draftTags: [],
  draftPriority: false
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showSnack(msg) {
  if (snackTimer) clearTimeout(snackTimer);
  uiState.snackMessage = msg;
  snackTimer = setTimeout(() => {
    uiState.snackMessage = null;
    renderApp();
  }, 2200);
}

function triggerFileDownload(filename, content, mimeType) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyTextToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // fallback below
    }
  }
  if (typeof document !== 'undefined') {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (_) {
      // ignore
    }
    document.body.removeChild(ta);
  }
  return true;
}

function resetDraft() {
  uiState.draftName = '';
  uiState.draftHandle = '';
  uiState.draftSource = 'whatsapp';
  uiState.draftInterest = '';
  uiState.draftFollowUpDays = appState?.settings?.defaultFollowUpDays || 2;
  uiState.draftCustomDate = '';
  uiState.draftTags = [];
  uiState.draftPriority = false;
}

async function loadDictionaries() {
  const langs = ['en', 'hi', 'hinglish'];
  const dicts = await Promise.all(langs.map((l) => fetch(`./i18n/${l}.json`).then((r) => r.json())));
  langs.forEach((l, i) => registerTranslations(l, dicts[i]));
}

function hourLabel(h) {
  return `${String(h).padStart(2, '0')}:00`;
}

function notifyModeText(lang) {
  const cap = uiState.notifyCap;
  if (!cap || !cap.supported || cap.mode === 'none') return t(lang, 'notify_mode_none');
  if (cap.permission === 'denied') return t(lang, 'notify_permission_denied');
  return t(lang, cap.mode === 'periodic' ? 'notify_mode_periodic' : 'notify_mode_open');
}

/** Mirror today's counts into the Cache API for sw.js (debounced; runs after every render). */
function scheduleDigestWrite() {
  if (!appState || typeof caches === 'undefined') return;
  if (digestTimer) clearTimeout(digestTimer);
  digestTimer = setTimeout(() => {
    const buckets = categorize(appState.leads, Date.now());
    const snap = { ...buildDigestSnapshot(buckets, appState.settings.language), quiet: appState.settings.quietHours };
    writeDigestSnapshot(snap);
  }, 400);
}

/** Arm (or disarm) the in-app 9 AM reminder and the periodic background digest. */
function armReminders() {
  if (cancelReminder) {
    cancelReminder();
    cancelReminder = null;
  }
  if (!appState || !appState.settings.reminderEnabled) {
    if (swRegistration) unregisterPeriodicDigest(swRegistration);
    return;
  }
  if (swRegistration) registerPeriodicDigest(swRegistration);
  const fire = () => {
    const buckets = categorize(appState.leads, Date.now());
    const text = buildDigestText(buildDigestSnapshot(buckets, appState.settings.language));
    if (text) showReminderNotification(text, swRegistration);
    armReminders(); // next day
  };
  cancelReminder = scheduleInAppReminder({
    now: Date.now(),
    reminderHour: appState.settings.reminderHour,
    quiet: appState.settings.quietHours,
    onFire: fire
  });
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

function renderStagePill(stage, lang) {
  return `<span class="statusPill stage-${escapeHtml(stage)}">${escapeHtml(t(lang, `stage_${stage}`))}</span>`;
}

function renderPipelineCard(lead, lang, now) {
  return `
    <button type="button" class="lane-card lead ${lead.priority ? 'priority' : ''}" data-lead-id="${escapeHtml(lead.id)}">
      <div style="display:flex; align-items:center; gap:8px;">
        <div class="avatar" style="background:${avatarColor(lead.name)}; width:28px; height:28px; font-size:11px;">${escapeHtml(initials(lead.name))}</div>
        <div class="lead-name" style="flex:1; min-width:0; font-size:14px;">${escapeHtml(lead.name)}</div>
        ${lead.priority ? '<span style="color:var(--fub-marigold); font-size:12px;">★</span>' : ''}
      </div>
      <div class="lead-notes" style="margin-top:4px;">${escapeHtml(lead.interest)}</div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; gap:6px;">
        ${renderChannelChip(lead.source, lang)}
        <span class="lead-time" style="font-size:11px;">${escapeHtml(
          lead.status === 'active' && lead.nextFollowUpAt
            ? relTime(lead.nextFollowUpAt, now, lang)
            : lead.convertedValue
              ? formatINR(lead.convertedValue)
              : relPastTime(lead.updatedAt || lead.createdAt, now, lang)
        )}</span>
      </div>
    </button>
  `;
}

function renderPipeline(lang) {
  const now = Date.now();
  const lanes = groupByStage(appState.leads, appState.events);
  return `
    <div class="pipeline" aria-label="${escapeHtml(t(lang, 'view_pipeline'))}">
      ${STAGES.map(
        (stage) => `
          <section class="lane lane-${stage}">
            <header class="lane-head">
              <span>${escapeHtml(t(lang, `stage_${stage}`))}</span>
              <span class="count">${lanes[stage].length}</span>
            </header>
            ${
              lanes[stage].length === 0
                ? `<div class="lane-empty">${escapeHtml(t(lang, 'pipeline_lane_empty'))}</div>`
                : lanes[stage].map((l) => renderPipelineCard(l, lang, now)).join('')
            }
          </section>
        `
      ).join('')}
    </div>
    <div class="hint" style="font-size:12px; color:var(--fub-ink-3); text-align:center; margin:8px 0 80px;">${escapeHtml(t(lang, 'pipeline_hint'))}</div>
  `;
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
        ${(() => {
          const who = showFollowUp && appState && appState.settings.deviceName ? lastTouchedBy(lead.id, appState.events) : null;
          return who ? `<div class="lead-by">👥 ${escapeHtml(t(lang, 'team_last_by', { who: who.by, when: relPastTime(who.at, now, lang) }))}</div>` : '';
        })()}
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
            ? `<div class="lead-time">${escapeHtml(relTime(lead.nextFollowUpAt, now, lang))}</div>`
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
  const catchUp = uiState.catchUp;
  const activeCount = getActiveLeadCount(appState);
  const firstName = String(appState.settings.sellerName || '').trim().split(/\s+/)[0];
  const isEmpty = overdue.length === 0 && today.length === 0 && upcoming.length === 0;
  const showProCard = !appState.settings.isPro && activeCount / FREE_ACTIVE_LEAD_LIMIT >= 0.8;

  return `
    <div class="fub" data-screen="today">
      <div class="fub-bar">
        <div style="flex:1;">
          <h1>${escapeHtml(t(lang, 'today_title'))}</h1>
          <div class="sub">${escapeHtml(formatHeaderDate(now, lang))}</div>
        </div>
        <button type="button" class="btn icon flat" id="btn-today-stats" aria-label="${escapeHtml(t(lang, 'stats_title'))}">📈</button>
        <button type="button" class="btn icon flat" id="btn-today-search" aria-label="${escapeHtml(t(lang, 'search_placeholder'))}">🔍</button>
      </div>

      <div class="fub-content">
        ${
          catchUp
            ? `<div style="background:var(--fub-marigold-soft); color:#5e3d02; border-radius:12px; padding:10px 14px; margin-bottom:10px; font-size:13px; font-weight:600;">
                 ⚠ ${escapeHtml(t(lang, 'today_catchup_banner', { days: catchUp.missedDays }))}
               </div>`
            : ''
        }

        <div class="today-hero">
          <div class="greet">${escapeHtml(firstName ? t(lang, 'today_greet', { firstName }) : t(lang, 'today_greet_anon'))}</div>
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

function renderAllLeadsScreen(lang) {
  const now = Date.now();
  const nonArchivedTotal = appState.leads.filter((l) => !l.archived).length;
  const archivedTotal = appState.leads.filter((l) => Boolean(l.archived)).length;
  const filtered = filterLeads(appState.leads, {
    query: uiState.searchQuery,
    statusF: uiState.statusFilter,
    sourceF: uiState.sourceFilter,
    tagF: uiState.tagFilter,
    showArchived: uiState.showArchived
  });

  const statusPills = [
    { id: 'all', lbl: t(lang, 'filter_all', { count: nonArchivedTotal }) },
    { id: 'active', lbl: t(lang, 'filter_active') },
    { id: 'converted', lbl: t(lang, 'filter_converted') },
    { id: 'not_interested', lbl: t(lang, 'filter_not_int') },
    { id: 'lost', lbl: t(lang, 'filter_lost') }
  ];

  const sourcePills = [
    { id: 'all', lbl: t(lang, 'filter_any_source') },
    { id: 'whatsapp', lbl: `💬 ${t(lang, 'source_whatsapp')}` },
    { id: 'instagram', lbl: `📸 ${t(lang, 'source_instagram')}` }
  ];

  return `
    <div class="fub" data-screen="all">
      <div class="fub-bar">
        <h1 style="flex:1;">${escapeHtml(t(lang, 'all_leads_title'))}</h1>
        <button type="button" class="btn flat sm ${uiState.showArchived ? 'primary' : ''}" id="btn-toggle-archived" aria-label="${escapeHtml(t(lang, 'settings_archived_leads'))}">
          🗄️ ${archivedTotal}
        </button>
      </div>

      <div class="fub-content">
        <div class="segmented" style="margin-bottom:10px;">
          <button type="button" class="all-view-btn ${uiState.allView === 'list' ? 'on' : ''}" data-view="list">☰ ${escapeHtml(t(lang, 'view_list'))}</button>
          <button type="button" class="all-view-btn ${uiState.allView === 'pipeline' ? 'on' : ''}" data-view="pipeline">▥ ${escapeHtml(t(lang, 'view_pipeline'))}</button>
        </div>
        ${uiState.allView === 'pipeline' ? renderPipeline(lang) : `
        <div class="search">
          <span aria-hidden="true">🔍</span>
          <input type="text" id="input-all-search" aria-label="${escapeHtml(t(lang, 'search_placeholder'))}"
            value="${escapeHtml(uiState.searchQuery)}"
            placeholder="${escapeHtml(t(lang, 'search_placeholder'))}" />
          ${
            uiState.searchQuery
              ? `<button type="button" id="btn-clear-search" class="btn icon flat" style="width:36px;height:36px;min-height:36px;margin:4px 0;" aria-label="${escapeHtml(t(lang, 'btn_cancel'))}">✕</button>`
              : ''
          }
        </div>

        <div class="filters" aria-label="Status filters">
          ${statusPills
            .map(
              (p) => `
                <button type="button" class="filter status-filter-btn ${uiState.statusFilter === p.id ? 'on' : ''}" data-status="${p.id}">
                  ${escapeHtml(p.lbl)}
                </button>
              `
            )
            .join('')}
        </div>

        <div class="filters" aria-label="Source filters">
          ${sourcePills
            .map(
              (p) => `
                <button type="button" class="filter source-filter-btn ${uiState.sourceFilter === p.id ? 'on' : ''}" data-source-f="${p.id}">
                  ${escapeHtml(p.lbl)}
                </button>
              `
            )
            .join('')}
          <button type="button" id="btn-tag-pro-filter"
            class="filter ${uiState.tagFilter !== 'all' ? 'on' : ''}"
            style="border-style:dashed;">
            ✨ ${escapeHtml(uiState.tagFilter !== 'all' ? uiState.tagFilter : t(lang, 'filter_tag_pro'))}
            <span class="chip pro" style="font-size:9px; padding:1px 5px;">PRO</span>
          </button>
        </div>

        <div style="font-size:12px; color:var(--fub-ink-3); margin:6px 4px 8px; font-weight:600;" id="all-leads-count">
          ${escapeHtml(
            filtered.length === 1
              ? t(lang, 'lead_count_single', { count: 1 })
              : t(lang, 'lead_count_plural', { count: filtered.length })
          )}
        </div>

        ${filtered
          .map((l) => renderLeadRow(l, { showFollowUp: l.status === 'active', now, lang }))
          .join('')}

        ${
          filtered.length === 0
            ? `<div class="empty">
                 <div style="font-size:48px;">🔎</div>
                 <h3>${escapeHtml(t(lang, 'empty_search_title'))}</h3>
                 <p>${escapeHtml(t(lang, 'empty_search_sub'))}</p>
               </div>`
            : ''
        }
        `}
      </div>

      <button type="button" class="fab" id="btn-fab-add" aria-label="${escapeHtml(t(lang, 'fab_add_lead'))}">+</button>
    </div>
  `;
}

function renderStatsScreen(lang) {
  const now = Date.now();
  const st = computeStats(appState, now);
  const monthName = (offset) =>
    new Date(new Date(now).getFullYear(), new Date(now).getMonth() + offset, 1).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { month: 'short' });
  const sourceLabel = (src) => t(lang, src === 'whatsapp' ? 'source_whatsapp' : src === 'instagram' ? 'source_instagram' : 'source_other');
  const maxTag = Math.max(1, ...st.tags.map((x) => x.orders));
  return `
    <div class="fub" data-screen="stats">
      <div class="fub-bar">
        <button type="button" class="btn icon flat" id="btn-stats-back" aria-label="${escapeHtml(t(lang, 'btn_back'))}">←</button>
        <h1 style="flex:1;">${escapeHtml(t(lang, 'stats_title'))}</h1>
      </div>
      <div class="fub-content">
        <div class="stat-grid">
          <div class="stat-card hero">
            <div class="k">${escapeHtml(t(lang, 'stats_this_month', { month: monthName(0) }))}</div>
            <div class="v">${escapeHtml(formatINR(st.monthly.thisMonth.value))}</div>
            <div class="s">${escapeHtml(t(lang, 'stats_orders_count', { count: st.monthly.thisMonth.orders }))}</div>
          </div>
          <div class="stat-card">
            <div class="k">${escapeHtml(t(lang, 'stats_last_month', { month: monthName(-1) }))}</div>
            <div class="v">${escapeHtml(formatINR(st.monthly.lastMonth.value))}</div>
            <div class="s">${escapeHtml(t(lang, 'stats_orders_count', { count: st.monthly.lastMonth.orders }))}</div>
          </div>
          <div class="stat-card">
            <div class="k">${escapeHtml(t(lang, 'stats_week_followups'))}</div>
            <div class="v">${st.week.total}</div>
            <div class="s">${escapeHtml(t(lang, 'stats_week_detail', { sent: st.week.contacted, replied: st.week.replied }))}</div>
          </div>
          <div class="stat-card">
            <div class="k">${escapeHtml(t(lang, 'stats_all_time'))}</div>
            <div class="v">${escapeHtml(formatINR(st.totals.value))}</div>
            <div class="s">${escapeHtml(t(lang, 'stats_all_time_detail', { orders: st.totals.orders, leads: st.totals.leads }))}</div>
          </div>
        </div>

        <div class="fub-section"><h2>${escapeHtml(t(lang, 'stats_best_tags'))}</h2></div>
        ${
          st.tags.length === 0
            ? `<div class="stat-empty">${escapeHtml(t(lang, 'stats_empty'))}</div>`
            : st.tags
                .map(
                  (tg) => `
                    <div class="stat-row">
                      <div class="stat-row-head"><span class="chip tag">${escapeHtml(tg.tag)}</span><span>${escapeHtml(t(lang, 'stats_orders_count', { count: tg.orders }))} · ${escapeHtml(formatINR(tg.value))}</span></div>
                      <div class="bar"><span style="width:${Math.round((tg.orders / maxTag) * 100)}%"></span></div>
                    </div>`
                )
                .join('')
        }

        <div class="fub-section"><h2>${escapeHtml(t(lang, 'stats_best_source'))}</h2></div>
        ${
          st.sources.length === 0
            ? `<div class="stat-empty">${escapeHtml(t(lang, 'stats_empty'))}</div>`
            : st.sources
                .map(
                  (s) => `
                    <div class="stat-row">
                      <div class="stat-row-head">${renderChannelChip(s.source, lang)}<span>${s.conversion}% · ${escapeHtml(t(lang, 'stats_source_detail', { orders: s.orders, leads: s.leads }))}</span></div>
                      <div class="bar"><span style="width:${s.conversion}%"></span></div>
                    </div>`
                )
                .join('')
        }
        <div style="font-size:12px; color:var(--fub-ink-3); text-align:center; margin:18px 0 80px;">${escapeHtml(t(lang, 'stats_footnote'))}</div>
      </div>
    </div>
  `;
}

function renderTemplatesScreen(lang) {
  const s = appState.settings;
  const templates = s.templates || [];
  const map = s.tagTemplates || {};
  return `
    <div class="fub" data-screen="templates">
      <div class="fub-bar">
        <button type="button" class="btn icon flat" id="btn-templates-back" aria-label="${escapeHtml(t(lang, 'btn_back'))}">←</button>
        <h1 style="flex:1;">${escapeHtml(t(lang, 'templates_title'))}</h1>
        <span class="chip pro">PRO</span>
      </div>
      <div class="fub-content">
        <p style="font-size:13px; color:var(--fub-ink-2); margin:0 2px 12px; line-height:1.45;">${escapeHtml(t(lang, 'templates_intro'))}</p>
        <div class="fub-section"><h2>${escapeHtml(t(lang, 'templates_saved', { count: templates.length, max: MAX_TEMPLATES }))}</h2></div>
        ${templates
          .map(
            (tp) => `
              <div class="tpl-card">
                <div style="display:flex; align-items:center; gap:8px;">
                  <strong style="flex:1; font-size:14px;">${escapeHtml(tp.name)}</strong>
                  <button type="button" class="btn sm ghost tpl-edit-btn" data-id="${escapeHtml(tp.id)}">✎ ${escapeHtml(t(lang, 'btn_edit'))}</button>
                  <button type="button" class="btn sm danger tpl-del-btn" data-id="${escapeHtml(tp.id)}" aria-label="${escapeHtml(t(lang, 'btn_delete'))}">🗑</button>
                </div>
                <div style="font-size:13px; color:var(--fub-ink-2); margin-top:6px; white-space:pre-wrap;">${escapeHtml(tp.text)}</div>
              </div>`
          )
          .join('')}
        ${
          templates.length < MAX_TEMPLATES
            ? `<button type="button" class="btn ghost block" id="btn-new-template" style="margin:4px 0 16px;">+ ${escapeHtml(t(lang, 'templates_new'))}</button>`
            : `<div class="hint" style="font-size:12px; color:var(--fub-ink-3); margin:4px 2px 16px;">${escapeHtml(t(lang, 'templates_limit_note', { max: MAX_TEMPLATES }))}</div>`
        }

        <div class="fub-section"><h2>${escapeHtml(t(lang, 'templates_by_tag'))}</h2></div>
        <div class="settings-group">
          ${appState.tags
            .map(
              (tg) => `
                <div class="setting">
                  <div class="text"><div class="t">${escapeHtml(tg.name)}</div></div>
                  <select class="hour-select tag-template-select" data-tag="${escapeHtml(tg.name)}" aria-label="${escapeHtml(tg.name)}" style="max-width:150px;">
                    <option value="">${escapeHtml(t(lang, 'templates_default_option'))}</option>
                    ${templates
                      .map((tp) => `<option value="${escapeHtml(tp.id)}" ${map[tg.name] === tp.id ? 'selected' : ''}>${escapeHtml(tp.name)}</option>`)
                      .join('')}
                  </select>
                </div>`
            )
            .join('')}
        </div>
        <div style="font-size:12px; color:var(--fub-ink-3); text-align:center; margin:12px 0 80px;">${escapeHtml(t(lang, 'templates_share_note'))}</div>
      </div>
    </div>
  `;
}

function renderTemplateSheet(lang) {
  const d = uiState.templateDraft;
  return `
    <div class="scrim" id="sheet-scrim"></div>
    <form class="sheet" id="form-template">
      <div class="grab"></div>
      <h2 style="margin:0 0 12px; font-size:18px; font-weight:800;">${escapeHtml(t(lang, d.id ? 'templates_edit_title' : 'templates_new'))}</h2>
      <div class="field">
        <label for="tpl-name-in">${escapeHtml(t(lang, 'templates_name_label'))}</label>
        <input id="tpl-name-in" type="text" value="${escapeHtml(d.name)}" placeholder="${escapeHtml(t(lang, 'templates_name_placeholder'))}" />
      </div>
      <div class="field">
        <label for="tpl-text-in">${escapeHtml(t(lang, 'templates_text_label'))}</label>
        <textarea id="tpl-text-in" required maxlength="300" placeholder="${escapeHtml(t(lang, 'followup_template'))}">${escapeHtml(d.text)}</textarea>
        <div class="hint">${escapeHtml(t(lang, 'templates_vars_hint'))}</div>
      </div>
      <div style="display:flex; gap:10px; margin-top:12px;">
        <button type="button" class="btn ghost" id="btn-close-template-sheet" style="flex:1;">${escapeHtml(t(lang, 'btn_cancel'))}</button>
        <button type="submit" class="btn primary" style="flex:2;">✓ ${escapeHtml(t(lang, 'btn_save'))}</button>
      </div>
    </form>
  `;
}

/** Make sure object URLs exist for catalogue photos (async; re-renders when loaded). */
function ensurePhotoUrls() {
  const missing = (appState.catalogue || []).filter((p) => p.photoId && !uiState.photoUrls[p.photoId]);
  if (missing.length === 0 || typeof URL === 'undefined') return;
  Promise.all(
    missing.map(async (p) => {
      const blob = await getPhoto(p.photoId);
      if (blob) uiState.photoUrls[p.photoId] = URL.createObjectURL(blob);
    })
  ).then(() => renderApp());
}

function renderProductThumb(p) {
  const url = p.photoId ? uiState.photoUrls[p.photoId] : null;
  return url
    ? `<div class="prd-thumb" style="background-image:url('${escapeHtml(url)}');"></div>`
    : `<div class="prd-thumb empty">🛍️</div>`;
}

function renderCatalogueScreen(lang) {
  const s = appState.settings;
  const list = appState.catalogue || [];
  const limit = productLimit(s);
  ensurePhotoUrls();
  return `
    <div class="fub" data-screen="catalogue">
      <div class="fub-bar">
        <button type="button" class="btn icon flat" id="btn-catalogue-back" aria-label="${escapeHtml(t(lang, 'btn_back'))}">←</button>
        <h1 style="flex:1;">${escapeHtml(t(lang, 'catalogue_title'))}</h1>
        <span class="chip ${s.isPro ? 'pro' : ''}">${list.length} / ${limit}</span>
      </div>
      <div class="fub-content">
        <p style="font-size:13px; color:var(--fub-ink-2); margin:0 2px 12px; line-height:1.45;">${escapeHtml(t(lang, 'catalogue_intro'))}</p>
        ${list
          .map(
            (p) => `
              <div class="prd-card">
                ${renderProductThumb(p)}
                <div style="flex:1; min-width:0;">
                  <div style="font-weight:700; font-size:15px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(p.name)}</div>
                  <div style="color:var(--fub-emerald-deep); font-weight:700;">${escapeHtml(formatINR(p.price))}</div>
                </div>
                <button type="button" class="btn sm ghost prd-edit-btn" data-id="${escapeHtml(p.id)}">✎</button>
                <button type="button" class="btn sm danger prd-del-btn" data-id="${escapeHtml(p.id)}" aria-label="${escapeHtml(t(lang, 'btn_delete'))}">🗑</button>
              </div>`
          )
          .join('')}
        ${
          list.length < limit
            ? `<button type="button" class="btn ghost block" id="btn-new-product" style="margin:4px 0 16px;">+ ${escapeHtml(t(lang, 'catalogue_add'))}</button>`
            : `<div style="font-size:12px; color:var(--fub-ink-3); margin:4px 2px 16px;">${escapeHtml(
                s.isPro ? t(lang, 'catalogue_limit_pro', { max: limit }) : t(lang, 'catalogue_limit_free', { max: limit })
              )}</div>
              ${s.isPro ? '' : `<button type="button" class="btn primary block" id="btn-catalogue-upsell" style="margin-bottom:16px;">✨ ${escapeHtml(t(lang, 'pro_card_settings_cta'))}</button>`}`
        }
        <div style="font-size:12px; color:var(--fub-ink-3); text-align:center; margin:12px 0 80px;">${escapeHtml(t(lang, 'catalogue_privacy_note'))}</div>
      </div>
    </div>
  `;
}

function renderProductSheet(lang) {
  const d = uiState.productDraft;
  const url = d.photoId ? uiState.photoUrls[d.photoId] : null;
  return `
    <div class="scrim" id="sheet-scrim"></div>
    <form class="sheet" id="form-product">
      <div class="grab"></div>
      <h2 style="margin:0 0 12px; font-size:18px; font-weight:800;">${escapeHtml(t(lang, d.id ? 'catalogue_edit' : 'catalogue_add'))}</h2>
      <div class="field">
        <label for="prd-name-in">${escapeHtml(t(lang, 'catalogue_name'))}</label>
        <input id="prd-name-in" type="text" required maxlength="60" value="${escapeHtml(d.name)}" placeholder="${escapeHtml(t(lang, 'catalogue_name_placeholder'))}" />
      </div>
      <div class="field">
        <label for="prd-price-in">${escapeHtml(t(lang, 'catalogue_price'))}</label>
        <input id="prd-price-in" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(d.price)}" placeholder="e.g. 1200" />
      </div>
      <div class="field">
        <label>${escapeHtml(t(lang, 'catalogue_photo'))}</label>
        <div style="display:flex; gap:10px; align-items:center;">
          ${url ? `<div class="prd-thumb" style="background-image:url('${escapeHtml(url)}');"></div>` : `<div class="prd-thumb empty">🛍️</div>`}
          <label class="btn ghost sm" style="margin:0; cursor:pointer;">
            📷 ${escapeHtml(t(lang, 'catalogue_pick_photo'))}
            <input type="file" id="prd-photo-in" accept="image/*" style="display:none;" />
          </label>
          ${uiState.cardBusy ? `<span style="font-size:12px; color:var(--fub-ink-3);">…</span>` : ''}
        </div>
        <div class="hint">${escapeHtml(t(lang, 'catalogue_photo_hint'))}</div>
      </div>
      <div style="display:flex; gap:10px; margin-top:12px;">
        <button type="button" class="btn ghost" id="btn-close-product-sheet" style="flex:1;">${escapeHtml(t(lang, 'btn_cancel'))}</button>
        <button type="submit" class="btn primary" style="flex:2;">✓ ${escapeHtml(t(lang, 'btn_save'))}</button>
      </div>
    </form>
  `;
}

function renderProductPickerSheet(lang) {
  const list = appState.catalogue || [];
  ensurePhotoUrls();
  return `
    <div class="scrim" id="sheet-scrim"></div>
    <div class="sheet" id="sheet-product-picker">
      <div class="grab"></div>
      <h2 style="margin:0 0 4px; font-size:18px; font-weight:800;">${escapeHtml(t(lang, 'card_send_title'))}</h2>
      <p style="font-size:12px; color:var(--fub-ink-3); margin:0 0 12px;">${escapeHtml(t(lang, 'card_send_sub'))}</p>
      ${
        list.length === 0
          ? `<div class="stat-empty">${escapeHtml(t(lang, 'card_no_products'))}</div>
             <button type="button" class="btn primary block" id="btn-picker-open-catalogue">${escapeHtml(t(lang, 'catalogue_title'))}</button>`
          : list
              .map(
                (p) => `
                  <button type="button" class="prd-card prd-pick-btn" data-id="${escapeHtml(p.id)}" ${uiState.cardBusy ? 'disabled' : ''}>
                    ${renderProductThumb(p)}
                    <div style="flex:1; min-width:0; text-align:left;">
                      <div style="font-weight:700; font-size:15px;">${escapeHtml(p.name)}</div>
                      <div style="color:var(--fub-emerald-deep); font-weight:700;">${escapeHtml(formatINR(p.price))}</div>
                    </div>
                    <span style="color:var(--fub-ink-3);">›</span>
                  </button>`
              )
              .join('')
      }
      <button type="button" class="btn flat block" id="btn-close-product-picker" style="margin-top:8px;">${escapeHtml(t(lang, 'btn_cancel'))}</button>
    </div>
  `;
}

/** Render the PNG card for a product, share it (Web Share with files) or download it, and open wa.me. */
async function sendProductCard(lead, product, lang) {
  const model = buildProductCardModel(product, appState.settings);
  let photo = null;
  try {
    const blob = product.photoId ? await getPhoto(product.photoId) : null;
    if (blob) photo = await createImageBitmap(blob);
  } catch {
    photo = null;
  }
  const canvas = document.createElement('canvas');
  drawProductCard(canvas, model, photo);
  if (photo && photo.close) photo.close();
  const png = await canvasToPngBlob(canvas);
  const fileName = productCardFileName(product);
  const file = typeof File !== 'undefined' ? new File([png], fileName, { type: 'image/png' }) : null;
  const text = buildProductMessage(lead, product, appState.settings);

  let shared = false;
  if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: product.name, text });
      shared = true;
    } catch {
      shared = false;
    }
  }
  if (!shared) {
    const url = URL.createObjectURL(png);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    if (lead.source === 'whatsapp' && normalizePhone(lead.handle).length >= 10) {
      window.open(buildWhatsAppUrl(lead.handle, text), '_blank', 'noopener,noreferrer');
    } else {
      await copyTextToClipboard(text);
    }
  }
  appState = logLeadEvent(appState, lead.id, 'contacted', `Sent product card: ${product.name}`);
  showSnack(t(lang, shared ? 'snack_card_shared' : 'snack_card_downloaded'));
}

/** Merge a decrypted remote state into this phone: union of leads/events, newest lead wins. */
function applyRemoteState(remoteState) {
  let remote;
  try {
    remote = migrate(remoteState);
  } catch {
    return;
  }
  appState = saveState(mergeStates(appState, remote));
}

async function cloudPush(key) {
  const cloud = appState.settings.cloud;
  const payload = await encryptJson(backupPayload(appState), { key, salt: cloud.salt, updatedAt: stateUpdatedAt(appState) || Date.now() });
  await pushVault(cloud.vaultId, payload);
  appState = updateSettings(appState, { cloud: { ...cloud, lastSyncAt: Date.now() } });
}

/** Full sync: pull, merge if the cloud copy is newer (with confirm unless silent), then push. */
async function cloudSync({ silent = false, lang } = {}) {
  const cloud = appState.settings.cloud;
  if (!isCloudConfigured() || !cloud.vaultId || !cloud.keyB64 || cloudBusy) return;
  cloudBusy = true;
  const L = lang || appState.settings.language;
  try {
    const key = await importKeyB64(cloud.keyB64);
    const remote = await pullVault(cloud.vaultId);
    if (remote && resolveConflict(cloud.lastSyncAt, remote.updatedAt) === 'remote') {
      const remoteState = await decryptJson(remote, { key });
      if (silent || window.confirm(t(L, 'cloud_conflict_confirm'))) {
        applyRemoteState(remoteState);
      }
    }
    await cloudPush(key);
    if (!silent) showSnack(t(L, 'snack_cloud_synced'));
  } catch (err) {
    const code = err && err.code;
    uiState.cloudStatus = t(L, code === 'DECRYPT_FAILED' ? 'snack_cloud_wrong_pass' : code === 'TOO_LARGE' ? 'snack_cloud_too_large' : 'snack_cloud_failed');
    if (!silent) showSnack(uiState.cloudStatus);
  }
  cloudBusy = false;
  renderApp();
}

/** Debounced auto-sync (30 s) after changes while the app is open. */
function scheduleCloudSync() {
  const cloud = appState?.settings?.cloud;
  if (!cloud || !cloud.autoSync || !cloud.vaultId || !isCloudConfigured()) return;
  if (stateUpdatedAt(appState) <= cloud.lastSyncAt) return;
  if (cloudTimer) clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => cloudSync({ silent: true }), AUTO_SYNC_DEBOUNCE_MS);
}

function renderCloudScreen(lang) {
  const s = appState.settings;
  const cloud = s.cloud;
  const configured = isCloudConfigured();
  const when = cloud.lastSyncAt ? `${relPastTime(cloud.lastSyncAt, Date.now(), lang)} · ${new Date(cloud.lastSyncAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : '';
  const form = (mode) => `
    <form id="form-cloud-${mode}" class="tpl-card" style="margin-top:10px;">
      ${
        mode === 'restore'
          ? `<div class="field">
               <label for="cloud-code-in">${escapeHtml(t(lang, 'cloud_vault_code'))}</label>
               <input id="cloud-code-in" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="xxxx-xxxx-xxxx-…" required />
               <div class="hint">${escapeHtml(t(lang, 'cloud_vault_code_hint'))}</div>
             </div>`
          : ''
      }
      <div class="field">
        <label for="cloud-pass-in">${escapeHtml(t(lang, 'cloud_passphrase'))}</label>
        <input id="cloud-pass-in" type="password" minlength="8" required autocomplete="new-password" />
        <div class="hint">${escapeHtml(t(lang, 'cloud_passphrase_hint'))}</div>
      </div>
      ${
        mode === 'create'
          ? `<div class="field">
               <label for="cloud-pass2-in">${escapeHtml(t(lang, 'cloud_passphrase_again'))}</label>
               <input id="cloud-pass2-in" type="password" minlength="8" required autocomplete="new-password" />
             </div>`
          : ''
      }
      <div style="display:flex; gap:10px;">
        <button type="button" class="btn ghost" id="btn-cloud-cancel" style="flex:1;">${escapeHtml(t(lang, 'btn_cancel'))}</button>
        <button type="submit" class="btn primary" style="flex:2;" ${cloudBusy ? 'disabled' : ''}>✓ ${escapeHtml(t(lang, mode === 'create' ? 'cloud_create' : 'cloud_restore'))}</button>
      </div>
    </form>`;

  return `
    <div class="fub" data-screen="cloud">
      <div class="fub-bar">
        <button type="button" class="btn icon flat" id="btn-cloud-back" aria-label="${escapeHtml(t(lang, 'btn_back'))}">←</button>
        <h1 style="flex:1;">${escapeHtml(t(lang, 'cloud_title'))}</h1>
        <span class="chip pro">PRO</span>
      </div>
      <div class="fub-content">
        ${
          !configured
            ? `<div class="pro-card" style="margin-bottom:14px;">
                 <h3>${escapeHtml(t(lang, 'cloud_unavailable_title'))}</h3>
                 <p style="margin-bottom:0;">${escapeHtml(t(lang, 'cloud_unavailable_body'))}</p>
               </div>`
            : ''
        }
        <p style="font-size:13px; color:var(--fub-ink-2); margin:0 2px 12px; line-height:1.45;">${escapeHtml(t(lang, 'cloud_intro'))}</p>
        ${uiState.cloudStatus ? `<div style="font-size:13px; color:#8A2C1F; margin:0 2px 10px; font-weight:600;">${escapeHtml(uiState.cloudStatus)}</div>` : ''}
        ${
          cloud.vaultId
            ? `
              <div class="tpl-card">
                <div style="font-size:12px; color:var(--fub-ink-3); font-weight:600;">${escapeHtml(t(lang, 'cloud_your_code'))}</div>
                <div style="font-family:var(--fub-mono); font-size:15px; margin:6px 0 10px; word-break:break-all;">${escapeHtml(formatVaultCode(cloud.vaultId))}</div>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                  <button type="button" class="btn sm ghost" id="btn-cloud-copy">📋 ${escapeHtml(t(lang, 'cloud_copy_code'))}</button>
                  <button type="button" class="btn sm primary" id="btn-cloud-sync" ${configured && !cloudBusy ? '' : 'disabled'}>🔄 ${escapeHtml(t(lang, 'cloud_sync_now'))}</button>
                </div>
                <div style="font-size:12px; color:var(--fub-ink-3); margin-top:10px;">${escapeHtml(cloud.lastSyncAt ? t(lang, 'cloud_last_sync', { when }) : t(lang, 'cloud_never_synced'))}</div>
              </div>
              <div class="settings-group">
                <div class="setting">
                  <div class="ico">🔄</div>
                  <div class="text">
                    <div class="t">${escapeHtml(t(lang, 'cloud_auto_sync'))}</div>
                    <div class="s">${escapeHtml(t(lang, 'cloud_auto_sync_sub'))}</div>
                  </div>
                  <button type="button" id="btn-cloud-autosync" class="tog ${cloud.autoSync ? 'on' : ''}" style="border:none;" aria-pressed="${cloud.autoSync ? 'true' : 'false'}" aria-label="${escapeHtml(t(lang, 'cloud_auto_sync'))}"></button>
                </div>
                <div class="setting" id="btn-cloud-forget" style="cursor:pointer;">
                  <div class="ico">🚪</div>
                  <div class="text"><div class="t">${escapeHtml(t(lang, 'cloud_forget'))}</div></div>
                </div>
                <div class="setting" id="btn-cloud-delete" style="cursor:pointer;">
                  <div class="ico" style="background:var(--fub-terracotta-soft); color:#8A2C1F;">🗑️</div>
                  <div class="text"><div class="t" style="color:#8A2C1F;">${escapeHtml(t(lang, 'cloud_delete_remote'))}</div></div>
                </div>
              </div>
              <div style="font-size:12px; color:var(--fub-ink-3); margin:0 2px 80px;">${escapeHtml(t(lang, 'cloud_key_note'))}</div>`
            : `
              ${
                uiState.cloudMode
                  ? form(uiState.cloudMode)
                  : `<button type="button" class="btn primary block" id="btn-cloud-mode-create" ${configured ? '' : 'disabled'}>🔐 ${escapeHtml(t(lang, 'cloud_create'))}</button>
                     <button type="button" class="btn ghost block" id="btn-cloud-mode-restore" style="margin-top:10px;" ${configured ? '' : 'disabled'}>📥 ${escapeHtml(t(lang, 'cloud_restore'))}</button>`
              }
              <div style="height:80px;"></div>`
        }
      </div>
    </div>
  `;
}

function renderTeamScreen(lang) {
  const s = appState.settings;
  const cloud = s.cloud;
  return `
    <div class="fub" data-screen="team">
      <div class="fub-bar">
        <button type="button" class="btn icon flat" id="btn-team-back" aria-label="${escapeHtml(t(lang, 'btn_back'))}">←</button>
        <h1 style="flex:1;">${escapeHtml(t(lang, 'team_title'))}</h1>
        <span class="chip pro">PRO</span>
      </div>
      <div class="fub-content">
        <p style="font-size:13px; color:var(--fub-ink-2); margin:0 2px 12px; line-height:1.45;">${escapeHtml(t(lang, 'team_intro'))}</p>
        <form id="form-device-name" class="tpl-card">
          <div class="field" style="margin-bottom:8px;">
            <label for="device-name-in">${escapeHtml(t(lang, 'team_device_name'))}</label>
            <input id="device-name-in" type="text" maxlength="40" value="${escapeHtml(s.deviceName)}" placeholder="${escapeHtml(t(lang, 'team_device_placeholder'))}" />
            <div class="hint">${escapeHtml(t(lang, 'team_device_name_hint'))}</div>
          </div>
          <button type="submit" class="btn primary sm">✓ ${escapeHtml(t(lang, 'btn_save'))}</button>
        </form>
        <div class="fub-section"><h2>${escapeHtml(t(lang, 'team_invite'))}</h2></div>
        ${
          cloud.vaultId
            ? `<div class="tpl-card">
                 <p style="font-size:13px; color:var(--fub-ink-2); margin:0 0 8px; line-height:1.45;">${escapeHtml(t(lang, 'team_invite_body'))}</p>
                 <div style="font-family:var(--fub-mono); font-size:15px; margin:6px 0 10px; word-break:break-all;">${escapeHtml(formatVaultCode(cloud.vaultId))}</div>
                 <button type="button" class="btn sm ghost" id="btn-team-copy">📋 ${escapeHtml(t(lang, 'cloud_copy_code'))}</button>
               </div>`
            : `<div class="tpl-card">
                 <p style="font-size:13px; color:var(--fub-ink-2); margin:0 0 10px;">${escapeHtml(t(lang, 'team_no_vault'))}</p>
                 <button type="button" class="btn sm primary" id="btn-team-open-cloud">☁️ ${escapeHtml(t(lang, 'cloud_title'))}</button>
               </div>`
        }
        <div style="font-size:12px; color:var(--fub-ink-3); margin:12px 2px 80px;">${escapeHtml(t(lang, 'team_merge_rule'))}</div>
      </div>
    </div>
  `;
}

function renderSettingsScreen(lang) {
  const s = appState.settings;
  const archivedCount = appState.leads.filter((l) => Boolean(l.archived)).length;

  return `
    <div class="fub" data-screen="settings">
      <div class="fub-bar">
        <h1 style="flex:1;">${escapeHtml(t(lang, 'settings_title'))}</h1>
        ${
          s.isPro
            ? `<span class="chip pro">✨ PRO</span>`
            : ''
        }
      </div>

      <div class="fub-content">
        ${
          !s.isPro
            ? `<div class="pro-card" style="margin-bottom:18px;">
                 <h3>${escapeHtml(t(lang, 'pro_card_settings_title'))}</h3>
                 <p>${escapeHtml(t(lang, 'pro_card_settings_body'))}</p>
                 <button type="button" class="btn sm" id="btn-settings-upgrade-pro">
                   ✨ ${escapeHtml(t(lang, 'pro_card_settings_cta'))}
                 </button>
               </div>`
            : ''
        }

        <div style="font-size:12px; font-weight:700; color:var(--fub-ink-3); text-transform:uppercase; letter-spacing:.08em; margin:4px 4px 8px;">
          ${escapeHtml(t(lang, 'settings_group_profile'))}
        </div>
        <div class="settings-group">
          <div class="setting" id="setting-row-profile" style="cursor:pointer;">
            <div class="ico" style="background:var(--fub-emerald); color:#fff;">👤</div>
            <div class="text">
              <div class="t">${escapeHtml(s.sellerName || t(lang, 'profile_empty'))}</div>
              <div class="s">${escapeHtml([s.sellerHandle, s.sellerBusiness].filter(Boolean).join(' · '))}</div>
            </div>
            <span style="color:var(--fub-ink-3);">›</span>
          </div>
        </div>

        <div style="font-size:12px; font-weight:700; color:var(--fub-ink-3); text-transform:uppercase; letter-spacing:.08em; margin:4px 4px 8px;">
          ${escapeHtml(t(lang, 'settings_group_followups'))}
        </div>
        <div class="settings-group">
          <div class="setting" id="setting-row-stats" style="cursor:pointer;">
            <div class="ico" style="background:var(--fub-emerald-soft); color:var(--fub-emerald-deep);">📈</div>
            <div class="text">
              <div class="t">${escapeHtml(t(lang, 'stats_title'))}</div>
              <div class="s">${escapeHtml(t(lang, 'stats_settings_sub'))}</div>
            </div>
            <span style="color:var(--fub-ink-3);">›</span>
          </div>

          <div class="setting" id="setting-row-catalogue" style="cursor:pointer;">
            <div class="ico warn">🛍️</div>
            <div class="text">
              <div class="t">${escapeHtml(t(lang, 'catalogue_title'))}</div>
              <div class="s">${escapeHtml(t(lang, 'catalogue_settings_sub', { count: (appState.catalogue || []).length, max: productLimit(s) }))}</div>
            </div>
            <span style="color:var(--fub-ink-3);">›</span>
          </div>

          <div class="setting" id="setting-row-cloud" style="cursor:pointer;">
            <div class="ico cobalt">☁️</div>
            <div class="text">
              <div class="t">${escapeHtml(t(lang, 'cloud_title'))} ${s.isPro ? '' : '<span class="chip pro" style="font-size:9px; padding:1px 5px;">PRO</span>'}</div>
              <div class="s">${escapeHtml(isCloudConfigured() ? t(lang, 'cloud_settings_sub') : t(lang, 'cloud_unavailable_title'))}</div>
            </div>
            <span style="color:var(--fub-ink-3);">›</span>
          </div>

          <div class="setting" id="setting-row-team" style="cursor:pointer;">
            <div class="ico">👥</div>
            <div class="text">
              <div class="t">${escapeHtml(t(lang, 'team_title'))} ${s.isPro ? '' : '<span class="chip pro" style="font-size:9px; padding:1px 5px;">PRO</span>'}</div>
              <div class="s">${escapeHtml(t(lang, 'team_settings_sub'))}</div>
            </div>
            <span style="color:var(--fub-ink-3);">›</span>
          </div>

          <div class="setting" id="setting-row-templates" style="cursor:pointer;">
            <div class="ico cobalt">✉️</div>
            <div class="text">
              <div class="t">${escapeHtml(t(lang, 'templates_title'))} ${s.isPro ? '' : '<span class="chip pro" style="font-size:9px; padding:1px 5px;">PRO</span>'}</div>
              <div class="s">${escapeHtml(t(lang, 'templates_settings_sub', { count: (s.templates || []).length }))}</div>
            </div>
            <span style="color:var(--fub-ink-3);">›</span>
          </div>

          <div class="setting" id="setting-row-delay" style="cursor:pointer;">
            <div class="ico">🕒</div>
            <div class="text">
              <div class="t">${escapeHtml(t(lang, 'settings_default_delay'))}</div>
              <div class="s">${escapeHtml(t(lang, 'settings_default_delay_sub'))}</div>
            </div>
            <div style="font-size:14px; font-weight:700; color:var(--fub-emerald);" id="setting-delay-val">${s.defaultFollowUpDays}d</div>
          </div>

          <div class="setting">
            <div class="ico">🔔</div>
            <div class="text">
              <div class="t">${escapeHtml(t(lang, 'settings_reminders'))} · ${escapeHtml(hourLabel(s.reminderHour))}</div>
              <div class="s">${escapeHtml(notifyModeText(lang))}</div>
            </div>
            <button type="button" id="btn-toggle-reminders" aria-label="${escapeHtml(t(lang, 'settings_reminders'))}" aria-pressed="${s.reminderEnabled ? 'true' : 'false'}"
              class="tog ${s.reminderEnabled ? 'on' : ''}" style="border:none;"></button>
          </div>

          <div class="setting">
            <div class="ico">🌙</div>
            <div class="text">
              <div class="t">${escapeHtml(t(lang, 'settings_quiet_hours'))}</div>
              <div class="s">${escapeHtml(t(lang, 'settings_quiet_hours_sub', { start: hourLabel(s.quietHours.start), end: hourLabel(s.quietHours.end) }))}</div>
            </div>
            <div style="display:flex; gap:4px; align-items:center;">
              <select id="sel-quiet-start" aria-label="${escapeHtml(t(lang, 'quiet_from'))}" class="hour-select">
                ${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === s.quietHours.start ? 'selected' : ''}>${hourLabel(h)}</option>`).join('')}
              </select>
              <span style="color:var(--fub-ink-3); font-size:12px;">–</span>
              <select id="sel-quiet-end" aria-label="${escapeHtml(t(lang, 'quiet_to'))}" class="hour-select">
                ${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === s.quietHours.end ? 'selected' : ''}>${hourLabel(h)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="setting">
            <div class="ico">✨</div>
            <div class="text">
              <div class="t">${escapeHtml(t(lang, 'settings_morning_summary'))}</div>
              <div class="s">${escapeHtml(t(lang, 'settings_morning_summary_sub'))}</div>
            </div>
            <button type="button" id="btn-toggle-morning" aria-label="${escapeHtml(t(lang, 'settings_morning_summary'))}" aria-pressed="${s.morningSummary ? 'true' : 'false'}"
              class="tog ${s.morningSummary ? 'on' : ''}" style="border:none;"></button>
          </div>
        </div>

        <div style="font-size:12px; font-weight:700; color:var(--fub-ink-3); text-transform:uppercase; letter-spacing:.08em; margin:4px 4px 8px;">
          ${escapeHtml(t(lang, 'settings_group_app'))}
        </div>
        <div class="settings-group">
          <div class="setting">
            <div class="ico cobalt">🌐</div>
            <div class="text">
              <div class="t">${escapeHtml(t(lang, 'settings_language'))}</div>
              <div class="s">${escapeHtml(LANG_LABELS[s.language] || 'English')}</div>
            </div>
            <div class="segmented" style="width:170px;">
              <button type="button" class="lang-seg-btn ${s.language === 'en' ? 'on' : ''}" data-lang="en">EN</button>
              <button type="button" class="lang-seg-btn ${s.language === 'hi' ? 'on' : ''}" data-lang="hi">हि</button>
              <button type="button" class="lang-seg-btn ${s.language === 'hinglish' ? 'on' : ''}" data-lang="hinglish">Hing</button>
            </div>
          </div>

          <div class="setting" id="setting-row-theme" style="cursor:pointer;">
            <div class="ico">🎨</div>
            <div class="text">
              <div class="t">${escapeHtml(t(lang, 'settings_theme'))} · ${escapeHtml(t(lang, 'settings_density'))}</div>
              <div class="s">${escapeHtml(s.theme)} · ${escapeHtml(s.density)}</div>
            </div>
            <div style="display:flex; gap:6px;">
              <button type="button" class="btn sm ghost" id="btn-cycle-theme" aria-label="${escapeHtml(t(lang, 'settings_theme'))}">${s.theme === 'dark' ? '🌙' : '☀️'}</button>
              <button type="button" class="btn sm ghost" id="btn-cycle-density" aria-label="${escapeHtml(t(lang, 'settings_density'))}">${escapeHtml(s.density)}</button>
            </div>
          </div>

          <div class="setting" id="setting-row-backup" style="cursor:pointer;">
            <div class="ico warn">⬇️</div>
            <div class="text">
              <div class="t">${escapeHtml(t(lang, 'settings_backup_export'))}</div>
              <div class="s">${escapeHtml(t(lang, 'settings_backup_export_sub'))}</div>
            </div>
            <span style="color:var(--fub-ink-3);">›</span>
          </div>

          <div class="setting" id="setting-row-archived" style="cursor:pointer;">
            <div class="ico">🗄️</div>
            <div class="text">
              <div class="t">${escapeHtml(t(lang, 'settings_archived_leads'))}</div>
              <div class="s">${escapeHtml(t(lang, 'settings_archived_leads_sub', { count: archivedCount }))}</div>
            </div>
            <span style="color:var(--fub-ink-3);">›</span>
          </div>

          <div class="setting" id="setting-row-seed" style="cursor:pointer;">
            <div class="ico">🌱</div>
            <div class="text">
              <div class="t">${escapeHtml(t(lang, 'settings_seed_demo'))}</div>
              <div class="s">${escapeHtml(t(lang, 'settings_seed_demo_sub'))}</div>
            </div>
            <span style="color:var(--fub-ink-3);">›</span>
          </div>

          <div class="setting" id="setting-row-clear" style="cursor:pointer;">
            <div class="ico" style="background:var(--fub-terracotta-soft); color:#8A2C1F;">🗑️</div>
            <div class="text">
              <div class="t" style="color:#8A2C1F;">${escapeHtml(t(lang, 'settings_clear_data'))}</div>
              <div class="s">${escapeHtml(t(lang, 'settings_clear_data_sub'))}</div>
            </div>
            <span style="color:var(--fub-ink-3);">›</span>
          </div>
        </div>

        <div style="font-size:11px; color:var(--fub-ink-4); text-align:center; margin:16px 0; font-weight:500;">
          ${escapeHtml(t(lang, 'settings_footer'))} · <a href="./privacy.html" style="color:var(--fub-ink-3);">${escapeHtml(t(lang, 'privacy_link'))}</a>
        </div>
      </div>
    </div>
  `;
}

function renderBackupSheet(lang) {
  return `
    <div class="scrim" id="sheet-scrim"></div>
    <div class="sheet" id="sheet-backup">
      <div class="grab"></div>
      <h2 style="margin:0 0 12px; font-size:18px; font-weight:800;">${escapeHtml(t(lang, 'settings_backup_export'))}</h2>
      <div style="display:flex; flex-direction:column; gap:10px;">
        <button type="button" class="btn primary block" id="btn-export-json">
          ⬇️ ${escapeHtml(t(lang, 'backup_export_json'))}
        </button>
        <label class="btn ghost block" style="cursor:pointer; margin:0;">
          ⬆️ ${escapeHtml(t(lang, 'backup_restore_json'))}
          <input type="file" id="input-import-json" accept="application/json,.json" style="display:none;" />
        </label>
        <button type="button" class="btn ghost block" id="btn-export-csv">
          📊 ${escapeHtml(t(lang, 'backup_export_csv'))} ${appState.settings.isPro ? '' : '🔒 PRO'}
        </button>
        <button type="button" class="btn flat block" id="btn-close-backup-sheet">
          ${escapeHtml(t(lang, 'btn_cancel'))}
        </button>
      </div>
    </div>
  `;
}

function renderProfileSheet(lang) {
  const s = appState.settings;
  return `
    <div class="scrim" id="sheet-scrim"></div>
    <form class="sheet" id="form-profile-edit">
      <div class="grab"></div>
      <h2 style="margin:0 0 12px; font-size:18px; font-weight:800;">${escapeHtml(t(lang, 'settings_group_profile'))}</h2>
      <div class="field">
        <label for="profile-name-in">${escapeHtml(t(lang, 'field_name'))}</label>
        <input id="profile-name-in" type="text" required value="${escapeHtml(s.sellerName)}" />
      </div>
      <div class="field">
        <label for="profile-handle-in">${escapeHtml(t(lang, 'profile_handle_label'))}</label>
        <input id="profile-handle-in" type="text" value="${escapeHtml(s.sellerHandle)}" />
      </div>
      <div class="field">
        <label for="profile-biz-in">${escapeHtml(t(lang, 'profile_business_label'))}</label>
        <input id="profile-biz-in" type="text" value="${escapeHtml(s.sellerBusiness)}" />
      </div>
      <div style="display:flex; gap:10px; margin-top:12px;">
        <button type="button" class="btn ghost" id="btn-close-profile-sheet" style="flex:1;">${escapeHtml(t(lang, 'btn_cancel'))}</button>
        <button type="submit" class="btn primary" style="flex:2;">✓ ${escapeHtml(t(lang, 'btn_save'))}</button>
      </div>
    </form>
  `;
}

function renderLeadDetailScreen(lang) {
  const lead = appState.leads.find((l) => l.id === uiState.selectedLeadId);
  if (!lead) {
    uiState.screen = 'today';
    return renderTodayScreen(lang);
  }
  const now = Date.now();
  const events = getLeadEvents(appState, lead.id);
  const tags = Array.isArray(lead.tags) ? lead.tags : [];
  const canWa = normalizePhone(lead.handle).length >= 10;
  const canIg = Boolean(lead.handle) && !canWa;

  return `
    <div class="fub" data-screen="detail" data-lead-id="${escapeHtml(lead.id)}">
      <div class="fub-bar">
        <button type="button" class="btn icon flat" id="btn-detail-back" aria-label="${escapeHtml(t(lang, 'btn_back'))}">←</button>
        <h1 style="font-size:16px; font-weight:600;">${escapeHtml(t(lang, 'detail_title'))}</h1>
        <button type="button" class="btn icon flat" id="btn-detail-archive" aria-label="${escapeHtml(t(lang, lead.archived ? 'btn_unarchive' : 'btn_archive'))}">🗄️</button>
      </div>

      <div class="fub-content no-pad">
        <div class="detail-header">
          <div style="display:flex; gap:14px; align-items:center;">
            <div class="av" style="background:${avatarColor(lead.name)};">${escapeHtml(initials(lead.name))}</div>
            <div style="flex:1; min-width:0;">
              <div style="font-size:20px; font-weight:700; letter-spacing:-.01em;">${escapeHtml(lead.name)}</div>
              <div style="font-size:13px; color:var(--fub-ink-3); margin-top:2px;">${escapeHtml(lead.handle)}</div>
              <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                ${renderChannelChip(lead.source, lang)}
                ${renderStatusPill(lead.status, lang)}
                ${renderStagePill(deriveStage(lead, appState.events), lang)}
                ${lead.priority ? `<span class="chip warn">★ ${escapeHtml(t(lang, 'chip_priority'))}</span>` : ''}
                ${lead.convertedValue ? `<span class="chip tag">${escapeHtml(formatINR(lead.convertedValue))}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="quick-actions">
            <button type="button" class="qa wa" id="btn-qa-whatsapp" ${canWa ? '' : 'disabled'}>
              <div class="ico">💬</div>
              ${escapeHtml(t(lang, 'qa_whatsapp'))}
            </button>
            <button type="button" class="qa ig" id="btn-qa-instagram" ${canIg ? '' : 'disabled'}>
              <div class="ico">📸</div>
              ${escapeHtml(t(lang, 'qa_instagram'))}
            </button>
            <button type="button" class="qa copy" id="btn-qa-copy">
              <div class="ico">📋</div>
              ${escapeHtml(t(lang, 'qa_copy'))}
            </button>
            <button type="button" class="qa" id="btn-qa-share">
              <div class="ico">📤</div>
              ${escapeHtml(t(lang, 'qa_share'))}
            </button>
          </div>
          <button type="button" class="btn ghost block sm" id="btn-send-product-card" style="margin-top:10px;">
            🛍️ ${escapeHtml(t(lang, 'card_send_btn'))}
          </button>
          ${(() => {
            const r = resolveTemplate(lead, appState.settings);
            const tp = r.via === 'tag' ? (appState.settings.templates || []).find((x) => x.id === r.templateId) : null;
            return tp ? `<div style="font-size:12px; color:var(--fub-ink-3); margin-top:8px;">✉️ ${escapeHtml(t(lang, 'templates_title'))}: <strong>${escapeHtml(tp.name)}</strong></div>` : '';
          })()}
        </div>

        <div style="padding:12px 16px;">
          <div class="fub-section" style="margin:6px 2px 8px;">
            <h2>${escapeHtml(t(lang, 'section_interest'))}</h2>
          </div>
          <div style="background:var(--fub-card); border:1px solid var(--fub-line); border-radius:14px; padding:14px; font-size:14px; line-height:1.5; color:var(--fub-ink);">
            ${escapeHtml(lead.interest)}
          </div>

          ${
            tags.length > 0
              ? `<div style="display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;">
                   ${tags.map((tg) => `<span class="chip tag lg">${escapeHtml(tg)}</span>`).join('')}
                 </div>`
              : ''
          }

          <div class="fub-section">
            <h2>${escapeHtml(t(lang, 'section_next_followup'))}</h2>
          </div>
          <div style="background:var(--fub-marigold-soft); border-radius:14px; padding:14px; display:flex; align-items:center; gap:12px;">
            <div style="width:40px; height:40px; border-radius:10px; background:#fff; display:flex; align-items:center; justify-content:center; color:#8A5A04;">
              🕒
            </div>
            <div style="flex:1;">
              <div style="font-weight:700; color:#5e3d02;" id="detail-followup-rel">
                ${escapeHtml(lead.nextFollowUpAt ? relTime(lead.nextFollowUpAt, now, lang) : t(lang, 'no_followup_set'))}
              </div>
              <div style="font-size:12px; color:#8A5A04;">
                ${escapeHtml(lead.nextFollowUpAt ? shortDate(lead.nextFollowUpAt, lang) : t(lang, 'tap_to_schedule'))}
              </div>
            </div>
            <button type="button" class="btn sm warn" id="btn-open-reschedule">
              ✎ ${escapeHtml(t(lang, 'btn_reschedule'))}
            </button>
          </div>

          <div class="fub-section">
            <h2>${escapeHtml(t(lang, 'section_history'))}</h2>
          </div>
          <form id="form-add-note" style="display:flex; gap:8px; margin-bottom:10px;">
            <input type="text" id="input-lead-note" placeholder="${escapeHtml(t(lang, 'note_placeholder'))}" aria-label="${escapeHtml(t(lang, 'note_placeholder'))}"
              value="${escapeHtml(uiState.noteDraft)}"
              style="flex:1; height:40px; border-radius:10px; border:1.5px solid var(--fub-line); background:var(--fub-card); padding:0 12px; font-size:13px;" />
            <button type="submit" class="btn sm ghost">${escapeHtml(t(lang, 'btn_add_note'))}</button>
          </form>
          <div class="timeline" id="detail-timeline">
            ${events
              .map(
                (ev, i) => `
                  <div class="row">
                    <div class="dot ${i === 0 ? '' : 'muted'}"></div>
                    <div>
                      <div class="when">${escapeHtml(relPastTime(ev.createdAt, now, lang))} · ${escapeHtml(shortDate(ev.createdAt, lang))}</div>
                      <div class="what">${escapeHtml(ev.body)}${ev.by ? ` <span style="color:var(--fub-ink-3); font-size:11px;">· ${escapeHtml(ev.by)}</span>` : ''}</div>
                    </div>
                  </div>
                `
              )
              .join('')}
          </div>

          <div class="fub-section">
            <h2>${escapeHtml(t(lang, 'section_outcome'))}</h2>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
            <button type="button" class="btn flat sm" id="btn-outcome-replied" style="color:var(--fub-emerald-deep);">
              💬 ${escapeHtml(t(lang, 'outcome_replied'))}
            </button>
            <button type="button" class="btn flat sm" id="btn-outcome-no-reply">
              ⏳ ${escapeHtml(t(lang, 'outcome_no_reply'))}
            </button>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:24px;">
            <button type="button" class="btn primary sm" id="btn-outcome-converted">
              ✓ ${escapeHtml(t(lang, 'outcome_converted'))}
            </button>
            <button type="button" class="btn flat sm" id="btn-outcome-not-interested">
              ${escapeHtml(t(lang, 'outcome_not_interested'))}
            </button>
            <button type="button" class="btn danger sm" id="btn-outcome-lost">
              ${escapeHtml(t(lang, 'outcome_lost'))}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderRescheduleSheet(lang) {
  const opts = [
    { d: 1, lbl: t(lang, 'delay_tomorrow') },
    { d: 2, lbl: t(lang, 'delay_2d') },
    { d: 7, lbl: t(lang, 'delay_1w') },
    { d: 30, lbl: t(lang, 'delay_1m') }
  ];
  return `
    <div class="scrim" id="sheet-scrim"></div>
    <div class="sheet" id="sheet-reschedule">
      <div class="grab"></div>
      <h2 style="margin:0 0 12px; font-size:18px; font-weight:800;">${escapeHtml(t(lang, 'btn_reschedule'))}</h2>
      <div class="chip-row" style="margin-bottom:14px;">
        ${opts
          .map(
            (o) => `
              <button type="button" class="chip-pick reschedule-opt-btn" data-days="${o.d}">
                ${escapeHtml(o.lbl)}
              </button>
            `
          )
          .join('')}
      </div>
      <div class="field">
        <label>${escapeHtml(t(lang, 'snooze_presets_label'))}</label>
        <div class="chip-row">
          ${snoozePresets(Date.now(), appState.settings.reminderHour)
            .map(
              (p) => `
                <button type="button" class="chip-pick snooze-preset-btn" data-at="${p.at}">
                  ${escapeHtml(t(lang, `snooze_${p.id}`))} · ${escapeHtml(shortDate(p.at, lang))}
                </button>`
            )
            .join('')}
        </div>
      </div>
      <div class="field">
        <label for="snooze-date-in">${escapeHtml(t(lang, 'snooze_pick_date'))}</label>
        <div style="display:flex; gap:8px;">
          <input type="date" id="snooze-date-in" style="flex:1;" aria-label="${escapeHtml(t(lang, 'snooze_pick_date'))}" />
          <button type="button" class="btn primary sm" id="btn-snooze-date">✓ ${escapeHtml(t(lang, 'btn_save'))}</button>
        </div>
      </div>
      <button type="button" class="btn ghost block" id="btn-close-reschedule">${escapeHtml(t(lang, 'btn_cancel'))}</button>
    </div>
  `;
}

function renderConvertedSheet(lang) {
  return `
    <div class="scrim" id="sheet-scrim"></div>
    <form class="sheet" id="form-converted-value">
      <div class="grab"></div>
      <h2 style="margin:0 0 8px; font-size:18px; font-weight:800;">🎉 ${escapeHtml(t(lang, 'outcome_converted'))}</h2>
      <div class="field">
        <label for="input-converted-value">${escapeHtml(t(lang, 'converted_value_label'))}</label>
        <input type="number" id="input-converted-value" min="0" step="1" placeholder="e.g. 2400"
          value="${escapeHtml(uiState.convertedValueDraft)}" />
      </div>
      <div style="display:flex; gap:10px; margin-top:12px;">
        <button type="button" class="btn ghost" id="btn-skip-converted-value" style="flex:1;">${escapeHtml(t(lang, 'btn_skip_value'))}</button>
        <button type="submit" class="btn primary" style="flex:2;">✓ ${escapeHtml(t(lang, 'outcome_converted'))}</button>
      </div>
    </form>
  `;
}

function renderAddLeadSheet(lang) {
  const suggested = Array.from(new Set([...appState.tags.slice(0, 6).map((tg) => tg.name), ...uiState.draftTags]));
  const delayOpts = [
    { d: 1, lbl: t(lang, 'delay_tomorrow') },
    { d: 2, lbl: t(lang, 'delay_2d') },
    { d: 7, lbl: t(lang, 'delay_1w') },
    { d: 30, lbl: t(lang, 'delay_1m') }
  ];
  const allowMoreTags = canAddTag(appState);

  return `
    <div class="scrim" id="sheet-scrim"></div>
    <form class="sheet" id="form-add-lead">
      <div class="grab"></div>
      <div style="display:flex; align-items:center; margin-bottom:10px;">
        <h2 style="margin:0; font-size:20px; font-weight:800; letter-spacing:-.01em; flex:1;">
          ${escapeHtml(t(lang, 'sheet_new_lead_title'))}
        </h2>
        <button type="button" class="btn icon flat" id="btn-close-add-sheet" aria-label="${escapeHtml(t(lang, 'btn_cancel'))}">✕</button>
      </div>

      <div class="field">
        <label for="lead-name-input">${escapeHtml(t(lang, 'field_name'))}</label>
        <input id="lead-name-input" name="name" type="text" required
          value="${escapeHtml(uiState.draftName)}"
          placeholder="${escapeHtml(t(lang, 'field_name_placeholder'))}" />
      </div>

      <div class="field">
        <label>${escapeHtml(t(lang, 'field_source_handle'))}</label>
        <div class="segmented" style="margin-bottom:8px;">
          <button type="button" class="source-seg-btn ${uiState.draftSource === 'whatsapp' ? 'on' : ''}" data-source="whatsapp">
            ${escapeHtml(t(lang, 'source_whatsapp'))}
          </button>
          <button type="button" class="source-seg-btn ${uiState.draftSource === 'instagram' ? 'on' : ''}" data-source="instagram">
            ${escapeHtml(t(lang, 'source_instagram'))}
          </button>
          <button type="button" class="source-seg-btn ${uiState.draftSource === 'other' ? 'on' : ''}" data-source="other">
            ${escapeHtml(t(lang, 'source_other'))}
          </button>
        </div>
        <input id="lead-handle-input" name="handle" type="text" aria-label="${escapeHtml(t(lang, 'field_source_handle'))}"
          value="${escapeHtml(uiState.draftHandle)}"
          placeholder="${escapeHtml(uiState.draftSource === 'whatsapp' ? t(lang, 'placeholder_wa') : t(lang, 'placeholder_ig'))}" />
      </div>

      <div class="field">
        <label for="lead-interest-input">${escapeHtml(t(lang, 'field_interest'))}</label>
        <textarea id="lead-interest-input" name="interest"
          placeholder="${escapeHtml(t(lang, 'field_interest_placeholder'))}">${escapeHtml(uiState.draftInterest)}</textarea>
        <div class="hint">${escapeHtml(t(lang, 'field_interest_hint'))}</div>
      </div>

      <div class="field">
        <label>${escapeHtml(t(lang, 'field_followup_in'))}</label>
        <div class="chip-row">
          ${delayOpts
            .map(
              (o) => `
                <button type="button" class="chip-pick delay-chip-btn ${uiState.draftFollowUpDays === o.d ? 'on' : ''}" data-days="${o.d}">
                  ${escapeHtml(o.lbl)}
                </button>
              `
            )
            .join('')}
        </div>
      </div>

      <div class="field">
        <label>${escapeHtml(t(lang, 'field_tags'))}</label>
        <div class="chip-row">
          ${suggested
            .map((tg) => {
              const on = uiState.draftTags.includes(tg);
              return `
                <button type="button" class="chip-pick tag-chip-btn ${on ? 'on' : ''}" data-tag="${escapeHtml(tg)}">
                  ${escapeHtml(tg)}
                </button>
              `;
            })
            .join('')}
          <button type="button" id="btn-add-tag-chip" class="chip-pick">
            ${escapeHtml(allowMoreTags ? t(lang, 'tag_new') : t(lang, 'tag_upgrade'))}
          </button>
        </div>
      </div>

      <div style="display:flex; align-items:center; gap:12px; padding:8px 2px;">
        <input type="checkbox" id="lead-priority-check" ${uiState.draftPriority ? 'checked' : ''}
          style="width:20px; height:20px; min-height:20px; accent-color:var(--fub-emerald);" />
        <label for="lead-priority-check" style="margin:0; font-size:14px; color:var(--fub-ink); font-weight:600; cursor:pointer;">
          ${escapeHtml(t(lang, 'field_priority'))} ★
        </label>
      </div>

      <div style="display:flex; gap:10px; margin-top:14px;">
        <button type="button" class="btn ghost" id="btn-cancel-add-lead" style="flex:1;">
          ${escapeHtml(t(lang, 'btn_cancel'))}
        </button>
        <button type="submit" class="btn primary" style="flex:2;">
          ✓ ${escapeHtml(t(lang, 'btn_save_lead'))}
        </button>
      </div>
    </form>
  `;
}

function renderProUpsellSheet(lang) {
  const busy = uiState.billingBusy ? 'disabled' : '';
  const notice = uiState.billingNotice
    ? `<p style="font-weight:700; margin:0 0 10px;">${escapeHtml(uiState.billingNotice)}</p>`
    : '';
  let body;
  if (appState.settings.isPro) {
    body = `
      <p>${escapeHtml(t(lang, 'pro_active'))}</p>
      <a class="btn sm ghost" style="color:#fff; border-color:rgba(255,255,255,.35); display:inline-flex;" href="${MANAGE_SUBSCRIPTIONS_URL}" target="_blank" rel="noopener">${escapeHtml(t(lang, 'pro_manage'))}</a>`;
  } else if (uiState.billingAvailable) {
    body = `
      <div style="display:flex; flex-direction:column; gap:8px;">
        <button type="button" id="btn-buy-pro-monthly" class="btn sm" ${busy}>✨ ${escapeHtml(t(lang, 'pro_plan_monthly', { price: uiState.proPrices.monthly }))}</button>
        <button type="button" id="btn-buy-pro-yearly" class="btn sm" ${busy}>⭐ ${escapeHtml(t(lang, 'pro_plan_yearly', { price: uiState.proPrices.yearly }))}</button>
        <button type="button" id="btn-restore-pro" class="btn sm ghost" style="color:#fff; border-color:rgba(255,255,255,.35);" ${busy}>${escapeHtml(t(lang, 'pro_restore'))}</button>
      </div>
      <p style="font-size:12px; opacity:.85; margin:10px 0 0;">${escapeHtml(t(lang, 'pro_renew_note'))}</p>`;
  } else {
    body = `<p>${escapeHtml(t(lang, 'pro_unavailable'))}</p>`;
  }
  return `
    <div class="scrim" id="sheet-scrim"></div>
    <div class="sheet">
      <div class="grab"></div>
      <div class="pro-card">
        <h3>${escapeHtml(t(lang, 'pro_card_settings_title'))}</h3>
        <p>${escapeHtml(t(lang, 'pro_card_settings_body'))}</p>
        ${notice}
        ${body}
        <div style="margin-top:10px;">
          <button type="button" id="btn-close-pro-sheet" class="btn sm ghost" style="color:#fff; border-color:rgba(255,255,255,.35);">
            ${escapeHtml(t(lang, 'btn_close'))}
          </button>
        </div>
      </div>
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
          const active = uiState.tab === tb.id && uiState.screen !== 'detail';
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
    bindEvents(lang);
    return;
  }

  let mainScreenHtml = '';
  if (uiState.screen === 'detail') {
    mainScreenHtml = renderLeadDetailScreen(lang);
  } else if (uiState.screen === 'all') {
    mainScreenHtml = renderAllLeadsScreen(lang);
  } else if (uiState.screen === 'settings') {
    mainScreenHtml = renderSettingsScreen(lang);
  } else if (uiState.screen === 'stats') {
    mainScreenHtml = renderStatsScreen(lang);
  } else if (uiState.screen === 'templates') {
    mainScreenHtml = renderTemplatesScreen(lang);
  } else if (uiState.screen === 'catalogue') {
    mainScreenHtml = renderCatalogueScreen(lang);
  } else if (uiState.screen === 'cloud') {
    mainScreenHtml = renderCloudScreen(lang);
  } else if (uiState.screen === 'team') {
    mainScreenHtml = renderTeamScreen(lang);
  } else {
    mainScreenHtml = renderTodayScreen(lang);
  }

  root.innerHTML = `
    ${mainScreenHtml}
    ${uiState.addSheetOpen ? renderAddLeadSheet(lang) : ''}
    ${uiState.proSheetOpen ? renderProUpsellSheet(lang) : ''}
    ${uiState.rescheduleSheetOpen ? renderRescheduleSheet(lang) : ''}
    ${uiState.convertedSheetOpen ? renderConvertedSheet(lang) : ''}
    ${uiState.backupSheetOpen ? renderBackupSheet(lang) : ''}
    ${uiState.profileSheetOpen ? renderProfileSheet(lang) : ''}
    ${uiState.templateSheetOpen ? renderTemplateSheet(lang) : ''}
    ${uiState.productSheetOpen ? renderProductSheet(lang) : ''}
    ${uiState.productPickerOpen ? renderProductPickerSheet(lang) : ''}
    ${uiState.snackMessage ? `<div class="snack">${escapeHtml(uiState.snackMessage)}</div>` : ''}
    ${renderTabBar(lang)}
  `;
  bindEvents(lang);
  scheduleDigestWrite();
  scheduleCloudSync();
}

function syncDraftInputs(root) {
  const nameIn = root.querySelector('#lead-name-input');
  const handleIn = root.querySelector('#lead-handle-input');
  const interestIn = root.querySelector('#lead-interest-input');
  const prioIn = root.querySelector('#lead-priority-check');
  if (nameIn) uiState.draftName = nameIn.value;
  if (handleIn) uiState.draftHandle = handleIn.value;
  if (interestIn) uiState.draftInterest = interestIn.value;
  if (prioIn) uiState.draftPriority = prioIn.checked;
}

function bindEvents(lang) {
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

  const todaySearchBtn = root.querySelector('#btn-today-search');
  if (todaySearchBtn) {
    todaySearchBtn.addEventListener('click', () => {
      uiState.tab = 'all';
      uiState.screen = 'all';
      renderApp();
      const sIn = document.querySelector('#input-all-search');
      if (sIn) sIn.focus();
    });
  }

  const openStats = () => {
    uiState.prevScreen = uiState.screen;
    uiState.screen = 'stats';
    renderApp();
  };
  const statsBtn = root.querySelector('#btn-today-stats');
  if (statsBtn) statsBtn.addEventListener('click', openStats);
  const rowStats = root.querySelector('#setting-row-stats');
  if (rowStats) rowStats.addEventListener('click', openStats);
  const statsBack = root.querySelector('#btn-stats-back');
  if (statsBack) {
    statsBack.addEventListener('click', () => {
      uiState.screen = uiState.prevScreen && uiState.prevScreen !== 'stats' ? uiState.prevScreen : uiState.tab;
      renderApp();
    });
  }

  // Catalogue (v3)
  const rowCatalogue = root.querySelector('#setting-row-catalogue');
  if (rowCatalogue) {
    rowCatalogue.addEventListener('click', () => {
      uiState.screen = 'catalogue';
      renderApp();
    });
  }
  const catalogueBack = root.querySelector('#btn-catalogue-back');
  if (catalogueBack) {
    catalogueBack.addEventListener('click', () => {
      uiState.screen = 'settings';
      renderApp();
    });
  }
  const catalogueUpsell = root.querySelector('#btn-catalogue-upsell');
  if (catalogueUpsell) {
    catalogueUpsell.addEventListener('click', () => {
      uiState.proSheetOpen = true;
      renderApp();
    });
  }
  const newPrdBtn = root.querySelector('#btn-new-product');
  if (newPrdBtn) {
    newPrdBtn.addEventListener('click', () => {
      uiState.productDraft = { id: null, name: '', price: '', photoId: null };
      uiState.productSheetOpen = true;
      renderApp();
    });
  }
  root.querySelectorAll('.prd-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = (appState.catalogue || []).find((x) => x.id === btn.getAttribute('data-id'));
      if (!p) return;
      uiState.productDraft = { id: p.id, name: p.name, price: String(p.price || ''), photoId: p.photoId };
      uiState.productSheetOpen = true;
      renderApp();
    });
  });
  root.querySelectorAll('.prd-del-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!window.confirm(t(lang, 'catalogue_delete_confirm'))) return;
      const id = btn.getAttribute('data-id');
      const p = (appState.catalogue || []).find((x) => x.id === id);
      appState = removeProduct(appState, id);
      if (p && p.photoId) await deletePhoto(p.photoId);
      renderApp();
    });
  });
  const closePrdSheet = root.querySelector('#btn-close-product-sheet');
  if (closePrdSheet) {
    closePrdSheet.addEventListener('click', () => {
      uiState.productSheetOpen = false;
      renderApp();
    });
  }
  const prdPhotoIn = root.querySelector('#prd-photo-in');
  if (prdPhotoIn) {
    prdPhotoIn.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const nIn = root.querySelector('#prd-name-in');
      const pIn = root.querySelector('#prd-price-in');
      if (nIn) uiState.productDraft.name = nIn.value;
      if (pIn) uiState.productDraft.price = pIn.value;
      uiState.cardBusy = true;
      renderApp();
      try {
        const id = await importPhoto(file);
        const blob = await getPhoto(id);
        if (blob) uiState.photoUrls[id] = URL.createObjectURL(blob);
        uiState.productDraft.photoId = id;
      } catch {
        showSnack(t(lang, 'snack_photo_failed'));
      }
      uiState.cardBusy = false;
      renderApp();
    });
  }
  const prdForm = root.querySelector('#form-product');
  if (prdForm) {
    prdForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const nIn = root.querySelector('#prd-name-in');
      const pIn = root.querySelector('#prd-price-in');
      const input = { name: nIn ? nIn.value : '', price: pIn ? pIn.value : 0, photoId: uiState.productDraft.photoId };
      try {
        appState = uiState.productDraft.id
          ? updateProduct(appState, uiState.productDraft.id, input)
          : addProduct(appState, input);
        uiState.productSheetOpen = false;
        showSnack(t(lang, 'snack_product_saved'));
      } catch (err) {
        if (err && err.code === 'PRO_PRODUCT_LIMIT') {
          uiState.productSheetOpen = false;
          uiState.proSheetOpen = true;
        } else {
          showSnack(t(lang, 'snack_product_invalid'));
        }
      }
      renderApp();
    });
  }
  const openPickerBtn = root.querySelector('#btn-send-product-card');
  if (openPickerBtn) {
    openPickerBtn.addEventListener('click', () => {
      uiState.productPickerOpen = true;
      renderApp();
    });
  }
  const closePicker = root.querySelector('#btn-close-product-picker');
  if (closePicker) {
    closePicker.addEventListener('click', () => {
      uiState.productPickerOpen = false;
      renderApp();
    });
  }
  const pickerOpenCat = root.querySelector('#btn-picker-open-catalogue');
  if (pickerOpenCat) {
    pickerOpenCat.addEventListener('click', () => {
      uiState.productPickerOpen = false;
      uiState.screen = 'catalogue';
      renderApp();
    });
  }
  root.querySelectorAll('.prd-pick-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const lead = appState.leads.find((l) => l.id === uiState.selectedLeadId);
      const product = (appState.catalogue || []).find((x) => x.id === btn.getAttribute('data-id'));
      if (!lead || !product || uiState.cardBusy) return;
      uiState.cardBusy = true;
      renderApp();
      try {
        await sendProductCard(lead, product, lang);
      } catch {
        showSnack(t(lang, 'snack_card_failed'));
      }
      uiState.cardBusy = false;
      uiState.productPickerOpen = false;
      renderApp();
    });
  });

  // Team of two (v3, Pro)
  const rowTeam = root.querySelector('#setting-row-team');
  if (rowTeam) {
    rowTeam.addEventListener('click', () => {
      if (!appState.settings.isPro) {
        uiState.proSheetOpen = true;
        renderApp();
        return;
      }
      uiState.screen = 'team';
      renderApp();
    });
  }
  const teamBack = root.querySelector('#btn-team-back');
  if (teamBack) {
    teamBack.addEventListener('click', () => {
      uiState.screen = 'settings';
      renderApp();
    });
  }
  const deviceForm = root.querySelector('#form-device-name');
  if (deviceForm) {
    deviceForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = root.querySelector('#device-name-in');
      appState = updateSettings(appState, { deviceName: inp ? inp.value.trim() : '' });
      showSnack(t(lang, 'snack_device_saved'));
      renderApp();
    });
  }
  const teamCopy = root.querySelector('#btn-team-copy');
  if (teamCopy) {
    teamCopy.addEventListener('click', async () => {
      await copyTextToClipboard(formatVaultCode(appState.settings.cloud.vaultId));
      showSnack(t(lang, 'snack_cloud_copied'));
      renderApp();
    });
  }
  const teamOpenCloud = root.querySelector('#btn-team-open-cloud');
  if (teamOpenCloud) {
    teamOpenCloud.addEventListener('click', () => {
      uiState.cloudMode = null;
      uiState.screen = 'cloud';
      renderApp();
    });
  }

  // Cloud backup (v3, Pro)
  const rowCloud = root.querySelector('#setting-row-cloud');
  if (rowCloud) {
    rowCloud.addEventListener('click', () => {
      if (!appState.settings.isPro) {
        uiState.proSheetOpen = true;
        renderApp();
        return;
      }
      uiState.cloudMode = null;
      uiState.cloudStatus = '';
      uiState.screen = 'cloud';
      renderApp();
    });
  }
  const cloudBack = root.querySelector('#btn-cloud-back');
  if (cloudBack) {
    cloudBack.addEventListener('click', () => {
      uiState.screen = 'settings';
      renderApp();
    });
  }
  for (const mode of ['create', 'restore']) {
    const b = root.querySelector(`#btn-cloud-mode-${mode}`);
    if (b) {
      b.addEventListener('click', () => {
        uiState.cloudMode = mode;
        uiState.cloudStatus = '';
        renderApp();
      });
    }
  }
  const cloudCancel = root.querySelector('#btn-cloud-cancel');
  if (cloudCancel) {
    cloudCancel.addEventListener('click', () => {
      uiState.cloudMode = null;
      renderApp();
    });
  }
  const cloudCreateForm = root.querySelector('#form-cloud-create');
  if (cloudCreateForm) {
    cloudCreateForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const p1 = root.querySelector('#cloud-pass-in').value;
      const p2 = root.querySelector('#cloud-pass2-in').value;
      if (p1.length < 8) return showSnack(t(lang, 'snack_cloud_short')), renderApp();
      if (p1 !== p2) return showSnack(t(lang, 'snack_cloud_mismatch')), renderApp();
      cloudBusy = true;
      renderApp();
      try {
        const salt = randomBytes(16);
        const key = await deriveKey(p1, salt);
        const cloud = { vaultId: newVaultId(), salt: bytesToBase64(salt), keyB64: await exportKeyB64(key), autoSync: true, lastSyncAt: 0 };
        appState = updateSettings(appState, { cloud });
        cloudBusy = false;
        await cloudPush(key);
        uiState.cloudMode = null;
        uiState.cloudStatus = '';
        showSnack(t(lang, 'snack_cloud_created'));
      } catch (err) {
        appState = updateSettings(appState, { cloud: { vaultId: null, salt: null, keyB64: null, autoSync: false, lastSyncAt: 0 } });
        uiState.cloudStatus = t(lang, err && err.code === 'TOO_LARGE' ? 'snack_cloud_too_large' : 'snack_cloud_failed');
      }
      cloudBusy = false;
      renderApp();
    });
  }
  const cloudRestoreForm = root.querySelector('#form-cloud-restore');
  if (cloudRestoreForm) {
    cloudRestoreForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const vaultId = parseVaultCode(root.querySelector('#cloud-code-in').value);
      const pass = root.querySelector('#cloud-pass-in').value;
      if (!vaultId) return showSnack(t(lang, 'snack_cloud_wrong_pass')), renderApp();
      cloudBusy = true;
      renderApp();
      try {
        const remote = await pullVault(vaultId);
        if (!remote) {
          uiState.cloudStatus = t(lang, 'snack_cloud_not_found');
        } else {
          const key = await deriveKey(pass, base64ToBytes(remote.salt));
          const remoteState = await decryptJson(remote, { key });
          if (window.confirm(t(lang, 'cloud_restore_confirm'))) {
            appState = updateSettings(appState, {
              cloud: { vaultId, salt: remote.salt, keyB64: await exportKeyB64(key), autoSync: true, lastSyncAt: 0 }
            });
            applyRemoteState(remoteState);
            cloudBusy = false;
            await cloudPush(key);
            uiState.cloudMode = null;
            uiState.cloudStatus = '';
            showSnack(t(lang, 'snack_cloud_restored'));
          }
        }
      } catch (err) {
        uiState.cloudStatus = t(lang, err && err.code === 'DECRYPT_FAILED' ? 'snack_cloud_wrong_pass' : 'snack_cloud_failed');
      }
      cloudBusy = false;
      renderApp();
    });
  }
  const cloudCopy = root.querySelector('#btn-cloud-copy');
  if (cloudCopy) {
    cloudCopy.addEventListener('click', async () => {
      await copyTextToClipboard(formatVaultCode(appState.settings.cloud.vaultId));
      showSnack(t(lang, 'snack_cloud_copied'));
      renderApp();
    });
  }
  const cloudSyncBtn = root.querySelector('#btn-cloud-sync');
  if (cloudSyncBtn) cloudSyncBtn.addEventListener('click', () => cloudSync({ silent: false, lang }));
  const cloudAuto = root.querySelector('#btn-cloud-autosync');
  if (cloudAuto) {
    cloudAuto.addEventListener('click', () => {
      const cloud = appState.settings.cloud;
      appState = updateSettings(appState, { cloud: { ...cloud, autoSync: !cloud.autoSync } });
      renderApp();
    });
  }
  const cloudForget = root.querySelector('#btn-cloud-forget');
  if (cloudForget) {
    cloudForget.addEventListener('click', () => {
      if (!window.confirm(t(lang, 'cloud_forget_confirm'))) return;
      appState = updateSettings(appState, { cloud: { vaultId: null, salt: null, keyB64: null, autoSync: false, lastSyncAt: 0 } });
      renderApp();
    });
  }
  const cloudDelete = root.querySelector('#btn-cloud-delete');
  if (cloudDelete) {
    cloudDelete.addEventListener('click', async () => {
      if (!window.confirm(t(lang, 'cloud_delete_remote_confirm'))) return;
      try {
        await deleteVault(appState.settings.cloud.vaultId);
      } catch {
        /* ignore */
      }
      appState = updateSettings(appState, { cloud: { vaultId: null, salt: null, keyB64: null, autoSync: false, lastSyncAt: 0 } });
      renderApp();
    });
  }

  // Message templates (Pro)
  const rowTemplates = root.querySelector('#setting-row-templates');
  if (rowTemplates) {
    rowTemplates.addEventListener('click', () => {
      if (!appState.settings.isPro) {
        uiState.proSheetOpen = true;
        renderApp();
        return;
      }
      uiState.prevScreen = uiState.screen;
      uiState.screen = 'templates';
      renderApp();
    });
  }
  const templatesBack = root.querySelector('#btn-templates-back');
  if (templatesBack) {
    templatesBack.addEventListener('click', () => {
      uiState.screen = 'settings';
      renderApp();
    });
  }
  const newTplBtn = root.querySelector('#btn-new-template');
  if (newTplBtn) {
    newTplBtn.addEventListener('click', () => {
      uiState.templateDraft = { id: null, name: '', text: '' };
      uiState.templateSheetOpen = true;
      renderApp();
    });
  }
  root.querySelectorAll('.tpl-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tp = (appState.settings.templates || []).find((x) => x.id === btn.getAttribute('data-id'));
      if (!tp) return;
      uiState.templateDraft = { id: tp.id, name: tp.name, text: tp.text };
      uiState.templateSheetOpen = true;
      renderApp();
    });
  });
  root.querySelectorAll('.tpl-del-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!window.confirm(t(lang, 'templates_delete_confirm'))) return;
      appState = deleteTemplate(appState, btn.getAttribute('data-id'));
      renderApp();
    });
  });
  root.querySelectorAll('.tag-template-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      appState = assignTagTemplate(appState, sel.getAttribute('data-tag'), sel.value || null);
      renderApp();
    });
  });
  const closeTplSheet = root.querySelector('#btn-close-template-sheet');
  if (closeTplSheet) {
    closeTplSheet.addEventListener('click', () => {
      uiState.templateSheetOpen = false;
      renderApp();
    });
  }
  const tplForm = root.querySelector('#form-template');
  if (tplForm) {
    tplForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const nIn = root.querySelector('#tpl-name-in');
      const tIn = root.querySelector('#tpl-text-in');
      try {
        appState = saveTemplate(appState, { id: uiState.templateDraft.id, name: nIn ? nIn.value : '', text: tIn ? tIn.value : '' });
        uiState.templateSheetOpen = false;
        showSnack(t(lang, 'snack_template_saved'));
      } catch (err) {
        if (err && err.code === 'PRO_REQUIRED') {
          uiState.templateSheetOpen = false;
          uiState.proSheetOpen = true;
        } else {
          showSnack(t(lang, 'snack_template_invalid'));
        }
      }
      renderApp();
    });
  }

  const todayProBtn = root.querySelector('#btn-today-pro-upsell');
  if (todayProBtn) {
    todayProBtn.addEventListener('click', () => {
      uiState.proSheetOpen = true;
      renderApp();
    });
  }

  // All Leads search & filter controls
  const searchInput = root.querySelector('#input-all-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      uiState.searchQuery = e.target.value;
      const pos = e.target.selectionStart;
      renderApp();
      const nextIn = document.querySelector('#input-all-search');
      if (nextIn) {
        nextIn.focus();
        try {
          nextIn.setSelectionRange(pos, pos);
        } catch (_) {
          // ignore
        }
      }
    });
  }

  const clearSearchBtn = root.querySelector('#btn-clear-search');
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      uiState.searchQuery = '';
      renderApp();
    });
  }

  const toggleArchBtn = root.querySelector('#btn-toggle-archived');
  if (toggleArchBtn) {
    toggleArchBtn.addEventListener('click', () => {
      uiState.showArchived = !uiState.showArchived;
      renderApp();
    });
  }

  root.querySelectorAll('.status-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      uiState.statusFilter = btn.getAttribute('data-status') || 'all';
      renderApp();
    });
  });

  root.querySelectorAll('.source-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      uiState.sourceFilter = btn.getAttribute('data-source-f') || 'all';
      renderApp();
    });
  });

  const tagProFilterBtn = root.querySelector('#btn-tag-pro-filter');
  if (tagProFilterBtn) {
    tagProFilterBtn.addEventListener('click', () => {
      if (!appState.settings.isPro) {
        uiState.proSheetOpen = true;
        renderApp();
        return;
      }
      const tagNames = ['all', ...appState.tags.map((tg) => tg.name)];
      const curIdx = tagNames.indexOf(uiState.tagFilter);
      uiState.tagFilter = tagNames[(curIdx + 1) % tagNames.length];
      renderApp();
    });
  }

  // Settings screen interactions
  const settingsProBtn = root.querySelector('#btn-settings-upgrade-pro');
  if (settingsProBtn) {
    settingsProBtn.addEventListener('click', () => {
      uiState.proSheetOpen = true;
      renderApp();
    });
  }


  const rowProfile = root.querySelector('#setting-row-profile');
  if (rowProfile) {
    rowProfile.addEventListener('click', () => {
      uiState.profileSheetOpen = true;
      renderApp();
    });
  }

  const profileForm = root.querySelector('#form-profile-edit');
  if (profileForm) {
    profileForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const nIn = root.querySelector('#profile-name-in');
      const hIn = root.querySelector('#profile-handle-in');
      const bIn = root.querySelector('#profile-biz-in');
      appState = updateSettings(appState, {
        sellerName: nIn && nIn.value.trim() ? nIn.value.trim() : appState.settings.sellerName,
        sellerHandle: hIn ? hIn.value.trim() : appState.settings.sellerHandle,
        sellerBusiness: bIn ? bIn.value.trim() : appState.settings.sellerBusiness
      });
      uiState.profileSheetOpen = false;
      renderApp();
    });
  }

  const closeProfileBtn = root.querySelector('#btn-close-profile-sheet');
  if (closeProfileBtn) {
    closeProfileBtn.addEventListener('click', () => {
      uiState.profileSheetOpen = false;
      renderApp();
    });
  }

  const rowDelay = root.querySelector('#setting-row-delay');
  if (rowDelay) {
    rowDelay.addEventListener('click', () => {
      const cycle = [1, 2, 7, 30];
      const idx = cycle.indexOf(appState.settings.defaultFollowUpDays);
      const next = cycle[(idx + 1) % cycle.length];
      appState = updateSettings(appState, { defaultFollowUpDays: next });
      renderApp();
    });
  }

  const togRem = root.querySelector('#btn-toggle-reminders');
  if (togRem) {
    togRem.addEventListener('click', () => {
      const next = !appState.settings.reminderEnabled;
      if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      appState = updateSettings(appState, { reminderEnabled: next });
      armReminders();
      renderApp();
    });
  }

  for (const edge of ['start', 'end']) {
    const sel = root.querySelector(`#sel-quiet-${edge}`);
    if (sel) {
      sel.addEventListener('change', () => {
        appState = updateSettings(appState, {
          quietHours: { ...appState.settings.quietHours, [edge]: Number(sel.value) }
        });
        armReminders();
        renderApp();
      });
    }
  }

  const togMorn = root.querySelector('#btn-toggle-morning');
  if (togMorn) {
    togMorn.addEventListener('click', () => {
      appState = updateSettings(appState, {
        morningSummary: !appState.settings.morningSummary
      });
      renderApp();
    });
  }

  root.querySelectorAll('.lang-seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState = updateSettings(appState, { language: normalizeLang(btn.getAttribute('data-lang')) });
      renderApp();
    });
  });

  const cycleThemeBtn = root.querySelector('#btn-cycle-theme');
  if (cycleThemeBtn) {
    cycleThemeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nextTheme = appState.settings.theme === 'dark' ? 'light' : 'dark';
      appState = updateSettings(appState, { theme: nextTheme });
      renderApp();
    });
  }

  const cycleDensityBtn = root.querySelector('#btn-cycle-density');
  if (cycleDensityBtn) {
    cycleDensityBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nextDensity = appState.settings.density === 'compact' ? 'comfy' : 'compact';
      appState = updateSettings(appState, { density: nextDensity });
      renderApp();
    });
  }

  const rowBackup = root.querySelector('#setting-row-backup');
  if (rowBackup) {
    rowBackup.addEventListener('click', () => {
      uiState.backupSheetOpen = true;
      renderApp();
    });
  }

  const closeBackupBtn = root.querySelector('#btn-close-backup-sheet');
  if (closeBackupBtn) {
    closeBackupBtn.addEventListener('click', () => {
      uiState.backupSheetOpen = false;
      renderApp();
    });
  }

  const exportJsonBtn = root.querySelector('#btn-export-json');
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', () => {
      const json = exportBackupJson(appState);
      triggerFileDownload('followup-buddy-backup.json', json, 'application/json');
      uiState.backupSheetOpen = false;
      showSnack(t(lang, 'snack_backup_downloaded'));
      renderApp();
    });
  }

  const importJsonIn = root.querySelector('#input-import-json');
  if (importJsonIn) {
    importJsonIn.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        appState = importBackupJson(text);
        uiState.backupSheetOpen = false;
        showSnack(t(lang, 'snack_backup_restored'));
        renderApp();
      } catch (_) {
        showSnack(t(lang, 'snack_backup_invalid'));
        renderApp();
      }
    });
  }

  const exportCsvBtn = root.querySelector('#btn-export-csv');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      try {
        const csv = exportLeadsCsv(appState);
        triggerFileDownload('followup-buddy-leads.csv', csv, 'text/csv;charset=utf-8');
        uiState.backupSheetOpen = false;
        showSnack(t(lang, 'snack_csv_exported'));
        renderApp();
      } catch (err) {
        if (err && err.code === 'PRO_REQUIRED') {
          uiState.backupSheetOpen = false;
          uiState.proSheetOpen = true;
          renderApp();
        }
      }
    });
  }

  const rowArchived = root.querySelector('#setting-row-archived');
  if (rowArchived) {
    rowArchived.addEventListener('click', () => {
      uiState.showArchived = true;
      uiState.tab = 'all';
      uiState.screen = 'all';
      renderApp();
    });
  }

  const rowSeed = root.querySelector('#setting-row-seed');
  if (rowSeed) {
    rowSeed.addEventListener('click', () => {
      if (appState.leads.length > 0 && !window.confirm(t(lang, 'seed_confirm'))) return;
      appState = seedSampleLeads(appState, globalThis.localStorage, Date.now());
      showSnack(t(lang, 'snack_seeded'));
      renderApp();
    });
  }

  const rowClear = root.querySelector('#setting-row-clear');
  if (rowClear) {
    rowClear.addEventListener('click', () => {
      if (!window.confirm(t(lang, 'clear_data_confirm'))) return;
      appState = clearAllData();
      clearPhotos();
      uiState.photoUrls = {};
      uiState.tab = 'today';
      uiState.screen = 'onboarding';
      uiState.onbStep = 0;
      uiState.catchUp = null;
      showSnack(t(lang, 'snack_data_cleared'));
      renderApp();
    });
  }

  // Open Lead Detail when clicking any lead card
  root.querySelectorAll('.lead[data-lead-id]').forEach((card) => {
    card.addEventListener('click', () => {
      const leadId = card.getAttribute('data-lead-id');
      if (!leadId) return;
      uiState.prevScreen = uiState.screen;
      uiState.selectedLeadId = leadId;
      uiState.screen = 'detail';
      renderApp();
    });
  });

  // Lead Detail interactions
  const backBtn = root.querySelector('#btn-detail-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      uiState.screen = uiState.prevScreen || 'today';
      renderApp();
    });
  }

  const archiveBtn = root.querySelector('#btn-detail-archive');
  if (archiveBtn && uiState.selectedLeadId) {
    archiveBtn.addEventListener('click', () => {
      const lead = appState.leads.find((l) => l.id === uiState.selectedLeadId);
      const nextArchived = !(lead && lead.archived);
      appState = archiveLead(appState, uiState.selectedLeadId, nextArchived);
      uiState.screen = uiState.prevScreen || 'today';
      showSnack(t(lang, nextArchived ? 'snack_archived' : 'snack_unarchived'));
      renderApp();
    });
  }

  const currentLead = uiState.selectedLeadId
    ? appState.leads.find((l) => l.id === uiState.selectedLeadId)
    : null;

  const qaWa = root.querySelector('#btn-qa-whatsapp');
  if (qaWa && currentLead) {
    qaWa.addEventListener('click', () => {
      const msg = buildMessageForLead(currentLead, appState.settings, t(lang, 'followup_template'));
      const url = buildWhatsAppUrl(currentLead.handle, msg);
      if (typeof window !== 'undefined' && window.open) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      appState = logLeadEvent(appState, currentLead.id, 'contacted', 'Sent WhatsApp follow-up');
      showSnack(t(lang, 'snack_wa_opened'));
      renderApp();
    });
  }

  const qaIg = root.querySelector('#btn-qa-instagram');
  if (qaIg && currentLead) {
    qaIg.addEventListener('click', async () => {
      const msg = buildMessageForLead(currentLead, appState.settings, t(lang, 'followup_template'));
      await copyTextToClipboard(msg);
      const url = buildInstagramWebUrl(currentLead.handle);
      if (typeof window !== 'undefined' && window.open) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      appState = logLeadEvent(appState, currentLead.id, 'contacted', 'Opened Instagram DM & copied follow-up');
      showSnack(t(lang, 'snack_ig_opened'));
      renderApp();
    });
  }

  const qaCopy = root.querySelector('#btn-qa-copy');
  if (qaCopy && currentLead) {
    qaCopy.addEventListener('click', async () => {
      const msg = buildMessageForLead(currentLead, appState.settings, t(lang, 'followup_template'));
      await copyTextToClipboard(msg);
      showSnack(t(lang, 'snack_copied'));
      renderApp();
    });
  }

  const qaShare = root.querySelector('#btn-qa-share');
  if (qaShare && currentLead) {
    qaShare.addEventListener('click', async () => {
      const summary = buildLeadSummaryText(currentLead);
      if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          await navigator.share({ title: currentLead.name, text: summary });
          return;
        } catch (_) {
          // fallback to clipboard
        }
      }
      await copyTextToClipboard(summary);
      showSnack(t(lang, 'snack_summary_copied'));
      renderApp();
    });
  }

  const openRescheduleBtn = root.querySelector('#btn-open-reschedule');
  if (openRescheduleBtn) {
    openRescheduleBtn.addEventListener('click', () => {
      uiState.rescheduleSheetOpen = true;
      renderApp();
    });
  }

  root.querySelectorAll('.reschedule-opt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!currentLead) return;
      const days = Number(btn.getAttribute('data-days') || 2);
      appState = rescheduleFollowUp(appState, currentLead.id, days);
      uiState.rescheduleSheetOpen = false;
      const updated = appState.leads.find((l) => l.id === currentLead.id);
      showSnack(t(lang, 'snack_rescheduled', { relTime: relTime(updated ? updated.nextFollowUpAt : Date.now(), Date.now(), lang) }));
      renderApp();
    });
  });

  const applySnoozeAt = (atMs) => {
    if (!currentLead || !atMs) return;
    appState = rescheduleFollowUp(appState, currentLead.id, atMs);
    uiState.rescheduleSheetOpen = false;
    showSnack(t(lang, 'snack_rescheduled', { relTime: relTime(atMs, Date.now(), lang) }));
    renderApp();
  };
  root.querySelectorAll('.snooze-preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => applySnoozeAt(Number(btn.getAttribute('data-at'))));
  });
  const snoozeDateBtn = root.querySelector('#btn-snooze-date');
  if (snoozeDateBtn) {
    snoozeDateBtn.addEventListener('click', () => {
      const inp = root.querySelector('#snooze-date-in');
      const atMs = pickDateAt(inp ? inp.value : '', Date.now(), appState.settings.reminderHour);
      if (!atMs) {
        showSnack(t(lang, 'snack_snooze_bad_date'));
        renderApp();
        return;
      }
      applySnoozeAt(atMs);
    });
  }

  const closeRescheduleBtn = root.querySelector('#btn-close-reschedule');
  if (closeRescheduleBtn) {
    closeRescheduleBtn.addEventListener('click', () => {
      uiState.rescheduleSheetOpen = false;
      renderApp();
    });
  }

  const addNoteForm = root.querySelector('#form-add-note');
  if (addNoteForm && currentLead) {
    addNoteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = root.querySelector('#input-lead-note');
      const val = input ? input.value.trim() : '';
      if (!val) return;
      appState = logLeadEvent(appState, currentLead.id, 'note', val);
      uiState.noteDraft = '';
      renderApp();
    });
  }

  const btnConverted = root.querySelector('#btn-outcome-converted');
  if (btnConverted && currentLead) {
    btnConverted.addEventListener('click', () => {
      uiState.convertedValueDraft = currentLead.convertedValue ? String(currentLead.convertedValue) : '';
      uiState.convertedSheetOpen = true;
      renderApp();
    });
  }

  const convertedForm = root.querySelector('#form-converted-value');
  if (convertedForm && currentLead) {
    convertedForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const valIn = root.querySelector('#input-converted-value');
      const rawVal = valIn ? Number(valIn.value) : null;
      appState = updateLeadStatus(
        appState,
        currentLead.id,
        'converted',
        rawVal && rawVal > 0 ? rawVal : null
      );
      uiState.convertedSheetOpen = false;
      showSnack(t(lang, 'snack_converted'));
      renderApp();
    });
  }

  const skipConvertedValBtn = root.querySelector('#btn-skip-converted-value');
  if (skipConvertedValBtn && currentLead) {
    skipConvertedValBtn.addEventListener('click', () => {
      appState = updateLeadStatus(appState, currentLead.id, 'converted', null);
      uiState.convertedSheetOpen = false;
      showSnack(t(lang, 'snack_converted'));
      renderApp();
    });
  }

  const btnReplied = root.querySelector('#btn-outcome-replied');
  if (btnReplied && currentLead) {
    btnReplied.addEventListener('click', () => {
      appState = logLeadEvent(appState, currentLead.id, 'replied', 'Lead replied');
      showSnack(t(lang, 'snack_replied'));
      renderApp();
    });
  }

  const btnNoReply = root.querySelector('#btn-outcome-no-reply');
  if (btnNoReply && currentLead) {
    btnNoReply.addEventListener('click', () => {
      appState = logLeadEvent(appState, currentLead.id, 'note', 'No reply yet');
      uiState.rescheduleSheetOpen = true;
      renderApp();
    });
  }

  root.querySelectorAll('.all-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      uiState.allView = btn.getAttribute('data-view') === 'pipeline' ? 'pipeline' : 'list';
      renderApp();
    });
  });

  const btnNotInt = root.querySelector('#btn-outcome-not-interested');
  if (btnNotInt && currentLead) {
    btnNotInt.addEventListener('click', () => {
      appState = updateLeadStatus(appState, currentLead.id, 'not_interested');
      showSnack(t(lang, 'snack_not_interested'));
      renderApp();
    });
  }

  const btnLost = root.querySelector('#btn-outcome-lost');
  if (btnLost && currentLead) {
    btnLost.addEventListener('click', () => {
      appState = updateLeadStatus(appState, currentLead.id, 'lost');
      showSnack(t(lang, 'snack_lost'));
      renderApp();
    });
  }

  // Open Add Lead sheet via FAB, Empty CTA, or Add tab
  const openAddHandler = () => {
    if (!canAddActiveLead(appState)) {
      uiState.proSheetOpen = true;
      renderApp();
      return;
    }
    resetDraft();
    uiState.addSheetOpen = true;
    renderApp();
  };

  const fabAdd = root.querySelector('#btn-fab-add');
  if (fabAdd) fabAdd.addEventListener('click', openAddHandler);

  const emptyAdd = root.querySelector('#btn-empty-add-lead');
  if (emptyAdd) emptyAdd.addEventListener('click', openAddHandler);

  root.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      if (tabId === 'add') {
        openAddHandler();
        return;
      }
      uiState.tab = tabId;
      uiState.screen = tabId;
      renderApp();
    });
  });

  // Add Lead sheet interactions
  const closeAddBtn = root.querySelector('#btn-close-add-sheet');
  const cancelAddBtn = root.querySelector('#btn-cancel-add-lead');
  const scrim = root.querySelector('#sheet-scrim');
  if (closeAddBtn) closeAddBtn.addEventListener('click', () => { uiState.addSheetOpen = false; renderApp(); });
  if (cancelAddBtn) cancelAddBtn.addEventListener('click', () => { uiState.addSheetOpen = false; renderApp(); });
  if (scrim) {
    scrim.addEventListener('click', () => {
      uiState.addSheetOpen = false;
      uiState.proSheetOpen = false;
      uiState.rescheduleSheetOpen = false;
      uiState.convertedSheetOpen = false;
      uiState.backupSheetOpen = false;
      uiState.profileSheetOpen = false;
      uiState.templateSheetOpen = false;
      uiState.productSheetOpen = false;
      uiState.productPickerOpen = false;
      renderApp();
    });
  }

  root.querySelectorAll('.source-seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      syncDraftInputs(root);
      uiState.draftSource = btn.getAttribute('data-source') || 'whatsapp';
      renderApp();
    });
  });

  root.querySelectorAll('.delay-chip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      syncDraftInputs(root);
      uiState.draftFollowUpDays = Number(btn.getAttribute('data-days') || 2);
      renderApp();
    });
  });

  root.querySelectorAll('.tag-chip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      syncDraftInputs(root);
      const tg = btn.getAttribute('data-tag');
      if (!tg) return;
      if (uiState.draftTags.includes(tg)) {
        uiState.draftTags = uiState.draftTags.filter((x) => x !== tg);
      } else {
        uiState.draftTags = [...uiState.draftTags, tg];
      }
      renderApp();
    });
  });

  const addTagChipBtn = root.querySelector('#btn-add-tag-chip');
  if (addTagChipBtn) {
    addTagChipBtn.addEventListener('click', () => {
      syncDraftInputs(root);
      if (!canAddTag(appState)) {
        uiState.addSheetOpen = false;
        uiState.proSheetOpen = true;
        renderApp();
        return;
      }
      const name = String(window.prompt(t(lang, 'tag_new_prompt')) || '').trim();
      if (!name) return;
      try {
        appState = addTag(appState, name);
        const created = appState.tags.find((tg) => tg.name.toLowerCase() === name.toLowerCase());
        if (created && !uiState.draftTags.includes(created.name)) {
          uiState.draftTags = [...uiState.draftTags, created.name];
        }
      } catch (_) {
        // tag limit hit between render and click; upsell on next render
      }
      renderApp();
    });
  }

  const addLeadForm = root.querySelector('#form-add-lead');
  if (addLeadForm) {
    addLeadForm.addEventListener('submit', (e) => {
      e.preventDefault();
      syncDraftInputs(root);
      try {
        appState = createLead(appState, {
          name: uiState.draftName,
          handle: uiState.draftHandle,
          source: uiState.draftSource,
          interest: uiState.draftInterest,
          followUpDays: uiState.draftFollowUpDays,
          tags: uiState.draftTags,
          priority: uiState.draftPriority
        });
        uiState.addSheetOpen = false;
        showSnack(t(lang, 'snack_lead_saved', { days: uiState.draftFollowUpDays }));
        renderApp();
      } catch (err) {
        if (err && (err.code === 'PRO_LIMIT_REACHED' || err.code === 'PRO_PRIORITY_LIMIT')) {
          uiState.addSheetOpen = false;
          uiState.proSheetOpen = true;
          renderApp();
        }
      }
    });
  }

  for (const plan of ['monthly', 'yearly']) {
    const buyBtn = root.querySelector(`#btn-buy-pro-${plan}`);
    if (buyBtn) {
      buyBtn.addEventListener('click', async () => {
        if (uiState.billingBusy) return;
        uiState.billingBusy = true;
        uiState.billingNotice = '';
        renderApp();
        try {
          await buyPro(plan);
          appState = updateSettings(appState, { isPro: true, proPlan: plan });
          uiState.billingNotice = '';
        } catch (err) {
          uiState.billingNotice = t(lang, err && err.code === 'cancelled' ? 'purchase_cancelled' : 'purchase_failed');
        }
        uiState.billingBusy = false;
        renderApp();
      });
    }
  }

  const restoreProBtn = root.querySelector('#btn-restore-pro');
  if (restoreProBtn) {
    restoreProBtn.addEventListener('click', async () => {
      if (uiState.billingBusy) return;
      uiState.billingBusy = true;
      renderApp();
      const plan = await activeProPlan();
      if (plan) {
        appState = updateSettings(appState, { isPro: true, proPlan: plan });
        uiState.billingNotice = '';
      } else {
        uiState.billingNotice = t(lang, 'no_purchase_found');
      }
      uiState.billingBusy = false;
      renderApp();
    });
  }

  const closeProBtn = root.querySelector('#btn-close-pro-sheet');
  if (closeProBtn) {
    closeProBtn.addEventListener('click', () => {
      uiState.proSheetOpen = false;
      renderApp();
    });
  }
}

export async function initApp() {
  await loadDictionaries();
  appState = loadState();
  uiState.catchUp = computeCatchUpBanner(appState.leads, appState.settings, Date.now());
  appState = updateSettings(appState, { lastOpenedAt: Date.now() });
  uiState.screen = appState.settings.hasOnboarded ? 'today' : 'onboarding';
  // Web Share Target: Android shared a contact / profile link / text into the app.
  if (typeof window !== 'undefined' && hasSharePayload(window.location.search)) {
    const parsed = parseSharedPayload(readSharePayload(window.location.search));
    resetDraft();
    uiState.draftName = parsed.name;
    uiState.draftHandle = parsed.handle;
    uiState.draftSource = parsed.source;
    uiState.draftInterest = parsed.interest;
    if (!appState.settings.hasOnboarded) {
      appState = updateSettings(appState, { hasOnboarded: true });
    }
    uiState.screen = 'today';
    uiState.addSheetOpen = canAddActiveLead(appState);
    uiState.proSheetOpen = !uiState.addSheetOpen;
    if (uiState.addSheetOpen) showSnack(t(appState.settings.language, 'snack_share_prefilled'));
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch {
      /* ignore */
    }
  }
  renderApp();
  // Play Billing: only inside the Play-installed app. Entitlement follows the active subscription.
  try {
    uiState.billingAvailable = await isPlayBillingAvailable();
    if (uiState.billingAvailable) {
      const [prices, plan] = await Promise.all([getProPrices(), activeProPlan()]);
      uiState.proPrices = prices;
      const isPro = plan !== null;
      if (isPro !== Boolean(appState.settings.isPro)) {
        appState = updateSettings(appState, { isPro, proPlan: plan });
        renderApp();
      }
    }
  } catch {
    /* billing is optional */
  }
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register('./sw.js');
    } catch {
      swRegistration = null;
    }
  }
  // Reminders: in-app timer while open; Periodic Background Sync when installed (TWA / Chromium).
  try {
    uiState.notifyCap = await canNotify({ registration: swRegistration });
  } catch {
    uiState.notifyCap = null;
  }
  armReminders();
  if (uiState.screen === 'settings') renderApp();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    initApp().catch((err) => console.error('FollowUp Buddy init failed:', err));
  });
}
