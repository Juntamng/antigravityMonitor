/**
 * Reusable pinned monitor tab lifecycle.
 */

const MONITOR_TAB_STORAGE_KEY =
  PAGE_MONITOR_CONSTANTS.STORAGE.REUSABLE_MONITOR_TAB_ID;
const IDLE_MONITOR_TAB_URL = chrome.runtime.getURL("monitor-tab.html");
let reusableMonitorTabId = null;
let monitorTabLock = Promise.resolve();

chrome.storage.session.get(MONITOR_TAB_STORAGE_KEY).then((stored) => {
  const id = stored?.[MONITOR_TAB_STORAGE_KEY];
  if (typeof id === "number") reusableMonitorTabId = id;
});

async function setReusableMonitorTabId(tabId) {
  reusableMonitorTabId = tabId ?? null;
  if (reusableMonitorTabId == null) {
    await chrome.storage.session.remove(MONITOR_TAB_STORAGE_KEY);
  } else {
    await chrome.storage.session.set({
      [MONITOR_TAB_STORAGE_KEY]: reusableMonitorTabId,
    });
  }
}

function isIdleMonitorTab(tab) {
  const url = tab.url || tab.pendingUrl || "";
  return url === IDLE_MONITOR_TAB_URL || url === "about:blank";
}

async function resolveReusableMonitorTabId() {
  const candidateIds = [];
  if (reusableMonitorTabId != null) candidateIds.push(reusableMonitorTabId);
  const stored = await chrome.storage.session.get(MONITOR_TAB_STORAGE_KEY);
  const storedId = stored?.[MONITOR_TAB_STORAGE_KEY];
  if (storedId != null && !candidateIds.includes(storedId)) {
    candidateIds.push(storedId);
  }

  for (const id of candidateIds) {
    try {
      const tab = await chrome.tabs.get(id);
      if (tab?.id) {
        await setReusableMonitorTabId(tab.id);
        return tab.id;
      }
    } catch {
      /* tab gone */
    }
  }

  const pinnedTabs = await chrome.tabs.query({ pinned: true });
  const idleTabs = pinnedTabs.filter(isIdleMonitorTab);
  if (idleTabs.length === 0) return null;

  idleTabs.sort((a, b) => a.id - b.id);
  const keep = idleTabs[0];
  for (let i = 1; i < idleTabs.length; i++) {
    try {
      await chrome.tabs.remove(idleTabs[i].id);
    } catch {
      /* already closed */
    }
  }
  await setReusableMonitorTabId(keep.id);
  return keep.id;
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let settled = false;
    function done() {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    }

    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === "complete") done();
    }

    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(done, timeoutMs);

    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab?.status === "complete") done();
      })
      .catch(done);
  });
}

function withMonitorTabLock(task) {
  const run = monitorTabLock.then(task, task);
  monitorTabLock = run.catch(() => {});
  return run;
}

async function getOrCreateReusableMonitorTab(url) {
  const existingId = await resolveReusableMonitorTabId();
  if (existingId) {
    try {
      await chrome.tabs.update(existingId, {
        url,
        active: false,
        pinned: true,
      });
      await chrome.tabs.move(existingId, { index: 0 });
      await setReusableMonitorTabId(existingId);
      return existingId;
    } catch {
      await setReusableMonitorTabId(null);
    }
  }

  const tab = await chrome.tabs.create({
    url,
    active: false,
    pinned: true,
    index: 0,
  });
  await setReusableMonitorTabId(tab.id || null);
  return reusableMonitorTabId;
}

async function resetReusableMonitorTabToBlank(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.update(tabId, {
      url: IDLE_MONITOR_TAB_URL,
      active: false,
      pinned: true,
    });
    await chrome.tabs.move(tabId, { index: 0 });
    await setReusableMonitorTabId(tabId);
  } catch {
    if (tabId === reusableMonitorTabId) {
      await setReusableMonitorTabId(null);
    }
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === reusableMonitorTabId) {
    void setReusableMonitorTabId(null);
  }
});
