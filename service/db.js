/**
 * db.js — SQLite persistence layer
 *
 * Uses Node.js built-in node:sqlite (--experimental-sqlite).
 * Database stored at ~/.page-monitor/data.db with WAL mode
 * and foreign-key enforcement.
 *
 * Tables: monitors, history, alerts
 */

const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const DB_DIR = path.join(os.homedir(), ".page-monitor");
const DB_PATH = path.join(DB_DIR, "data.db");

// Ensure directory exists
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and foreign keys
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// ── Schema ──────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS monitors (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    label         TEXT    NOT NULL,
    url           TEXT    NOT NULL,
    selector      TEXT    NOT NULL,
    interval_minutes INTEGER NOT NULL DEFAULT 5,
    last_value    TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    active        INTEGER NOT NULL DEFAULT 1
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id  INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    value       TEXT,
    checked_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    error       TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id  INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    old_value   TEXT,
    new_value   TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    acked       INTEGER NOT NULL DEFAULT 0
  )
`);

// ── Idempotent migrations ───────────────────────────────

function columnExists(table, column) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  return info.some((col) => col.name === column);
}

if (!columnExists("monitors", "active")) {
  db.exec(
    "ALTER TABLE monitors ADD COLUMN active INTEGER NOT NULL DEFAULT 1"
  );
}

if (!columnExists("monitors", "pending_browser_check")) {
  db.exec(
    "ALTER TABLE monitors ADD COLUMN pending_browser_check INTEGER NOT NULL DEFAULT 0"
  );
}

if (!columnExists("monitors", "check_method")) {
  db.exec(
    "ALTER TABLE monitors ADD COLUMN check_method TEXT NOT NULL DEFAULT 'auto'"
  );
}

if (!columnExists("history", "error")) {
  db.exec("ALTER TABLE history ADD COLUMN error TEXT");
}

// ── Prepared statements ─────────────────────────────────

const stmts = {
  // Monitors
  getAllMonitors: db.prepare(`
    SELECT m.*,
           (SELECT MAX(checked_at) FROM history WHERE monitor_id = m.id) AS last_checked
    FROM monitors m
    WHERE m.active = 1
    ORDER BY m.created_at DESC
  `),

  getMonitor: db.prepare("SELECT * FROM monitors WHERE id = ?"),

  createMonitor: db.prepare(`
    INSERT INTO monitors (label, url, selector, interval_minutes, last_value)
    VALUES (?, ?, ?, ?, ?)
  `),

  deleteMonitor: db.prepare("UPDATE monitors SET active = 0 WHERE id = ?"),

  updateMonitorValue: db.prepare(
    "UPDATE monitors SET last_value = ? WHERE id = ?"
  ),

  flagBrowserCheck: db.prepare(
    "UPDATE monitors SET pending_browser_check = 1 WHERE id = ?"
  ),

  clearBrowserCheck: db.prepare(
    "UPDATE monitors SET pending_browser_check = 0 WHERE id = ?"
  ),

  getPendingBrowserChecks: db.prepare(`
    SELECT id, label, url, selector
    FROM monitors
    WHERE active = 1 AND pending_browser_check = 1
  `),

  // History
  insertHistory: db.prepare(`
    INSERT INTO history (monitor_id, value, error)
    VALUES (?, ?, ?)
  `),

  getHistory: db.prepare(`
    SELECT * FROM history
    WHERE monitor_id = ?
    ORDER BY checked_at DESC
    LIMIT 100
  `),

  // Alerts
  insertAlert: db.prepare(`
    INSERT INTO alerts (monitor_id, old_value, new_value)
    VALUES (?, ?, ?)
  `),

  getPendingAlerts: db.prepare(`
    SELECT a.*, m.label AS monitor_label
    FROM alerts a
    JOIN monitors m ON a.monitor_id = m.id
    WHERE a.acked = 0
    ORDER BY a.created_at DESC
  `),

  ackAlert: db.prepare("UPDATE alerts SET acked = 1 WHERE id = ?"),
};

module.exports = { db, stmts, DB_PATH };
