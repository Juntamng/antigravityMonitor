/**
 * Content script files injected when picker is activated on a tab without scripts.
 */
const CONTENT_SCRIPT_FILES = [
  "lib/utils.js",
  "lib/dom-extract.js",
  "lib/constants.js",
  "content/picker.js",
  "content/save-panel.js",
  "content/toast.js",
  "content.js",
];

const messageHandlers = {
  async ELEMENT_PICKED(msg, sender) {
    await chrome.storage.session.set({
      [PAGE_MONITOR_CONSTANTS.STORAGE.PENDING_ELEMENT]: msg.payload,
    });
    setPendingPick(true);
    if (sender?.tab?.id) {
      chrome.tabs
        .sendMessage(sender.tab.id, {
          type: PAGE_MONITOR_CONSTANTS.MSG.SHOW_SAVE_PANEL,
          payload: msg.payload,
        })
        .catch(() => {});
    }
    return { ok: true };
  },

  async CLEAR_PENDING_ELEMENT() {
    await chrome.storage.session.remove(
      PAGE_MONITOR_CONSTANTS.STORAGE.PENDING_ELEMENT
    );
    setPendingPick(false);
    return { ok: true };
  },

  async ACTIVATE_PICKER() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) {
      return { error: "No active tab found" };
    }
    const url = tab.url || "";
    if (
      url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("edge://") ||
      url.startsWith("about:")
    ) {
      return { error: "Picker is not available on this browser page" };
    }

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: PAGE_MONITOR_CONSTANTS.MSG.ACTIVATE_PICKER,
      });
      return { ok: true };
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: CONTENT_SCRIPT_FILES,
      });
      await chrome.tabs.sendMessage(tab.id, {
        type: PAGE_MONITOR_CONSTANTS.MSG.ACTIVATE_PICKER,
      });
      return { ok: true };
    }
  },

  async GET_AUTH_STATE() {
    const session = await getSession();
    if (!session?.access_token) {
      return { authenticated: false };
    }
    try {
      const refreshed = await refreshSessionIfNeeded();
      const s = refreshed || session;
      return {
        authenticated: true,
        email: s.user?.email || null,
        expires_at: s.expires_at || null,
      };
    } catch {
      await setSession(null);
      return { authenticated: false };
    }
  },

  async LOGOUT() {
    await setSession(null);
    await clearMonitorCache();
    setPendingPick(false);
    await syncAlertCountFromStorage();
    return { ok: true };
  },

  async REFRESH_SESSION() {
    const s = await refreshSessionIfNeeded();
    return { ok: true, expires_at: s?.expires_at };
  },

  async GOOGLE_LOGIN() {
    const session = await performGoogleLogin();
    return { ok: true, email: session.user?.email };
  },

  async GET_HEALTH() {
    const base = await getBackendUrl();
    const resp = await fetch(`${base}/health`);
    const json = await resp.json().catch(() => ({}));
    return { ...json, activeUrl: base };
  },

  async GET_MONITORS() {
    return getMonitorsCached();
  },

  async CREATE_MONITOR(msg) {
    const created = await apiFetch("/monitors", {
      method: "POST",
      body: JSON.stringify(msg.payload),
    });
    if (created?.id) {
      await upsertMonitorInCache(created);
    }
    return created;
  },

  async DELETE_MONITOR(msg) {
    const result = await apiFetch(`/monitors/${msg.payload.id}`, {
      method: "DELETE",
    });
    if (result?.ok) {
      await removeMonitorFromCache(msg.payload.id);
    }
    return result;
  },

  async CHECK_MONITOR(msg) {
    const monitor = msg.payload;
    if (!monitor?.id) {
      return { error: "Invalid monitor" };
    }
    return executeBrowserCheck(monitor, { historyOnly: true });
  },

  async GET_HISTORY(msg) {
    return apiFetch(`/monitors/${msg.payload.id}/history`);
  },

  async GET_UNREAD_ALERTS() {
    const key = PAGE_MONITOR_CONSTANTS.STORAGE.UNREAD_ALERTS;
    const { [key]: unreadAlerts = [] } = await chrome.storage.local.get(key);
    return unreadAlerts;
  },

  async DISMISS_ALERT(msg) {
    const key = PAGE_MONITOR_CONSTANTS.STORAGE.UNREAD_ALERTS;
    const { [key]: unreadAlerts = [] } = await chrome.storage.local.get(key);
    const filtered = unreadAlerts.filter(
      (a) => String(a.id) !== String(msg.payload.id)
    );
    await chrome.storage.local.set({ [key]: filtered });
    setAlertCount(filtered.length);
    return { ok: true };
  },

  async DISMISS_ALL_ALERTS() {
    const key = PAGE_MONITOR_CONSTANTS.STORAGE.UNREAD_ALERTS;
    await chrome.storage.local.set({ [key]: [] });
    setAlertCount(0);
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = messageHandlers[msg.type];
  if (handler) {
    handler(msg, sender)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});
