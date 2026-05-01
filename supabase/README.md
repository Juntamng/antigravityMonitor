# Supabase migrations

Apply SQL in `migrations/` via the Supabase dashboard **SQL Editor** (or the Supabase CLI linked to this project).

- **`20250501000000_migration3_alerts_user_id.sql`** — adds `alerts.user_id`, backfills from `monitors`, and adds indexes for agent polling and RLS.
