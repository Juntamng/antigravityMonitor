/**
 * popup.js — Popup application logic (auth-gated)
 */

(() => {
  const backendTarget = document.getElementById("backend-target");

  const statusDot = document.getElementById("status-dot");
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

  let pendingElement = null;
  let monitors = [];
  let currentView = "list";

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
    const s = String(dateStr);
    const iso = s.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(s) ? s : `${s}Z`;
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "unknown";
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

  async function checkHealth() {
    if (!statusDot) return;
    try {
      const resp = await sendMsg("GET_HEALTH");
      const base = resp?.activeUrl || "";
      statusDot.className = resp?.ok ? "status-dot online" : "status-dot offline";
      statusDot.title = resp?.ok
        ? base
          ? `Backend online — ${base}`
          : "Backend online"
        : base
          ? `Backend offline — ${base}`
          : "Backend offline";
    } catch {
      statusDot.className = "status-dot offline";
      statusDot.title = "Backend offline";
    }
  }

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
        <div class="alert-row" data-id="${esc(String(a.id))}">
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

      alertsList.querySelectorAll(".dismiss-alert-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const row = e.target.closest(".alert-row");
          const id = row.dataset.id;
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

  dismissAllBtn?.addEventListener("click", async () => {
    await sendMsg("DISMISS_ALL_ALERTS");
    alertsBanner.classList.remove("has-alerts");
    alertsList.innerHTML = "";
  });

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

    monitorLabelInput.value = e.pageTitle ? e.pageTitle.slice(0, 40) : "My Monitor";
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
      const res = await sendMsg("CREATE_MONITOR", {
        label,
        url: pendingElement.url,
        selector: pendingElement.selector,
        interval_minutes: interval || 5,
        last_value: pendingElement.value,
      });
      if (res?.error) throw new Error(res.error);

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

  pickElementBtn.addEventListener("click", async () => {
    await sendMsg("ACTIVATE_PICKER");
    window.close();
  });

  async function loadMonitors() {
    try {
      const data = await sendMsg("GET_MONITORS");
      if (data?.error) throw new Error(data.error);
      monitors = Array.isArray(data) ? data : [];
      renderMonitors();
    } catch {
      monitors = [];
      renderMonitors();
    }
  }

  function renderMonitors() {
    if (!monitors || monitors.length === 0) {
      emptyState.classList.remove("hidden");
      monitorList.querySelectorAll(".monitor-card").forEach((c) => c.remove());
      return;
    }

    emptyState.classList.add("hidden");

    const html = monitors
      .map(
        (m) => `
      <div class="monitor-card" data-id="${esc(String(m.id))}">
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
          <button class="btn btn-ghost btn-sm check-now-btn" data-id="${esc(String(m.id))}">⚡ Check Now</button>
          <button class="btn btn-ghost btn-sm history-btn" data-id="${esc(String(m.id))}">📜 History</button>
          <button class="btn btn-danger btn-sm delete-btn" data-id="${esc(String(m.id))}">🗑</button>
        </div>
      </div>
    `
      )
      .join("");

    monitorList.querySelectorAll(".monitor-card").forEach((c) => c.remove());
    monitorList.insertAdjacentHTML("beforeend", html);

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
    const id = btn.dataset.id;
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
      } else if (result?.queued) {
        btn.innerHTML = "⏳ Queued";
        btn.style.color = "var(--accent-light)";
      } else {
        btn.innerHTML = "✅ OK";
        btn.style.color = "var(--success)";
      }

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
    const id = e.currentTarget.dataset.id;
    const monitor = monitors.find((m) => String(m.id) === String(id));

    currentView = "history";
    monitorsSection.classList.add("hidden");
    pickerBar.classList.add("hidden");
    confirmSection.classList.remove("active");
    historySection.classList.add("active");

    historyTitle.textContent = `History — ${monitor?.label || "Monitor"}`;
    historyList.innerHTML =
      '<div style="padding:20px;text-align:center;color:var(--text-muted)"><span class="spinner"></span> Loading…</div>';

    try {
      const history = await sendMsg("GET_HISTORY", { id });

      if (history?.error) throw new Error(history.error);
      if (!history || history.length === 0) {
        historyList.innerHTML =
          '<div style="padding:20px;text-align:center;color:var(--text-muted)">No history yet</div>';
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
      historyList.innerHTML =
        '<div style="padding:20px;text-align:center;color:var(--text-muted)">Failed to load history</div>';
    }
  }

  async function handleDelete(e) {
    const id = e.currentTarget.dataset.id;
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

  async function startMainApp() {
    checkHealth();
    loadAlerts();
    loadMonitors();
    checkPendingElement();
    setInterval(checkHealth, 10000);
  }

  async function initBackendBar() {
    if (!backendTarget) return;
    try {
      const opts = await sendMsg("GET_BACKEND_OPTIONS");
      if (opts?.error) return;
      backendTarget.value = opts.target === "local" ? "local" : "hosted";
      if (opts.activeUrl) backendTarget.title = `Active: ${opts.activeUrl}`;
    } catch {
      /* ignore */
    }

    backendTarget.addEventListener("change", async () => {
      const target = backendTarget.value;
      try {
        const res = await sendMsg("SET_BACKEND_TARGET", { target });
        if (res?.error) throw new Error(res.error);
        if (res?.activeUrl) backendTarget.title = `Active: ${res.activeUrl}`;
      } catch {
        backendTarget.title = "";
      }
      await checkHealth();
      const main = document.getElementById("app-main");
      if (main && !main.classList.contains("hidden")) {
        loadAlerts();
        loadMonitors();
      }
    });
  }

  async function init() {
    await initBackendBar();
    window.PageMonitorAuth.bindAuthForm();
    const ok = await window.PageMonitorAuth.init();
    if (ok) {
      await startMainApp();
    }
    window.addEventListener("page-monitor:auth-changed", async () => {
      const authed = await window.PageMonitorAuth.init();
      if (authed) {
        await startMainApp();
      }
    });
  }

  init();
})();
