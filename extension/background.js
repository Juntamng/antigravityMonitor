/**
 * background.js — Extension service worker
 *
 * Responsibilities:
 *   - Authentication: Google OAuth via Supabase, token management
 *   - Message bus bridging popup/content ↔ cloud API
 *   - Pending picked element in session storage
 *   - Alarm-driven periodic jobs:
 *       • poll-alerts  : fetch new alerts from cloud (every 30s)
 *       • ext-checks   : execute "extension" mode monitor checks using
 *                        the user's real Chrome session (every 60s)
 *       • agent-status : check local agent liveness (every 60s)
 */

// ── Config ────────────────────────────────────────────────                      
const CLOUD_API_URL = "https://antigravitymonitor.onrender.com";
const AGENT_LOCAL_URL = "http://127.0.0.1:3580";        // local agent management server

// ── Auth Token Management ─────────────────────────────────

async function getAuthToken() {
  const { authSession } = await chrome.storage.local.get("authSession");
  return authSession?.access_token || null;
}

async function getAuthHeaders() {
  const token = await getAuthToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function isLoggedIn() {
  return !!(await getAuthToken());
}

// ── Alarms Setup ──────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("poll-alerts", { periodInMinutes: 0.5 });
  chrome.alarms.create("ext-checks", { periodInMinutes: 1 });
  chrome.alarms.create("agent-status", { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("poll-alerts", { periodInMinutes: 0.5 });
  chrome.alarms.create("ext-checks", { periodInMinutes: 1 });
  chrome.alarms.create("agent-status", { periodInMinutes: 1 });
});

// ── Alarm Handler ─────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "poll-alerts") await handleAlertPolling();
  if (alarm.name === "ext-checks") await handleExtensionChecks();
  if (alarm.name === "agent-status") await checkAgentStatus();
});

// ── Extension-Mode Checks (login-gated pages) ─────────────

async function handleExtensionChecks() {
  if (!(await isLoggedIn())) return;
  try {
    const headers = await getAuthHeaders();
    const resp = await fetch(`${CLOUD_API_URL}/extension/jobs`, { headers });
    if (!resp.ok) return;
    const monitors = await resp.json();
    for (const monitor of monitors) {
      await executeExtensionCheck(monitor);
    }
  } catch (err) {
    console.log("[bg] Extension checks fetch failed:", err.message);
  }
}

async function executeExtensionCheck(monitor) {
  let tabId = null;
  try {
    // Open a hidden tab in the user's real Chrome session (carries login cookies)
    const tab = await chrome.tabs.create({ url: monitor.url, active: false });
    tabId = tab.id;

    // Wait for page load + SPA settle
    await new Promise((r) => setTimeout(r, 5000));

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector) => {
        const el = document.querySelector(selector);
        if (!el) return { error: "Element not found" };
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
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

    // Post result to cloud (same pipeline as agent)
    const headers = await getAuthHeaders();
    await fetch(`${CLOUD_API_URL}/extension/result/${monitor.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(result),
    });

    console.log(`[bg] Extension check completed for monitor ${monitor.id}`);
  } catch (err) {
    console.error(`[bg] Extension check failed for monitor ${monitor.id}:`, err.message);
    try {
      const headers = await getAuthHeaders();
      await fetch(`${CLOUD_API_URL}/extension/result/${monitor.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ error: err.message }),
      });
    } catch { /* cloud unreachable */ }
  } finally {
    if (tabId) chrome.tabs.remove(tabId).catch(() => { });
  }
}

// ── Local Agent Status ─────────────────────────────────────

async function checkAgentStatus() {
  try {
    const resp = await fetch(`${AGENT_LOCAL_URL}/status`, { signal: AbortSignal.timeout(2000) });
    const data = resp.ok ? await resp.json() : null;
    await chrome.storage.local.set({ agentStatus: data ? "online" : "offline" });
  } catch {
    await chrome.storage.local.set({ agentStatus: "offline" });
  }
}

// ── Alert Polling ─────────────────────────────────────────

async function handleAlertPolling() {
  if (!(await isLoggedIn())) return;
  try {
    const headers = await getAuthHeaders();
    const resp = await fetch(`${CLOUD_API_URL}/alerts/pending`, { headers });
    if (!resp.ok) return;
    const alerts = await resp.json();

    if (alerts.length === 0) return;

    const { unreadAlerts = [] } = await chrome.storage.local.get("unreadAlerts");
    const existingIds = new Set(unreadAlerts.map((a) => a.id));
    const newAlerts = alerts.filter((a) => !existingIds.has(a.id));

    if (newAlerts.length === 0) return;

    const merged = [...newAlerts, ...unreadAlerts].slice(0, 50);
    await chrome.storage.local.set({ unreadAlerts: merged });

    const count = merged.length;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });

    for (const alert of newAlerts) {
      chrome.notifications.create(`alert-${alert.id}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: `Change: ${alert.monitor_label}`,
        message: `"${truncate(alert.old_value)}" → "${truncate(alert.new_value)}"`,
      });

      try {
        const monResp = await fetch(`${CLOUD_API_URL}/monitors`, { headers });
        if (!monResp.ok) continue;
        const monitors = await monResp.json();
        const monitor = monitors.find((m) => m.id === alert.monitor_id);
        if (monitor) {
          const tabs = await chrome.tabs.query({});
          for (const tab of tabs) {
            if (tab.url && tab.id) {
              chrome.tabs.sendMessage(tab.id, {
                type: "SHOW_TOAST",
                payload: {
                  label: alert.monitor_label,
                  oldValue: alert.old_value,
                  newValue: alert.new_value,
                },
              }).catch(() => { });
            }
          }
        }
      } catch { /* best effort */ }

      try {
        await fetch(`${CLOUD_API_URL}/alerts/${alert.id}/ack`, { method: "POST", headers });
      } catch { /* will retry next poll */ }
    }
  } catch (err) {
    console.log("[bg] Alert polling failed:", err.message);
  }
}

function truncate(str, max = 50) {
  if (!str) return "(empty)";
  return str.length > max ? str.slice(0, max) + "…" : str;
}

// ── OAuth Callback Tab Interception ───────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url &&
    tab.url.startsWith(`${CLOUD_API_URL}/auth/callback`)
  ) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.title,
      });
      const title = results?.[0]?.result || "";
      if (title.startsWith("PAGE_MONITOR_AUTH:")) {
        const tokenData = JSON.parse(title.replace("PAGE_MONITOR_AUTH:", ""));
        if (tokenData.access_token) {
          await chrome.storage.local.set({ authSession: tokenData });
          console.log("[bg] Auth tokens stored successfully");
          chrome.tabs.remove(tabId).catch(() => { });
          chrome.action.setBadgeText({ text: "" });
          chrome.runtime.sendMessage({ type: "AUTH_STATE_CHANGED", loggedIn: true }).catch(() => { });
        }
      }
    } catch (err) {
      console.error("[bg] Failed to extract auth tokens:", err.message);
    }
  }
});

// ── Message Bus ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = messageHandlers[msg.type];
  if (handler) {
    handler(msg, sender)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

const messageHandlers = {
  // ── Auth ──────────────────────────────────────────────

  async SIGN_IN() {
    await chrome.tabs.create({ url: `${CLOUD_API_URL}/auth/google` });
    return { ok: true };
  },

  async SIGN_OUT() {
    await chrome.storage.local.remove("authSession");
    await chrome.storage.local.set({ unreadAlerts: [] });
    chrome.action.setBadgeText({ text: "" });
    return { ok: true };
  },

  async GET_AUTH_STATE() {
    const { authSession } = await chrome.storage.local.get("authSession");
    return { loggedIn: !!authSession?.access_token };
  },

  // ── Agent Status ──────────────────────────────────────

  async GET_AGENT_STATUS() {
    const { agentStatus = "unknown" } = await chrome.storage.local.get("agentStatus");
    return { status: agentStatus };
  },

  // ── Element picked from content script ────────────────

  async ELEMENT_PICKED(msg) {
    await chrome.storage.session.set({ pendingElement: msg.payload });
    chrome.action.setBadgeText({ text: "1" });
    chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
    return { ok: true };
  },

  async GET_PENDING_ELEMENT() {
    const { pendingElement = null } =
      await chrome.storage.session.get("pendingElement");
    return pendingElement;
  },

  async CLEAR_PENDING_ELEMENT() {
    await chrome.storage.session.remove("pendingElement");
    chrome.action.setBadgeText({ text: "" });
    return { ok: true };
  },

  async ACTIVATE_PICKER() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE_PICKER" });
    return { ok: true };
  },

  // ── Cloud API Proxies ────────────────────────────────

  async GET_HEALTH() {
    const resp = await fetch(`${CLOUD_API_URL}/health`);
    return resp.json();
  },

  async GET_MONITORS() {
    const headers = await getAuthHeaders();
    const resp = await fetch(`${CLOUD_API_URL}/monitors`, { headers });
    if (!resp.ok) throw new Error("Unauthorized");
    return resp.json();
  },

  async CREATE_MONITOR(msg) {
    const headers = await getAuthHeaders();
    const resp = await fetch(`${CLOUD_API_URL}/monitors`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(msg.payload),
    });
    if (!resp.ok) throw new Error("Failed to create monitor");
    return resp.json();
  },

  async DELETE_MONITOR(msg) {
    const headers = await getAuthHeaders();
    const resp = await fetch(`${CLOUD_API_URL}/monitors/${msg.payload.id}`, {
      method: "DELETE",
      headers,
    });
    return resp.json();
  },

  async GET_HISTORY(msg) {
    const headers = await getAuthHeaders();
    const resp = await fetch(`${CLOUD_API_URL}/monitors/${msg.payload.id}/history`, { headers });
    return resp.json();
  },

  async GET_UNREAD_ALERTS() {
    const { unreadAlerts = [] } =
      await chrome.storage.local.get("unreadAlerts");
    return unreadAlerts;
  },

  async DISMISS_ALERT(msg) {
    const { unreadAlerts = [] } =
      await chrome.storage.local.get("unreadAlerts");
    const filtered = unreadAlerts.filter((a) => a.id !== msg.payload.id);
    await chrome.storage.local.set({ unreadAlerts: filtered });
    chrome.action.setBadgeText({ text: filtered.length > 0 ? String(filtered.length) : "" });
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
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE_PICKER" });
  }
});
