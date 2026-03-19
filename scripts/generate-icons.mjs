#!/usr/bin/env node
// Generate PWA icons from octopus.svg.
// Run: node scripts/generate-icons.mjs
// Requires sharp (installed in server/node_modules)

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, '..', 'server', 'assets');
const require = createRequire(path.join(__dirname, '..', 'server', 'package.json'));
const sharp = require('sharp');

const SVG_SRC = path.join(ASSETS, 'octopus.svg');

// Scale factors (Lucide badge-check spans ~20 units in 24-unit space):
// "any":      scale(17.4) → 20 × 17.4 = 348px ≈ 68% of 512
// "maskable": scale(13.9) → 20 × 13.9 = 278px ≈ 54% of 512
const ANY_SCALE = 17.4;
const MASKABLE_SCALE = 13.9;

function buildSvg(scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1a3a5c"/>
      <stop offset="40%" stop-color="#115e59"/>
      <stop offset="100%" stop-color="#0d9488"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(256,256) scale(${scale})">
    <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.77 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
          transform="translate(-12,-12)"
          fill="rgba(255,255,255,0.93)" stroke="none"/>
    <path d="m9 12 2 2 4-4"
          transform="translate(-12,-12)"
          fill="none" stroke="#115e59"
          stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

async function main() {
  for (const size of [192, 512]) {
    // "any" icon — badge at 80% fill
    await sharp(Buffer.from(buildSvg(ANY_SCALE)))
      .resize(size, size)
      .png()
      .toFile(path.join(ASSETS, `icon-${size}.png`));

    // "maskable" icon — badge at 64% fill (safe zone)
    await sharp(Buffer.from(buildSvg(MASKABLE_SCALE)))
      .resize(size, size)
      .png()
      .toFile(path.join(ASSETS, `icon-maskable-${size}.png`));

    console.log(`[octask] Generated ${size}x${size} icons`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
