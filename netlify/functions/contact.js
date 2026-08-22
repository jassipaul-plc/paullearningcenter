// Netlify adapter for the host-independent relay core.
// Exposed at /api/contact via the redirect in netlify.toml.
import { handleContact } from '../../relay/core.js';

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ ok: false, error: 'Method not allowed.' }, { status: 405 });
  }
  let payload;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }
  const { status, body } = await handleContact(payload, process.env);
  return Response.json(body, { status });
};
