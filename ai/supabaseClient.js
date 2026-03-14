const { createClient } = window.supabase || {};

const supabaseUrl =
  window.SUPABASE_URL ||
  window.__SUPABASE_URL ||
  "https://pbsbkzsmrfssyjzlfzfs.supabase.co";

const supabaseAnonKey =
  window.SUPABASE_ANON_KEY ||
  window.__SUPABASE_ANON_KEY ||
  "YOUR_SUPABASE_DEV_ANON_KEY";

const isValidHttpUrl = (value) => /^https?:\/\//i.test((value || "").toString().trim());
const isConfigured =
  typeof createClient === "function" &&
  isValidHttpUrl(supabaseUrl) &&
  supabaseAnonKey

if (!isConfigured) {
  console.error(
    "[supabase] Client not initialized. Set a real SUPABASE_URL and SUPABASE_ANON_KEY in ai/supabaseClient.js " +
    "or on window.SUPABASE_URL/window.SUPABASE_ANON_KEY before script.js."
  );
  window.supabaseClient = null;
} else {
  window.supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
}
