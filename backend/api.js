/**
 * api.js — Express router
 *
 * User routes: Supabase JWT + RLS via supabaseForUser().
 * Agent routes: X-Agent-Secret + X-Agent-Id (service role on server).
 */

const { Router } = require("express");
const { supabaseAdmin, supabaseForUser } = require("./supabase");
const { requireAuth } = require("./auth");

const DEBUG = process.env.DEBUG === "true" || process.env.DEBUG === "1";

function dbg(...args) {
  if (DEBUG) console.log("[DEBUG]", ...args);
}

const router = Router();

/** Log every incoming request URL when DEBUG is enabled */
router.use((req, _res, next) => {
  dbg(`${req.method} ${req.originalUrl}`);
  next();
});

/** Attach RLS-scoped Supabase client after auth */
function withUserClient(req, res, next) {
  try {
    req.supabaseUser = supabaseForUser(req.accessToken);
    next();
  } catch (e) {
    res.status(503).json({ error: e.message || "Supabase not configured" });
  }
}

function requireAgent(req, res, next) {
  const secret = req.headers["x-agent-secret"];
  const agentId = req.headers["x-agent-id"];
  if (!process.env.AGENT_SECRET || secret !== process.env.AGENT_SECRET) {
    return res.status(401).json({ error: "Unauthorized agent" });
  }
  if (!agentId || typeof agentId !== "string") {
    return res.status(400).json({ error: "Missing X-Agent-Id header" });
  }
  req.agentId = agentId.trim();
  next();
}

async function mergeLastChecked(sb, monitors) {
  if (!monitors?.length) return monitors;
  const ids = monitors.map((m) => m.id);
  const { data: rows, error } = await sb
    .from("history")
    .select("monitor_id, checked_at")
    .in("monitor_id", ids)
    .order("checked_at", { ascending: false })
    .limit(Math.min(2000, ids.length * 50));

  if (error || !rows?.length) {
    return monitors.map((m) => ({ ...m, last_checked: null }));
  }

  const latest = new Map();
  for (const r of rows) {
    if (!latest.has(r.monitor_id)) latest.set(r.monitor_id, r.checked_at);
  }
  return monitors.map((m) => ({
    ...m,
    last_checked: latest.get(m.id) ?? null,
  }));
}

function addMinutesIso(iso, minutes) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + Number(minutes) || 5);
  return d.toISOString();
}

// ── Health ──────────────────────────────────────────────

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ── Auth profile ────────────────────────────────────────

router.get("/me", requireAuth, (req, res) => {
  const u = req.user;
  res.json({
    id: u.id,
    email: u.email,
    user_metadata: u.user_metadata,
  });
});

// ── Monitors (authenticated) ────────────────────────────

router.get("/monitors", requireAuth, withUserClient, async (req, res) => {
  try {
    const sb = req.supabaseUser;
    const { data, error } = await sb
      .from("monitors")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false });

    if (error) throw error;
    const withLast = await mergeLastChecked(sb, data || []);
    dbg("GET /monitors dataset:", JSON.stringify(withLast, null, 2));
    res.json(withLast);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/monitors", requireAuth, withUserClient, async (req, res) => {
  try {
    const {
      label,
      url,
      selector,
      interval_minutes = 5,
      last_value = null,
      execution_mode = "agent",
      assigned_agent = process.env.DEFAULT_AGENT_ID || "home-pc",
    } = req.body;

    if (!label || !url || !selector) {
      return res.status(400).json({ error: "label, url, and selector are required" });
    }

    const now = new Date().toISOString();
    const row = {
      user_id: req.user.id,
      label,
      url,
      selector,
      interval_minutes,
      last_value,
      active: true,
      pending_browser_check: false,
      execution_mode,
      assigned_agent,
      next_check_at: now,
    };

    const sb = req.supabaseUser;
    const { data, error } = await sb.from("monitors").insert(row).select("*").single();

    if (error) throw error;
    res.status(201).json({ ...data, last_checked: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/monitors/:id", requireAuth, withUserClient, async (req, res) => {
  try {
    const id = req.params.id;
    const sb = req.supabaseUser;
    const { error } = await sb.from("monitors").update({ active: false }).eq("id", id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * "Check now": no Playwright on server. Extension monitors → pending_browser_check;
 * agent monitors → bump next_check_at to now.
 */
router.post("/monitors/:id/check", requireAuth, withUserClient, async (req, res) => {
  try {
    const id = req.params.id;
    const sb = req.supabaseUser;

    const { data: monitor, error: fetchErr } = await sb
      .from("monitors")
      .select("*")
      .eq("id", id)
      .eq("active", true)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!monitor) {
      return res.status(404).json({ error: "Monitor not found" });
    }

    const now = new Date().toISOString();
    if (monitor.execution_mode === "agent") {
      const { error: upErr } = await sb
        .from("monitors")
        .update({ next_check_at: now })
        .eq("id", id);
      if (upErr) throw upErr;
      return res.json({
        ok: true,
        queued: "agent",
        message: "Agent will pick up this monitor on its next poll",
      });
    }

    const { error: upErr } = await sb
      .from("monitors")
      .update({ pending_browser_check: true })
      .eq("id", id);
    if (upErr) throw upErr;

    return res.json({
      ok: true,
      queued: "extension",
      message: "Browser-assisted check queued for the extension",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/monitors/pending-browser-checks", requireAuth, withUserClient, async (req, res) => {
  try {
    const sb = req.supabaseUser;
    const { data, error } = await sb
      .from("monitors")
      .select("id, label, url, selector")
      .eq("active", true)
      .eq("pending_browser_check", true);

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/monitors/:id/browser-result", requireAuth, withUserClient, async (req, res) => {
  try {
    const id = req.params.id;
    const { value, error: bodyError } = req.body;
    const sb = req.supabaseUser;

    const { error: clearErr } = await sb
      .from("monitors")
      .update({ pending_browser_check: false })
      .eq("id", id);
    if (clearErr) throw clearErr;

    if (bodyError) {
      const { error: histErr } = await sb.from("history").insert({
        monitor_id: id,
        value: null,
        error: bodyError,
      });
      if (histErr) throw histErr;
      return res.json({ ok: true, error: bodyError });
    }

    const { data: monitor, error: monErr } = await sb
      .from("monitors")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (monErr) throw monErr;
    if (!monitor) {
      return res.status(404).json({ error: "Monitor not found" });
    }

    const { error: histErr } = await sb.from("history").insert({
      monitor_id: id,
      value,
      error: null,
    });
    if (histErr) throw histErr;

    const oldValue = monitor.last_value;
    if (oldValue !== null && oldValue !== value) {
      const alertRow = {
        monitor_id: id,
        old_value: oldValue,
        new_value: value,
        user_id: monitor.user_id,
      };
      const { error: alertErr } = await sb.from("alerts").insert(alertRow);
      if (alertErr) throw alertErr;
    }

    const nextAt = addMinutesIso(new Date().toISOString(), monitor.interval_minutes);
    const { error: upErr } = await sb
      .from("monitors")
      .update({
        last_value: value,
        pending_browser_check: false,
        next_check_at: nextAt,
      })
      .eq("id", id);
    if (upErr) throw upErr;

    res.json({ ok: true, changed: oldValue !== null && oldValue !== value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/monitors/:id/history", requireAuth, withUserClient, async (req, res) => {
  try {
    const id = req.params.id;
    const sb = req.supabaseUser;
    const { data, error } = await sb
      .from("history")
      .select("*")
      .eq("monitor_id", id)
      .order("checked_at", { ascending: false })
      .limit(100);

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/alerts/pending", requireAuth, withUserClient, async (req, res) => {
  try {
    const sb = req.supabaseUser;
    const { data: alerts, error: aErr } = await sb
      .from("alerts")
      .select("*")
      .eq("acked", false)
      .order("created_at", { ascending: false });
    if (aErr) throw aErr;
    if (!alerts?.length) return res.json([]);

    const monitorIds = [...new Set(alerts.map((a) => a.monitor_id))];
    const { data: monitors, error: mErr } = await sb
      .from("monitors")
      .select("id, label")
      .in("id", monitorIds);
    if (mErr) throw mErr;
    const labelById = new Map((monitors || []).map((m) => [m.id, m.label]));

    const enriched = alerts.map((a) => ({
      ...a,
      monitor_label: labelById.get(a.monitor_id) || "Monitor",
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/alerts/:id/ack", requireAuth, withUserClient, async (req, res) => {
  try {
    const id = req.params.id;
    const sb = req.supabaseUser;
    const { error } = await sb.from("alerts").update({ acked: true }).eq("id", id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agent (service role on server) ──────────────────────

router.post("/agent/heartbeat", requireAgent, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase admin not configured" });
    }
    const agentId = req.agentId;
    const monitor_count =
      typeof req.body?.monitor_count === "number" ? req.body.monitor_count : null;
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      null;

    const row = {
      agent_id: agentId,
      last_seen: new Date().toISOString(),
      status: "online",
      monitor_count,
      ip_address: ip,
    };

    const { error } = await supabaseAdmin.from("agent_registry").upsert(row, {
      onConflict: "agent_id",
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/agent/tasks", requireAgent, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase admin not configured" });
    }
    const agentId = req.agentId;
    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("monitors")
      .select("*")
      .eq("assigned_agent", agentId)
      .eq("active", true)
      .eq("execution_mode", "agent")
      .lte("next_check_at", now);

    if (error) throw error;
    dbg(`GET /agent/tasks [agent=${agentId}] dataset:`, JSON.stringify(data, null, 2));
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/agent/result", requireAgent, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Supabase admin not configured" });
    }
    const { monitor_id, value, error: checkError } = req.body;
    if (!monitor_id) {
      return res.status(400).json({ error: "monitor_id is required" });
    }

    const { data: monitor, error: mErr } = await supabaseAdmin
      .from("monitors")
      .select("*")
      .eq("id", monitor_id)
      .maybeSingle();
    if (mErr) throw mErr;
    if (!monitor) {
      return res.status(404).json({ error: "Monitor not found" });
    }
    if (monitor.assigned_agent !== req.agentId) {
      return res.status(403).json({ error: "Monitor not assigned to this agent" });
    }
    dbg(`POST /agent/result monitor_id=${monitor_id} url=${monitor.url} value=${value} error=${checkError ?? null}`);

    const now = new Date().toISOString();

    if (checkError) {
      await supabaseAdmin.from("history").insert({
        monitor_id,
        value: null,
        error: checkError,
      });
      const nextAt = addMinutesIso(now, monitor.interval_minutes);
      await supabaseAdmin
        .from("monitors")
        .update({ next_check_at: nextAt, pending_browser_check: false })
        .eq("id", monitor_id);
      return res.json({ ok: true, error: checkError });
    }

    await supabaseAdmin.from("history").insert({
      monitor_id,
      value,
      error: null,
    });

    const oldValue = monitor.last_value;
    let changed = false;
    if (oldValue !== null && oldValue !== value) {
      changed = true;
      await supabaseAdmin.from("alerts").insert({
        monitor_id,
        old_value: oldValue,
        new_value: value,
        user_id: monitor.user_id,
      });
    }

    const nextAt = addMinutesIso(now, monitor.interval_minutes);
    await supabaseAdmin
      .from("monitors")
      .update({
        last_value: value,
        pending_browser_check: false,
        next_check_at: nextAt,
      })
      .eq("id", monitor_id);

    res.json({ ok: true, changed, last_value: value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
