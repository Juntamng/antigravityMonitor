/**
 * Centralized extension action badge state.
 * Alerts take priority over pending element pick.
 */

let pendingPick = false;
let alertCount = 0;

async function initBadgeFromStorage() {
  const { unreadAlerts = [] } = await chrome.storage.local.get("unreadAlerts");
  alertCount = unreadAlerts.length;
  refreshBadge();
}

function refreshBadge() {
  if (alertCount > 0) {
    chrome.action.setBadgeText({ text: String(alertCount) });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
  } else if (pendingPick) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

function setPendingPick(value) {
  pendingPick = Boolean(value);
  refreshBadge();
}

function setAlertCount(count) {
  alertCount = Math.max(0, Number(count) || 0);
  refreshBadge();
}

async function syncAlertCountFromStorage() {
  const { unreadAlerts = [] } = await chrome.storage.local.get("unreadAlerts");
  setAlertCount(unreadAlerts.length);
}

initBadgeFromStorage();
