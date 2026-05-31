/**
 * Optimistic UX for manual "Check Now": immediate history, alerts, dedupe with backend poll.
 */

const CLIENT_TRANSITION_TTL_MS = 60 * 60 * 1000;
const MAX_CLIENT_TRANSITIONS = 100;

function alertTransitionKey(monitorId, oldValue, newValue) {
  return `${monitorId}|${oldValue ?? ""}|${newValue ?? ""}`;
}

async function readClientAlertedTransitions() {
  const key = PAGE_MONITOR_CONSTANTS.STORAGE.CLIENT_ALERTED_TRANSITIONS;
  const { [key]: rows = [] } = await chrome.storage.local.get(key);
  return Array.isArray(rows) ? rows : [];
}

async function recordClientAlertedTransition(monitorId, oldValue, newValue) {
  const key = PAGE_MONITOR_CONSTANTS.STORAGE.CLIENT_ALERTED_TRANSITIONS;
  const now = Date.now();
  const entry = {
    monitor_id: monitorId,
    old_value: oldValue,
    new_value: newValue,
    at: now,
  };
  const pruned = (await readClientAlertedTransitions()).filter(
    (t) => now - t.at < CLIENT_TRANSITION_TTL_MS
  );
  pruned.unshift(entry);
  await chrome.storage.local.set({
    [key]: pruned.slice(0, MAX_CLIENT_TRANSITIONS),
  });
}

async function isAlertTransitionSuppressed(alert) {
  const key = alertTransitionKey(
    alert.monitor_id,
    alert.old_value,
    alert.new_value
  );
  const now = Date.now();
  const rows = await readClientAlertedTransitions();
  return rows.some(
    (t) =>
      now - t.at < CLIENT_TRANSITION_TTL_MS &&
      alertTransitionKey(t.monitor_id, t.old_value, t.new_value) === key
  );
}

function notifyAlertsUpdated() {
  chrome.runtime
    .sendMessage({ type: PAGE_MONITOR_CONSTANTS.MSG.ALERTS_UPDATED })
    .catch(() => {});
}

function notifyHistoryUpdated(monitorId) {
  chrome.runtime
    .sendMessage({
      type: PAGE_MONITOR_CONSTANTS.MSG.HISTORY_UPDATED,
      payload: { monitorId },
    })
    .catch(() => {});
}

async function readOptimisticHistory() {
  const key = PAGE_MONITOR_CONSTANTS.STORAGE.OPTIMISTIC_HISTORY;
  const { [key]: byMonitor = {} } = await chrome.storage.session.get(key);
  return byMonitor && typeof byMonitor === "object" ? byMonitor : {};
}

async function prependOptimisticHistory(monitorId, entry) {
  const key = PAGE_MONITOR_CONSTANTS.STORAGE.OPTIMISTIC_HISTORY;
  const byMonitor = await readOptimisticHistory();
  const list = Array.isArray(byMonitor[monitorId]) ? byMonitor[monitorId] : [];
  byMonitor[monitorId] = [entry, ...list].slice(0, 20);
  await chrome.storage.session.set({ [key]: byMonitor });
}

async function clearOptimisticHistory(monitorId) {
  const key = PAGE_MONITOR_CONSTANTS.STORAGE.OPTIMISTIC_HISTORY;
  const byMonitor = await readOptimisticHistory();
  if (!byMonitor[monitorId]) return;
  delete byMonitor[monitorId];
  await chrome.storage.session.set({ [key]: byMonitor });
}

async function mergeHistoryWithOptimistic(monitorId, backendHistory) {
  const backend = Array.isArray(backendHistory) ? backendHistory : [];
  const byMonitor = await readOptimisticHistory();
  const pending = byMonitor[monitorId];
  if (!pending?.length) return backend;

  const merged = [...pending, ...backend];
  const seen = new Set();
  return merged.filter((row) => {
    const k = `${row.checked_at}|${row.error ?? ""}|${row.value ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function pushUnreadClientAlert(monitor, oldValue, newValue) {
  const key = PAGE_MONITOR_CONSTANTS.STORAGE.UNREAD_ALERTS;
  const alert = {
    id: `client-${monitor.id}-${Date.now()}`,
    monitor_id: monitor.id,
    monitor_label: monitor.label || "Monitor",
    old_value: oldValue,
    new_value: newValue,
    created_at: new Date().toISOString(),
    client: true,
  };

  const { [key]: unreadAlerts = [] } = await chrome.storage.local.get(key);
  const merged = [alert, ...unreadAlerts].slice(0, 50);
  await chrome.storage.local.set({ [key]: merged });
  setAlertCount(merged.length);
  notifyAlertsUpdated();

  await recordClientAlertedTransition(monitor.id, oldValue, newValue);

  chrome.notifications.create(`alert-${alert.id}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `Change: ${alert.monitor_label}`,
    message: `"${PAGE_MONITOR_UTILS.truncate(oldValue)}" → "${PAGE_MONITOR_UTILS.truncate(newValue)}"`,
  });

  try {
    const tabs = await chrome.tabs.query({});
    const shown = await showAlertToast(monitor, alert, tabs);
    if (!shown) {
      await broadcastAlertToast(alert, tabs);
    }
  } catch {
    /* best effort */
  }

  return alert;
}

/**
 * Apply cache/history/alert updates immediately after scrape (before backend returns).
 */
async function applyOptimisticManualCheck(monitor, scrapeResult) {
  const checkedAt = new Date().toISOString();
  const oldValue = monitor.last_value ?? null;
  const hasError = Boolean(scrapeResult?.error);
  const newValue = hasError ? null : scrapeResult?.value ?? null;

  const historyEntry = {
    id: `opt-${monitor.id}-${Date.now()}`,
    monitor_id: monitor.id,
    value: newValue,
    error: scrapeResult?.error ?? null,
    checked_at: checkedAt,
    optimistic: true,
  };

  await prependOptimisticHistory(monitor.id, historyEntry);
  notifyHistoryUpdated(monitor.id);

  const patch = { last_checked: checkedAt };
  if (!hasError && newValue != null) {
    patch.last_value = newValue;
  }
  await patchMonitorInCache(monitor.id, patch);

  const changed =
    !hasError &&
    oldValue !== null &&
    newValue !== null &&
    oldValue !== newValue;

  let alerted = false;
  if (changed) {
    await pushUnreadClientAlert(monitor, oldValue, newValue);
    alerted = true;
  }

  const entry = await readMonitorCache();
  const updated =
    entry?.monitors?.find((m) => String(m.id) === String(monitor.id)) ||
    { ...monitor, ...patch };

  return {
    value: newValue,
    error: scrapeResult?.error,
    changed,
    alerted,
    monitor: updated,
    historyEntry,
  };
}

async function persistManualCheckResult(monitor, scrapeResult) {
  const resultPath = `/monitors/${monitor.id}/manual-check-result`;
  try {
    await apiFetch(resultPath, {
      method: "POST",
      body: JSON.stringify(scrapeResult),
    });
    await clearOptimisticHistory(monitor.id);
    notifyHistoryUpdated(monitor.id);
  } catch (err) {
    console.log(
      `[bg] Manual check persist failed for monitor ${monitor.id}:`,
      err.message
    );
    throw err;
  }
}
