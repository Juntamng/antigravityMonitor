/**
 * Browser-assisted monitor checks via reusable pinned tab.
 */

async function handleScheduledExtensionChecks() {
  try {
    await refreshSessionIfNeeded();
    const monitors = await apiFetch("/monitors/due-extension-checks");
    for (const monitor of monitors) {
      await executeBrowserCheck(monitor);
    }
  } catch (err) {
    if (err.message === "Not authenticated") return;
    console.log("[bg] Extension checks fetch failed:", err.message);
  }
}

async function executeBrowserCheck(monitor, options = {}) {
  const { historyOnly = false } = options;
  const resultPath = historyOnly
    ? `/monitors/${monitor.id}/manual-check-result`
    : `/monitors/${monitor.id}/browser-result`;

  return withMonitorTabLock(async () => {
    let tabId = null;
    let checkResult = null;
    try {
      tabId = await getOrCreateReusableMonitorTab(monitor.url);
      if (!tabId) throw new Error("Failed to initialize reusable monitor tab");

      await waitForTabComplete(tabId, 30000);

      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: pollElementValue,
        args: [monitor.selector],
      });

      const result = results?.[0]?.result || { error: "No result" };

      checkResult = await apiFetch(resultPath, {
        method: "POST",
        body: JSON.stringify(result),
      });

      console.log(`[bg] Browser check completed for monitor ${monitor.id}`);
    } catch (err) {
      console.error(
        `[bg] Browser check failed for monitor ${monitor.id}:`,
        err.message
      );
      try {
        checkResult = await apiFetch(resultPath, {
          method: "POST",
          body: JSON.stringify({ error: err.message }),
        });
      } catch (resultErr) {
        checkResult = { error: resultErr.message || err.message };
      }
    } finally {
      await resetReusableMonitorTabToBlank(tabId);
    }
    return checkResult || { ok: true };
  });
}
