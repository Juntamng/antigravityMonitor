/**
 * db.js — Supabase persistence layer
 *
 * Replaces node:sqlite with @supabase/supabase-js.
 * Uses the service_role key so the backend can access all rows
 * regardless of RLS policies (trusted server context).
 *
 * All functions are async and return data directly or throw on error.
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "\n  ❌  Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env\n" +
    "     Copy your service_role key from:\n" +
    "     Supabase Dashboard → Project Settings → API → service_role\n"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Monitors ─────────────────────────────────────────────

async function getAllMonitors(userId) {
  const { data, error } = await supabase
    .from("monitors")
    .select(`
      *,
      last_checked:history(checked_at)
    `)
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  // Flatten last_checked to a single timestamp
  return data.map((m) => {
    const checks = m.last_checked || [];
    const latest = checks.reduce((max, h) => {
      return !max || h.checked_at > max ? h.checked_at : max;
    }, null);
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

async function createMonitor({ userId, label, url, selector, interval_minutes = 5, last_value = null }) {
  const { data, error } = await supabase
    .from("monitors")
    .insert({
      user_id: userId,
      label,
      url,
      selector,
      interval_minutes,
      last_value,
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

async function flagBrowserCheck(id) {
  const { error } = await supabase
    .from("monitors")
    .update({ pending_browser_check: true })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

async function clearBrowserCheck(id) {
  const { error } = await supabase
    .from("monitors")
    .update({ pending_browser_check: false })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

async function getPendingBrowserChecks() {
  const { data, error } = await supabase
    .from("monitors")
    .select("id, label, url, selector")
    .eq("active", true)
    .eq("pending_browser_check", true);

  if (error) throw new Error(error.message);
  return data;
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
    .select(`
      *,
      monitors!inner(label, user_id)
    `)
    .eq("acked", false)
    .eq("monitors.user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  // Flatten monitor_label for API compatibility
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

/**
 * Verify a JWT and return the user object, or throw.
 */
async function getUserFromToken(token) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw new Error("Invalid or expired token");
  return data.user;
}

module.exports = {
  supabase,
  // Monitors
  getAllMonitors,
  getMonitor,
  createMonitor,
  deleteMonitor,
  updateMonitorValue,
  flagBrowserCheck,
  clearBrowserCheck,
  getPendingBrowserChecks,
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
