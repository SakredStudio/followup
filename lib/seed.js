// Pure ES module porting the 14 Indian sample leads & 15 tags from design/data.js (no DOM)

import { DAY_MS } from './format.js';

export const SEED_TAGS = [
  'Cakes', 'Sarees', 'T-shirts', 'Tiffin', 'Hampers',
  'Bridal', 'Kurtas', 'High value', 'Corporate', 'B2B',
  'Repeat', 'Eggless', 'Jain', 'Vegan', 'Custom'
];

export const PROTOTYPE_ANCHOR_MS = new Date('2026-05-27T10:30:00+05:30').getTime();

/**
 * Build the 14 sample Indian leads and their history events anchored around `anchorNowMs`.
 * @param {number|Date} [anchorNowMs]
 */
export function buildSeedDataset(anchorNowMs = Date.now()) {
  const baseMs = anchorNowMs instanceof Date ? anchorNowMs.getTime() : Number(anchorNowMs);
  const days = (n) => baseMs + n * DAY_MS;

  const rawLeads = [
    {
      id: 'lead_1', name: 'Priya Sharma', handle: '@priya.bakes_indore',
      source: 'instagram', status: 'active', priority: true,
      interest: "Red velvet 1kg for sister's bday. Wants eggless. Budget around ₹1200.",
      tags: ['Cakes', 'High value', 'Eggless'],
      createdAt: days(-4), nextFollowUpAt: days(0), lastContactedAt: days(-2),
      history: [
        { at: days(-4), kind: 'note', text: 'First DM: asked for red velvet 1kg menu' },
        { at: days(-2), kind: 'contacted', text: 'You sent menu + price. She said "decide karke batati hu"' },
        { at: days(0), kind: 'follow_up_set', text: 'Follow-up due today' }
      ]
    },
    {
      id: 'lead_2', name: 'Rohit Verma', handle: '+91 98765 43210',
      source: 'whatsapp', status: 'active', priority: false,
      interest: 'Weekly tiffin plan for office. Wants Jain food, no onion garlic.',
      tags: ['Tiffin', 'Jain'],
      createdAt: days(-3), nextFollowUpAt: days(0), lastContactedAt: days(-1),
      history: [
        { at: days(-3), kind: 'note', text: 'WA: asked for weekly tiffin rates' },
        { at: days(-1), kind: 'contacted', text: 'Sent menu PDF, awaiting confirmation' }
      ]
    },
    {
      id: 'lead_3', name: 'Sneha Iyer', handle: '+91 88665 41122',
      source: 'whatsapp', status: 'active', priority: true,
      interest: 'Diwali corporate hampers — 25 pieces for her company. Decision by Friday.',
      tags: ['Hampers', 'High value', 'Corporate'],
      createdAt: days(-6), nextFollowUpAt: days(-1), lastContactedAt: days(-3),
      history: [
        { at: days(-6), kind: 'note', text: "Referral from Anita ma'am. Asked for hamper catalogue" },
        { at: days(-3), kind: 'contacted', text: 'Sent 3 hamper options (₹800 / ₹1500 / ₹2500)' }
      ]
    },
    {
      id: 'lead_4', name: 'Aisha Khan', handle: '@aisha_styles.nag',
      source: 'instagram', status: 'active', priority: false,
      interest: 'Pink-green organza saree set seen in Reel. Asked if you ship to Nagpur.',
      tags: ['Sarees'],
      createdAt: days(-5), nextFollowUpAt: days(-2), lastContactedAt: days(-4),
      history: [
        { at: days(-5), kind: 'note', text: 'IG DM after Reel. Sent shipping rates' },
        { at: days(-4), kind: 'contacted', text: 'Confirmed shipping. Asked for COD option' }
      ]
    },
    {
      id: 'lead_5', name: 'Manoj Patil', handle: '+91 90220 17788',
      source: 'whatsapp', status: 'active', priority: false,
      interest: 'Bole "salary mil gayi to order karunga" — pineapple cake 500g.',
      tags: ['Cakes'],
      createdAt: days(-7), nextFollowUpAt: days(0), lastContactedAt: days(-7),
      history: [
        { at: days(-7), kind: 'note', text: 'Asked pineapple cake price' },
        { at: days(-7), kind: 'contacted', text: 'You quoted ₹450. He said wait for salary' }
      ]
    },
    {
      id: 'lead_6', name: 'Karan Mehta', handle: '@karan.fits',
      source: 'instagram', status: 'active', priority: false,
      interest: 'Asked size chart for printed tee. Wants L size in black + olive.',
      tags: ['T-shirts'],
      createdAt: days(-2), nextFollowUpAt: days(2), lastContactedAt: days(-1),
      history: [
        { at: days(-2), kind: 'note', text: 'IG: asked size chart' },
        { at: days(-1), kind: 'contacted', text: 'Sent chart, waiting on size confirmation' }
      ]
    },
    {
      id: 'lead_7', name: 'Divya Reddy', handle: '@divya.glowup',
      source: 'instagram', status: 'active', priority: false,
      interest: 'Bridal makeup trial — wedding on 12 Dec. Wants quote + portfolio.',
      tags: ['Bridal', 'High value'],
      createdAt: days(-1), nextFollowUpAt: days(3), lastContactedAt: days(-1),
      history: [
        { at: days(-1), kind: 'contacted', text: 'IG DM after Reel. Sent rates + portfolio link' }
      ]
    },
    {
      id: 'lead_8', name: 'Anita Joshi', handle: '+91 70123 99882',
      source: 'whatsapp', status: 'converted', priority: false,
      interest: "Booked 2kg chocolate truffle for son's bday — picked up Sat.",
      tags: ['Cakes', 'Repeat'],
      createdAt: days(-15), nextFollowUpAt: null, lastContactedAt: days(-3),
      convertedAt: days(-3), convertedValue: 1400,
      history: [
        { at: days(-15), kind: 'note', text: 'WA inquiry — chocolate truffle' },
        { at: days(-10), kind: 'contacted', text: 'Confirmed order ₹1400' },
        { at: days(-3), kind: 'status_change', text: 'Picked up — happy customer, said will reorder' }
      ]
    },
    {
      id: 'lead_9', name: 'Faisal Ahmed', handle: '@faisal.kicks',
      source: 'instagram', status: 'not_interested', priority: false,
      interest: 'Asked tee price, said "thoda expensive hai bhai". No reply since.',
      tags: ['T-shirts'],
      createdAt: days(-12), nextFollowUpAt: null, lastContactedAt: days(-10),
      history: [
        { at: days(-12), kind: 'note', text: 'IG DM — asked price' },
        { at: days(-10), kind: 'status_change', text: 'Said too expensive, ghosted' }
      ]
    },
    {
      id: 'lead_10', name: 'Kavita Nair', handle: '+91 80456 11223',
      source: 'whatsapp', status: 'active', priority: false,
      interest: 'Asked for vegan brownie samples. Owns a café in Kothrud.',
      tags: ['Cakes', 'B2B', 'Vegan'],
      createdAt: days(-3), nextFollowUpAt: days(1), lastContactedAt: days(-2),
      history: [
        { at: days(-3), kind: 'note', text: 'Asked vegan brownie wholesale rates' },
        { at: days(-2), kind: 'contacted', text: 'Sent rate card. Awaiting sample order' }
      ]
    },
    {
      id: 'lead_11', name: 'Vikram Singh', handle: '+91 99887 22115',
      source: 'whatsapp', status: 'active', priority: true,
      interest: 'Anniversary cake — heart shape, ₹2000 budget. Date: 5 June.',
      tags: ['Cakes', 'High value'],
      createdAt: days(-1), nextFollowUpAt: days(0), lastContactedAt: days(0),
      history: [
        { at: days(-1), kind: 'note', text: 'WA: anniversary cake inquiry' },
        { at: days(0), kind: 'contacted', text: 'Sent 3 design options this morning' }
      ]
    },
    {
      id: 'lead_12', name: 'Pooja Desai', handle: '@pooja.thesarees',
      source: 'instagram', status: 'active', priority: false,
      interest: 'Wants navy blue Banarasi for engagement. Will visit if available in Surat.',
      tags: ['Sarees', 'High value'],
      createdAt: days(-9), nextFollowUpAt: days(7), lastContactedAt: days(-5),
      history: [
        { at: days(-9), kind: 'note', text: 'IG DM after story' },
        { at: days(-5), kind: 'contacted', text: "Sent 4 options. She's thinking" }
      ]
    },
    {
      id: 'lead_13', name: 'Imran Sheikh', handle: '+91 98888 12340',
      source: 'whatsapp', status: 'lost', priority: false,
      interest: 'Wanted tiffin but order taken by competitor.',
      tags: ['Tiffin'],
      createdAt: days(-20), nextFollowUpAt: null, lastContactedAt: days(-14),
      history: [
        { at: days(-20), kind: 'note', text: 'WA inquiry' },
        { at: days(-14), kind: 'status_change', text: 'Bole "bhabhi ne paas wale se book kar liya"' }
      ]
    },
    {
      id: 'lead_14', name: 'Riya Kapoor', handle: '@riyakap_official',
      source: 'instagram', status: 'active', priority: false,
      interest: 'Asked for custom embroidered kurta. Sent measurements.',
      tags: ['Kurtas', 'Custom'],
      createdAt: days(0), nextFollowUpAt: days(5), lastContactedAt: days(0),
      history: [
        { at: days(0), kind: 'note', text: 'New lead — IG DM with measurements' }
      ]
    }
  ];

  const leads = [];
  const events = [];

  for (const item of rawLeads) {
    const { history, ...leadFields } = item;
    leads.push(leadFields);
    history.forEach((h, idx) => {
      events.push({
        id: `evt_${item.id}_${idx + 1}`,
        leadId: item.id,
        at: h.at,
        kind: h.kind,
        text: h.text
      });
    });
  }

  const tags = SEED_TAGS.map((name, i) => ({
    id: `tag_${i + 1}`,
    name
  }));

  return { leads, events, tags };
}
