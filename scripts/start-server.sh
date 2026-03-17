#!/bin/bash
# Shared logic: start the task dashboard server if not already running
set -euo pipefail

PORT=3847

# Check if server is already running
if curl -s "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
  echo "Octask Dashboard already running at http://localhost:${PORT}"
  exit 0
fi

# Resolve server directory (works from symlink or direct invocation)
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")" && pwd)"
SERVER_DIR="$(cd "${SCRIPT_DIR}/../server" && pwd)"

# Check dependencies
if [ ! -d "${SERVER_DIR}/node_modules" ]; then
  echo "Installing dependencies..."
  cd "${SERVER_DIR}" && npm install --production --silent
fi

# Start server in background
cd "${SERVER_DIR}" && nohup node server.js > /tmp/task-dashboard.log 2>&1 &
SERVER_PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  if curl -s "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    echo "Octask Dashboard started at http://localhost:${PORT} (PID: ${SERVER_PID})"
    exit 0
  fi
  sleep 0.2
done

echo "Error: Server failed to start. Check /tmp/task-dashboard.log"
exit 1
