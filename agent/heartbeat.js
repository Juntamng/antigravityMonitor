/**
 * heartbeat.js — agent_registry upserts + graceful offline
 */

const os = require("node:os");

function getOutboundIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

async function upsertOnline(sb, agentId, monitorCount = null) {
  const row = {
    agent_id: agentId,
    last_seen: new Date().toISOString(),
    status: "online",
    monitor_count: monitorCount,
    ip_address: getOutboundIp(),
  };
  const { error } = await sb.from("agent_registry").upsert(row, { onConflict: "agent_id" });
  if (error) throw error;
}

async function setOffline(sb, agentId) {
  const { error } = await sb
    .from("agent_registry")
    .update({ status: "offline", last_seen: new Date().toISOString() })
    .eq("agent_id", agentId);
  if (error) console.error("[heartbeat] offline update failed:", error.message);
}

module.exports = { upsertOnline, setOffline };
