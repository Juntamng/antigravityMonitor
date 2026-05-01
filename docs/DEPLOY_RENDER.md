# Deploy backend to Render

1. Push this repo to GitHub (or connect Render to your repo).
2. In Render: **New +** → **Blueprint** → select `render.yaml`, or **Web Service** with root directory `backend`.
3. Set environment variables (match `backend/.env.example`):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `AGENT_SECRET` (long random string; share with local agent only if using HTTP agent routes)
4. After deploy, copy the public URL (e.g. `https://page-monitor-backend-xxxx.onrender.com`).
5. Update [`extension/config.js`](../extension/config.js): set `BACKEND_URL` to that URL.
6. Update [`extension/manifest.json`](../extension/manifest.json): replace the placeholder `host_permissions` backend entry with the same origin + `/*`.
7. Reload the unpacked extension in Chrome.

## Smoke checks

```bash
curl -sS https://YOUR_BACKEND/health
# Expect: {"ok":true}

curl -sS -H "Authorization: Bearer YOUR_USER_JWT" https://YOUR_BACKEND/monitors
```

Agent HTTP smoke (optional):

```bash
curl -sS -X POST https://YOUR_BACKEND/agent/heartbeat \
  -H "Content-Type: application/json" \
  -H "X-Agent-Id: test-agent" \
  -H "X-Agent-Secret: YOUR_AGENT_SECRET" \
  -d '{"monitor_count":0}'
```
