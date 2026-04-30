/**
 * auth.js — Google OAuth flow for Chrome extension
 *
 * Flow:
 *   1. Extension opens tab to GET /auth/google
 *   2. Server redirects to Supabase's Google OAuth URL
 *   3. After Google login, Supabase redirects to GET /auth/callback
 *   4. Callback page reads tokens from URL hash and displays them
 *   5. Extension background script detects the callback URL,
 *      extracts tokens, stores them, and closes the tab
 */

const { Router } = require("express");
const { createClient } = require("@supabase/supabase-js");

const router = Router();

// Use the anon key for auth flows (not service_role)
const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);

const CALLBACK_URL = `http://localhost:${process.env.PORT || 3579}/auth/callback`;

/**
 * GET /auth/google
 * Initiates the Google OAuth flow by redirecting to Supabase.
 */
router.get("/auth/google", async (_req, res) => {
  try {
    const { data, error } = await supabaseAuth.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: CALLBACK_URL,
      },
    });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.redirect(data.url);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /auth/callback
 * Supabase redirects here after successful Google login.
 * The tokens are in the URL hash fragment (#access_token=...&refresh_token=...).
 * Since the server can't read hash fragments, we serve a tiny HTML page
 * that extracts them client-side and makes them visible to the extension.
 */
router.get("/auth/callback", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Login Successful</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a1a;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
    }
    .card {
      text-align: center;
      background: rgba(30, 30, 60, 0.8);
      border: 1px solid rgba(99, 102, 241, 0.2);
      border-radius: 16px;
      padding: 48px;
      max-width: 420px;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #a5b4fc; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; }
    .error { color: #f87171; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1 id="title">Signed in!</h1>
    <p id="msg">You can close this tab and return to the extension.</p>
  </div>
  <script>
    // Extract tokens from hash fragment
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (accessToken) {
      // Store in a way the extension can read — put tokens in the page title
      // The extension's background script watches for this tab URL pattern
      document.title = 'PAGE_MONITOR_AUTH:' + JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken
      });
    } else {
      document.getElementById('title').textContent = 'Login Failed';
      document.getElementById('title').classList.add('error');
      document.getElementById('msg').textContent = 'No authentication token received. Please try again.';
    }
  </script>
</body>
</html>`);
});

module.exports = router;
