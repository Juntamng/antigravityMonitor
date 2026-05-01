/**
 * Optional smoke checks (run with env set).
 * Usage: node scripts/smoke.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const base = process.env.SMOKE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3579}`;

async function main() {
  const h = await fetch(`${base}/health`);
  console.log("GET /health", h.status, await h.text());

  const token = process.env.SMOKE_JWT;
  if (!token) {
    console.log("Set SMOKE_JWT to test authenticated routes.");
    return;
  }
  const m = await fetch(`${base}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log("GET /me", m.status, await m.text());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
