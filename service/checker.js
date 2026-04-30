/**
 * checker.js — Playwright-based page evaluator
 *
 * Strategy (in order):
 *   1. Attach to existing Chrome over CDP (localhost:9222)
 *   2. Launch with channel: 'chrome' (uses installed Chrome)
 *   3. Fall back to Playwright's bundled Chromium
 *
 * On timeout-like failures, flags the monitor for
 * browser-assisted extension fallback.
 */

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  // Keep browser install/lookup inside project directory on Render.
  process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
}

const { chromium } = require("playwright");

let sharedBrowser = null;

/**
 * Try to obtain a usable browser instance.
 */
async function getBrowser() {
  // Strategy 1: existing CDP
  try {
    const browser = await chromium.connectOverCDP("http://localhost:9222", {
      timeout: 3000,
    });
    return { browser, owned: false };
  } catch {
    /* no CDP available */
  }

  // Strategy 2: system Chrome
  try {
    if (!sharedBrowser || !sharedBrowser.isConnected()) {
      sharedBrowser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    }
    return { browser: sharedBrowser, owned: true };
  } catch {
    /* system Chrome not available */
  }

  // Strategy 3: bundled Chromium
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return { browser: sharedBrowser, owned: true };
}

/**
 * Check a monitor's selector on its URL and return the current value.
 *
 * @param {{ url: string, selector: string }} monitor
 * @returns {Promise<string>} The text/value extracted from the element.
 * @throws On timeout or evaluation failure.
 */
async function checkSelector(monitor) {
  const { browser } = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });

  // Anti-detection init script
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
    });
  });

  const page = await context.newPage();

  try {
    await page.goto(monitor.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Allow SPA settle time
    await page.waitForTimeout(2000);

    // Wait for selector
    const el = await page.waitForSelector(monitor.selector, { timeout: 10000 });

    // Extract value
    const value = await el.evaluate((node) => {
      if (
        node.tagName === "INPUT" ||
        node.tagName === "TEXTAREA" ||
        node.tagName === "SELECT"
      ) {
        return node.value;
      }
      if (node.hasAttribute("content")) {
        return node.getAttribute("content");
      }
      return node.innerText;
    });

    return (value || "").trim().slice(0, 5000);
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { checkSelector };
