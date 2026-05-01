/**
 * supabase.js — Supabase client factory
 *
 * supabaseAdmin: service role, bypasses RLS (agent routes + auth.getUser).
 * supabaseForUser(jwt): per-request client with user JWT for RLS-scoped queries.
 */

require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !serviceKey) {
  console.warn(
    "[supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — set them in .env"
  );
}

const supabaseAdmin =
  url && serviceKey
    ? createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

/**
 * @param {string} accessToken User's Supabase access_token (JWT)
 */
function supabaseForUser(accessToken) {
  if (!url || !anonKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }
  return createClient(url, anonKey, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

module.exports = { supabaseAdmin, supabaseForUser };
