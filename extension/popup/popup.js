/**
 * popup.js — Popup application logic
 *
 * Manages authentication state, monitor list, confirm-selection form,
 * history view, alerts banner, and service health indicator.
 */

(() => {
  // ── DOM refs ──────────────────────────────────────────

  const loginScreen = document.getElementById("login-screen");
  const appContainer = document.getElementById("app-container");
  const googleSignInBtn = document.getElementById("google-sign-in-btn");
  const loginStatus = document.getElementById("login-status");
  const signOutBtn = document.getElementById("sign-out-btn");

  const statusDot = document.getElementById("status-dot");
  const serviceEnvSelect = document.getElementById("service-env-select");
  const alertsBanner = document.getElementById("alerts-banner");
  const alertsList = document.getElementById("alerts-list");
  const dismissAllBtn = document.getElementById("dismiss-all-btn");
  const confirmSection = document.getElementById("confirm-section");
  const confirmPreview = document.getElementById("confirm-preview");
  const monitorLabelInput = document.getElementById("monitor-label");
  const monitorIntervalInput = document.getElementById("monitor-interval");
  const cancelConfirmBtn = document.getElementById("cancel-confirm-btn");
  const saveMonitorBtn = document.getElementById("save-monitor-btn");
  const pickerBar = document.getElementById("picker-bar");
  const pickElementBtn = document.getElementById("pick-element-btn");
  const monitorsSection = document.getElementById("monitors-section");
  const monitorList = document.getElementById("monitor-list");
  const emptyState = document.getElementById("empty-state");
  const historySection = document.getElementById("history-section");
  const historyBack = document.getElementById("history-back");
  const historyTitle = document.getElementById("history-title");
  const historyList = document.getElementById("history-list");

  // ── State ─────────────────────────────────────────────

  let pendingElement = null;
  let monitors = [];
  let currentView = "list"; // list | confirm | history

  // ── Helpers ───────────────────────────────────────────

  function esc(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function truncate(str, max = 60) {
    if (!str) return "(empty)";
    return str.length > max ? str.slice(0, max) + "…" : str;
  }

  function relativeTime(dateStr) {
    if (!dateStr) return "never";
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = Math.floor((now - then) / 1000);
    if (diff < 10) return "just now";
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  async function sendMsg(type, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, payload }, (resp) => {
        resolve(resp);
      });
    });
  }

  // ── Auth ──────────────────────────────────────────────

  async function checkAuthState() {
    const result = await sendMsg("GET_AUTH_STATE");
    if (result?.loggedIn) {
      showApp();
    } else {
      showLogin();
    }
  }

  function showLogin() {
    loginScreen.style.display = "";
    appContainer.style.display = "none";
  }

  function showApp() {
    loginScreen.style.display = "none";
    appContainer.style.display = "";
    // Initialize app
    loadServiceEnv();
    checkHealth();
    loadAlerts();
    loadMonitors();
    checkPendingElement();
  }

  googleSignInBtn.addEventListener("click", async () => {
    loginStatus.textContent = "Opening Google Sign-In…";
    loginStatus.className = "login-status";
    try {
      await sendMsg("SIGN_IN");
      loginStatus.textContent = "Complete sign-in in the opened tab.";
    } catch (err) {
      loginStatus.textContent = "Failed to open sign-in. Is the service running?";
      loginStatus.className = "login-status error";
    }
  });

  signOutBtn.addEventListener("click", async () => {
    await sendMsg("SIGN_OUT");
    showLogin();
  });

  // Listen for auth state changes (from background script)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "AUTH_STATE_CHANGED" && msg.loggedIn) {
      showApp();
    }
  });

  // ── Service Health ────────────────────────────────────

  async function checkHealth() {
    try {
      const svc = await sendMsg("GET_SERVICE_ENV");
      const resp = await sendMsg("GET_HEALTH");
      statusDot.className = resp?.ok ? "status-dot online" : "status-dot offline";
      statusDot.title = resp?.ok ? `Service online (${svc?.env || "local"})` : `Service offline (${svc?.env || "local"})`;
    } catch {
      statusDot.className = "status-dot offline";
      statusDot.title = "Service offline";
    }
  }

  async function loadServiceEnv() {
    try {
      const svc = await sendMsg("GET_SERVICE_ENV");
      const env = svc?.env || "local";
      serviceEnvSelect.value = env;
      serviceEnvSelect.title = `Backend: ${env}`;
    } catch {
      serviceEnvSelect.value = "local";
    }
  }

  serviceEnvSelect.addEventListener("change", async () => {
    const env = serviceEnvSelect.value;
    serviceEnvSelect.disabled = true;
    try {
      await sendMsg("SET_SERVICE_ENV", { env });
      await Promise.all([checkHealth(), loadMonitors(), loadAlerts()]);
    } finally {
      serviceEnvSelect.disabled = false;
    }
  });

  // ── Alerts ────────────────────────────────────────────

  async function loadAlerts() {
    try {
      const alerts = await sendMsg("GET_UNREAD_ALERTS");
      if (!alerts || alerts.length === 0) {
        alertsBanner.classList.remove("has-alerts");
        return;
      }

      alertsBanner.classList.add("has-alerts");
      alertsList.innerHTML = alerts
        .slice(0, 5)
        .map(
          (a) => `
        <div class="alert-row" data-id="${a.id}">
          <div class="alert-indicator"></div>
          <div class="alert-content">
            <div class="alert-label">${esc(a.monitor_label)}</div>
            <div class="alert-values">
              <span class="alert-old">${esc(truncate(a.old_value, 30))}</span>
              <span>→</span>
              <span class="alert-new">${esc(truncate(a.new_value, 30))}</span>
            </div>
          </div>
          <button class="btn btn-ghost btn-icon dismiss-alert-btn" title="Dismiss">✕</button>
        </div>
      `
        )
        .join("");

      // Dismiss individual alerts
      alertsList.querySelectorAll(".dismiss-alert-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const row = e.target.closest(".alert-row");
          const id = Number(row.dataset.id);
          await sendMsg("DISMISS_ALERT", { id });
          row.style.transition = "opacity 0.2s, max-height 0.2s";
          row.style.opacity = "0";
          row.style.maxHeight = "0";
          row.style.overflow = "hidden";
          setTimeout(() => {
            row.remove();
            loadAlerts();
          }, 200);
        });
      });
    } catch {
      alertsBanner.classList.remove("has-alerts");
    }
  }

  dismissAllBtn.addEventListener("click", async () => {
    await sendMsg("DISMISS_ALL_ALERTS");
    alertsBanner.classList.remove("has-alerts");
    alertsList.innerHTML = "";
  });

  // ── Pending Element ───────────────────────────────────

  async function checkPendingElement() {
    const el = await sendMsg("GET_PENDING_ELEMENT");
    if (el) {
      pendingElement = el;
      showConfirmView();
    }
  }

  function showConfirmView() {
    currentView = "confirm";
    confirmSection.classList.add("active");
    pickerBar.classList.add("hidden");
    monitorsSection.classList.add("hidden");
    historySection.classList.remove("active");

    const e = pendingElement;
    confirmPreview.innerHTML = `
      <div class="confirm-preview-row">
        <span class="confirm-preview-key">Page</span>
        <span class="confirm-preview-val">${esc(truncate(e.pageTitle, 50))}</span>
      </div>
      <div class="confirm-preview-row">
        <span class="confirm-preview-key">Selector</span>
        <span class="confirm-preview-val" style="font-family:monospace;font-size:10px">${esc(truncate(e.selector, 60))}</span>
      </div>
      <div class="confirm-preview-row">
        <span class="confirm-preview-key">Value</span>
        <span class="confirm-preview-val" style="color:var(--accent-light)">${esc(truncate(e.value, 50))}</span>
      </div>
    `;

    // Auto-generate label from page title
    monitorLabelInput.value = e.pageTitle
      ? e.pageTitle.slice(0, 40)
      : "My Monitor";
    monitorLabelInput.focus();
    monitorLabelInput.select();
  }

  function showListView() {
    currentView = "list";
    confirmSection.classList.remove("active");
    pickerBar.classList.remove("hidden");
    monitorsSection.classList.remove("hidden");
    historySection.classList.remove("active");
    pendingElement = null;
  }

  cancelConfirmBtn.addEventListener("click", async () => {
    await sendMsg("CLEAR_PENDING_ELEMENT");
    showListView();
  });

  saveMonitorBtn.addEventListener("click", async () => {
    const label = monitorLabelInput.value.trim();
    const interval = parseInt(monitorIntervalInput.value, 10);

    if (!label) {
      monitorLabelInput.style.borderColor = "var(--danger)";
      monitorLabelInput.focus();
      return;
    }

    saveMonitorBtn.disabled = true;
    saveMonitorBtn.innerHTML = '<span class="spinner"></span> Saving…';

    try {
      await sendMsg("CREATE_MONITOR", {
        label,
        url: pendingElement.url,
        selector: pendingElement.selector,
        interval_minutes: interval || 5,
        last_value: pendingElement.value,
      });

      await sendMsg("CLEAR_PENDING_ELEMENT");
      showListView();
      loadMonitors();
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      saveMonitorBtn.disabled = false;
      saveMonitorBtn.textContent = "Start Monitoring";
    }
  });

  // ── Pick Element ──────────────────────────────────────

  pickElementBtn.addEventListener("click", async () => {
    await sendMsg("ACTIVATE_PICKER");
    window.close(); // close popup so user can interact with page
  });

  // ── Monitor List ──────────────────────────────────────

  async function loadMonitors() {
    try {
      monitors = await sendMsg("GET_MONITORS");
      renderMonitors();
    } catch {
      monitors = [];
      renderMonitors();
    }
  }

  function renderMonitors() {
    if (!monitors || monitors.length === 0) {
      emptyState.classList.remove("hidden");
      // Clear any existing cards but keep empty state
      const cards = monitorList.querySelectorAll(".monitor-card");
      cards.forEach((c) => c.remove());
      return;
    }

    emptyState.classList.add("hidden");

    // Build cards
    const html = monitors
      .map(
        (m) => `
      <div class="monitor-card" data-id="${m.id}">
        <div class="monitor-top">
          <div class="monitor-icon">📡</div>
          <div class="monitor-info">
            <div class="monitor-label">${esc(m.label)}</div>
            <div class="monitor-url">${esc(truncate(m.url, 45))}</div>
          </div>
        </div>
        <div class="monitor-value-row">
          <div class="monitor-value">${esc(truncate(m.last_value || "(no data yet)", 50))}</div>
          <span class="monitor-time">${relativeTime(m.last_checked)}</span>
        </div>
        <div class="monitor-actions">
          <button class="btn btn-ghost btn-sm check-now-btn" data-id="${m.id}">⚡ Check Now</button>
          <button class="btn btn-ghost btn-sm history-btn" data-id="${m.id}">📜 History</button>
          <button class="btn btn-danger btn-sm delete-btn" data-id="${m.id}">🗑</button>
        </div>
      </div>
    `
      )
      .join("");

    // Remove old cards, keep empty state
    const oldCards = monitorList.querySelectorAll(".monitor-card");
    oldCards.forEach((c) => c.remove());
    monitorList.insertAdjacentHTML("beforeend", html);

    // Bind actions
    monitorList.querySelectorAll(".check-now-btn").forEach((btn) => {
      btn.addEventListener("click", handleCheckNow);
    });
    monitorList.querySelectorAll(".history-btn").forEach((btn) => {
      btn.addEventListener("click", handleShowHistory);
    });
    monitorList.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", handleDelete);
    });
  }

  async function handleCheckNow(e) {
    const btn = e.currentTarget;
    const id = Number(btn.dataset.id);
    const originalText = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
      const result = await sendMsg("CHECK_MONITOR", { id });

      if (result?.error) {
        btn.innerHTML = "❌ Error";
        btn.style.color = "var(--danger)";
      } else if (result?.changed) {
        btn.innerHTML = "✅ Changed!";
        btn.style.color = "var(--success)";
      } else {
        btn.innerHTML = "✅ Same";
        btn.style.color = "var(--success)";
      }

      // Reload monitor list to show new value
      setTimeout(() => loadMonitors(), 1200);
    } catch {
      btn.innerHTML = "❌ Failed";
      btn.style.color = "var(--danger)";
    }

    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = originalText;
      btn.style.color = "";
    }, 2000);
  }

  async function handleShowHistory(e) {
    const id = Number(e.currentTarget.dataset.id);
    const monitor = monitors.find((m) => m.id === id);

    currentView = "history";
    monitorsSection.classList.add("hidden");
    pickerBar.classList.add("hidden");
    confirmSection.classList.remove("active");
    historySection.classList.add("active");

    historyTitle.textContent = `History — ${monitor?.label || "Monitor"}`;
    historyList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)"><span class="spinner"></span> Loading…</div>';

    try {
      const history = await sendMsg("GET_HISTORY", { id });

      if (!history || history.length === 0) {
        historyList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No history yet</div>';
        return;
      }

      historyList.innerHTML = history
        .map(
          (h) => `
        <div class="history-entry">
          <div class="history-dot ${h.error ? "error" : ""}"></div>
          <div class="history-content">
            ${
              h.error
                ? `<div class="history-error">${esc(h.error)}</div>`
                : `<div class="history-value">${esc(truncate(h.value, 100))}</div>`
            }
            <div class="history-time">${relativeTime(h.checked_at)}</div>
          </div>
        </div>
      `
        )
        .join("");
    } catch {
      historyList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Failed to load history</div>';
    }
  }

  async function handleDelete(e) {
    const id = Number(e.currentTarget.dataset.id);
    const card = e.currentTarget.closest(".monitor-card");

    card.style.transition = "opacity 0.2s, transform 0.2s";
    card.style.opacity = "0";
    card.style.transform = "translateX(20px)";

    setTimeout(async () => {
      await sendMsg("DELETE_MONITOR", { id });
      loadMonitors();
    }, 200);
  }

  historyBack.addEventListener("click", () => {
    showListView();
  });

  // ── Init ──────────────────────────────────────────────

  async function init() {
    // Check auth state first
    await checkAuthState();

    // Refresh health periodically (only runs if app is visible)
    setInterval(() => {
      if (appContainer.style.display !== "none") {
        checkHealth();
      }
    }, 10000);
  }

  init();
})();
