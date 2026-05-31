/**
 * Shared utilities for truncate, HTML escape, messaging, and URL normalization.
 */
(function (global) {
  function truncate(str, max = 60) {
    if (!str) return "(empty)";
    return str.length > max ? str.slice(0, max) + "…" : str;
  }

  function esc(str) {
    if (typeof document === "undefined") {
      return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function sendMsg(type, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, payload }, (resp) => {
        resolve(resp || {});
      });
    });
  }

  function normalizeBackendUrl(url) {
    return String(url || "").replace(/\/$/, "");
  }

  global.PAGE_MONITOR_UTILS = {
    truncate,
    esc,
    sendMsg,
    normalizeBackendUrl,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
