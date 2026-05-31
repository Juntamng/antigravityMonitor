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

  function historyEntryKey(entry) {
    if (entry?.error) return `error:${entry.error}`;
    return `value:${entry?.value ?? ""}`;
  }

  /** Keep newest row per consecutive run of identical content (history is checked_at desc). */
  function dedupeConsecutiveHistory(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const deduped = [];
    let lastKey = null;
    for (const entry of entries) {
      const key = historyEntryKey(entry);
      if (key !== lastKey) {
        deduped.push(entry);
        lastKey = key;
      }
    }
    return deduped;
  }

  global.PAGE_MONITOR_UTILS = {
    truncate,
    esc,
    sendMsg,
    normalizeBackendUrl,
    dedupeConsecutiveHistory,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
