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

  async function applyScheduledCacheUpdate(result) {
    if (historyOnly) return;
    const patch = { last_checked: new Date().toISOString() };
    if (result?.value != null && !result.error) {
      patch.last_value = result.value;
    }
    await patchMonitorInCache(monitor.id, patch);
  }

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

      if (historyOnly) {
        const optimistic = await applyOptimisticManualCheck(monitor, result);
        persistManualCheckResult(monitor, result).catch(() => {});
        checkResult = { ok: true, ...optimistic };
        console.log(
          `[bg] Manual check (optimistic) completed for monitor ${monitor.id}`
        );
      } else {
        checkResult = await apiFetch(resultPath, {
          method: "POST",
          body: JSON.stringify(result),
        });
        await applyScheduledCacheUpdate(result);
        console.log(`[bg] Browser check completed for monitor ${monitor.id}`);
      }
    } catch (err) {
      console.error(
        `[bg] Browser check failed for monitor ${monitor.id}:`,
        err.message
      );
      const errorPayload = { error: err.message };
      if (historyOnly) {
        try {
          const optimistic = await applyOptimisticManualCheck(
            monitor,
            errorPayload
          );
          persistManualCheckResult(monitor, errorPayload).catch(() => {});
          checkResult = { ok: true, ...optimistic };
        } catch {
          checkResult = { error: err.message };
        }
      } else {
        try {
          checkResult = await apiFetch(resultPath, {
            method: "POST",
            body: JSON.stringify(errorPayload),
          });
          await applyScheduledCacheUpdate(errorPayload);
        } catch (resultErr) {
          checkResult = { error: resultErr.message || err.message };
        }
      }
    } finally {
      await resetReusableMonitorTabToBlank(tabId);
    }
    return checkResult || { ok: true };
  });
}
