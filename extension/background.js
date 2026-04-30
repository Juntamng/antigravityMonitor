/**
 * background.js — Extension service worker
 *
 * Responsibilities:
 *   - Message bus bridging popup/content ↔ local service API
 *   - Pending picked element in session storage
 *   - Alarm-driven periodic jobs (browser checks, alert polling)
 *   - Browser-assisted fallback execution in hidden tabs
 */

const SERVICE_URL = "http://localhost:3579";

// ── Alarms Setup ──────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("browser-checks", { periodInMinutes: 1 });
  chrome.alarms.create("poll-alerts", { periodInMinutes: 0.5 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("browser-checks", { periodInMinutes: 1 });
  chrome.alarms.create("poll-alerts", { periodInMinutes: 0.5 });
});

// ── Alarm Handler ─────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "browser-checks") {
    await handleBrowserChecks();
  } else if (alarm.name === "poll-alerts") {
    await handleAlertPolling();
  }
});

// ── Browser-Assisted Checks ──────────────────────────────

async function handleBrowserChecks() {
  try {
    const resp = await fetch(`${SERVICE_URL}/monitors/pending-browser-checks`);
    const monitors = await resp.json();

    for (const monitor of monitors) {
      await executeBrowserCheck(monitor);
    }
  } catch (err) {
    console.log("[bg] Browser checks fetch failed:", err.message);
  }
}

async function executeBrowserCheck(monitor) {
  let tabId = null;
  try {
    // Open hidden tab
    const tab = await chrome.tabs.create({
      url: monitor.url,
      active: false,
    });
    tabId = tab.id;

    // Wait for page load + SPA settle
    await new Promise((r) => setTimeout(r, 5000));

    // Execute script to read selector value
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector) => {
        const el = document.querySelector(selector);
        if (!el) return { error: "Element not found" };
        if (
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT"
        ) {
          return { value: (el.value || "").trim() };
        }
        if (el.hasAttribute("content")) {
          return { value: (el.getAttribute("content") || "").trim() };
        }
        return { value: (el.innerText || "").trim() };
      },
      args: [monitor.selector],
    });

    const result = results?.[0]?.result || { error: "No result" };

    // Post result to service
    await fetch(`${SERVICE_URL}/monitors/${monitor.id}/browser-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });

    console.log(`[bg] Browser check completed for monitor ${monitor.id}`);
  } catch (err) {
    console.error(`[bg] Browser check failed for monitor ${monitor.id}:`, err.message);
    try {
      await fetch(`${SERVICE_URL}/monitors/${monitor.id}/browser-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: err.message }),
      });
    } catch {
      /* service unreachable */
    }
  } finally {
    if (tabId) {
      chrome.tabs.remove(tabId).catch(() => {});
    }
  }
}

// ── Alert Polling ─────────────────────────────────────────

async function handleAlertPolling() {
  try {
    const resp = await fetch(`${SERVICE_URL}/alerts/pending`);
    const alerts = await resp.json();

    if (alerts.length === 0) return;

    // Store unread alerts locally
    const { unreadAlerts = [] } = await chrome.storage.local.get("unreadAlerts");
    const existingIds = new Set(unreadAlerts.map((a) => a.id));
    const newAlerts = alerts.filter((a) => !existingIds.has(a.id));

    if (newAlerts.length === 0) return;

    const merged = [...newAlerts, ...unreadAlerts].slice(0, 50);
    await chrome.storage.local.set({ unreadAlerts: merged });

    // Update badge
    const count = merged.length;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });

    // Process each new alert
    for (const alert of newAlerts) {
      // OS notification
      chrome.notifications.create(`alert-${alert.id}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: `Change: ${alert.monitor_label}`,
        message: `"${truncate(alert.old_value)}" → "${truncate(alert.new_value)}"`,
      });

      // In-page toast on all matching tabs
      try {
        // Get the monitor to find its URL
        const monResp = await fetch(`${SERVICE_URL}/monitors`);
        const monitors = await monResp.json();
        const monitor = monitors.find((m) => m.id === alert.monitor_id);

        if (monitor) {
          const tabs = await chrome.tabs.query({});
          for (const tab of tabs) {
            if (tab.url && tab.id) {
              try {
                chrome.tabs.sendMessage(tab.id, {
                  type: "SHOW_TOAST",
                  payload: {
                    label: alert.monitor_label,
                    oldValue: alert.old_value,
                    newValue: alert.new_value,
                  },
                });
              } catch {
                /* tab may not have content script */
              }
            }
          }
        }
      } catch {
        /* best effort */
      }

      // Acknowledge alert
      try {
        await fetch(`${SERVICE_URL}/alerts/${alert.id}/ack`, {
          method: "POST",
        });
      } catch {
        /* will retry next poll */
      }
    }
  } catch (err) {
    console.log("[bg] Alert polling failed:", err.message);
  }
}

function truncate(str, max = 50) {
  if (!str) return "(empty)";
  return str.length > max ? str.slice(0, max) + "…" : str;
}

// ── Message Bus ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = messageHandlers[msg.type];
  if (handler) {
    handler(msg, sender)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // async response
  }
});

const messageHandlers = {
  // Element picked from content script
  async ELEMENT_PICKED(msg) {
    await chrome.storage.session.set({ pendingElement: msg.payload });
    // Open popup by focusing extension action
    // We need to use a workaround since we can't programmatically open popup
    // Store in session and badge to alert user
    chrome.action.setBadgeText({ text: "1" });
    chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
    return { ok: true };
  },

  // Popup: get pending element
  async GET_PENDING_ELEMENT() {
    const { pendingElement = null } = await chrome.storage.session.get("pendingElement");
    return pendingElement;
  },

  // Popup: clear pending element
  async CLEAR_PENDING_ELEMENT() {
    await chrome.storage.session.remove("pendingElement");
    chrome.action.setBadgeText({ text: "" });
    return { ok: true };
  },

  // Popup: activate picker on current tab
  async ACTIVATE_PICKER() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE_PICKER" });
    }
    return { ok: true };
  },

  // Service API proxies
  async GET_HEALTH() {
    const resp = await fetch(`${SERVICE_URL}/health`);
    return resp.json();
  },

  async GET_MONITORS() {
    const resp = await fetch(`${SERVICE_URL}/monitors`);
    return resp.json();
  },

  async CREATE_MONITOR(msg) {
    const resp = await fetch(`${SERVICE_URL}/monitors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload),
    });
    return resp.json();
  },

  async DELETE_MONITOR(msg) {
    const resp = await fetch(`${SERVICE_URL}/monitors/${msg.payload.id}`, {
      method: "DELETE",
    });
    return resp.json();
  },

  async CHECK_MONITOR(msg) {
    const resp = await fetch(`${SERVICE_URL}/monitors/${msg.payload.id}/check`, {
      method: "POST",
    });
    return resp.json();
  },

  async GET_HISTORY(msg) {
    const resp = await fetch(`${SERVICE_URL}/monitors/${msg.payload.id}/history`);
    return resp.json();
  },

  async GET_UNREAD_ALERTS() {
    const { unreadAlerts = [] } = await chrome.storage.local.get("unreadAlerts");
    return unreadAlerts;
  },

  async DISMISS_ALERT(msg) {
    const { unreadAlerts = [] } = await chrome.storage.local.get("unreadAlerts");
    const filtered = unreadAlerts.filter((a) => a.id !== msg.payload.id);
    await chrome.storage.local.set({ unreadAlerts: filtered });
    const count = filtered.length;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
    return { ok: true };
  },

  async DISMISS_ALL_ALERTS() {
    await chrome.storage.local.set({ unreadAlerts: [] });
    chrome.action.setBadgeText({ text: "" });
    return { ok: true };
  },
};

// ── Commands (keyboard shortcut) ──────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "activate-picker") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE_PICKER" });
    }
  }
});
