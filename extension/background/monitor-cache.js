/**
 * Stale-while-revalidate cache for monitor list (chrome.storage.local).
 */

const MONITOR_CACHE_TTL_MS = 60_000;

let monitorCacheRefreshPromise = null;

async function getMonitorCacheUserId() {
  const session = await getSession();
  return session?.user?.id || null;
}

async function readMonitorCache() {
  const userId = await getMonitorCacheUserId();
  if (!userId) return null;

  const key = PAGE_MONITOR_CONSTANTS.STORAGE.CACHED_MONITORS;
  const { [key]: entry } = await chrome.storage.local.get(key);
  if (!entry || entry.userId !== userId || !Array.isArray(entry.monitors)) {
    return null;
  }
  return entry;
}

async function writeMonitorCache(monitors) {
  const userId = await getMonitorCacheUserId();
  if (!userId) return;

  const key = PAGE_MONITOR_CONSTANTS.STORAGE.CACHED_MONITORS;
  await chrome.storage.local.set({
    [key]: {
      userId,
      monitors,
      cachedAt: Date.now(),
    },
  });
  notifyMonitorsUpdated(monitors);
}

async function clearMonitorCache() {
  await chrome.storage.local.remove(
    PAGE_MONITOR_CONSTANTS.STORAGE.CACHED_MONITORS
  );
}

function notifyMonitorsUpdated(monitors) {
  chrome.runtime
    .sendMessage({
      type: PAGE_MONITOR_CONSTANTS.MSG.MONITORS_UPDATED,
      payload: monitors,
    })
    .catch(() => {});
}

async function fetchAndCacheMonitors() {
  const monitors = await apiFetch("/monitors");
  const list = Array.isArray(monitors) ? monitors : [];
  await writeMonitorCache(list);
  return list;
}

async function refreshMonitorsCache(force = false) {
  const entry = await readMonitorCache();
  const stale =
    !entry || Date.now() - entry.cachedAt > MONITOR_CACHE_TTL_MS;
  if (!force && !stale) return entry.monitors;

  if (monitorCacheRefreshPromise) return monitorCacheRefreshPromise;

  monitorCacheRefreshPromise = fetchAndCacheMonitors()
    .catch((err) => {
      if (err.message !== "Not authenticated") {
        console.log("[bg] Monitor cache refresh failed:", err.message);
      }
      throw err;
    })
    .finally(() => {
      monitorCacheRefreshPromise = null;
    });

  return monitorCacheRefreshPromise;
}

async function getMonitorsCached() {
  const entry = await readMonitorCache();
  if (entry) {
    if (Date.now() - entry.cachedAt > MONITOR_CACHE_TTL_MS) {
      refreshMonitorsCache(true).catch(() => {});
    }
    return entry.monitors;
  }
  return fetchAndCacheMonitors();
}

async function upsertMonitorInCache(monitor) {
  if (!monitor?.id) return;
  const entry = await readMonitorCache();
  const monitors = entry ? [...entry.monitors] : [];
  const idx = monitors.findIndex((m) => String(m.id) === String(monitor.id));
  if (idx >= 0) {
    monitors[idx] = { ...monitors[idx], ...monitor };
  } else {
    monitors.unshift(monitor);
  }
  await writeMonitorCache(monitors);
}

async function removeMonitorFromCache(monitorId) {
  const entry = await readMonitorCache();
  if (!entry) return;
  const monitors = entry.monitors.filter(
    (m) => String(m.id) !== String(monitorId)
  );
  await writeMonitorCache(monitors);
}

async function patchMonitorInCache(monitorId, patch) {
  const entry = await readMonitorCache();
  if (!entry) return;
  const monitors = entry.monitors.map((m) =>
    String(m.id) === String(monitorId) ? { ...m, ...patch } : m
  );
  await writeMonitorCache(monitors);
}
