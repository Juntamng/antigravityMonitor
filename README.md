# Antigravity Monitor (Page Change Monitor) !!

Chrome extension + **deployed Node backend** (Render) + **Supabase** (Postgres + Auth) + optional **local agent** (Playwright).

## Layout

| Path | Role |
|------|------|
| [`backend/`](backend/) | Express API, JWT auth, Supabase SDK |
| [`extension/`](extension/) | MV3 extension — auth, UI, browser-assisted checks |
| [`agent/`](agent/) | Local process — polls Supabase for `execution_mode = agent` monitors |
| [`supabase/migrations/`](supabase/migrations/) | SQL migrations (apply Migration 3 in Supabase) |

## Quick start

1. **Supabase**: Run [`supabase/migrations/20250501000000_migration3_alerts_user_id.sql`](supabase/migrations/20250501000000_migration3_alerts_user_id.sql) if not already applied.
2. **Backend**: `cd backend && cp .env.example .env` — set `SUPABASE_*`, `AGENT_SECRET`, `npm install && npm start`.
3. **Extension**: Edit [`extension/config.js`](extension/config.js) (`BACKEND_URL`, `SUPABASE_ANON_KEY`) and align [`extension/manifest.json`](extension/manifest.json) `host_permissions` with your backend URL.
4. **Agent** (optional): `cd agent && cp .env.example .env` — service role key + `AGENT_ID`; `npm install && npm start`.

Deploy backend: see [`docs/DEPLOY_RENDER.md`](docs/DEPLOY_RENDER.md).  
E2E checklist: [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

## Security

- Never put the **service role** key in the extension or commit it.
- `AGENT_SECRET` protects optional HTTP `/agent/*` routes on the backend; the default agent uses Supabase directly with the service role on your machine only.
