// Central site configuration — single source of truth for contact info,
// external URLs, and the current enrollment campaign.
export const site = {
  name: 'Paul Learning Center',
  url: 'https://paullearningcenter.com',
  email: 'paullearningcenter@gmail.com',
  // Phone from PLC's most recent public results flyer (2024-25 Sem 2).
  // An older flyer shows 510-570-0007 — confirm which is current.
  phone: '630-540-6049',
  address: '507 E Bernadette Terrace, Mountain House, CA',
  facebook: 'https://www.facebook.com/profile.php?id=100075888083406',
  facebookReviews: 'https://www.facebook.com/profile.php?id=100075888083406&sk=reviews',
  // Facebook Messenger deep link — opens a chat with the PLC page
  messenger: 'https://m.me/100075888083406',
  whatsapp: {
    // E.164 without '+'. Uses the phone from the latest public flyer —
    // TODO: CONFIRM this number is registered on WhatsApp (Business)
    // before launch; swap here if a different number is used.
    number: '16305406049',
    prefill: "Hi Paul Learning Center! I'd like to know about enrollment for School Session 2026-27.",
  },
  otute: {
    courses: 'https://otute.com/courses',
    login: 'https://otute.com/login',
  },
  session: {
    label: 'School Session 2026-27',
    landingPath: '/session-2026-27/',
    // TODO: fill real session dates when confirmed
  },
};

// WhatsApp click-to-chat URL with pre-filled text (wa.me supports ?text=,
// unlike Messenger). Pass custom text for page-specific prefills.
export function whatsappUrl(text) {
  return `https://wa.me/${site.whatsapp.number}?text=${encodeURIComponent(text || site.whatsapp.prefill)}`;
}
