// ============================================================================
// Marketing kit configuration — per-project settings.
// The kit itself (marketing-kit.js) is generic and reusable on any site.
//
// SETUP (see docs/MARKETING-SETUP.md for step-by-step instructions):
//   1. Create/locate the ad + analytics accounts and paste the IDs below.
//   2. Empty string = that integration stays OFF (safe default).
//   3. Prefer GTM: paste only gtmId and manage GA4/Meta/Ads inside GTM.
//      Without GTM, paste ga4Id / metaPixelId and the kit loads them directly.
// ============================================================================
window.MARKETING_CONFIG = {
  // --- Tag containers / pixels ------------------------------------------------
  gtmId: '',            // TODO: e.g. 'GTM-XXXXXXX'  (preferred, single container)
  ga4Id: '',            // TODO: e.g. 'G-XXXXXXXXXX' (used only if gtmId is empty)
  metaPixelId: '1541182933882320', // PLC Meta pixel (live) — used only if gtmId is empty

  // --- Consent ---------------------------------------------------------------
  consent: {
    // 'opt-out': tracking on by default, banner lets visitors decline (US default).
    // 'opt-in' : tracking off until the visitor accepts (EEA/UK style).
    mode: 'opt-out',
    banner: true,
    message:
      'We use cookies and similar technologies to understand how our site is used and to measure our advertising.',
    acceptLabel: 'OK',
    declineLabel: 'Decline',
    policyUrl: '/privacy/',
  },

  // --- Outbound conversion tracking ------------------------------------------
  // Clicks on links to these domains fire a conversion event and get the
  // decoration params appended. Works for any third-party destination —
  // or leave the list empty for projects without one.
  conversionDomains: [
    { domain: 'otute.com', event: 'enroll_click' },
    { domain: 'm.me', event: 'messenger_click' },
    { domain: 'wa.me', event: 'whatsapp_click' },
  ],
  decorate: {
    utm_source: 'paullearningcenter',
    utm_medium: 'referral',
    // 'ref' identifies this site to the destination; 'ref_vid' (added
    // automatically) is our anonymous visitor id — the future join key
    // for Otute enrollment postbacks.
    ref: 'plc-website',
  },

  // --- Lead / form tracking ---------------------------------------------------
  // Forms marked data-mk-lead fire 'generate_lead' on submit; landing on
  // thankYouPath fires 'lead_complete' (mark it as a conversion in Ads/Meta).
  thankYouPath: '/thank-you/',
};
