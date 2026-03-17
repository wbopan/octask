#!/usr/bin/env node
// Generate PWA icons from the octopus pixel art.
// Run: node scripts/generate-icons.mjs
// Requires sharp (auto-resolved if run via: npx --yes -p sharp node scripts/generate-icons.mjs)

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, '..', 'server', 'assets');

const W = 21, H = 13;
const BRAND = '#c4613c';

const pixels = [
  { x: 14, y: 0, w: 1, c: '#6b3a1f' }, { x: 15, y: 0, w: 6, c: '#c4613c' },
  { x: 3, y: 1, w: 11, c: '#d4785c' }, { x: 14, y: 1, w: 1, c: '#6b3a1f' }, { x: 15, y: 1, w: 5, c: '#faf9f5' }, { x: 20, y: 1, w: 1, c: '#c4613c' },
  { x: 3, y: 2, w: 11, c: '#d4785c' }, { x: 14, y: 2, w: 1, c: '#6b3a1f' }, { x: 15, y: 2, w: 1, c: '#faf9f5' }, { x: 16, y: 2, w: 4, c: '#9a9a98' }, { x: 20, y: 2, w: 1, c: '#c4613c' },
  { x: 3, y: 3, w: 2, c: '#d4785c' }, { x: 5, y: 3, w: 1, c: '#111' }, { x: 6, y: 3, w: 6, c: '#d4785c' }, { x: 12, y: 3, w: 1, c: '#111' }, { x: 13, y: 3, w: 1, c: '#d4785c' }, { x: 14, y: 3, w: 1, c: '#6b3a1f' }, { x: 15, y: 3, w: 5, c: '#faf9f5' }, { x: 20, y: 3, w: 1, c: '#c4613c' },
  { x: 3, y: 4, w: 1, c: '#d4785c' }, { x: 4, y: 4, w: 1, c: '#111' }, { x: 5, y: 4, w: 1, c: '#d4785c' }, { x: 6, y: 4, w: 1, c: '#111' }, { x: 7, y: 4, w: 4, c: '#d4785c' }, { x: 11, y: 4, w: 1, c: '#111' }, { x: 12, y: 4, w: 1, c: '#d4785c' }, { x: 13, y: 4, w: 1, c: '#111' }, { x: 14, y: 4, w: 1, c: '#6b3a1f' }, { x: 15, y: 4, w: 1, c: '#faf9f5' }, { x: 16, y: 4, w: 4, c: '#9a9a98' }, { x: 20, y: 4, w: 1, c: '#c4613c' },
  { x: 1, y: 5, w: 13, c: '#d4785c' }, { x: 14, y: 5, w: 1, c: '#6b3a1f' }, { x: 15, y: 5, w: 5, c: '#faf9f5' }, { x: 20, y: 5, w: 1, c: '#c4613c' },
  { x: 1, y: 6, w: 13, c: '#d4785c' }, { x: 14, y: 6, w: 1, c: '#6b3a1f' }, { x: 15, y: 6, w: 1, c: '#faf9f5' }, { x: 16, y: 6, w: 4, c: '#9a9a98' }, { x: 20, y: 6, w: 1, c: '#c4613c' },
  { x: 3, y: 7, w: 11, c: '#d4785c' }, { x: 14, y: 7, w: 1, c: '#6b3a1f' }, { x: 15, y: 7, w: 5, c: '#faf9f5' }, { x: 20, y: 7, w: 1, c: '#c4613c' },
  { x: 3, y: 8, w: 11, c: '#d4785c' }, { x: 14, y: 8, w: 1, c: '#6b3a1f' }, { x: 15, y: 8, w: 6, c: '#c4613c' },
  { x: 4, y: 9, w: 1, c: '#d4785c' }, { x: 6, y: 9, w: 1, c: '#d4785c' }, { x: 11, y: 9, w: 1, c: '#d4785c' }, { x: 13, y: 9, w: 1, c: '#d4785c' },
  { x: 4, y: 10, w: 1, c: '#d4785c' }, { x: 6, y: 10, w: 1, c: '#d4785c' }, { x: 11, y: 10, w: 1, c: '#d4785c' }, { x: 13, y: 10, w: 1, c: '#d4785c' },
];

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
}

function renderIcon(size, scale, bgColor) {
  const buf = Buffer.alloc(size * size * 4);
  const bg = bgColor ? hexToRgb(bgColor) : null;
  for (let i = 0; i < size * size; i++) {
    if (bg) { buf[i*4]=bg[0]; buf[i*4+1]=bg[1]; buf[i*4+2]=bg[2]; buf[i*4+3]=255; }
  }
  const ox = Math.floor((size - W * scale) / 2);
  const oy = Math.floor((size - H * scale) / 2);
  for (const p of pixels) {
    const rgb = hexToRgb(p.c);
    for (let dy = 0; dy < scale; dy++) {
      for (let px = 0; px < p.w; px++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = ox + (p.x + px) * scale + dx;
          const y = oy + p.y * scale + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) {
            const idx = (y * size + x) * 4;
            buf[idx]=rgb[0]; buf[idx+1]=rgb[1]; buf[idx+2]=rgb[2]; buf[idx+3]=255;
          }
        }
      }
    }
  }
  return buf;
}

async function main() {
  // Resolve sharp from server/node_modules where it's installed
  const { createRequire } = await import('module');
  const require = createRequire(path.join(__dirname, '..', 'server', 'package.json'));
  const sharp = require('sharp');
  for (const size of [192, 512]) {
    // "any": pixel art ~75% of canvas, transparent background
    const anyScale = Math.floor((size * 0.75) / W);
    await sharp(renderIcon(size, anyScale, null), { raw: { width: size, height: size, channels: 4 } })
      .png().toFile(path.join(ASSETS, `icon-${size}.png`));

    // "maskable": pixel art ~55% (inside 66% safe zone), brand color background
    const maskScale = Math.floor((size * 0.55) / W);
    await sharp(renderIcon(size, maskScale, BRAND), { raw: { width: size, height: size, channels: 4 } })
      .png().toFile(path.join(ASSETS, `icon-maskable-${size}.png`));

    console.log(`[octask] Generated ${size}x${size} icons`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
