/**
 * index.js — Agent entry: heartbeat + poll loops
 */

const { createClient } = require("@supabase/supabase-js");
const config = require("./config");
const { pollOnce } = require("./poller");
const { upsertOnline, setOffline } = require("./heartbeat");

const sb = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let shuttingDown = false;

async function heartbeatLoop() {
  while (!shuttingDown) {
    try {
      await upsertOnline(sb, config.AGENT_ID);
    } catch (e) {
      console.error("[agent] heartbeat error:", e.message);
    }
    await sleep(config.HEARTBEAT_INTERVAL_MS);
  }
}

async function pollLoop() {
  while (!shuttingDown) {
    try {
      await pollOnce(sb, config.AGENT_ID);
    } catch (e) {
      console.error("[agent] poll error:", e.message);
    }
    await sleep(config.POLL_INTERVAL_MS);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`[agent] Starting agent_id=${config.AGENT_ID}`);
  await upsertOnline(sb, config.AGENT_ID);

  await Promise.all([heartbeatLoop(), pollLoop()]);
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[agent] Shutting down…");
  await setOffline(sb, config.AGENT_ID);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("[agent] Fatal:", err);
  process.exit(1);
});
