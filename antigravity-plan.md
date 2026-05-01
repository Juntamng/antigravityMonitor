Three-Tier Architecture Migration Plan
Extension → Backend (Supabase) → Agent
Approved Decisions
Question	Decision
Backend hosting	Render (Node.js Express)
Google login UX	chrome.identity.launchWebAuthFlow (stays inside extension popup)
Agent identity	Auto-generated UUID stored in .env / agent_registry
Background
The system is evolving from a local-only, single-user architecture (Extension + localhost Node.js service + SQLite) into a three-tier, multi-user, cloud-backed architecture:

Tier	Current	Target
Extension	Talks to localhost:3579, no auth	Talks to deployed backend API, Supabase Auth login
Backend	Local Express + SQLite	Deployed Node.js + Supabase (PostgreSQL + Auth)
Agent	Playwright inside the same Node service	Separate agent process on local PC (or AWS WorkSpaces), polling Supabase
The Supabase project already exists at https://avvadnrovreimjfqbqdl.supabase.co and has two applied migrations with the tables: monitors, history, alerts, and agent_registry — plus RLS policies and agent-scheduling columns (next_check_at, assigned_agent, execution_mode).

User Review Required
IMPORTANT

The Supabase DB schema is already partially migrated. We must not re-create existing tables. The plan adds only missing gaps (e.g. user_id on alerts table for RLS; performance indexes).

WARNING

The extension will now make network calls to a public HTTPS backend instead of localhost. This changes the threat surface: all API calls from the extension must carry a Supabase JWT to be authorized. Any existing test data in Supabase tied to user_id = NULL may become invisible under RLS.

IMPORTANT

Agent authentication: The agent process is not a human user. It will authenticate with a Supabase service role key (kept on the local PC only, never in the extension). This is safe as long as the key never leaves the agent environment.

Current Supabase Schema (Already Exists)
monitors        — id, user_id (FK → auth.users), label, url, selector,
                  interval_minutes, last_value, created_at, active,
                  pending_browser_check, execution_mode (agent|extension),
                  next_check_at, assigned_agent
history         — id, monitor_id, value, checked_at, error
alerts          — id, monitor_id, old_value, new_value, created_at, acked
agent_registry  — agent_id (PK), last_seen, status, monitor_count, ip_address
RLS is enabled on monitors, history, alerts (but NOT on agent_registry).

Proposed Changes
Tier 1: Backend API Service
The existing service/ directory becomes the deployed backend. It replaces SQLite with Supabase and adds authentication middleware.

[MODIFY] service/ — Concept renamed to backend/
Restructure the directory:

backend/
  index.js          ← Express entry, binds to 0.0.0.0 (deployed, not localhost)
  api.js            ← All routes, now require JWT auth middleware
  db.js             ← [DELETE] replaced by supabase.js
  scheduler.js      ← [DELETE] moved to Agent tier
  checker.js        ← [DELETE] moved to Agent tier
  supabase.js       ← [NEW] Supabase client factory
  auth.js           ← [NEW] JWT verification middleware
  package.json      ← Add: @supabase/supabase-js; drop: node-cron, playwright
Key API changes:

All user routes require Authorization: Bearer <supabase_jwt> header
user_id is extracted from the JWT and scoped to all DB queries (RLS handles enforcement)
GET /monitors — queries Supabase monitors table (RLS scopes to user)
POST /monitors — inserts with user_id from JWT, sets next_check_at = now()
Scheduling is no longer managed by the backend — next_check_at and assigned_agent fields drive agent scheduling
Backend still owns: monitor CRUD, alert acknowledgment, history reads, health
New endpoints:

GET /me — returns authenticated user profile
POST /agent/heartbeat — agent upserts agent_registry row (protected by AGENT_SECRET env var header)
GET /agent/tasks — returns monitors due for the calling agent
POST /agent/result — agent posts check result (writes history, alert if changed, updates last_value)
[NEW] backend/supabase.js
Supabase client factory:

supabaseAdmin — uses SUPABASE_SERVICE_ROLE_KEY, bypasses RLS, used only for agent endpoints and admin ops
supabaseForUser(jwt) — creates per-request client with user JWT, respects RLS
[NEW] backend/auth.js
Express middleware:

Extracts Authorization: Bearer <token> header
Verifies JWT via supabaseAdmin.auth.getUser(token)
Attaches req.user to request
Returns 401 if missing or invalid
[MODIFY] backend/api.js
All user routes wrapped with auth middleware
Routes call Supabase SDK instead of SQLite stmts
Scheduler and checker imports removed
Agent routes added with AGENT_SECRET header check (not user JWT)
Schema Gap Migrations
Additive only — existing data is preserved:

alerts.user_id — add for efficient RLS (currently RLS on alerts relies on a join through monitors; denormalizing with user_id is cleaner and faster)
Performance indexes — monitors(assigned_agent, next_check_at) for agent polling, alerts(user_id) for RLS queries
Tier 2: Chrome Extension
The extension stops talking to localhost:3579 and instead talks to the deployed backend URL over HTTPS.

[MODIFY] extension/manifest.json
Remove http://localhost:3579/* host permission
Add deployed backend URL: https://<your-backend-host>/*
Add Supabase project URL: https://avvadnrovreimjfqbqdl.supabase.co/*
Add identity permission (for Google OAuth flow)
[MODIFY] extension/background.js
Replace SERVICE_URL = "http://localhost:3579" with deployed backend URL
All fetch calls to backend now include Authorization: Bearer <jwt> header
Add auth state management: on startup, check if user is logged in (JWT in chrome.storage.local)
Add message handlers: LOGIN, LOGOUT, GOOGLE_LOGIN, GET_AUTH_STATE, REFRESH_SESSION
Browser-assisted check polling remains (extension is still the execution_mode = 'extension' runner)
Add periodic alarm to refresh JWT before expiry
[NEW] extension/popup/auth.js
Auth UI controller:

Detects logged-in state on popup open
Shows login form (email/password) or Google button if not logged in
On email login: calls Supabase Auth REST API directly using the anon key, stores session in chrome.storage.local
On Google login: sends GOOGLE_LOGIN message to background, which uses chrome.identity.launchWebAuthFlow
On logout: clears storage, resets badge
[MODIFY] extension/popup/popup.html + popup.js
Add auth-gated view: show login screen if not authenticated, monitor list if authenticated
Show user email in popup header when logged in
All backend calls pass JWT via the background message bus
Auth Flow
User opens popup
  → Checks chrome.storage.local for { session }
  → If none → show Login screen
      Email/Password → Supabase Auth REST → store { access_token, refresh_token }
      Google → background: chrome.identity.launchWebAuthFlow → Supabase OAuth → store session
  → If session exists → check expiry, refresh via background alarm if needed
  → Show monitor list (all API calls carry Bearer token)
Token refresh: Supabase JWTs expire in 1 hour. A background alarm runs every 45 minutes to call supabase.auth.refreshSession() and update chrome.storage.local.

Tier 3: Agent (Local PC / AWS WorkSpaces)
The agent is an entirely new standalone Node.js process that runs on your local PC (future: AWS WorkSpaces). It does NOT share code with the deployed backend.

[NEW] agent/ directory
agent/
  index.js        ← Entry: init, register agent, start poll + heartbeat loops
  poller.js       ← Polls Supabase for due monitors assigned to this agent
  checker.js      ← Playwright-based page evaluator (ported from service/checker.js)
  reporter.js     ← Writes results to Supabase (history, alerts, monitor value update)
  heartbeat.js    ← Updates agent_registry every 30s, marks offline on shutdown
  config.js       ← Reads env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AGENT_ID
  package.json    ← Dependencies: @supabase/supabase-js, playwright, dotenv
  .env.example    ← Template: SUPABASE_URL=, SUPABASE_SERVICE_ROLE_KEY=, AGENT_ID=home-pc
  ecosystem.config.js ← PM2 config for auto-start on local PC
Agent Polling Logic (poller.js)
Every POLL_INTERVAL seconds (default: 30s):
  1. Query Supabase:
       SELECT * FROM monitors
       WHERE assigned_agent = AGENT_ID
         AND active = true
         AND execution_mode = 'agent'
         AND next_check_at <= now()
  2. For each due monitor:
     a. Optimistic lock: UPDATE monitors SET next_check_at = now() + interval WHERE id = X
     b. Run checker.js → extract DOM value
     c. Compare with monitor.last_value
     d. INSERT INTO history (monitor_id, value, checked_at)
     e. If changed: INSERT INTO alerts (monitor_id, old_value, new_value, user_id)
     f. UPDATE monitors SET last_value = newValue, pending_browser_check = false WHERE id = X
  3. On error:
     - INSERT INTO history (monitor_id, error, checked_at)
     - Log locally, continue to next monitor
Concurrency safety: Step 2a's optimistic next_check_at update prevents two agents from double-processing the same monitor.

Agent Registration & Heartbeat
On startup, agent upserts into agent_registry:

sql
INSERT INTO agent_registry (agent_id, last_seen, status, ip_address)
VALUES ($AGENT_ID, now(), 'online', $IP)
ON CONFLICT (agent_id) DO UPDATE
  SET last_seen = now(), status = 'online', ip_address = $IP
Heartbeat runs every 30s. On SIGTERM/SIGINT: sets status = 'offline', exits cleanly.

Agent Authentication
The agent uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS entirely and write to all tables.

CAUTION

The service role key must never be committed to git. Add agent/.env to .gitignore. Only commit .env.example with placeholder values.

End-to-End Data Flow
opens popup
no session
email+password or Google
JWT session
JWT API calls
Supabase SDK + RLS
service role key, poll due monitors
Playwright check
write history + alerts
browser-assisted fallback
selector result
write result
poll alerts
badge + toast + OS notification
User
Extension
Login Screen
Supabase Auth
Deployed Backend API
Supabase PostgreSQL
Agent
Target Webpage
Hidden Chrome Tab
execution_mode on each monitor determines the check runner:

'agent' → local PC agent picks it up via polling
'extension' → extension runs browser-assisted check in a hidden tab
Schema Migrations Needed
Only additive changes — all existing rows and relations preserved.

Migration 3: alerts.user_id + performance indexes
sql
-- Denormalize user_id onto alerts for simpler/faster RLS
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
-- Backfill from monitors
UPDATE alerts a
SET user_id = m.user_id
FROM monitors m
WHERE a.monitor_id = m.id;
-- Agent polling index
CREATE INDEX IF NOT EXISTS idx_monitors_agent_due
  ON monitors (assigned_agent, next_check_at)
  WHERE active = true;
-- Alerts RLS query index
CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts (user_id);
Implementation Order
Phase 1 — Backend Supabase migration (drop SQLite)
  [ ] 1. Rename service/ → backend/, add supabase.js + auth.js
  [ ] 2. Rewrite api.js routes to use Supabase SDK (drop stmts/db.js)
  [ ] 3. Add /agent/heartbeat, /agent/tasks, /agent/result endpoints
  [ ] 4. Run migration 3 (alerts.user_id + indexes)
  [ ] 5. Deploy backend to Railway/Render
Phase 2 — Extension auth
  [ ] 6. Add Supabase JS SDK to extension (bundled or CDN in popup)
  [ ] 7. Build auth.js UI controller (login/logout/google)
  [ ] 8. Modify popup.html + popup.js for auth-gated view
  [ ] 9. Wire JWT to all background.js API calls
  [ ] 10. Update manifest.json permissions + host_permissions
Phase 3 — Agent
  [ ] 11. Scaffold agent/ directory, config.js, package.json
  [ ] 12. Port checker.js from service/ into agent/
  [ ] 13. Implement poller.js + reporter.js
  [ ] 14. Implement heartbeat.js
  [ ] 15. Add PM2 ecosystem.config.js for local PC auto-start
  [ ] 16. End-to-end test: extension creates monitor → agent checks → result in Supabase → alert in extension
Verification Plan
Automated Tests
Backend curl smoke tests: /health (no auth), /monitors (valid JWT), /monitors (no JWT → 401)
Agent dry-run mode flag: log what would be written without actually writing to DB
Manual Verification
 Email/password login → monitor list loads
 Google login → monitor list loads
 Create monitor → row appears in Supabase monitors with correct user_id
 Agent polls → history rows appear, last_value updates
 Value changes → alerts row inserted, extension badge + toast fires
 Agent heartbeat → agent_registry.last_seen increments every 30s
 Agent shutdown → status = 'offline' in agent_registry
MCP Store
supabase
