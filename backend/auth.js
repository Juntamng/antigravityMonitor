/**
 * auth.js — JWT verification middleware
 *
 * Expects Authorization: Bearer <supabase_jwt>
 * Attaches req.user = { id, email, ... } and req.accessToken for supabaseForUser().
 */

const { supabaseAdmin } = require("./supabase");

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = match[1].trim();
  if (!supabaseAdmin) {
    return res.status(503).json({ error: "Auth not configured" });
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.user = data.user;
  req.accessToken = token;
  next();
}

module.exports = { requireAuth };
