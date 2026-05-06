/**
 * content.js — Element picker and in-page toast notifications
 *
 * Injected on all pages. Provides:
 *   - Interactive picker mode with hover overlay
 *   - Selector generation (id → class → DOM path)
 *   - Value extraction
 *   - In-page toast notifications for change alerts
 */

(() => {
  // ── State ───────────────────────────────────────────────

  let pickerActive = false;
  let overlay = null;
  let selectorLabel = null;
  let hoveredElement = null;

  // ── Selector Generation ─────────────────────────────────

  function generateSelector(el) {
    // Strategy 1: unique ID
    if (el.id) {
      return `#${CSS.escape(el.id)}`;
    }

    // Strategy 2: unique class combination
    if (el.classList.length > 0) {
      for (const cls of el.classList) {
        const sel = `.${CSS.escape(cls)}`;
        if (document.querySelectorAll(sel).length === 1) {
          return sel;
        }
      }
      // Try full class list
      const fullClass = Array.from(el.classList)
        .map((c) => `.${CSS.escape(c)}`)
        .join("");
      if (document.querySelectorAll(fullClass).length === 1) {
        return fullClass;
      }
    }

    // Strategy 3: DOM path with :nth-of-type
    const parts = [];
    let current = el;
    while (
      current &&
      current !== document.body &&
      current !== document.documentElement
    ) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (s) => s.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          parts.unshift(`${tag}:nth-of-type(${idx})`);
        } else {
          parts.unshift(tag);
        }
      } else {
        parts.unshift(tag);
      }
      current = parent;
    }
    return `body > ${parts.join(" > ")}`;
  }

  // ── Value Extraction ────────────────────────────────────

  function extractValue(el) {
    if (
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT"
    ) {
      return (el.value || "").trim().slice(0, 2000);
    }
    if (el.hasAttribute("content")) {
      return (el.getAttribute("content") || "").trim().slice(0, 2000);
    }
    return (el.innerText || "").trim().slice(0, 2000);
  }

  // ── Overlay / Label ─────────────────────────────────────

  function createOverlay() {
    overlay = document.createElement("div");
    overlay.id = "__pcm-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      pointerEvents: "none",
      border: "2px solid #6366f1",
      backgroundColor: "rgba(99, 102, 241, 0.12)",
      borderRadius: "4px",
      zIndex: "2147483646",
      transition: "all 0.15s ease",
      display: "none",
    });
    document.body.appendChild(overlay);

    selectorLabel = document.createElement("div");
    selectorLabel.id = "__pcm-label";
    Object.assign(selectorLabel.style, {
      position: "fixed",
      pointerEvents: "none",
      backgroundColor: "#6366f1",
      color: "#fff",
      padding: "3px 8px",
      borderRadius: "4px",
      fontSize: "11px",
      fontFamily: "'Inter', system-ui, sans-serif",
      fontWeight: "600",
      zIndex: "2147483647",
      display: "none",
      maxWidth: "400px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
    });
    document.body.appendChild(selectorLabel);
  }

  function updateOverlay(el) {
    if (!overlay || !selectorLabel) return;
    const rect = el.getBoundingClientRect();
    Object.assign(overlay.style, {
      top: rect.top + "px",
      left: rect.left + "px",
      width: rect.width + "px",
      height: rect.height + "px",
      display: "block",
    });
    selectorLabel.textContent = generateSelector(el);
    Object.assign(selectorLabel.style, {
      top: Math.max(0, rect.top - 26) + "px",
      left: rect.left + "px",
      display: "block",
    });
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = "none";
    if (selectorLabel) selectorLabel.style.display = "none";
  }

  function destroyOverlay() {
    overlay?.remove();
    selectorLabel?.remove();
    overlay = null;
    selectorLabel = null;
  }

  // ── Picker Lifecycle ────────────────────────────────────

  function onMouseMove(e) {
    if (!pickerActive) return;
    const target = e.target;
    if (
      target === overlay ||
      target === selectorLabel ||
      target.id?.startsWith("__pcm")
    ) {
      return;
    }
    hoveredElement = target;
    updateOverlay(target);
  }

  function onMouseClick(e) {
    if (!pickerActive) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const el = hoveredElement;
    if (!el) return;

    const selector = generateSelector(el);
    const value = extractValue(el);

    // Send to background
    chrome.runtime.sendMessage({
      type: "ELEMENT_PICKED",
      payload: {
        selector,
        value,
        url: window.location.href,
        pageTitle: document.title,
      },
    });

    deactivatePicker();
  }

  function onKeyDown(e) {
    if (!pickerActive) return;
    if (e.key === "Escape") {
      e.preventDefault();
      deactivatePicker();
    }
  }

  function activatePicker() {
    if (pickerActive) return;
    pickerActive = true;
    createOverlay();
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onMouseClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.body.style.cursor = "crosshair";

    showPickerBanner();
  }

  function deactivatePicker() {
    if (!pickerActive) return;
    pickerActive = false;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onMouseClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.body.style.cursor = "";
    hideOverlay();
    destroyOverlay();
    hoveredElement = null;
    removePickerBanner();
  }

  // ── Picker Banner ───────────────────────────────────────

  let pickerBanner = null;

  function showPickerBanner() {
    pickerBanner = document.createElement("div");
    pickerBanner.id = "__pcm-banner";
    pickerBanner.innerHTML = `
      <span style="margin-right:8px">🎯</span>
      <span><strong>Page Monitor</strong> — Click any element to monitor it. Press <kbd style="
        background:#374151;padding:2px 6px;border-radius:3px;font-size:11px;
        border:1px solid #4b5563;font-family:monospace
      ">Esc</kbd> to cancel.</span>
    `;
    Object.assign(pickerBanner.style, {
      position: "fixed",
      top: "12px",
      left: "50%",
      transform: "translateX(-50%)",
      backgroundColor: "#1e1b4b",
      color: "#e0e7ff",
      padding: "10px 20px",
      borderRadius: "10px",
      fontSize: "13px",
      fontFamily: "'Inter', system-ui, sans-serif",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      boxShadow: "0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.3)",
      animation: "__pcm-slideDown 0.3s ease",
      pointerEvents: "none",
    });
    document.body.appendChild(pickerBanner);

    // Inject animation keyframe
    if (!document.getElementById("__pcm-styles")) {
      const style = document.createElement("style");
      style.id = "__pcm-styles";
      style.textContent = `
        @keyframes __pcm-slideDown {
          from { opacity:0; transform: translateX(-50%) translateY(-20px); }
          to   { opacity:1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes __pcm-fadeIn {
          from { opacity:0; transform: translateY(20px); }
          to   { opacity:1; transform: translateY(0); }
        }
        @keyframes __pcm-progress {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  function removePickerBanner() {
    pickerBanner?.remove();
    pickerBanner = null;
  }

  // ── In-Page Save Panel ───────────────────────────────────

  const SAVE_PANEL_HOST_ID = "__pcm-save-panel-host";
  const SAVE_PANEL_ESC_HANDLER_KEY = "__pcmSavePanelEscHandler";

  function truncate(str, max = 60) {
    if (!str) return "(empty)";
    return str.length > max ? str.slice(0, max) + "…" : str;
  }

  function sendMsg(type, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, payload }, (resp) => {
        resolve(resp || {});
      });
    });
  }

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
          <div style="font-size:11px;font-family:monospace;color:#cbd5e1;background:rgba(15,23,42,0.65);padding:6px;border-radius:6px;">${esc(truncate(data.selector, 80))}</div>
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
            <option value="5">5 minutes</option>
            <option value="15" selected>15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="1440">1 day</option>
          </select>
        </div>
        <div id="__pcm-save-error" style="display:none;margin-bottom:10px;color:#fca5a5;font-size:12px;"></div>
        <div style="display:flex;gap:8px;">
          <button id="__pcm-save-cancel" type="button" style="flex:1;height:34px;border:1px solid #334155;border-radius:8px;background:transparent;color:#cbd5e1;cursor:pointer;">Cancel</button>
          <button id="__pcm-save-submit" type="button" style="flex:1;height:34px;border:0;border-radius:8px;background:#6366f1;color:#fff;font-weight:600;cursor:pointer;">Start Monitoring</button>
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
      await sendMsg("CLEAR_PENDING_ELEMENT");
      closeSavePanel();
    }

    async function save() {
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

      const resp = await sendMsg("CREATE_MONITOR", {
        label,
        url: data.url,
        selector: data.selector,
        interval_minutes: interval,
        last_value: data.value || "",
      });

      if (resp?.error) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Start Monitoring";
        errorEl.style.display = "block";
        errorEl.textContent = resp.error;
        return;
      }

      await sendMsg("CLEAR_PENDING_ELEMENT");
      closeSavePanel();
      showToast({
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

  // ── In-Page Toast Notification ──────────────────────────

  function showToast(data) {
    const { label, oldValue, newValue } = data;

    const toast = document.createElement("div");
    toast.className = "__pcm-toast";
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      width: "340px",
      backgroundColor: "#1a1a2e",
      border: "1px solid rgba(99,102,241,0.4)",
      borderRadius: "12px",
      padding: "16px",
      color: "#e2e8f0",
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: "13px",
      zIndex: "2147483647",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.2)",
      animation: "__pcm-fadeIn 0.3s ease",
      overflow: "hidden",
    });

    const truncate = (s, max = 60) =>
      s && s.length > max ? s.slice(0, max) + "…" : s || "(empty)";

    toast.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-size:16px">🔔</span>
        <strong style="color:#a5b4fc;flex:1">${esc(label)}</strong>
        <span style="cursor:pointer;color:#64748b;font-size:16px" id="__pcm-toast-close">✕</span>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:6px;">
        <span style="color:#f87171;background:#2a1a1a;padding:2px 8px;border-radius:4px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">
          ${esc(truncate(oldValue))}
        </span>
        <span style="color:#64748b">→</span>
        <span style="color:#34d399;background:#1a2a1a;padding:2px 8px;border-radius:4px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">
          ${esc(truncate(newValue))}
        </span>
      </div>
      <div style="height:3px;background:#1e293b;border-radius:2px;margin-top:10px;overflow:hidden;">
        <div style="height:100%;background:linear-gradient(90deg,#6366f1,#a78bfa);border-radius:2px;animation:__pcm-progress 5s linear forwards;"></div>
      </div>
    `;

    document.body.appendChild(toast);

    // Close button
    toast.querySelector("#__pcm-toast-close")?.addEventListener("click", () => {
      toast.remove();
    });

    // Auto-dismiss
    setTimeout(() => {
      toast.style.transition = "opacity 0.3s, transform 0.3s";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(20px)";
      setTimeout(() => toast.remove(), 300);
    }, 5000);

    // Play chime
    playChime();
  }

  function playChime() {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      /* audio not available */
    }
  }

  // ── HTML escaping helper ────────────────────────────────

  function esc(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  // ── Message Listener ────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "ACTIVATE_PICKER") {
      activatePicker();
    } else if (msg.type === "CLOSE_SAVE_PANEL") {
      closeSavePanel();
    } else if (msg.type === "SHOW_SAVE_PANEL") {
      showSavePanel(msg.payload || {});
    } else if (msg.type === "SHOW_TOAST") {
      showToast(msg.payload);
    }
  });
})();
