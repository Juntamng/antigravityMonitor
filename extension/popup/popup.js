/**
 * popup.js — Popup application logic (auth-gated)
 */

(() => {
  const { truncate, esc, sendMsg, dedupeConsecutiveHistory } = PAGE_MONITOR_UTILS;
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
  let historyMonitorId = null;

  function renderHistoryEntries(history) {
    if (!history || history.length === 0) {
      historyList.innerHTML =
        '<div style="padding:20px;text-align:center;color:var(--text-muted)">No history yet</div>';
      return;
    }

    const displayHistory = dedupeConsecutiveHistory(history);
    historyList.innerHTML = displayHistory
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
  }

  async function refreshHistoryView(monitorId) {
    if (!historyMonitorId || String(historyMonitorId) !== String(monitorId)) {
      return;
    }
    try {
      const history = await sendMsg(MSG.GET_HISTORY, { id: monitorId });
      if (history?.error) throw new Error(history.error);
      renderHistoryEntries(history);
    } catch {
      /* keep optimistic rows visible */
    }
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

  function getMonitorUrl(monitorId) {
    const m = monitors.find((m) => String(m.id) === String(monitorId));
    return m?.url || "";
  }

  function buildAlertEntryRow(a) {
    return `
      <div class="alert-stack-entry" data-id="${esc(String(a.id))}">
        <div class="alert-values">
          <span class="alert-old">${esc(truncate(a.old_value, 26))}</span>
          <span class="alert-arrow">→</span>
          <span class="alert-new">${esc(truncate(a.new_value, 26))}</span>
        </div>
        <span class="alert-entry-time">${relativeTime(a.created_at)}</span>
        <button class="btn btn-ghost btn-icon dismiss-entry-btn" title="Dismiss">✕</button>
      </div>
    `;
  }

  function buildAlertStackRow(group) {
    const { monitorId, label, url, alerts } = group;
    const latest = alerts[0];
    const count = alerts.length;
    const ids = alerts.map((a) => String(a.id)).join(",");
    const src = faviconSrc(url);
    const faviconHtml = src
      ? `<img class="alert-favicon" src="${esc(src)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'alert-favicon-fallback',textContent:'📡'}))">`
      : `<span class="alert-favicon-fallback">📡</span>`;
    const badge = count > 1 ? `<span class="alert-count-badge">${count} changes</span>` : "";
    const chevron =
      count > 1
        ? `<svg class="alert-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        : "";
    const entriesHtml =
      count > 1
        ? `<div class="alert-stack-entries"><div class="alert-stack-entries-inner">${alerts.map(buildAlertEntryRow).join("")}</div></div>`
        : "";

    return `
      <div class="alert-stack" data-monitor-id="${esc(String(monitorId))}" data-ids="${esc(ids)}">
        <div class="alert-stack-header">
          <div class="alert-indicator"></div>
          <div class="alert-favicon-wrap">${faviconHtml}</div>
          <div class="alert-content">
            <div class="alert-label">${esc(label)}</div>
            <div class="alert-values">
              <span class="alert-old">${esc(truncate(latest.old_value, 26))}</span>
              <span class="alert-arrow">→</span>
              <span class="alert-new">${esc(truncate(latest.new_value, 26))}</span>
            </div>
          </div>
          ${badge}${chevron}
          <button class="btn btn-ghost btn-icon dismiss-stack-btn" title="Dismiss all">✕</button>
        </div>
        ${entriesHtml}
      </div>
    `;
  }

  function groupAlerts(alerts) {
    const order = [];
    const map = new Map();
    for (const a of alerts) {
      const key = String(a.monitor_id);
      if (!map.has(key)) {
        order.push(key);
        map.set(key, {
          monitorId: a.monitor_id,
          label: a.monitor_label || "Monitor",
          url: getMonitorUrl(a.monitor_id),
          alerts: [],
        });
      }
      map.get(key).alerts.push(a);
    }
    return order.map((k) => map.get(k));
  }

  function bindDismissHandlers(container) {
    // Dismiss entire stack — acks all alerts for that monitor
    container.querySelectorAll(".dismiss-stack-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const stack = e.target.closest(".alert-stack");
        const ids = (stack.dataset.ids || "").split(",").filter(Boolean);
        stack.style.transition = "opacity 0.2s";
        stack.style.opacity = "0";
        await Promise.all(ids.map((id) => sendMsg(MSG.DISMISS_ALERT, { id })));
        setTimeout(() => {
          stack.remove();
          if (!alertsList.querySelector(".alert-stack")) {
            alertsBanner.classList.remove("has-alerts");
            alertsList.innerHTML = "";
          }
        }, 220);
      });
    });

    // Dismiss a single entry inside an expanded stack
    container.querySelectorAll(".dismiss-entry-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const entry = e.target.closest(".alert-stack-entry");
        const stack = e.target.closest(".alert-stack");
        const id = String(entry.dataset.id);
        entry.style.transition = "opacity 0.15s";
        entry.style.opacity = "0";
        await sendMsg(MSG.DISMISS_ALERT, { id });
        setTimeout(() => {
          entry.remove();
          const remaining = (stack.dataset.ids || "")
            .split(",")
            .filter((i) => i && i !== id);
          stack.dataset.ids = remaining.join(",");
          const count = remaining.length;
          if (count === 0) {
            stack.remove();
          } else {
            const badge = stack.querySelector(".alert-count-badge");
            const chevron = stack.querySelector(".alert-chevron");
            if (count <= 1) {
              badge?.remove();
              chevron?.remove();
              stack.classList.remove("expanded");
            } else if (badge) {
              badge.textContent = `${count} changes`;
            }
          }
          if (!alertsList.querySelector(".alert-stack")) {
            alertsBanner.classList.remove("has-alerts");
            alertsList.innerHTML = "";
          }
        }, 160);
      });
    });

    // Expand/collapse on header click (skip if clicking dismiss btn)
    container.querySelectorAll(".alert-stack-header").forEach((header) => {
      header.addEventListener("click", (e) => {
        if (e.target.closest(".dismiss-stack-btn")) return;
        const stack = header.closest(".alert-stack");
        if (!stack.querySelector(".alert-stack-entries")) return;
        stack.classList.toggle("expanded");
      });
    });
  }

  async function loadAlerts() {
    try {
      const alerts = await sendMsg(MSG.GET_UNREAD_ALERTS);
      if (!Array.isArray(alerts) || alerts.length === 0) {
        alertsBanner.classList.remove("has-alerts");
        alertsList.innerHTML = "";
        return;
      }
      alertsBanner.classList.add("has-alerts");
      const groups = groupAlerts(alerts);
      alertsList.innerHTML = groups.map(buildAlertStackRow).join("");
      bindDismissHandlers(alertsList);
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

  function faviconSrc(url) {
    try {
      const { hostname } = new URL(url);
      return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
    } catch {
      return "";
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
          <div class="monitor-icon"><img class="monitor-favicon" src="${faviconSrc(m.url)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'📡'}))"></div>
          <div class="monitor-info">
            <div class="monitor-label">${esc(m.label)}</div>
            <div class="monitor-url-row">
              <span class="monitor-url">${esc(truncate(m.url, 45))}</span>
              <button class="btn open-url-btn" data-url="${esc(m.url)}" title="Open in new tab"><svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 1h3v3M11 1L6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            </div>
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
    monitorList.querySelectorAll(".open-url-btn").forEach((btn) => {
      btn.addEventListener("click", handleOpenUrl);
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

      if (result?.monitor) {
        const idx = monitors.findIndex(
          (m) => String(m.id) === String(result.monitor.id)
        );
        if (idx >= 0) {
          monitors[idx] = result.monitor;
        }
        renderMonitors();
      }

      if (result?.alert) {
        // Guard: ALERTS_UPDATED listener may have already called loadAlerts()
        // which replaces innerHTML before sendResponse resolves — don't double-insert.
        const alertId = String(result.alert.id);
        const mid = String(result.alert.monitor_id);
        const alreadyRendered = Array.from(
          alertsList.querySelectorAll(".alert-stack[data-ids]")
        ).some((el) => el.dataset.ids.split(",").includes(alertId));

        if (!alreadyRendered) {
          alertsBanner.classList.add("has-alerts");
          const existingStack = alertsList.querySelector(
            `.alert-stack[data-monitor-id="${mid}"]`
          );
          if (existingStack) {
            // Merge: update ids, badge, summary, and prepend entry to expanded list
            const ids = (existingStack.dataset.ids || "").split(",").filter(Boolean);
            ids.unshift(alertId);
            existingStack.dataset.ids = ids.join(",");
            const count = ids.length;

            const summaryEl = existingStack.querySelector(
              ".alert-stack-header .alert-values"
            );
            if (summaryEl) {
              summaryEl.innerHTML = `<span class="alert-old">${esc(truncate(result.alert.old_value, 26))}</span><span class="alert-arrow">→</span><span class="alert-new">${esc(truncate(result.alert.new_value, 26))}</span>`;
            }

            if (count > 1) {
              let badge = existingStack.querySelector(".alert-count-badge");
              const dismissBtn = existingStack.querySelector(".dismiss-stack-btn");
              if (!badge) {
                badge = document.createElement("span");
                badge.className = "alert-count-badge";
                const svg = document.createElementNS(
                  "http://www.w3.org/2000/svg",
                  "svg"
                );
                svg.setAttribute("class", "alert-chevron");
                svg.setAttribute("width", "12");
                svg.setAttribute("height", "12");
                svg.setAttribute("viewBox", "0 0 12 12");
                svg.setAttribute("fill", "none");
                svg.setAttribute("aria-hidden", "true");
                const path = document.createElementNS(
                  "http://www.w3.org/2000/svg",
                  "path"
                );
                path.setAttribute("d", "M4.5 2.5l3.5 3.5-3.5 3.5");
                path.setAttribute("stroke", "currentColor");
                path.setAttribute("stroke-width", "1.5");
                path.setAttribute("stroke-linecap", "round");
                path.setAttribute("stroke-linejoin", "round");
                svg.appendChild(path);
                const header = existingStack.querySelector(".alert-stack-header");
                header.insertBefore(badge, dismissBtn);
                header.insertBefore(svg, dismissBtn);
              }
              badge.textContent = `${count} changes`;

              let entriesEl = existingStack.querySelector(".alert-stack-entries");
              if (!entriesEl) {
                entriesEl = document.createElement("div");
                entriesEl.className = "alert-stack-entries";
                const inner = document.createElement("div");
                inner.className = "alert-stack-entries-inner";
                entriesEl.appendChild(inner);
                existingStack.appendChild(entriesEl);
              }
              entriesEl
                .querySelector(".alert-stack-entries-inner")
                .insertAdjacentHTML("afterbegin", buildAlertEntryRow(result.alert));
              bindDismissHandlers(existingStack);
            }
          } else {
            const group = {
              monitorId: result.alert.monitor_id,
              label: result.alert.monitor_label || "Monitor",
              url: getMonitorUrl(result.alert.monitor_id),
              alerts: [result.alert],
            };
            alertsList.insertAdjacentHTML("afterbegin", buildAlertStackRow(group));
            bindDismissHandlers(alertsList);
          }
        }
      } else if (result?.alerted) {
        loadAlerts();
      }

      if (
        result?.historyEntry &&
        historyMonitorId &&
        String(historyMonitorId) === String(id)
      ) {
        try {
          const history = await sendMsg(MSG.GET_HISTORY, { id });
          if (!history?.error) renderHistoryEntries(history);
        } catch {
          /* keep spinner / prior rows */
        }
      }

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
    historyMonitorId = id;

    monitorsSection.classList.add("hidden");
    pickerBar.classList.add("hidden");
    historySection.classList.add("active");

    historyTitle.textContent = `History — ${monitor?.label || "Monitor"}`;
    historyList.innerHTML =
      '<div style="padding:20px;text-align:center;color:var(--text-muted)"><span class="spinner"></span> Loading…</div>';

    try {
      const history = await sendMsg(MSG.GET_HISTORY, { id });
      if (history?.error) throw new Error(history.error);
      renderHistoryEntries(history);
    } catch {
      historyList.innerHTML =
        '<div style="padding:20px;text-align:center;color:var(--text-muted)">Failed to load history</div>';
    }
  }

  function handleOpenUrl(e) {
    e.stopPropagation();
    const url = e.currentTarget.dataset.url;
    if (url) {
      chrome.tabs.create({ url });
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
    historyMonitorId = null;
    monitorsSection.classList.remove("hidden");
    pickerBar.classList.remove("hidden");
    historySection.classList.remove("active");
  });

  async function startMainApp() {
    checkHealth();
    await loadMonitors();
    loadAlerts();
    setInterval(checkHealth, 10000);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === MSG.MONITORS_UPDATED && Array.isArray(msg.payload)) {
      monitors = msg.payload;
      renderMonitors();
    }
    if (msg.type === MSG.ALERTS_UPDATED) {
      loadAlerts();
    }
    if (msg.type === MSG.HISTORY_UPDATED && msg.payload?.monitorId) {
      refreshHistoryView(msg.payload.monitorId);
    }
  });

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
