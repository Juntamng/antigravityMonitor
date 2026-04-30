/**
 * index.js — Service entrypoint
 *
 * Express server on 127.0.0.1:3579 (localhost-only).
 * Loads API routes, auth routes, and starts the monitor scheduler.
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const api = require("./api");
const auth = require("./auth");
const { loadAllSchedules } = require("./scheduler");

const PORT = process.env.PORT || 3579;
const HOST = "127.0.0.1";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use(auth);   // /auth/google, /auth/callback (public)
app.use(api);    // /health (public), everything else (protected)

// Start
app.listen(PORT, HOST, async () => {
  console.log(`\n  ┌─────────────────────────────────────────────┐`);
  console.log(`  │  Page Monitor Service                        │`);
  console.log(`  │  Running on http://${HOST}:${PORT}          │`);
  console.log(`  │  Database: Supabase (PostgreSQL)              │`);
  console.log(`  └─────────────────────────────────────────────┘\n`);

  // Load existing monitor schedules
  await loadAllSchedules();
});
