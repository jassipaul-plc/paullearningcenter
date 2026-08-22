# Marketing & tracking setup

The site ships with a host-independent marketing kit
([public/js/marketing-kit.js](../public/js/marketing-kit.js)) configured per-project in
[public/js/marketing.config.js](../public/js/marketing.config.js). Everything is client-side —
no database; GA4 and Meta dashboards are the data store.

## 1. Create the accounts (one-time)

| Account | Where | What you need from it |
| --- | --- | --- |
| Google Tag Manager | tagmanager.google.com | Container ID `GTM-XXXXXXX` |
| Google Analytics 4 | analytics.google.com | Measurement ID `G-XXXXXXXXXX` (add as a GA4 tag inside GTM) |
| Google Ads | ads.google.com | Link it to GA4; import the `enroll_click` and `lead_complete` conversions |
| Meta Business Manager | business.facebook.com | Pixel ID (add as a tag inside GTM, or paste directly in the config) |

## 2. Paste the IDs

Edit `public/js/marketing.config.js`:

- **Preferred:** set `gtmId` only, and manage GA4 + Meta Pixel + Google Ads tags inside GTM.
- **Without GTM:** leave `gtmId` empty and set `ga4Id` / `metaPixelId` — the kit loads them directly.
- Empty string = integration off. The kit is safe to deploy with no IDs (it only captures attribution locally).

## 3. What the kit does automatically

- **Consent banner** (Google Consent Mode v2). `consent.mode` is `'opt-out'` (US default — tracking on until declined). Switch to `'opt-in'` for EEA-style behavior.
- **Attribution capture** on every visit: `utm_*`, `gclid`, `fbclid`, referrer, landing page, first + last touch, and an anonymous `visitor_id` — stored in `localStorage` under `mk_attribution`.
- **Outbound conversions**: any click on a link to `otute.com` fires `enroll_click` (with attribution attached) and decorates the URL with `utm_source`, `utm_medium`, `ref`, and `ref_vid`. The `ref_vid` is the future join key for Otute enrollment postbacks. Chat links are tracked the same way: `m.me` → `messenger_click`, `wa.me` → `whatsapp_click` (WhatsApp links open with a pre-filled message; the number lives in `src/data/site.js` — confirm it is WhatsApp-registered before launch).
- **Lead events**: the contact form fires `generate_lead` on submit; landing on `/thank-you/` fires `lead_complete`.

## 4. Mark the conversions in the ad platforms

- **Google Ads**: mark `enroll_click` and `lead_complete` (imported from GA4) as conversions.
- **Meta**: create Custom Conversions from the `enroll_click` and `lead_complete` custom events.
- Point ad campaigns at **`/session-2026-27/`** (message-matched landing page), with your UTM parameters, e.g. `?utm_source=facebook&utm_medium=paid&utm_campaign=session-2026-27`. Google/Meta append `gclid`/`fbclid` automatically.

## 5. Contact email (Netlify function)

The contact form posts to `/api/contact` → [netlify/functions/contact.js](../netlify/functions/contact.js),
a thin adapter over the portable [relay/core.js](../relay/core.js). Set these env vars in the
Netlify dashboard (Site settings → Environment variables):

- `RESEND_API_KEY` — from resend.com (free tier)
- `CONTACT_TO` — defaults to paullearningcenter@gmail.com
- `CONTACT_FROM` — a verified sender once the domain is verified in Resend; until then the Resend onboarding sender is used

Until `RESEND_API_KEY` is set the endpoint returns 503 and the form shows a direct-email fallback — nothing breaks.

## 6. Verify before spending ad money

1. GA4 → Admin → DebugView: browse the site, click an Otute link, submit the form; confirm `enroll_click`, `generate_lead`, `lead_complete` arrive.
2. Meta Events Manager → Test Events: same checks.
3. Google Tag Assistant (tagassistant.google.com): confirm the GTM container and Consent Mode fire correctly.
4. Click an Otute link and confirm the decorated URL contains `utm_source`, `ref`, and `ref_vid`.

## Reuse on other projects

Copy `public/js/marketing-kit.js` unchanged + write a new `marketing.config.js`
(different IDs, different `conversionDomains` — or an empty list). The relay core in
`relay/` is likewise portable; only the per-host adapter changes. The long-term plan to turn
this into a `/marketing-setup` Claude Code skill is tracked in
[marketing-skill-vision.md](marketing-skill-vision.md).
