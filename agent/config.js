require("dotenv").config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AGENT_ID = process.env.AGENT_ID || "default-agent";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 30_000;
const HEARTBEAT_INTERVAL_MS =
  Number(process.env.HEARTBEAT_INTERVAL_MS) || 30_000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[config] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy .env.example to .env"
  );
  process.exit(1);
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  AGENT_ID,
  POLL_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
};
