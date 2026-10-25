# FollowUp Buddy — Offline-First WhatsApp & Instagram Lead Tracker

**FollowUp Buddy** (`com.sakredstudio.followupbuddy`) is a 100% offline-first personal lead follow-up organizer built for Indian solo sellers (home bakers, saree & boutique sellers, tiffin services, coaches, freelancers) who close sales on WhatsApp and Instagram DMs.

Hard rule, every version: the app **never sends a message for you, never reads your chats, never automates WhatsApp or Instagram.** It opens the chat with your message pre-typed; you press Send.

Vanilla JS PWA, no build step, no dependencies, ES modules, `node --test`. Everything lives in `localStorage` key `fub.v1` (schema v2, migrated on load) plus IndexedDB for catalogue photos.

## Features

### v1
- **Today Screen**: Emerald hero card with today's follow-up count, Overdue & Upcoming (next 7 days) buckets, priority star (`★`) sorting, and missed-days catch-up banner.
- **Quick Add Lead**: Save a lead in under 10 seconds with 3-way Source segmented control (`WhatsApp / Instagram / Other`), 1-tap delay chips (`Tomorrow / 2d / 1w / 1m`), tags, and priority star.
- **Lead Detail & 1-Tap Deep Links**:
  - **WhatsApp**: Opens `https://wa.me/91XXXXXXXXXX?text=...` with a pre-filled follow-up message (80-char interest truncation + `— sent with FollowUp Buddy · https://sakredstudio.github.io/followup`).
  - **Instagram**: Copies the follow-up message to clipboard and opens `https://instagram.com/<handle>`.
  - **History Timeline**: `created`, `contacted`, `replied`, `rescheduled`, `status_change` and custom `note` events (`contacted` / `replied` / `note` touch `lastContactedAt`).
  - **Outcomes**: `Replied`, `No reply`, `Converted` (with optional ₹ order value), `Not interested`, `Lost`.
- **All Leads & Search**: Instant search across `name + handle + interest + tags`, status filters, source filters, Pro tag filter, Archived view.
- **Free vs Pro Tier**: Free: 50 active leads, 5 tags, 3 priority leads, 3 catalogue products, JSON backup/restore. Pro (Play subscription ₹149/mo or ₹999/yr): unlimited leads/tags/priority, CSV export, message templates, 10 products, cloud backup, team of two.
- **Three UI languages & themes**: English, Hindi (`hi`) and Hinglish (`hinglish`, Roman-script Hindi) dictionaries with a parity test; Light/Dark; Comfy/Compact.

### v2 — "close the loop"
- **Daily reminder (`lib/notify.js`)**: a 9 AM "N leads today" notification. Two honest modes, shown as-is in Settings:
  - *While the app is open* (any browser): `setTimeout` to the next reminder hour, Notification API.
  - *Even when closed* (installed from Google Play / installed Chromium PWA): [Periodic Background Sync](https://developer.mozilla.org/docs/Web/API/Web_Periodic_Background_Synchronization_API) tag `daily-digest` (min interval 12 h). The service worker cannot read `localStorage`, so `app.js` writes a tiny counts snapshot (`todayCount`, `overdueCount`, 5 first names, language, quiet hours) into the Cache API (`fub-digest`) after every change; `sw.js` builds the notification from that. The exact firing time is up to Android's scheduler, not a precise alarm — the Settings copy says so.
  - **Quiet hours** (default 21:00–09:00): neither mode fires inside them.
- **Pipeline view (`lib/pipeline.js`)**: All Leads → *Pipeline* segment shows swimlanes New → Contacted → Interested → Ordered → Lost (horizontal scroll inside the container; the page never scrolls sideways). `lead.stage` sits next to the v1 `status`; `migrate()` derives it for old data. Transitions: message opened → Contacted; Replied → Contacted/Interested; Converted → Ordered; Lost/Not interested → Lost; reopen → Contacted. Ordered/Lost never move on their own.
- **Stats (`lib/stats.js`)**: Today header 📈 or Settings → Stats. Order value this month and last (by `convertedAt`), best tags by orders, best source by conversion %, follow-ups done this week (contacted + replied since Monday). Computed from this phone's data only.
- **Message templates per tag (`lib/templates.js`, Pro)**: Settings → Message templates. Up to 3 templates with `{name} {firstName} {interest} {seller}`; assign one per tag; the lead's first tag with a template wins, else the default. Free tier sees the Pro sheet. The share line is always appended by `channels.js`; templates cannot remove it.
- **Quick-add from the share sheet (`lib/share-target.js`)**: `manifest.webmanifest` declares a GET `share_target` (`title`/`text`/`url`). Share an Instagram profile URL, `@handle`, `wa.me` link, a contact with a +91 number, labelled "Name: / Phone:" lines or plain text into the app → the Add Lead sheet opens prefilled with source auto-detected; the URL is cleaned with `history.replaceState`. Works once installed (TWA / Chromium PWA).
- **Snooze presets + festivals (`lib/snooze.js`, `lib/festivals.js`)**: Reschedule sheet adds *Tomorrow 9 AM*, *Monday*, *After Diwali* (Diwali table 2026–2028, 2 days after at 9 AM) and *Pick a date*.
- **Hinglish UI**: `i18n/hinglish.json` is a full third dictionary; Settings → Language gains *Hing*.

### v3 — "the shop around the lead"
- **Catalogue card (`lib/catalogue.js`, `lib/photos.js`)**: Settings → Catalogue: up to 3 products (free) / 10 (Pro) with name, ₹ price and a photo. Photos are resized on device to max 800 px and stored in IndexedDB `fub-photos`; `localStorage` only keeps the photo id. From a lead, *Send product card* → pick a product → the app draws a 1080×1350 PNG (photo, name, price, seller, share line) on a canvas and hands it to the Web Share sheet with files; if the browser cannot share files it downloads the PNG and opens `wa.me` with the product message (Instagram leads: message copied). A `contacted` event is logged.
- **Encrypted cloud backup + multi-device (`lib/cloud.js`, Pro)**: Settings → Cloud backup. The phone derives an AES-GCM-256 key with PBKDF2 (200 000 iterations, SHA-256) from your passphrase + random 16-byte salt, encrypts the whole backup JSON, and PUTs `{salt, iv, data, updatedAt}` (base64) to `CLOUD_URL + '/v1/vault/' + vaultId`. The 16-byte hex `vaultId` is the only identifier — no account, no email. *Create vault* shows the vault code; *Restore / join* on another phone needs code + passphrase. Auto-sync uploads 30 s after a change while the app is open; manual *Sync now*. Conflict rule: newer `updatedAt` wins, the app asks before merging a newer cloud copy into the phone. The derived key stays in `localStorage` on the phone so sync can run without re-asking; it is stripped from JSON exports and from the vault payload.
  - `CLOUD_URL` in `lib/cloud.js` is `''` by default → Settings shows **"Not available yet"** and nothing is sent. The server is a Cloudflare Worker in `../worker/` (`wrangler.toml` with D1 binding `DB`, `schema.sql`, `src/index.js`: PUT/GET/DELETE, 2 MB cap, CORS for `https://sakredstudio.github.io`, per-IP rate limit 30/min, 409 when an older copy is pushed). **Not deployed.** To switch it on: create the D1 database, run `schema.sql`, `npx wrangler deploy`, set `CLOUD_URL`, bump the SW cache.
- **Team of two (`lib/merge.js`, Pro)**: Settings → Team of two. Built on the vault: the assistant enters the same vault code + passphrase on their phone; both phones sync through it. Settings → *This phone's name* stamps every event with `by`; Today rows show "Last by <phone> · when" and the timeline shows the device per entry. Merge rule on sync: union of leads by id, newest `updatedAt` per lead wins; events unioned by id; tags by name; catalogue by id; local settings win (remote fills missing templates). No invite codes beyond the vault code — honest and simple.
- **Self digest on WhatsApp**: Settings → *Send me today's list on WhatsApp* opens `wa.me/<your own number>` with today's + overdue leads pre-typed. You tap Send (needs your number in Profile).
- **Festival reactivation**: during a festival window (Diwali: 30 days before → 2 days after; Raksha Bandhan: 10 days before → 1 after; wedding season Nov–Feb) Today shows a *Reactivate* card listing cold leads (no touch in 30+ days, not Lost / Not interested / archived; Converted customers included as re-order leads) with one tap *Reactivate N → tomorrow* (confirm, then every cold lead is rescheduled to tomorrow at your reminder hour). You still message each one yourself.

### Not built on purpose
WhatsApp Business API automation, reading chats, bulk messaging, ads, lead buying, accounts for the free tier, Marathi/Tamil packs (only if data asks), the Shagun bridge.

## Data model (localStorage `fub.v1`, schemaVersion 2)
- `leads[]`: `id, name, handle, source, interest, status (new|active|converted|not_interested|lost), stage (new|contacted|interested|ordered|lost), priority, tags[], createdAt, nextFollowUpAt, lastContactedAt, updatedAt, archived?, convertedAt?, convertedValue?`
- `events[]`: `id, leadId, at, kind (note|contacted|replied|status_change|follow_up_set), text, by?`
- `tags[]`, `catalogue[]` (`id, name, price, photoId, updatedAt`, max 10)
- `settings`: profile (`sellerName, sellerHandle, sellerBusiness, sellerPhone`), `language (en|hi|hinglish)`, reminders (`reminderEnabled, reminderHour, quietHours{start,end}`), `templates[]` (max 3), `tagTemplates{}`, `deviceName`, `cloud{vaultId, salt, keyB64, autoSync, lastSyncAt}`, `isPro`, theme/density.

## Running & Testing Locally
```bash
# Run unit & acceptance tests (Node 20+ built-in test runner; WebCrypto is used by the cloud tests)
node --test projects/followup-buddy/app/tests/*.test.mjs

# Serve static PWA
npx serve projects/followup-buddy/app
```

Tests: `tests/*.test.mjs` — one per pure module (`notify`, `pipeline`, `stats`, `templates`, `share-target`, `snooze` + festivals, `catalogue`, `cloud` + worker handler with a fake D1, `merge`, plus the v1 suites) and an acceptance test that checks every `sw.js` precache asset exists on disk and walks seed → pipeline → stats → template → share-target → catalogue card → digest → merge → vault.

## Deploy (GitHub Pages)

Live at https://sakredstudio.github.io/followup/. The public repo `SakredStudio/followup` is a deploy mirror of this folder; the monorepo is the source of truth. From the sakred-os root, on master:

```
git subtree push --prefix=projects/followup-buddy/app https://github.com/SakredStudio/followup.git main
```

The workflow in `.github/workflows/deploy.yml` runs the tests and publishes the folder. Bump `CACHE_NAME` in `sw.js` first (currently `followup-buddy-v3`) and keep every new file in `PRECACHE_ASSETS` (the acceptance test checks it).
