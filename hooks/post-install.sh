#!/bin/bash
# Post-install hook: install npm dependencies
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="${PLUGIN_ROOT}/server"

# Install server dependencies
if [ -f "${SERVER_DIR}/package.json" ]; then
  echo "[octask] Installing server dependencies..."
  cd "${SERVER_DIR}" && npm install --production --silent 2>/dev/null
fi
