/**
 * checker.js — Playwright-based page evaluator (ported from legacy service/)
 */

const { chromium } = require("playwright");
const { CDP_URL, DEBUG } = require("./config");

/** @type {import('playwright').Browser|null} */
let sharedBrowser = null;

/**
 * Resolve a browser instance using the best available method, in priority order:
 *
 *   1. CDP — connect to a real running Chrome (set CDP_URL in .env).
 *      Uses the user's actual session: real cookies, real IP, real fingerprints.
 *      Bypasses Akamai, Cloudflare, and any bot-protection that fingerprints
 *      headless browsers at the TLS/JS layer.
 *
 *   2. System Chrome headless — installed Chrome binary, launched headless.
 *      Better TLS fingerprint than Playwright's bundled Chromium but still
 *      detectable by advanced bot-protection.
 *
 *   3. Playwright bundled Chromium headless — last resort.
 *
 * Returns { browser, mode } where mode is one of:
 *   "cdp"                — real Chrome via CDP
 *   "headless-chrome"    — system Chrome headless
 *   "headless-chromium"  — Playwright bundled Chromium headless
 */
async function getBrowser() {
  // ── 1. Real Chrome via CDP ───────────────────────────────────────────────
  const cdpTarget = CDP_URL || "http://localhost:9222";
  try {
    const browser = await chromium.connectOverCDP(cdpTarget, { timeout: 3000 });
    console.log(`[checker] Connected to real Chrome via CDP at ${cdpTarget}`);
    return { browser, mode: "cdp" };
  } catch {
    if (CDP_URL) {
      // User explicitly set CDP_URL but Chrome is unreachable — warn clearly
      console.warn(
        `[checker] CDP_URL is set to "${CDP_URL}" but Chrome is not reachable. ` +
        `Make sure Chrome is running with --remote-debugging-port. Falling back to headless.`
      );
    } else if (DEBUG) {
      console.log(`[checker] No Chrome found at ${cdpTarget}, using headless`);
    }
  }

  // ── 2. System Chrome headless ────────────────────────────────────────────
  try {
    if (!sharedBrowser || !sharedBrowser.isConnected()) {
      sharedBrowser = await chromium.launch({
        channel: "chrome",
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
      });
    }
    if (DEBUG) console.log("[checker] Using system Chrome (headless)");
    return { browser: sharedBrowser, mode: "headless-chrome" };
  } catch {
    /* system Chrome not installed */
  }

  // ── 3. Playwright bundled Chromium ───────────────────────────────────────
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
  if (DEBUG) console.log("[checker] Using Playwright bundled Chromium (headless)");
  return { browser: sharedBrowser, mode: "headless-chromium" };
}

/**
 * Throws a descriptive error if the page is a bot-management challenge rather
 * than the real target page. Covers Akamai Bot Manager (Home Depot, Walmart,
 * Lowe's, etc.), Cloudflare, and generic "access denied" patterns.
 *
 * When this throws, the caller should surface the error and the user should
 * switch the monitor to execution_mode="browser" so the extension opens a
 * real Chrome tab, which bypasses bot detection.
 */
async function detectBotChallenge(page, url) {
  const { title, html } = await page.evaluate(() => ({
    title: document.title,
    html: document.documentElement.innerHTML.slice(0, 8000),
  }));

  const lower = html.toLowerCase();

  // Akamai Bot Manager indicators
  const isAkamaiChallenge =
    lower.includes("sec-if-cpt-container") ||
    lower.includes("scf-akamai-logo") ||
    lower.includes("_bman_adv") ||
    lower.includes("akamai.com/privacy") ||
    (title === "Error Page" && lower.includes("_bman"));

  // Cloudflare indicators
  const isCloudflareCaptcha =
    lower.includes("cf-browser-verification") ||
    lower.includes("cf_chl_") ||
    (lower.includes("cloudflare") && lower.includes("verify you are human"));

  // Generic access-denied indicators (page under 15 KB is a heuristic for
  // a challenge/error page vs a real product page)
  const isAccessDenied =
    (title === "Access Denied" || title === "403 Forbidden" || title === "Just a moment...") ||
    (html.length < 15000 &&
      (lower.includes("access denied") || lower.includes("captcha")));

  if (isAkamaiChallenge) {
    throw new Error(
      `Bot-protection challenge detected on ${url} (Akamai Bot Manager). ` +
      `Headless browsers cannot pass this check. ` +
      `Switch this monitor to execution_mode="browser" so the extension uses a real Chrome tab instead.`
    );
  }
  if (isCloudflareCaptcha) {
    throw new Error(
      `Cloudflare CAPTCHA detected on ${url}. ` +
      `Switch this monitor to execution_mode="browser".`
    );
  }
  if (isAccessDenied) {
    throw new Error(
      `Access denied on ${url} (title="${title}"). ` +
      `The site may be blocking automated requests. ` +
      `Switch this monitor to execution_mode="browser".`
    );
  }
}

/**
 * @param {{ url: string, selector: string }} monitor
 * @returns {Promise<string>}
 */
async function checkSelector(monitor) {
  const { browser, mode } = await getBrowser();
  const isCdp = mode === "cdp";

  // ── Context setup ─────────────────────────────────────────────────────────
  //
  // CDP (real Chrome):
  //   Re-use the existing default browser context so checks run inside the
  //   user's real Chrome session — real cookies, saved passwords, browsing
  //   history, and fingerprints. Creating a new context via newContext()
  //   would open an incognito-like window and lose all of that.
  //   We DO NOT override userAgent or navigator.webdriver; the real browser
  //   already has the correct values and overriding them would be detectable.
  //
  // Headless:
  //   Create a fresh isolated context with a realistic userAgent and the
  //   webdriver property patched.
  //
  let context;
  let ownContext = false; // whether we created the context (and must close it)

  if (isCdp) {
    const existing = browser.contexts();
    if (existing.length > 0) {
      context = existing[0];
    } else {
      // Chrome is open but has no windows yet (rare) — open a default context
      context = await browser.newContext();
      ownContext = true;
    }
  } else {
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    ownContext = true;
  }

  const page = await context.newPage();

  try {
    await page.goto(monitor.url, {
      waitUntil: "load",
      timeout: 30000,
    });

    try {
      await page.waitForLoadState("networkidle", { timeout: 15000 });
    } catch {
      // Site uses persistent polling/websockets — proceed to selector wait anyway.
    }

    // Detect bot-management challenge pages before spending time waiting for
    // the selector. Akamai Bot Manager (used by Home Depot, Walmart, etc.)
    // serves a challenge page to headless browsers that no amount of waiting
    // will resolve without real user interaction. Fail fast with a clear,
    // actionable error so users know to switch to browser-assisted checks.
    // (When connected via CDP the real Chrome normally passes these, but we
    // still check in case something unexpected happens.)
    await detectBotChallenge(page, monitor.url);

    await page.waitForFunction(
      (sel) => {
        const node = document.querySelector(sel);
        if (!node) return false;
        if (
          node.tagName === "INPUT" ||
          node.tagName === "TEXTAREA" ||
          node.tagName === "SELECT"
        ) {
          return typeof node.value === "string" && node.value.trim().length > 0;
        }
        if (node.hasAttribute("content")) {
          return (node.getAttribute("content") || "").trim().length > 0;
        }
        return (node.innerText || "").trim().length > 0;
      },
      monitor.selector,
      { timeout: 20000, polling: 500 }
    );

    const el = await page.$(monitor.selector);
    if (!el) {
      throw new Error(`Selector not found after wait: ${monitor.selector}`);
    }

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
    // Always close the temporary page we opened
    await page.close().catch(() => {});
    // Only close the context if we created it — never close the real user's
    // browser context when connected via CDP
    if (ownContext) {
      await context.close().catch(() => {});
    }
  }
}

module.exports = { checkSelector };
