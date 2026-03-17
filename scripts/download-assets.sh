#!/usr/bin/env bash
set -euo pipefail

VENDOR_DIR="$(cd "$(dirname "$0")/.." && pwd)/server/assets/vendor"
FONTS_DIR="$VENDOR_DIR/fonts"
FONTS_CSS="$VENDOR_DIR/fonts.css"
mkdir -p "$FONTS_DIR"

if [ -f "$VENDOR_DIR/lucide.min.js" ] \
   && [ -f "$FONTS_CSS" ] \
   && ls "$FONTS_DIR"/*.woff2 >/dev/null 2>&1; then
  exit 0
fi

FONT_CSS_URL='https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700&family=DM+Mono:wght@400;500&display=swap'
LUCIDE_URL='https://unpkg.com/lucide@latest/dist/umd/lucide.min.js'

# Request woff2 format by pretending to be a modern browser
CSS="$(curl -fsSL -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' "$FONT_CSS_URL")"

# Download each woff2 font file and rewrite CSS to use local paths
LOCAL_CSS="$CSS"
while IFS= read -r font_url; do
  [ -z "$font_url" ] && continue
  filename="${font_url##*/}"
  curl -fsSL "$font_url" -o "$FONTS_DIR/$filename"
  # Use | as sed delimiter to avoid issues with URL slashes
  LOCAL_CSS="$(printf '%s\n' "$LOCAL_CSS" | sed "s|${font_url}|/assets/vendor/fonts/${filename}|g")"
done < <(printf '%s\n' "$CSS" | grep -oE 'https://[^)]+\.woff2')

printf '%s\n' "$LOCAL_CSS" > "$FONTS_CSS"

# Lucide icons
curl -fsSL "$LUCIDE_URL" -o "$VENDOR_DIR/lucide.min.js"

echo "[octask] Vendor assets downloaded to $VENDOR_DIR"
