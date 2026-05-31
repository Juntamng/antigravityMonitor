/**
 * popup.js — Popup application logic (auth-gated)
 */

(() => {
  const { truncate, esc, sendMsg } = PAGE_MONITOR_UTILS;
  const { MSG } = PAGE_MONITOR_CONSTANTS;

  const statusDot = document.getElementById("status-dot");
  const alertsBanner = document.getElementById("alerts-banner");
  const alertsList = document.getElementById("alerts-list");
  const dismissAllBtn = document.getElementById("dismiss-all-btn");
  const pickerBar = document.getElementById("picker-bar");
  const pickElementBtn = document.getElementById("pick-element-btn");
  const monitorsSection = document.getElementById("monitors-section");
  const monitorList = document.getElementById("monitor-list");
  const emptyState = document.getElementById("empty-state");
  const historySection = document.getElementById("history-section");
  const historyBack = document.getElementById("history-back");
  const historyTitle = document.getElementById("history-title");
  const historyList = document.getElementById("history-list");

  let monitors = [];

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

  async function checkHealth() {
    if (!statusDot) return;
    try {
      const resp = await sendMsg(MSG.GET_HEALTH);
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
      const alerts = await sendMsg(MSG.GET_UNREAD_ALERTS);
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
          await sendMsg(MSG.DISMISS_ALERT, { id });
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
    await sendMsg(MSG.DISMISS_ALL_ALERTS);
    alertsBanner.classList.remove("has-alerts");
    alertsList.innerHTML = "";
  });

  pickElementBtn.addEventListener("click", async () => {
    const resp = await sendMsg(MSG.ACTIVATE_PICKER);
    if (resp?.error) {
      console.warn("Picker activation failed:", resp.error);
      return;
    }
    window.close();
  });

  async function loadMonitors() {
    try {
      const data = await sendMsg(MSG.GET_MONITORS);
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
    const monitor = monitors.find((m) => String(m.id) === String(id));
    const originalText = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
      const result = await sendMsg(MSG.CHECK_MONITOR, monitor);

      if (result?.error) {
        btn.innerHTML = "❌ Error";
        btn.style.color = "var(--danger)";
      } else if (result?.value) {
        btn.innerHTML = `✅ ${truncate(result.value, 18)}`;
        btn.style.color = "var(--success)";
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

    monitorsSection.classList.add("hidden");
    pickerBar.classList.add("hidden");
    historySection.classList.add("active");

    historyTitle.textContent = `History — ${monitor?.label || "Monitor"}`;
    historyList.innerHTML =
      '<div style="padding:20px;text-align:center;color:var(--text-muted)"><span class="spinner"></span> Loading…</div>';

    try {
      const history = await sendMsg(MSG.GET_HISTORY, { id });

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
      await sendMsg(MSG.DELETE_MONITOR, { id });
      loadMonitors();
    }, 200);
  }

  historyBack.addEventListener("click", () => {
    monitorsSection.classList.remove("hidden");
    pickerBar.classList.remove("hidden");
    historySection.classList.remove("active");
  });

  async function startMainApp() {
    checkHealth();
    loadAlerts();
    loadMonitors();
    setInterval(checkHealth, 10000);
  }

  async function init() {
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
