/**
 * scheduler.js — node-cron job registry
 *
 * Manages per-monitor cron jobs keyed by monitor ID.
 * runCheck() performs the check → compare → history → alert pipeline.
 */

const cron = require("node-cron");
const { stmts } = require("./db");
const { checkSelector } = require("./checker");

/** @type {Map<number, import('node-cron').ScheduledTask>} */
const jobs = new Map();

/**
 * Convert interval in minutes to a cron expression.
 * Supports sub-minute (≤0) as every 30 seconds for testing.
 */
function intervalToCron(minutes) {
  if (minutes <= 0) return "*/30 * * * * *"; // every 30s (6-field cron)
  if (minutes === 1) return "* * * * *";
  if (minutes < 60) return `*/${minutes} * * * *`;

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return `${mins} */${hours} * * *`;

  return `${mins} 0 * * *`; // daily fallback
}

/**
 * Core check pipeline for a single monitor.
 */
async function runCheck(monitorId) {
  const monitor = stmts.getMonitor.get(monitorId);
  if (!monitor || !monitor.active) return;

  console.log(`[scheduler] Running check for monitor ${monitorId}: "${monitor.label}"`);

  try {
    const newValue = await checkSelector(monitor);

    // Write history
    stmts.insertHistory.run(monitorId, newValue, null);

    // Compare with last value
    const oldValue = monitor.last_value;
    if (oldValue !== null && oldValue !== newValue) {
      console.log(`[scheduler] Change detected on monitor ${monitorId}: "${oldValue}" → "${newValue}"`);
      stmts.insertAlert.run(monitorId, oldValue, newValue);
    }

    // Update current value
    stmts.updateMonitorValue.run(newValue, monitorId);

    return { value: newValue, changed: oldValue !== null && oldValue !== newValue };
  } catch (err) {
    console.error(`[scheduler] Check failed for monitor ${monitorId}:`, err.message);

    // Write error to history
    stmts.insertHistory.run(monitorId, null, err.message);

    // If timeout-like, flag for browser-assisted check
    if (
      err.message.includes("Timeout") ||
      err.message.includes("timeout") ||
      err.message.includes("net::ERR_") ||
      err.message.includes("Navigation failed")
    ) {
      console.log(`[scheduler] Flagging monitor ${monitorId} for browser-assisted check`);
      stmts.flagBrowserCheck.run(monitorId);
    }

    throw err;
  }
}

/**
 * Schedule a monitor for periodic checks.
 */
function scheduleMonitor(monitor) {
  // Remove existing job if any
  unscheduleMonitor(monitor.id);

  const cronExpr = intervalToCron(monitor.interval_minutes);
  console.log(`[scheduler] Scheduling monitor ${monitor.id} ("${monitor.label}") with cron: ${cronExpr}`);

  const task = cron.schedule(cronExpr, () => {
    runCheck(monitor.id).catch((err) => {
      console.error(`[scheduler] Cron check error for ${monitor.id}:`, err.message);
    });
  });

  jobs.set(monitor.id, task);
}

/**
 * Remove a monitor's scheduled job.
 */
function unscheduleMonitor(monitorId) {
  const existing = jobs.get(monitorId);
  if (existing) {
    existing.stop();
    jobs.delete(monitorId);
  }
}

/**
 * Load all active monitors and schedule them.
 * Called once at server startup.
 */
function loadAllSchedules() {
  const monitors = stmts.getAllMonitors.all();
  console.log(`[scheduler] Loading ${monitors.length} active monitor(s)`);
  for (const m of monitors) {
    scheduleMonitor(m);
  }
}

module.exports = { scheduleMonitor, unscheduleMonitor, loadAllSchedules, runCheck };
