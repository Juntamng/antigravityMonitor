/**
 * background.js — Extension service worker entry (MV3)
 */

importScripts("config.js");

const C = self.PAGE_MONITOR_CONFIG;

importScripts(
  "lib/constants.js",
  "lib/utils.js",
  "lib/dom-extract.js",
  "background/auth.js",
  "background/api-client.js",
  "background/monitor-cache.js",
  "background/monitor-tab.js",
  "background/browser-check.js",
  "background/badge.js",
  "background/alert-poller.js",
  "background/messages.js"
);

const { ALARMS } = PAGE_MONITOR_CONSTANTS;

function registerAlarms() {
  chrome.alarms.create(ALARMS.EXTENSION_CHECKS, { periodInMinutes: 1 });
  chrome.alarms.create(ALARMS.POLL_ALERTS, { periodInMinutes: 0.5 });
  chrome.alarms.create(ALARMS.SESSION_REFRESH, { periodInMinutes: 45 });
}

chrome.runtime.onInstalled.addListener(registerAlarms);
chrome.runtime.onStartup.addListener(registerAlarms);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARMS.EXTENSION_CHECKS) {
    await handleScheduledExtensionChecks();
  } else if (alarm.name === ALARMS.POLL_ALERTS) {
    await handleAlertPolling();
  } else if (alarm.name === ALARMS.SESSION_REFRESH) {
    try {
      await refreshSessionIfNeeded();
    } catch (e) {
      console.warn("[bg] Session refresh failed:", e.message);
    }
  }
});

chrome.storage.session
  .get(PAGE_MONITOR_CONSTANTS.STORAGE.PENDING_ELEMENT)
  .then((stored) => {
    if (stored?.[PAGE_MONITOR_CONSTANTS.STORAGE.PENDING_ELEMENT]) {
      setPendingPick(true);
    }
  });
