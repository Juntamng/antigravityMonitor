/**
 * checker.js — Playwright-based page evaluator (Local Agent)
 *
 * Anti-detection strategy (in order of preference):
 *   1. Attach to existing Chrome over CDP (localhost:9222) — uses your real profile
 *   2. Launch system Chrome with a persistent profile dir — carries cookies across runs
 *   3. Fall back to Playwright's bundled Chromium
 *
 * Runs with headless:false so the site sees a genuine window environment,
 * eliminating most canvas/WebGL fingerprint mismatches.
 */

const { chromium } = require("playwright");
const os = require("os");
const path = require("path");

const PROFILE_DIR = path.join(os.homedir(), ".monitor-agent-chrome-profile");

let sharedBrowser = null;

/**
 * Try to obtain a usable browser instance, most-trusted first.
 */
async function getBrowser() {
  // Strategy 1: Attach to existing Chrome CDP (user's real session, best anti-detection)
  try {
    const browser = await chromium.connectOverCDP("http://localhost:9222", {
      timeout: 3000,
    });
    console.log("[checker] Connected to existing Chrome via CDP");
    return { browser, owned: false };
  } catch {
    /* no CDP available */
  }

  // Strategy 2: System Chrome with persistent profile
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    try {
      sharedBrowser = await chromium.launch({
        channel: "chrome",
        headless: false,        // Real window — avoids headless detection
        args: [
          "--disable-blink-features=AutomationControlled",
          "--use-gl=desktop",   // Real GPU fingerprint
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${PROFILE_DIR}`, // Persistent cookies/login state
          "--window-position=9999,9999",    // Off-screen (invisible to user)
          "--window-size=1280,800",
        ],
      });
      console.log("[checker] Launched system Chrome with persistent profile");
    } catch {
      // Strategy 3: Bundled Chromium fallback
      sharedBrowser = await chromium.launch({
        headless: true,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
        ],
      });
      console.log("[checker] Launched bundled Chromium (fallback)");
    }
  }

  return { browser: sharedBrowser, owned: true };
}

/**
 * Check a monitor's selector on its URL and return the current value.
 *
 * @param {{ url: string, selector: string, label?: string }} monitor
 * @returns {Promise<string>} The text/value extracted from the element.
 * @throws On timeout or evaluation failure.
 */
async function checkSelector(monitor) {
  const { browser } = await getBrowser();

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  // Anti-detection: mask automation markers
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    await page.goto(monitor.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Human-like random delay (1.5–4s) to let SPAs settle
    const delay = 1500 + Math.floor(Math.random() * 2500);
    await page.waitForTimeout(delay);

    // Wait for selector
    const el = await page.waitForSelector(monitor.selector, { timeout: 10000 });

    // Extract value (input/textarea/select → .value, meta → content attr, else innerText)
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

/**
 * Cleanly close the shared browser on shutdown.
 */
async function closeBrowser() {
  if (sharedBrowser && sharedBrowser.isConnected()) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}

module.exports = { checkSelector, closeBrowser };
