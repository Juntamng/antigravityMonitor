/**
 * api.js — Express router
 *
 * All 10 REST endpoints consumed by the Chrome extension.
 */

const { Router } = require("express");
const { stmts } = require("./db");
const { scheduleMonitor, unscheduleMonitor, runCheck } = require("./scheduler");

const router = Router();

// ── Health ──────────────────────────────────────────────

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ── Monitors CRUD ───────────────────────────────────────

router.get("/monitors", (_req, res) => {
  try {
    const monitors = stmts.getAllMonitors.all();
    res.json(monitors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/monitors", (req, res) => {
  try {
    const { label, url, selector, interval_minutes = 5, last_value = null } = req.body;

    if (!label || !url || !selector) {
      return res.status(400).json({ error: "label, url, and selector are required" });
    }

    const result = stmts.createMonitor.run(
      label,
      url,
      selector,
      interval_minutes,
      last_value
    );

    const monitor = stmts.getMonitor.get(result.lastInsertRowid);
    scheduleMonitor(monitor);

    res.status(201).json(monitor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/monitors/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    unscheduleMonitor(id);
    stmts.deleteMonitor.run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Immediate check ─────────────────────────────────────

router.post("/monitors/:id/check", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await runCheck(id);
    res.json({ ok: true, last_value: result.value, changed: result.changed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Browser-assisted checks ────────────────────────────

router.get("/monitors/pending-browser-checks", (_req, res) => {
  try {
    const pending = stmts.getPendingBrowserChecks.all();
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/monitors/:id/browser-result", (req, res) => {
  try {
    const id = Number(req.params.id);
    const { value, error } = req.body;

    // Always clear the pending flag
    stmts.clearBrowserCheck.run(id);

    if (error) {
      stmts.insertHistory.run(id, null, error);
      return res.json({ ok: true, error });
    }

    const monitor = stmts.getMonitor.get(id);
    if (!monitor) {
      return res.status(404).json({ error: "Monitor not found" });
    }

    // Write history
    stmts.insertHistory.run(id, value, null);

    // Detect change
    const oldValue = monitor.last_value;
    if (oldValue !== null && oldValue !== value) {
      stmts.insertAlert.run(id, oldValue, value);
    }

    // Update value
    stmts.updateMonitorValue.run(value, id);

    res.json({ ok: true, changed: oldValue !== null && oldValue !== value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── History ─────────────────────────────────────────────

router.get("/monitors/:id/history", (req, res) => {
  try {
    const id = Number(req.params.id);
    const history = stmts.getHistory.all(id);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Alerts ──────────────────────────────────────────────

router.get("/alerts/pending", (_req, res) => {
  try {
    const alerts = stmts.getPendingAlerts.all();
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/alerts/:id/ack", (req, res) => {
  try {
    const id = Number(req.params.id);
    stmts.ackAlert.run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
