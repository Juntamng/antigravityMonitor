/**
 * Canonical DOM value extraction used by picker, browser checks, and agent (copy source).
 */
function extractValueFromElement(el, maxLen = 2000) {
  if (!el) return "";
  let value;
  if (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  ) {
    value = (el.value || "").trim();
  } else if (el.hasAttribute("content")) {
    value = (el.getAttribute("content") || "").trim();
  } else {
    value = (el.innerText || "").trim();
  }
  return maxLen > 0 ? value.slice(0, maxLen) : value;
}

/**
 * Poll until selector resolves to a non-empty value (for dynamic pages).
 * Passed to chrome.scripting.executeScript as a function reference.
 */
function pollElementValue(selector) {
  const POLL_MS = 500;
  const TIMEOUT_MS = 25000;

  return new Promise((resolve) => {
    const deadline = Date.now() + TIMEOUT_MS;

    function attempt() {
      const el = document.querySelector(selector);
      if (el) {
        const value = extractValueFromElement(el, 0);
        if (value.length > 0) {
          return resolve({ value });
        }
      }

      if (Date.now() >= deadline) {
        const msg = el
          ? "Element found but still empty after timeout"
          : "Element not found after timeout";
        return resolve({ error: msg });
      }

      setTimeout(attempt, POLL_MS);
    }

    attempt();
  });
}

if (typeof globalThis !== "undefined") {
  globalThis.PAGE_MONITOR_DOM = {
    extractValueFromElement,
    pollElementValue,
  };
}
