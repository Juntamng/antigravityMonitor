/**
 * index.js — Cloud API entrypoint (Render)
 *
 * Lightweight Express server. No Playwright, no scheduler.
 * All browser work is handled by the local agent.
 *
 * Env vars required (set in Render dashboard):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY,
 *   AGENT_SECRET
 */

// `dotenv` is useful locally, but optional in cloud runtimes like Render
// where environment variables are injected by the platform.
try {
  require("dotenv").config();
} catch (err) {
  if (err && err.code !== "MODULE_NOT_FOUND") {
    throw err;
  }
}

const express = require("express");
const cors = require("cors");
const api = require("./api");
const auth = require("./auth");

const PORT = process.env.PORT || 3579;

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use(auth);  // /auth/google, /auth/callback (public)
app.use(api);   // /health, /monitors, /alerts, /agent/*, /extension/*

app.listen(PORT, () => {
  console.log(`\n  ┌────────────────────────────────────────────────┐`);
  console.log(`  │  Page Monitor Cloud API                        │`);
  console.log(`  │  Listening on port ${String(PORT).padEnd(27)}│`);
  console.log(`  │  Database : Supabase (PostgreSQL)              │`);
  console.log(`  │  Scheduler: Delegated to local agent           │`);
  console.log(`  └────────────────────────────────────────────────┘\n`);
});
