/**
 * background.js — Extension service worker (MV3)
 *
 * Auth session in chrome.storage.local, JWT on all backend calls,
 * Supabase token refresh alarm, browser-assisted checks, alert polling.
 */

importScripts("config.js");

const C = self.PAGE_MONITOR_CONFIG;
const STORAGE_BACKEND_KEY = "pageMonitorBackendTarget";

function normalizeBackendUrl(url) {
  return String(url || "").replace(/\/$/, "");
}

async function getBackendTarget() {
  const stored = await chrome.storage.local.get(STORAGE_BACKEND_KEY);
  const t = stored[STORAGE_BACKEND_KEY];
  return t === "local" ? "local" : "hosted";
}

async function getBackendUrl() {
  const target = await getBackendTarget();
  const hosted = C.BACKEND_URL_HOSTED || C.BACKEND_URL;
  const raw =
    target === "local"
      ? C.BACKEND_URL_LOCAL || "http://127.0.0.1:3579"
      : hosted || "http://127.0.0.1:3579";
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
    const msg = json.error_description || json.msg || json.message || json.error || resp.statusText;
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
  chrome.alarms.create("poll-alerts", { periodInMinutes: 0.5 });
  chrome.alarms.create("session-refresh", { periodInMinutes: 45 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("browser-checks", { periodInMinutes: 1 });
  chrome.alarms.create("poll-alerts", { periodInMinutes: 0.5 });
  chrome.alarms.create("session-refresh", { periodInMinutes: 45 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "browser-checks") {
    await handleBrowserChecks();
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

async function executeBrowserCheck(monitor) {
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({
      url: monitor.url,
      active: false,
    });
    tabId = tab.id;

    await new Promise((r) => setTimeout(r, 5000));

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

    await apiFetch(`/monitors/${monitor.id}/browser-result`, {
      method: "POST",
      body: JSON.stringify(result),
    });

    console.log(`[bg] Browser check completed for monitor ${monitor.id}`);
  } catch (err) {
    console.error(`[bg] Browser check failed for monitor ${monitor.id}:`, err.message);
    try {
      await apiFetch(`/monitors/${monitor.id}/browser-result`, {
        method: "POST",
        body: JSON.stringify({ error: err.message }),
      });
    } catch {
      /* unreachable */
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
    await refreshSessionIfNeeded();
    const alerts = await apiFetch("/alerts/pending");

    if (!alerts.length) return;

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
  async ELEMENT_PICKED(msg) {
    await chrome.storage.session.set({ pendingElement: msg.payload });
    chrome.action.setBadgeText({ text: "1" });
    chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
    return { ok: true };
  },

  async GET_PENDING_ELEMENT() {
    const { pendingElement = null } = await chrome.storage.session.get("pendingElement");
    return pendingElement;
  },

  async CLEAR_PENDING_ELEMENT() {
    await chrome.storage.session.remove("pendingElement");
    chrome.action.setBadgeText({ text: "" });
    return { ok: true };
  },

  async ACTIVATE_PICKER() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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

  async LOGIN(msg) {
    const { email, password } = msg.payload || {};
    const data = await supabaseAuthFetch("/auth/v1/token?grant_type=password", {
      email,
      password,
    });
    const session = sessionFromAuthResponse(data);
    await setSession(session);
    return { ok: true, email: session.user?.email };
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
      throw new Error("Google login did not return tokens (check Supabase redirect allowlist)");
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

  async GET_BACKEND_OPTIONS() {
    const target = await getBackendTarget();
    const hosted = normalizeBackendUrl(C.BACKEND_URL_HOSTED || C.BACKEND_URL);
    const local = normalizeBackendUrl(C.BACKEND_URL_LOCAL || "http://127.0.0.1:3579");
    return {
      target,
      urls: { hosted, local },
      activeUrl: await getBackendUrl(),
    };
  },

  async SET_BACKEND_TARGET(msg) {
    const t = msg.payload?.target;
    if (t !== "local" && t !== "hosted") {
      throw new Error("Invalid backend target");
    }
    await chrome.storage.local.set({ [STORAGE_BACKEND_KEY]: t });
    return { ok: true, target: t, activeUrl: await getBackendUrl() };
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
    return apiFetch(`/monitors/${msg.payload.id}/check`, { method: "POST" });
  },

  async GET_HISTORY(msg) {
    return apiFetch(`/monitors/${msg.payload.id}/history`);
  },

  async GET_UNREAD_ALERTS() {
    const { unreadAlerts = [] } = await chrome.storage.local.get("unreadAlerts");
    return unreadAlerts;
  },

  async DISMISS_ALERT(msg) {
    const { unreadAlerts = [] } = await chrome.storage.local.get("unreadAlerts");
    const filtered = unreadAlerts.filter((a) => String(a.id) !== String(msg.payload.id));
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE_PICKER" });
    }
  }
});
