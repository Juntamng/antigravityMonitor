/**
 * checker.js — Playwright-based page evaluator (ported from legacy service/)
 */

const { chromium } = require("playwright");

let sharedBrowser = null;

async function getBrowser() {
  try {
    const browser = await chromium.connectOverCDP("http://localhost:9222", {
      timeout: 3000,
    });
    return { browser, owned: false };
  } catch {
    /* no CDP */
  }

  try {
    if (!sharedBrowser || !sharedBrowser.isConnected()) {
      sharedBrowser = await chromium.launch({
        channel: "chrome",
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
      });
    }
    return { browser: sharedBrowser, owned: true };
  } catch {
    /* no system Chrome */
  }

  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
  return { browser: sharedBrowser, owned: true };
}

/**
 * @param {{ url: string, selector: string }} monitor
 * @returns {Promise<string>}
 */
async function checkSelector(monitor) {
  const { browser } = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });

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

    await new Promise((r) => setTimeout(r, 2000));

    const el = await page.waitForSelector(monitor.selector, { timeout: 10000 });

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
