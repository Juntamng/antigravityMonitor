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
    while (current && current !== document.body && current !== document.documentElement) {
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
    } else if (msg.type === "SHOW_TOAST") {
      showToast(msg.payload);
    }
  });
})();
