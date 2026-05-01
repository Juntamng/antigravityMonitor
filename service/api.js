/**
 * api.js — Express router (Cloud API — Render)
 *
 * Routes:
 *   Public   : /health
 *   User JWT : /monitors, /alerts, /extension/jobs, /extension/result/:id
 *   Agent    : /agent/jobs, /agent/result/:id, /agent/heartbeat
 *
 * The local MacBook agent consumes /agent/* using AGENT_SECRET.
 * The Chrome extension consumes /extension/jobs and /extension/result/:id
 * using the user's Supabase JWT (user-scoped — only their own monitors).
 */

const { Router } = require("express");
const db = require("./db");

const router = Router();

// ── Auth Middleware (User JWT) ──────────────────────────

async function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Authentication required" });

  try {
    req.user = await db.getUserFromToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ── Auth Middleware (Agent Secret) ─────────────────────

function requireAgent(req, res, next) {
  const secret = req.headers["x-agent-secret"];
  if (!secret || secret !== process.env.AGENT_SECRET) {
    return res.status(401).json({ error: "Invalid agent secret" });
  }
  next();
}

// ── Health (public) ─────────────────────────────────────

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "page-monitor-cloud-api" });
});

// ── Monitors CRUD (user JWT) ────────────────────────────

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
    const {
      label,
      url,
      selector,
      interval_minutes = 5,
      last_value = null,
      execution_mode = "agent",
    } = req.body;

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
      execution_mode,
    });

    res.status(201).json(monitor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/monitors/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.deleteMonitor(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── History (user JWT) ──────────────────────────────────

router.get("/monitors/:id/history", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const history = await db.getHistory(id);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Alerts (user JWT) ───────────────────────────────────

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

// ── Extension Jobs (user JWT) ───────────────────────────
// Called by the Chrome extension alarm to get login-gated monitors due for check.

router.get("/extension/jobs", requireAuth, async (req, res) => {
  try {
    const jobs = await db.getExtensionJobs(req.user.id);
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Extension posts its check result here (same pipeline as agent)
router.post("/extension/result/:id", requireAuth, async (req, res) => {
  try {
    const monitorId = Number(req.params.id);
    const { value, error: checkError } = req.body;
    const result = await db.processCheckResult(monitorId, value, checkError);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agent Jobs (AGENT_SECRET) ───────────────────────────
// Called by the local MacBook agent to fetch monitors due for automated check.

router.get("/agent/jobs", requireAgent, async (req, res) => {
  try {
    const agentId = req.headers["x-agent-id"] || "default";
    const jobs = await db.getAgentJobs(agentId);
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agent posts its check result here
router.post("/agent/result/:id", requireAgent, async (req, res) => {
  try {
    const monitorId = Number(req.params.id);
    const { value, error: checkError } = req.body;
    const result = await db.processCheckResult(monitorId, value, checkError);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agent heartbeat — cloud records liveness
router.post("/agent/heartbeat", requireAgent, async (req, res) => {
  try {
    const { agent_id, status, monitor_count } = req.body;
    await db.upsertAgentHeartbeat({ agent_id, status, monitor_count });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
