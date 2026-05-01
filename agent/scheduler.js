/**
 * scheduler.js — Polls the cloud API for due jobs and dispatches Playwright checks
 *
 * Pull model: every POLL_INTERVAL_SECONDS, ask the cloud for monitors
 * assigned to this agent whose next_check_at <= NOW(). For each, run
 * checkSelector() and post the result back via reporter.js.
 *
 * Concurrency is limited to MAX_CONCURRENT_CHECKS to avoid overloading Chrome.
 */

const { CLOUD_API_URL, AGENT_SECRET, AGENT_ID, POLL_INTERVAL_SECONDS, MAX_CONCURRENT_CHECKS } = require("./config");
const { checkSelector } = require("./checker");
const { reportResult, reportError, sendHeartbeat } = require("./reporter");

let running = false;
let paused = false;
let pollTimer = null;
let activeJobCount = 0;

const AGENT_HEADERS = {
  "Content-Type": "application/json",
  "X-Agent-Secret": AGENT_SECRET,
  "X-Agent-ID": AGENT_ID,
};

/** Start the poll loop */
function start() {
  if (pollTimer) return;
  console.log(`[scheduler] Starting poll loop every ${POLL_INTERVAL_SECONDS}s`);
  _poll(); // immediate first run
  pollTimer = setInterval(_poll, POLL_INTERVAL_SECONDS * 1000);
}

/** Stop the poll loop */
function stop() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Pause job execution without stopping polling */
function pause() { paused = true;  console.log("[scheduler] Paused"); }
function resume() { paused = false; console.log("[scheduler] Resumed"); }
function isPaused() { return paused; }
function getActiveJobCount() { return activeJobCount; }

/** Run an immediate check for a specific monitor (called by mgmt API) */
async function runNow(monitorId) {
  const jobs = await fetchJobs();
  const monitor = jobs.find((j) => j.id === monitorId);
  if (!monitor) throw new Error(`Monitor ${monitorId} not found in current job list`);
  return _executeJob(monitor);
}

// ── Internals ──────────────────────────────────────────────────────────────

async function _poll() {
  if (running || paused) return;
  running = true;
  try {
    const jobs = await fetchJobs();
    if (jobs.length === 0) {
      await sendHeartbeat(0);
      return;
    }

    console.log(`[scheduler] ${jobs.length} job(s) due`);
    await sendHeartbeat(jobs.length);

    // Dispatch up to MAX_CONCURRENT_CHECKS in parallel
    const batches = chunk(jobs, MAX_CONCURRENT_CHECKS);
    for (const batch of batches) {
      await Promise.all(batch.map(_executeJob));
    }
  } catch (err) {
    console.error("[scheduler] Poll error:", err.message);
  } finally {
    running = false;
  }
}

async function fetchJobs() {
  try {
    const resp = await fetch(`${CLOUD_API_URL}/agent/jobs`, {
      headers: AGENT_HEADERS,
    });
    if (!resp.ok) {
      console.warn(`[scheduler] /agent/jobs returned ${resp.status}`);
      return [];
    }
    return await resp.json();
  } catch (err) {
    console.warn("[scheduler] Failed to fetch jobs:", err.message);
    return [];
  }
}

async function _executeJob(monitor) {
  activeJobCount++;
  console.log(`[scheduler] Checking monitor ${monitor.id}: "${monitor.label}"`);
  try {
    const value = await checkSelector(monitor);
    await reportResult(monitor.id, value);
    console.log(`[scheduler] ✓ Monitor ${monitor.id} → "${value.slice(0, 60)}"`);
  } catch (err) {
    console.error(`[scheduler] ✗ Monitor ${monitor.id} failed:`, err.message);
    await reportError(monitor.id, err.message);
  } finally {
    activeJobCount--;
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

module.exports = { start, stop, pause, resume, isPaused, getActiveJobCount, runNow };
