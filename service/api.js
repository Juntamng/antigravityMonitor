/**
 * api.js — Express router
 *
 * All REST endpoints consumed by the Chrome extension.
 * Protected routes require a valid Supabase JWT in the
 * Authorization: Bearer <token> header.
 */

const { Router } = require("express");
const db = require("./db");
const { scheduleMonitor, unscheduleMonitor, runCheck } = require("./scheduler");

const router = Router();

// ── Auth Middleware ──────────────────────────────────────

async function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    req.user = await db.getUserFromToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ── Health (public) ──────────────────────────────────────

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ── Monitors CRUD ────────────────────────────────────────

router.get("/monitors", requireAuth, async (req, res) => {
  try {
    const monitors = await db.getAllMonitors(req.user.id);
    res.json(monitors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/monitors", requireAuth, async (req, res) => {
  try {
    const { label, url, selector, interval_minutes = 5, last_value = null } = req.body;

    if (!label || !url || !selector) {
      return res.status(400).json({ error: "label, url, and selector are required" });
    }

    const monitor = await db.createMonitor({
      userId: req.user.id,
      label,
      url,
      selector,
      interval_minutes,
      last_value,
    });

    scheduleMonitor(monitor);
    res.status(201).json(monitor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/monitors/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    unscheduleMonitor(id);
    await db.deleteMonitor(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Immediate check ──────────────────────────────────────

router.post("/monitors/:id/check", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await runCheck(id);
    res.json({ ok: true, last_value: result?.value, changed: result?.changed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Browser-assisted checks ──────────────────────────────

router.get("/monitors/pending-browser-checks", requireAuth, async (req, res) => {
  try {
    const pending = await db.getPendingBrowserChecks();
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/monitors/:id/browser-result", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { value, error } = req.body;

    // Always clear the pending flag
    await db.clearBrowserCheck(id);

    if (error) {
      await db.insertHistory(id, null, error);
      return res.json({ ok: true, error });
    }

    const monitor = await db.getMonitor(id);
    if (!monitor) {
      return res.status(404).json({ error: "Monitor not found" });
    }

    // Write history
    await db.insertHistory(id, value, null);

    // Detect change
    const oldValue = monitor.last_value;
    if (oldValue !== null && oldValue !== value) {
      await db.insertAlert(id, oldValue, value);
    }

    // Update value
    await db.updateMonitorValue(id, value);

    res.json({ ok: true, changed: oldValue !== null && oldValue !== value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── History ──────────────────────────────────────────────

router.get("/monitors/:id/history", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const history = await db.getHistory(id);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Alerts ───────────────────────────────────────────────

router.get("/alerts/pending", requireAuth, async (req, res) => {
  try {
    const alerts = await db.getPendingAlerts(req.user.id);
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/alerts/:id/ack", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.ackAlert(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
