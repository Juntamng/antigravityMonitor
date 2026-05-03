/**
 * Extension runtime config (public values only).
 *
 * Hosted + local API bases; pick in the popup (stored in chrome.storage.local).
 * Add matching host_permissions in manifest.json for a custom hosted URL.
 * SUPABASE_ANON_KEY is safe to ship in an unpacked extension; restrict URL allowlists in Supabase.
 */
self.PAGE_MONITOR_CONFIG = {
  BACKEND_URL_HOSTED: "https://antigravitymonitor.onrender.com",
  BACKEND_URL_LOCAL: "http://127.0.0.1:3579",
  SUPABASE_URL: "https://avvadnrovreimjfqbqdl.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2dmFkbnJvdnJlaW1qZnFicWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MTA2MzgsImV4cCI6MjA5MzA4NjYzOH0.tjw01UXMVd1G_-v2rGJlfsYXiTH5xF3Ks06ImJMU_Yc",
};
