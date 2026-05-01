/**
 * db.js — Supabase persistence layer (Cloud API)
 *
 * Uses service_role key — trusted server context, bypasses RLS.
 * All functions async, throw on error.
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "\n  ❌  Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env\n" +
    "     Copy your service_role key from:\n" +
    "     Supabase Dashboard → Project Settings → API → service_role\n"
  );
  process.exit(1);
}

// Admin client — service_role key, bypasses RLS, used for all DB operations
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// Auth client — anon key, used only for validating user JWTs via getUser()
const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

// ── Monitors ─────────────────────────────────────────────

async function getAllMonitors(userId) {
  const { data, error } = await supabase
    .from("monitors")
    .select(`*, last_checked:history(checked_at)`)
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return data.map((m) => {
    const checks = m.last_checked || [];
    const latest = checks.reduce((max, h) =>
      !max || h.checked_at > max ? h.checked_at : max, null);
    return { ...m, last_checked: latest };
  });
}

async function getMonitor(id) {
  const { data, error } = await supabase
    .from("monitors")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function createMonitor({
  userId, label, url, selector,
  interval_minutes = 5, last_value = null, execution_mode = "agent",
}) {
  const { data, error } = await supabase
    .from("monitors")
    .insert({
      user_id: userId,
      label,
      url,
      selector,
      interval_minutes,
      last_value,
      execution_mode,
      next_check_at: new Date().toISOString(),
      assigned_agent: "default",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteMonitor(id) {
  const { error } = await supabase
    .from("monitors")
    .update({ active: false })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

async function updateMonitorValue(id, value) {
  const { error } = await supabase
    .from("monitors")
    .update({ last_value: value })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Agent Job Queue ──────────────────────────────────────

/**
 * Returns monitors that the given agent should check right now.
 * Criteria: active, execution_mode='agent', assigned to this agent,
 * and next_check_at is in the past.
 */
async function getAgentJobs(agentId = "default") {
  const { data, error } = await supabase
    .from("monitors")
    .select("id, label, url, selector, interval_minutes")
    .eq("active", true)
    .eq("execution_mode", "agent")
    .eq("assigned_agent", agentId)
    .lte("next_check_at", new Date().toISOString());

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Returns monitors due for the extension to check (user-scoped, login-gated pages).
 */
async function getExtensionJobs(userId) {
  const { data, error } = await supabase
    .from("monitors")
    .select("id, label, url, selector, interval_minutes")
    .eq("active", true)
    .eq("user_id", userId)
    .eq("execution_mode", "extension")
    .lte("next_check_at", new Date().toISOString());

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Unified result handler for both agent and extension check results.
 * - Inserts history
 * - Detects change, inserts alert if changed
 * - Updates last_value and schedules next_check_at
 */
async function processCheckResult(monitorId, value, errorMsg) {
  const monitor = await getMonitor(monitorId);
  if (!monitor) throw new Error("Monitor not found");

  // Write history
  await insertHistory(monitorId, value ?? null, errorMsg ?? null);

  if (errorMsg) {
    // On error, retry again on the next normal interval
    await _scheduleNext(monitorId, monitor.interval_minutes);
    return { changed: false, error: errorMsg };
  }

  // Detect change
  const oldValue = monitor.last_value;
  const changed = oldValue !== null && oldValue !== value;

  if (changed) {
    console.log(`[db] Change detected on monitor ${monitorId}: "${oldValue}" → "${value}"`);
    await insertAlert(monitorId, oldValue, value);
  }

  // Update last_value and schedule next run
  await supabase
    .from("monitors")
    .update({
      last_value: value,
      next_check_at: _nextCheckAt(monitor.interval_minutes),
    })
    .eq("id", monitorId);

  return { changed, old_value: oldValue, new_value: value };
}

// ── Agent Registry ───────────────────────────────────────

async function upsertAgentHeartbeat({ agent_id, status, monitor_count }) {
  const { error } = await supabase
    .from("agent_registry")
    .upsert(
      {
        agent_id,
        status: status || "online",
        monitor_count: monitor_count || 0,
        last_seen: new Date().toISOString(),
      },
      { onConflict: "agent_id" }
    );
  if (error) throw new Error(error.message);
}

// ── History ──────────────────────────────────────────────

async function insertHistory(monitorId, value, errorMsg) {
  const { error } = await supabase
    .from("history")
    .insert({ monitor_id: monitorId, value, error: errorMsg });
  if (error) throw new Error(error.message);
}

async function getHistory(monitorId) {
  const { data, error } = await supabase
    .from("history")
    .select("*")
    .eq("monitor_id", monitorId)
    .order("checked_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data;
}

// ── Alerts ───────────────────────────────────────────────

async function insertAlert(monitorId, oldValue, newValue) {
  const { error } = await supabase
    .from("alerts")
    .insert({ monitor_id: monitorId, old_value: oldValue, new_value: newValue });
  if (error) throw new Error(error.message);
}

async function getPendingAlerts(userId) {
  const { data, error } = await supabase
    .from("alerts")
    .select(`*, monitors!inner(label, user_id)`)
    .eq("acked", false)
    .eq("monitors.user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return data.map((a) => ({
    ...a,
    monitor_label: a.monitors?.label,
    monitors: undefined,
  }));
}

async function ackAlert(id) {
  const { error } = await supabase
    .from("alerts")
    .update({ acked: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Auth helper ──────────────────────────────────────────

async function getUserFromToken(token) {
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data?.user) throw new Error("Invalid or expired token");
  return data.user;
}

// ── Internals ────────────────────────────────────────────

function _nextCheckAt(intervalMinutes) {
  const ms = (intervalMinutes || 5) * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

async function _scheduleNext(monitorId, intervalMinutes) {
  await supabase
    .from("monitors")
    .update({ next_check_at: _nextCheckAt(intervalMinutes) })
    .eq("id", monitorId);
}

module.exports = {
  supabase,
  // Monitors
  getAllMonitors,
  getMonitor,
  createMonitor,
  deleteMonitor,
  updateMonitorValue,
  // Job queues
  getAgentJobs,
  getExtensionJobs,
  processCheckResult,
  // Agent registry
  upsertAgentHeartbeat,
  // History
  insertHistory,
  getHistory,
  // Alerts
  insertAlert,
  getPendingAlerts,
  ackAlert,
  // Auth
  getUserFromToken,
};
