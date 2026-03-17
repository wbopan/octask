#!/bin/bash
# Sync local repo to plugin cache directory
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="$HOME/.claude/plugins/cache/octask-marketplace/octask/1.0.0"

# Remove symlink if present, create dir
if [ -L "$CACHE" ]; then
  rm "$CACHE"
fi
mkdir -p "$CACHE"

# Sync tracked files only (respects .gitignore)
rsync -a --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='package-lock.json' \
  --exclude='starting-task-pacing-workspace/' \
  --filter=':- .gitignore' \
  "$SRC/" "$CACHE/"

# Reinstall server deps in cache
if [ -f "$CACHE/server/package.json" ]; then
  cd "$CACHE/server" && npm install --production --silent 2>/dev/null
fi

echo "Synced to $CACHE"
