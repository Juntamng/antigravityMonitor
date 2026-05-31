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

    toast.querySelector("#__pcm-toast-close")?.addEventListener("click", () => {
      toast.remove();
    });

    setTimeout(() => {
      toast.style.transition = "opacity 0.3s, transform 0.3s";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(20px)";
      setTimeout(() => toast.remove(), 300);
    }, 5000);

    playChime();
  }

  globalThis.PageMonitorToast = {
    showToast,
  };
})();
