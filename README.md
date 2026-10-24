# FollowUp Buddy — Offline-First WhatsApp & Instagram Lead Tracker

**FollowUp Buddy** (`com.sakred.followup`) is a 100% offline-first personal lead follow-up organizer built for Indian solo sellers (home bakers, saree & boutique sellers, tiffin services, coaches, freelancers) who close sales on WhatsApp and Instagram DMs.

## Features
- **Today Screen**: Emerald hero card with today's follow-up count, Overdue & Upcoming (next 7 days) buckets, priority star (`★`) sorting, and missed-days catch-up banner.
- **Quick Add Lead**: Save a lead in under 10 seconds with 3-way Source segmented control (`WhatsApp / Instagram / Other`), 1-tap delay chips (`Tomorrow / 2d / 1w / 1m`), tags, and priority star.
- **Lead Detail & 1-Tap Deep Links**:
  - **WhatsApp**: Opens `https://wa.me/91XXXXXXXXXX?text=...` with a pre-filled follow-up message (80-char interest truncation + `— sent with FollowUp Buddy · https://sakred.in/followup`).
  - **Instagram**: Copies the follow-up message to clipboard and opens `https://instagram.com/<handle>`.
  - **History Timeline**: Tracks `created`, `contacted`, `rescheduled`, `status_change`, and custom `note` events (`trg_event_touch` updates `lastContactedAt` on `note`/`contacted`).
  - **Outcomes**: Mark leads as `Converted` (with optional ₹ order value), `Not interested`, or `Lost`.
- **All Leads & Search**: Instant search across `name + handle + interest + tags`, status filters (`All / Active / Converted / Not int. / Lost`), source filters (`Any / WhatsApp / Instagram`), Pro tag filter, and Archived view.
- **Free vs Pro Tier**:
  - Free: up to 50 active leads, 5 active tags, 3 priority leads, JSON backup/restore.
  - Pro (₹149/mo): unlimited active leads, unlimited tags & priority leads, CSV export.
- **Bilingual & Themeable**: Full English (`en`) and Hindi (`hi`) dictionaries, Light/Dark themes, and Comfy/Compact density modes.

## Running & Testing Locally
```bash
# Run unit & acceptance tests (Node 20+ built-in test runner)
node --test projects/followup-buddy/app/tests/*.test.mjs

# Serve static PWA
npx serve projects/followup-buddy/app
```
