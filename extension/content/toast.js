/**
 * In-page toast notifications for change alerts.
 */
(() => {
  const { truncate, esc } = PAGE_MONITOR_UTILS;

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

  const TOAST_DURATION = 7000;

  // Ensure the shared keyframe stylesheet exists. picker.js creates the same
  // element via ensurePickerStyles(), but that only runs when the picker is
  // activated. The toast can appear on any page session regardless of whether
  // the picker was ever opened, so we must guarantee the animations are present.
  function ensureStyles() {
    if (document.getElementById("__pcm-styles")) return;
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

  function dismissToast(toast) {
    toast.style.transition = "opacity 0.3s, transform 0.3s";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(20px)";
    setTimeout(() => toast.remove(), 300);
  }

  function showToast(data) {
    ensureStyles();
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
        <div id="__pcm-toast-progress" style="height:100%;background:linear-gradient(90deg,#6366f1,#a78bfa);border-radius:2px;animation:__pcm-progress ${TOAST_DURATION / 1000}s linear forwards;"></div>
      </div>
    `;

    document.body.appendChild(toast);

    const progressBar = toast.querySelector("#__pcm-toast-progress");

    // Hover-to-pause: track remaining ms so multiple hover cycles work correctly.
    let remaining = TOAST_DURATION;
    let startTime = Date.now();
    let dismissTimer;

    function scheduleDismiss(ms) {
      clearTimeout(dismissTimer);
      dismissTimer = setTimeout(() => dismissToast(toast), ms);
    }

    scheduleDismiss(remaining);

    toast.addEventListener("mouseenter", () => {
      remaining -= Date.now() - startTime;
      clearTimeout(dismissTimer);
      progressBar.style.animationPlayState = "paused";
    });

    toast.addEventListener("mouseleave", () => {
      startTime = Date.now();
      progressBar.style.animationPlayState = "running";
      scheduleDismiss(remaining);
    });

    toast.querySelector("#__pcm-toast-close")?.addEventListener("click", () => {
      clearTimeout(dismissTimer);
      toast.remove();
    });

    playChime();
  }

  globalThis.PageMonitorToast = {
    showToast,
  };
})();
