/**
 * content.js — Content script entry: wires message listener to modules.
 */
(() => {
  const { MSG } = PAGE_MONITOR_CONSTANTS;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === MSG.ACTIVATE_PICKER) {
      PageMonitorPicker.activatePicker();
    } else if (msg.type === MSG.CLOSE_SAVE_PANEL) {
      PageMonitorSavePanel.closeSavePanel();
    } else if (msg.type === MSG.SHOW_SAVE_PANEL) {
      PageMonitorSavePanel.showSavePanel(msg.payload || {});
    } else if (msg.type === MSG.SHOW_TOAST) {
      PageMonitorToast.showToast(msg.payload);
    }
  });
})();
