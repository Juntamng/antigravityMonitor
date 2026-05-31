/**
 * In-page save panel shown after element pick.
 */
(() => {
  const { truncate, esc, sendMsg } = PAGE_MONITOR_UTILS;
  const { MSG, EXECUTION_MODE, SAVE_PANEL_HOST_ID, SAVE_PANEL_ESC_HANDLER_KEY } =
    PAGE_MONITOR_CONSTANTS;

  function closeSavePanel() {
    const host = document.getElementById(SAVE_PANEL_HOST_ID);
    if (!host) return;
    const escHandler = host[SAVE_PANEL_ESC_HANDLER_KEY];
    if (escHandler) {
      document.removeEventListener("keydown", escHandler, true);
    }
    host.remove();
  }

  async function showSavePanel(data) {
    closeSavePanel();

    const host = document.createElement("div");
    host.id = SAVE_PANEL_HOST_ID;
    Object.assign(host.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      width: "360px",
      zIndex: "2147483647",
      fontFamily: "'Inter', system-ui, sans-serif",
    });

    document.body.appendChild(host);

    const labelDefault = data.pageTitle
      ? data.pageTitle.slice(0, 40)
      : "My Monitor";
    const intervalDefault = "15";
    const hasStableSelector = Boolean(data.selector);

    host.innerHTML = `
      <div style="background:#1a1a2e;border:1px solid rgba(99,102,241,0.4);border-radius:14px;padding:14px;color:#e2e8f0;box-shadow:0 12px 36px rgba(0,0,0,0.55),0 0 0 1px rgba(99,102,241,0.18);animation:__pcm-fadeIn 0.2s ease;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span style="font-size:16px;">🎯</span>
          <strong style="color:#c7d2fe;flex:1;">Save Monitor</strong>
          <button id="__pcm-save-close" type="button" style="border:0;background:transparent;color:#94a3b8;cursor:pointer;font-size:18px;line-height:1;">×</button>
        </div>
        <div style="display:grid;gap:6px;margin-bottom:10px;">
          <div style="font-size:12px;color:#94a3b8;">Page</div>
          <div style="font-size:12px;color:#e2e8f0;">${esc(truncate(data.pageTitle, 50))}</div>
          <div style="font-size:12px;color:#94a3b8;">Selector</div>
          <div style="font-size:11px;font-family:monospace;color:#cbd5e1;background:rgba(15,23,42,0.65);padding:6px;border-radius:6px;">${esc(truncate(data.selector || "No stable selector found", 80))}</div>
          <div style="font-size:12px;color:#94a3b8;">Current value</div>
          <div style="font-size:12px;color:#a5b4fc;background:rgba(30,41,59,0.65);padding:6px;border-radius:6px;">${esc(truncate(data.value, 70))}</div>
        </div>
        <div style="display:grid;gap:6px;margin-bottom:10px;">
          <label for="__pcm-save-label" style="font-size:12px;color:#94a3b8;">Label</label>
          <input id="__pcm-save-label" type="text" maxlength="80" value="${esc(labelDefault)}" style="height:34px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;padding:0 10px;font-size:13px;outline:none;" />
        </div>
        <div style="display:grid;gap:6px;margin-bottom:12px;">
          <label for="__pcm-save-interval" style="font-size:12px;color:#94a3b8;">Check every</label>
          <select id="__pcm-save-interval" style="height:34px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;padding:0 10px;font-size:13px;outline:none;">
            <option value="1">1 minute</option>
            <option value="5">5 minutes</option>
            <option value="15" selected>15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="1440">1 day</option>
          </select>
        </div>
        <div id="__pcm-save-error" style="display:none;margin-bottom:10px;color:#fca5a5;font-size:12px;"></div>
        ${
          hasStableSelector
            ? ""
            : '<div style="margin-bottom:10px;color:#fca5a5;font-size:12px;">No stable selector found for this element. Try clicking a parent element with an id or class.</div>'
        }
        <div style="display:flex;gap:8px;">
          <button id="__pcm-save-cancel" type="button" style="flex:1;height:34px;border:1px solid #334155;border-radius:8px;background:transparent;color:#cbd5e1;cursor:pointer;">Cancel</button>
          <button id="__pcm-save-submit" type="button" style="flex:1;height:34px;border:0;border-radius:8px;background:#6366f1;color:#fff;font-weight:600;cursor:pointer;" ${
            hasStableSelector ? "" : "disabled"
          }>Start Monitoring</button>
        </div>
      </div>
    `;

    const labelInput = host.querySelector("#__pcm-save-label");
    const intervalInput = host.querySelector("#__pcm-save-interval");
    const errorEl = host.querySelector("#__pcm-save-error");
    const saveBtn = host.querySelector("#__pcm-save-submit");
    const cancelBtn = host.querySelector("#__pcm-save-cancel");
    const closeBtn = host.querySelector("#__pcm-save-close");

    async function cancel() {
      await sendMsg(MSG.CLEAR_PENDING_ELEMENT);
      closeSavePanel();
    }

    async function save() {
      if (!hasStableSelector) {
        errorEl.style.display = "block";
        errorEl.textContent =
          "No stable selector found for this element. Try a parent with an id or class.";
        return;
      }

      const label = String(labelInput?.value || "").trim();
      const interval = parseInt(
        String(intervalInput?.value || intervalDefault),
        10
      );

      if (!label) {
        errorEl.style.display = "block";
        errorEl.textContent = "Label is required.";
        labelInput?.focus();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      errorEl.style.display = "none";

      const resp = await sendMsg(MSG.CREATE_MONITOR, {
        label,
        url: data.url,
        selector: data.selector,
        interval_minutes: interval,
        last_value: data.value || "",
        execution_mode: EXECUTION_MODE.EXTENSION,
      });

      if (resp?.error) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Start Monitoring";
        errorEl.style.display = "block";
        errorEl.textContent = resp.error;
        return;
      }

      await sendMsg(MSG.CLEAR_PENDING_ELEMENT);
      closeSavePanel();
      PageMonitorToast.showToast({
        label,
        oldValue: data.value || "",
        newValue: data.value || "",
      });
    }

    closeBtn?.addEventListener("click", cancel);
    cancelBtn?.addEventListener("click", cancel);
    saveBtn?.addEventListener("click", save);
    labelInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      }
    });

    const escHandler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    host[SAVE_PANEL_ESC_HANDLER_KEY] = escHandler;
    document.addEventListener("keydown", escHandler, true);

    labelInput?.focus();
    labelInput?.select();
  }

  globalThis.PageMonitorSavePanel = {
    showSavePanel,
    closeSavePanel,
  };
})();
