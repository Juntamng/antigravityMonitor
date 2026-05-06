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
      waitUntil: "load",
      timeout: 30000,
    });

    try {
      await page.waitForLoadState("networkidle", { timeout: 15000 });
    } catch {
      // Site uses persistent polling/websockets — proceed to selector wait anyway.
    }

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
    await context.close().catch(() => {});
  }
}

module.exports = { checkSelector };
