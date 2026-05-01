#!/usr/bin/env bash
# install-agent.sh — Register the Page Monitor Agent as a macOS login service
#
# Usage: bash install-agent.sh

set -e

PLIST_SRC="$(dirname "$0")/com.shekhang.monitor-agent.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.shekhang.monitor-agent.plist"
ENV_FILE="$(dirname "$0")/.env"

echo ""
echo "  Page Monitor Agent — macOS Service Installer"
echo "  ─────────────────────────────────────────────"

# Check node is installed
if ! command -v node &>/dev/null; then
  echo "  ❌  node not found. Install it from https://nodejs.org"
  exit 1
fi

NODE_BIN=$(command -v node)
echo "  ✓  Node: $NODE_BIN ($(node --version))"

# Check .env exists
if [ ! -f "$ENV_FILE" ]; then
  echo ""
  echo "  ❌  No .env file found at: $ENV_FILE"
  echo "     Copy .env.example to .env and fill in your values:"
  echo "     cp agent/.env.example agent/.env"
  exit 1
fi
echo "  ✓  .env found"

# Install npm deps if needed
if [ ! -d "$(dirname "$0")/node_modules" ]; then
  echo "  📦  Installing npm dependencies…"
  npm install --prefix "$(dirname "$0")"
fi
echo "  ✓  Dependencies ready"

# Inject real node path into plist
sed "s|/usr/local/bin/node|$NODE_BIN|g" "$PLIST_SRC" > "$PLIST_DEST"
echo "  ✓  Plist installed to: $PLIST_DEST"

# Load (or reload) the service
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"
echo "  ✓  Service loaded"

echo ""
echo "  ┌────────────────────────────────────────────────────┐"
echo "  │  Agent is now running as a macOS background service │"
echo "  │                                                      │"
echo "  │  Status:  curl http://127.0.0.1:3580/status         │"
echo "  │  Logs:    tail -f /tmp/monitor-agent.log            │"
echo "  │  Stop:    launchctl unload ~/Library/LaunchAgents/  │"
echo "  │           com.shekhang.monitor-agent.plist          │"
echo "  └────────────────────────────────────────────────────┘"
echo ""
