/**
 * Poll backend for new alerts; notify user with targeted tab toasts.
 */

function urlsMatch(monitorUrl, tabUrl) {
  if (!monitorUrl || !tabUrl) return false;
  try {
    const monitor = new URL(monitorUrl);
    const tab = new URL(tabUrl);
    if (monitor.origin !== tab.origin) return false;
    const monitorPath = monitor.pathname.replace(/\/$/, "") || "/";
    const tabPath = tab.pathname.replace(/\/$/, "") || "/";
    return monitorPath === tabPath || tab.href.startsWith(monitorUrl);
  } catch {
    return tabUrl.startsWith(monitorUrl);
  }
}

async function sendToastToTab(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: PAGE_MONITOR_CONSTANTS.MSG.SHOW_TOAST,
      payload,
    });
    return true;
  } catch {
    return false;
  }
}

async function showAlertToast(monitor, alert, tabs) {
  const payload = {
    label: alert.monitor_label,
    oldValue: alert.old_value,
    newValue: alert.new_value,
  };

  if (!monitor?.url) {
    return false;
  }

  const matching = tabs.filter((tab) => tab.url && urlsMatch(monitor.url, tab.url));
  if (matching.length === 0) {
    return false;
  }

  matching.sort((a, b) => {
    if (a.active && !b.active) return -1;
    if (!a.active && b.active) return 1;
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });

  for (const tab of matching) {
    if (tab.id && (await sendToastToTab(tab.id, payload))) {
      return true;
    }
  }
  return false;
}

async function broadcastAlertToast(alert, tabs) {
  const payload = {
    label: alert.monitor_label,
    oldValue: alert.old_value,
    newValue: alert.new_value,
  };
  for (const tab of tabs) {
    if (tab.id) {
      await sendToastToTab(tab.id, payload);
    }
  }
}

async function handleAlertPolling() {
  try {
    await refreshSessionIfNeeded();
    const alerts = await apiFetch("/alerts/pending");

    if (!alerts.length) return;

    const { unreadAlerts = [] } =
      await chrome.storage.local.get("unreadAlerts");
    const existingIds = new Set(unreadAlerts.map((a) => a.id));
    const newAlerts = alerts.filter((a) => !existingIds.has(a.id));

    if (newAlerts.length === 0) return;

    const merged = [...newAlerts, ...unreadAlerts].slice(0, 50);
    await chrome.storage.local.set({ unreadAlerts: merged });
    setAlertCount(merged.length);

    let monitorsById = null;
    let allTabs = null;

    for (const alert of newAlerts) {
      chrome.notifications.create(`alert-${alert.id}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: `Change: ${alert.monitor_label}`,
        message: `"${PAGE_MONITOR_UTILS.truncate(alert.old_value)}" → "${PAGE_MONITOR_UTILS.truncate(alert.new_value)}"`,
      });

      try {
        if (!monitorsById) {
          const monitors = await apiFetch("/monitors");
          monitorsById = new Map(monitors.map((m) => [m.id, m]));
        }
        if (!allTabs) {
          allTabs = await chrome.tabs.query({});
        }

        const monitor = monitorsById.get(alert.monitor_id);
        const shown = monitor
          ? await showAlertToast(monitor, alert, allTabs)
          : false;
        if (!shown) {
          await broadcastAlertToast(alert, allTabs);
        }
      } catch {
        /* best effort */
      }

      try {
        await apiFetch(`/alerts/${alert.id}/ack`, { method: "POST" });
      } catch {
        /* retry next poll */
      }
    }
  } catch (err) {
    if (err.message === "Not authenticated") return;
    console.log("[bg] Alert polling failed:", err.message);
  }
}
