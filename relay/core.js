// ============================================================================
// Relay core — host-independent contact/lead handler.
// Contains ALL the logic; hosting platforms get thin adapters that just
// translate their request/response shapes (see netlify/functions/contact.js).
// Adding Vercel/Cloudflare/Express support later = new ~20-line adapter,
// no changes here.
//
// Env vars (set in the host's dashboard, never committed):
//   RESEND_API_KEY  — API key from resend.com (free tier is fine)
//   CONTACT_TO      — where leads are delivered (default below)
//   CONTACT_FROM    — verified sender, e.g. 'PLC Website <site@paullearningcenter.com>'
//                     (falls back to Resend's onboarding sender for testing)
// ============================================================================

const DEFAULT_TO = 'paullearningcenter@gmail.com';

/**
 * Handle a contact-form submission.
 * @param {object} payload  { name, email, message, company?, attribution? }
 * @param {object} env      environment variables
 * @returns {{ status: number, body: object }}
 */
export async function handleContact(payload, env) {
  const { name, email, message, company, attribution } = payload || {};

  // Honeypot: real users never fill the hidden "company" field.
  if (company) return { status: 200, body: { ok: true } };

  if (!name || !email || !message) {
    return { status: 400, body: { ok: false, error: 'Missing required fields.' } };
  }
  if (String(message).length > 5000 || String(name).length > 200) {
    return { status: 400, body: { ok: false, error: 'Message too long.' } };
  }

  if (!env.RESEND_API_KEY) {
    // Not configured yet — fail loudly so the client shows its email fallback.
    return { status: 503, body: { ok: false, error: 'Email delivery not configured.' } };
  }

  const attrLines = attribution
    ? [
        '',
        '--- Attribution ---',
        `Visitor ID: ${attribution.visitor_id || '-'}`,
        `First touch: ${JSON.stringify(attribution.first_touch || {})}`,
        `Last touch: ${JSON.stringify(attribution.last_touch || {})}`,
      ]
    : [];

  const text = [
    `Name: ${name}`,
    `Email: ${email}`,
    '',
    message,
    ...attrLines,
  ].join('\n');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.CONTACT_FROM || 'PLC Website <onboarding@resend.dev>',
      to: [env.CONTACT_TO || DEFAULT_TO],
      reply_to: email,
      subject: `Website inquiry from ${name}`,
      text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Resend error', res.status, detail);
    return { status: 502, body: { ok: false, error: 'Email delivery failed.' } };
  }
  return { status: 200, body: { ok: true } };
}
