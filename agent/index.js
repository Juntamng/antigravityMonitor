/**
 * index.js — Local Agent entrypoint
 *
 * Starts two things:
 *   1. The Playwright poll scheduler (background job runner)
 *   2. A tiny management HTTP server on 127.0.0.1:LOCAL_PORT
 *      for the extension status dot and CLI control
 */

const express = require("express");
const scheduler = require("./scheduler");
const { closeBrowser } = require("./checker");
const { AGENT_ID, LOCAL_PORT } = require("./config");

// ── Management HTTP server (localhost only) ──────────────

const app = express();
app.use(express.json());

/** GET /status — health check consumed by extension status dot */
app.get("/status", (_req, res) => {
  res.json({
    ok: true,
    agent_id: AGENT_ID,
    paused: scheduler.isPaused(),
    active_jobs: scheduler.getActiveJobCount(),
    uptime_seconds: Math.floor(process.uptime()),
    version: "1.0.0",
  });
});

/** POST /pause — temporarily stop executing checks */
app.post("/pause", (_req, res) => {
  scheduler.pause();
  res.json({ ok: true, paused: true });
});

/** POST /resume — re-enable check execution */
app.post("/resume", (_req, res) => {
  scheduler.resume();
  res.json({ ok: true, paused: false });
});

/** POST /run/:id — trigger an immediate check (extension "Check Now" button) */
app.post("/run/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await scheduler.runNow(id);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Boot ─────────────────────────────────────────────────

app.listen(LOCAL_PORT, "127.0.0.1", () => {
  console.log(`\n  ┌────────────────────────────────────────────────┐`);
  console.log(`  │  Page Monitor Agent                            │`);
  console.log(`  │  Agent ID : ${AGENT_ID.padEnd(32)}│`);
  console.log(`  │  Management: http://127.0.0.1:${LOCAL_PORT}         │`);
  console.log(`  └────────────────────────────────────────────────┘\n`);

  // Start polling for jobs
  scheduler.start();
});

// ── Graceful shutdown ─────────────────────────────────────

async function shutdown(signal) {
  console.log(`\n[agent] Received ${signal}, shutting down gracefully…`);
  scheduler.stop();
  await closeBrowser();
  process.exit(0);
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
