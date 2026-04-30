/**
 * index.js — Service entrypoint
 *
 * Express server on 127.0.0.1:3579 (localhost-only).
 * Loads API routes and starts the monitor scheduler.
 */

const express = require("express");
const cors = require("cors");
const api = require("./api");
const { loadAllSchedules } = require("./scheduler");
const { DB_PATH } = require("./db");

const PORT = 3579;
const HOST = "127.0.0.1";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use(api);

// Start
app.listen(PORT, HOST, () => {
  console.log(`\n  ┌─────────────────────────────────────────────┐`);
  console.log(`  │  Page Monitor Service                        │`);
  console.log(`  │  Running on http://${HOST}:${PORT}          │`);
  console.log(`  │  Database: ${DB_PATH}`);
  console.log(`  └─────────────────────────────────────────────┘\n`);

  // Load existing monitor schedules
  loadAllSchedules();
});
