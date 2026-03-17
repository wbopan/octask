#!/bin/bash
# Global CLI command: start dashboard and open in browser
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")" && pwd)"

# Start server (idempotent)
"${SCRIPT_DIR}/start-server.sh"

# Open in browser
open "http://localhost:3847" 2>/dev/null || xdg-open "http://localhost:3847" 2>/dev/null || echo "Open http://localhost:3847 in your browser"
