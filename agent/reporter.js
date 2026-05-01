/**
 * reporter.js — Posts check results back to the Cloud API
 *
 * Retries up to 3 times with exponential backoff on transient failures.
 * The cloud API handles change detection, history, and alerts.
 */

const { CLOUD_API_URL, AGENT_SECRET, AGENT_ID } = require("./config");

const AGENT_HEADERS = {
  "Content-Type": "application/json",
  "X-Agent-Secret": AGENT_SECRET,
  "X-Agent-ID": AGENT_ID,
};

/**
 * Post a successful check result to the cloud.
 *
 * @param {number} monitorId
 * @param {string} value
 */
async function reportResult(monitorId, value) {
  await postWithRetry(`${CLOUD_API_URL}/agent/result/${monitorId}`, {
    value,
    checked_at: new Date().toISOString(),
    agent_id: AGENT_ID,
  });
}

/**
 * Post a check error to the cloud.
 *
 * @param {number} monitorId
 * @param {string} errorMessage
 */
async function reportError(monitorId, errorMessage) {
  await postWithRetry(`${CLOUD_API_URL}/agent/result/${monitorId}`, {
    error: errorMessage,
    checked_at: new Date().toISOString(),
    agent_id: AGENT_ID,
  });
}

/**
 * Send a heartbeat so the cloud knows this agent is alive.
 *
 * @param {number} monitorCount  How many jobs this agent currently holds
 */
async function sendHeartbeat(monitorCount = 0) {
  try {
    const resp = await fetch(`${CLOUD_API_URL}/agent/heartbeat`, {
      method: "POST",
      headers: AGENT_HEADERS,
      body: JSON.stringify({
        agent_id: AGENT_ID,
        status: "online",
        monitor_count: monitorCount,
      }),
    });
    if (!resp.ok) {
      console.warn(`[reporter] Heartbeat returned ${resp.status}`);
    }
  } catch (err) {
    console.warn("[reporter] Heartbeat failed:", err.message);
  }
}

// ── Internals ──────────────────────────────────────────

async function postWithRetry(url, body, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: AGENT_HEADERS,
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      }
      return await resp.json();
    } catch (err) {
      lastErr = err;
      const backoff = 1000 * Math.pow(2, i); // 1s, 2s, 4s
      console.warn(`[reporter] POST failed (attempt ${i + 1}), retrying in ${backoff}ms:`, err.message);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { reportResult, reportError, sendHeartbeat };
