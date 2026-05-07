/**
 * poller.js — Fetch due monitors, optimistic lock, run checker, report
 */

const { checkSelector, BotChallengeError } = require("./checker");
const { reportSuccess, reportError, reportBotEscalation } = require("./reporter");
const { DEBUG } = require("./config");

function dbg(...args) {
  if (DEBUG) console.log("[debug]", ...args);
}

function addMinutesIso(iso, minutes) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + Number(minutes) || 5);
  return d.toISOString();
}

/**
 * Claim monitor by bumping next_check_at (prevents double-processing).
 * @returns {boolean} whether this agent won the claim
 */
async function claimMonitor(sb, monitor) {
  const now = new Date().toISOString();
  const bumped = addMinutesIso(now, monitor.interval_minutes);

  const { data, error } = await sb
    .from("monitors")
    .update({ next_check_at: bumped })
    .eq("id", monitor.id)
    .eq("assigned_agent", monitor.assigned_agent)
    .lte("next_check_at", now)
    .select("id");

  if (error) {
    console.error("[poller] claim failed:", error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

async function fetchDueMonitors(sb, agentId) {
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("monitors")
    .select("*")
    .eq("assigned_agent", agentId)
    .eq("active", true)
    .eq("execution_mode", "agent")
    .lte("next_check_at", now);

  if (error) throw error;
  const monitors = data || [];
  dbg(`fetchDueMonitors agentId=${agentId} due=${monitors.length}`, monitors.map((m) => m.url));
  return monitors;
}

async function processMonitor(sb, monitor) {
  const claimed = await claimMonitor(sb, monitor);
  if (!claimed) return;

  dbg(`processing monitor id=${monitor.id} url=${monitor.url}`);

  try {
    const value = await checkSelector(monitor);
    await reportSuccess(sb, monitor, value);
    console.log(`[poller] OK monitor ${monitor.id} value=${value.slice(0, 80)}…`);
  } catch (err) {
    if (err instanceof BotChallengeError) {
      console.error(`[poller] BOT monitor ${monitor.id}:`, err.message);
      await reportBotEscalation(sb, monitor, err.message);
      return;
    }
    console.error(`[poller] FAIL monitor ${monitor.id}:`, err.message);
    await reportError(sb, monitor, err.message);
  }
}

async function pollOnce(sb, agentId) {
  const due = await fetchDueMonitors(sb, agentId);
  for (const m of due) {
    await processMonitor(sb, m);
  }
}

module.exports = { pollOnce };
