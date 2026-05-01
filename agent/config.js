/**
 * config.js — Environment config + validation for the local agent
 */

require("dotenv").config();

const required = ["CLOUD_API_URL", "AGENT_SECRET", "AGENT_ID"];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`\n  ❌  Missing required env var: ${key}`);
    console.error(`     Create an agent/.env file with all required variables.\n`);
    process.exit(1);
  }
}

module.exports = {
  CLOUD_API_URL:          process.env.CLOUD_API_URL,
  AGENT_SECRET:           process.env.AGENT_SECRET,
  AGENT_ID:               process.env.AGENT_ID || "macbook-default",
  POLL_INTERVAL_SECONDS:  parseInt(process.env.POLL_INTERVAL_SECONDS || "30", 10),
  LOCAL_PORT:             parseInt(process.env.LOCAL_PORT || "3580", 10),
  MAX_CONCURRENT_CHECKS:  parseInt(process.env.MAX_CONCURRENT_CHECKS || "3", 10),
};
