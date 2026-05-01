# End-to-end verification checklist

Prerequisites: Migration 3 applied in Supabase, `backend/.env` filled, extension `config.js` updated, user account exists in Supabase Auth.

## 1. Backend

```bash
cd backend
npm install
npm start
```

```bash
curl -sS http://127.0.0.1:3579/health
curl -sS -H "Authorization: Bearer YOUR_ACCESS_TOKEN" http://127.0.0.1:3579/me
curl -sS -H "Authorization: Bearer YOUR_ACCESS_TOKEN" http://127.0.0.1:3579/monitors
```

## 2. Extension

- Load unpacked extension from `extension/`.
- Sign in (email/password or Google).
- Create a monitor with **execution_mode** left default (`extension`): use Pick Element → save.
- Confirm row in Supabase `monitors` has your `user_id`, `execution_mode = extension`, `next_check_at` set.

## 3. Agent path (Playwright checks)

1. In Supabase SQL editor (or Table Editor), set one monitor to agent mode:

   - `execution_mode` = `agent`
   - `assigned_agent` = same string as `AGENT_ID` in `agent/.env` (e.g. `home-pc`)
   - `next_check_at` = a time in the past (UTC)

2. Run agent:

   ```bash
   cd agent
   npm install
   cp .env.example .env
   # edit .env — service role key + AGENT_ID
   npm start
   ```

3. Confirm `history` rows appear, `monitors.last_value` updates, `agent_registry.last_seen` moves.

## 4. Alerts + extension badge

- Change monitored content (or tweak `last_value` in DB) so next check differs.
- Confirm `alerts` row (with `user_id` after migration 3), extension badge / notification after `/alerts/pending` poll.

## 5. Optional HTTP agent routes

If using `POST /agent/heartbeat` on the deployed backend:

```bash
curl -sS -X POST https://YOUR_BACKEND/agent/heartbeat \
  -H "Content-Type: application/json" \
  -H "X-Agent-Id: curl-test" \
  -H "X-Agent-Secret: $AGENT_SECRET" \
  -d '{"monitor_count":0}'
```
