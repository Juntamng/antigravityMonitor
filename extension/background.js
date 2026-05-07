/**
 * background.js — Extension service worker (MV3)
 *
 * Auth session in chrome.storage.local, JWT on all backend calls,
 * Supabase token refresh alarm, browser-assisted checks, alert polling.
 */

importScripts("config.js");

const C = self.PAGE_MONITOR_CONFIG;

function normalizeBackendUrl(url) {
  return String(url || "").replace(/\/$/, "");
}

async function getBackendUrl() {
  const raw =
    C.BACKEND_URL_HOSTED ||
    C.BACKEND_URL ||
    C.Backend_URL ||
    "http://127.0.0.1:3579";
  return normalizeBackendUrl(raw);
}

// ── Session / API ─────────────────────────────────────────

async function getSession() {
  const { session } = await chrome.storage.local.get("session");
  return session || null;
}

async function setSession(session) {
  if (session) {
    await chrome.storage.local.set({ session });
  } else {
    await chrome.storage.local.remove("session");
  }
}

async function apiFetch(path, options = {}) {
  const session = await getSession();
  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": options.body ? "application/json" : undefined,
  };
  const base = await getBackendUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const resp = await fetch(url, { ...options, headers });
  const text = await resp.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text || resp.statusText };
  }
  if (!resp.ok) {
    const err = new Error(json.error || resp.statusText || "Request failed");
    err.status = resp.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function supabaseAuthFetch(path, body, extraHeaders = {}) {
  const headers = {
    apikey: C.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${C.SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  const resp = await fetch(`${C.SUPABASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg =
      json.error_description ||
      json.msg ||
      json.message ||
      json.error ||
      resp.statusText;
    throw new Error(msg || "Auth request failed");
  }
  return json;
}

function sessionFromAuthResponse(data) {
  let expires_at;
  if (data.expires_at != null) {
    const raw = Number(data.expires_at);
    expires_at = raw > 1e12 ? raw : raw * 1000;
  } else {
    expires_at = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at,
    user: data.user || null,
  };
}

async function refreshSessionIfNeeded() {
  const session = await getSession();
  if (!session?.refresh_token) return null;
  const now = Date.now();
  if (session.expires_at && session.expires_at > now + 60_000) {
    return session;
  }
  const data = await supabaseAuthFetch(
    "/auth/v1/token?grant_type=refresh_token",
    { refresh_token: session.refresh_token }
  );
  const next = sessionFromAuthResponse(data);
  await setSession(next);
  return next;
}

// ── Alarms ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("browser-checks", { periodInMinutes: 1 });
  chrome.alarms.create("extension-checks", { periodInMinutes: 1 });
  chrome.alarms.create("poll-alerts", { periodInMinutes: 0.5 });
  chrome.alarms.create("session-refresh", { periodInMinutes: 45 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("browser-checks", { periodInMinutes: 1 });
  chrome.alarms.create("extension-checks", { periodInMinutes: 1 });
  chrome.alarms.create("poll-alerts", { periodInMinutes: 0.5 });
  chrome.alarms.create("session-refresh", { periodInMinutes: 45 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "browser-checks") {
    await handleBrowserChecks();
  } else if (alarm.name === "extension-checks") {
    await handleScheduledExtensionChecks();
  } else if (alarm.name === "poll-alerts") {
    await handleAlertPolling();
  } else if (alarm.name === "session-refresh") {
    try {
      await refreshSessionIfNeeded();
    } catch (e) {
      console.warn("[bg] Session refresh failed:", e.message);
    }
  }
});

// ── Browser-Assisted Checks ──────────────────────────────

async function handleBrowserChecks() {
  try {
    await refreshSessionIfNeeded();
    const monitors = await apiFetch("/monitors/pending-browser-checks");
    for (const monitor of monitors) {
      await executeBrowserCheck(monitor);
    }
  } catch (err) {
    if (err.message === "Not authenticated") return;
    console.log("[bg] Browser checks fetch failed:", err.message);
  }
}

async function handleScheduledExtensionChecks() {
  try {
    await refreshSessionIfNeeded();
    const monitors = await apiFetch("/monitors/due-extension-checks");
    for (const monitor of monitors) {
      await executeBrowserCheck(monitor);
    }
  } catch (err) {
    if (err.message === "Not authenticated") return;
    console.log("[bg] Extension checks fetch failed:", err.message);
  }
}

/**
 * Resolves once the given tab reaches status "complete", or after timeoutMs.
 * Registers the onUpdated listener before checking current state to avoid
 * the race where the tab completes between creation and listener registration.
 */
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

    // Safety-net: timer resolves if the tab never fires "complete"
    const timer = setTimeout(done, timeoutMs);

    // Check whether the tab is already complete (handles fast loads)
    chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === "complete") done();
    }).catch(done);
  });
}

async function executeBrowserCheck(monitor) {
  let tabId = null;
  let checkResult = null;
  try {
    const tab = await chrome.tabs.create({
      url: monitor.url,
      active: false,
    });
    tabId = tab.id;

    // Wait for the tab's document to finish loading before injecting.
    // A flat sleep is unreliable: sites like Home Depot render prices
    // asynchronously via JS after the initial HTML has arrived.
    await waitForTabComplete(tabId, 30000);

    // Inject a polling function so dynamically-injected content (e.g. a price
    // written to the DOM by React after an API call) is captured correctly.
    // chrome.scripting.executeScript awaits a returned Promise in MV3.
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector) => {
        const POLL_MS = 500;
        const TIMEOUT_MS = 25000;

        return new Promise((resolve) => {
          const deadline = Date.now() + TIMEOUT_MS;

          function attempt() {
            const el = document.querySelector(selector);
            if (el) {
              let value;
              if (
                el.tagName === "INPUT" ||
                el.tagName === "TEXTAREA" ||
                el.tagName === "SELECT"
              ) {
                value = (el.value || "").trim();
              } else if (el.hasAttribute("content")) {
                value = (el.getAttribute("content") || "").trim();
              } else {
                value = (el.innerText || "").trim();
              }
              // Only resolve when the element actually has content —
              // an empty string means the price hasn't been injected yet.
              if (value.length > 0) {
                return resolve({ value });
              }
            }

            if (Date.now() >= deadline) {
              const msg = el
                ? "Element found but still empty after timeout"
                : "Element not found after timeout";
              return resolve({ error: msg });
            }

            setTimeout(attempt, POLL_MS);
          }

          attempt();
        });
      },
      args: [monitor.selector],
    });

    const result = results?.[0]?.result || { error: "No result" };

    checkResult = await apiFetch(`/monitors/${monitor.id}/browser-result`, {
      method: "POST",
      body: JSON.stringify(result),
    });

    console.log(`[bg] Browser check completed for monitor ${monitor.id}`);
  } catch (err) {
    console.error(
      `[bg] Browser check failed for monitor ${monitor.id}:`,
      err.message
    );
    try {
      checkResult = await apiFetch(`/monitors/${monitor.id}/browser-result`, {
        method: "POST",
        body: JSON.stringify({ error: err.message }),
      });
    } catch (resultErr) {
      checkResult = { error: resultErr.message || err.message };
    }
  } finally {
    if (tabId) {
      chrome.tabs.remove(tabId).catch(() => {});
    }
  }
  return checkResult || { ok: true };
}

// ── Alert Polling ─────────────────────────────────────────

async function handleAlertPolling() {
  try {
    await refreshSessionIfNeeded();
    const alerts = await apiFetch("/alerts/pending");

    if (!alerts.length) return;

    const { unreadAlerts = [] } =
      await chrome.storage.local.get("unreadAlerts");
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
        const monitors = await apiFetch("/monitors");
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
                /* no content script */
              }
            }
          }
        }
      } catch {
        /* best effort */
      }

      try {
        await apiFetch(`/alerts/${alert.id}/ack`, { method: "POST" });
      } catch {
        /* retry next poll */
      }
    }
  } catch (err) {
    if (err.message === "Not authenticated") return;
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
    return true;
  }
});

const messageHandlers = {
  async ELEMENT_PICKED(msg, sender) {
    await chrome.storage.session.set({ pendingElement: msg.payload });
    chrome.action.setBadgeText({ text: "1" });
    chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
    if (sender?.tab?.id) {
      chrome.tabs
        .sendMessage(sender.tab.id, {
          type: "SHOW_SAVE_PANEL",
          payload: msg.payload,
        })
        .catch(() => {});
    }
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

  async CLOSE_SAVE_PANEL_ACTIVE_TAB() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) return { ok: true };
    await chrome.tabs
      .sendMessage(tab.id, {
        type: "CLOSE_SAVE_PANEL",
      })
      .catch(() => {});
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
      await chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE_PICKER" });
      return { ok: true };
    } catch {
      // Content script might not be present yet (e.g. after extension reload); inject and retry.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE_PICKER" });
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
    chrome.action.setBadgeText({ text: "" });
    return { ok: true };
  },

  async REFRESH_SESSION() {
    const s = await refreshSessionIfNeeded();
    return { ok: true, expires_at: s?.expires_at };
  },

  async GOOGLE_LOGIN() {
    const redirectUri = chrome.identity.getRedirectURL();
    const params = new URLSearchParams({
      provider: "google",
      redirect_to: redirectUri,
    });
    const authUrl = `${C.SUPABASE_URL}/auth/v1/authorize?${params.toString()}&apikey=${encodeURIComponent(
      C.SUPABASE_ANON_KEY
    )}`;

    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    });

    const url = new URL(responseUrl);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    const access_token = hashParams.get("access_token");
    const refresh_token = hashParams.get("refresh_token");
    if (!access_token || !refresh_token) {
      throw new Error(
        "Google login did not return tokens (check Supabase redirect allowlist)"
      );
    }

    const session = sessionFromAuthResponse({
      access_token,
      refresh_token,
      expires_in: hashParams.get("expires_in"),
      expires_at: hashParams.get("expires_at"),
      user: null,
    });

    const userResp = await fetch(`${C.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: C.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${access_token}`,
      },
    });
    const userJson = await userResp.json().catch(() => ({}));
    if (userResp.ok && userJson) {
      session.user = userJson;
    }

    await setSession(session);
    return { ok: true, email: session.user?.email };
  },

  async GET_HEALTH() {
    const base = await getBackendUrl();
    const resp = await fetch(`${base}/health`);
    const json = await resp.json().catch(() => ({}));
    return { ...json, activeUrl: base };
  },

  async GET_MONITORS() {
    return apiFetch("/monitors");
  },

  async CREATE_MONITOR(msg) {
    return apiFetch("/monitors", {
      method: "POST",
      body: JSON.stringify(msg.payload),
    });
  },

  async DELETE_MONITOR(msg) {
    return apiFetch(`/monitors/${msg.payload.id}`, { method: "DELETE" });
  },

  async CHECK_MONITOR(msg) {
    const monitor = msg.payload;
    if (!monitor?.id) {
      return { error: "Invalid monitor" };
    }

    // Extension monitors run immediately in a real tab for instant feedback.
    if (monitor.execution_mode === "extension") {
      return executeBrowserCheck(monitor);
    }

    return apiFetch(`/monitors/${monitor.id}/check`, { method: "POST" });
  },

  async GET_HISTORY(msg) {
    return apiFetch(`/monitors/${msg.payload.id}/history`);
  },

  async GET_UNREAD_ALERTS() {
    const { unreadAlerts = [] } =
      await chrome.storage.local.get("unreadAlerts");
    return unreadAlerts;
  },

  async DISMISS_ALERT(msg) {
    const { unreadAlerts = [] } =
      await chrome.storage.local.get("unreadAlerts");
    const filtered = unreadAlerts.filter(
      (a) => String(a.id) !== String(msg.payload.id)
    );
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

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "activate-picker") {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE_PICKER" });
    }
  }
});
