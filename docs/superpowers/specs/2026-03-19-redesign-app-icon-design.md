# Redesign App Icon — Design Spec

**Task**: `#redesign-app-icon`
**Date**: 2026-03-19

## Goal

Replace the current overlapping-octagons icon with a badge-check design that follows Apple HIG and PWA best practices, including macOS Tahoe Liquid Glass support.

## Design Decisions

| Aspect | Decision |
|--------|----------|
| Shape | Lucide `badge-check` silhouette (organic wavy-edge seal with checkmark) |
| Fill | ~80% of canvas (~410px on 512px canvas) |
| Background | Diagonal linear gradient: `#1a3a5c` → `#115e59` (40%) → `#0d9488` (100%) |
| Badge | Flat white, 93% opacity, no drop shadow (Liquid Glass adds its own depth) |
| Checkmark | Dark teal `#115e59` stroke, weight 1.5 (in 24-unit Lucide coordinate space) |
| Corner radius | None on SVG — system applies squircle mask for PWA/macOS |

## Scale Factor Calculation

The Lucide `badge-check` path spans ~20 units in its 24x24 coordinate space (roughly x:2–22, y:2–22). To fill ~80% of a 512px canvas (~410px):

- **`any` icons**: `scale(20.5)` → 20 × 20.5 = 410px ≈ 80% of 512
- **`maskable` icons**: `scale(16.4)` → 20 × 16.4 = 328px ≈ 64% of 512 (80% of 80%, fitting within the maskable safe zone where the center 80% is guaranteed visible)

## Output Files

| File | Size | Purpose | Notes |
|------|------|---------|-------|
| `server/assets/octopus.svg` | 512x512 | SVG source, favicon base | Replaces current file |
| `server/assets/icon-192.png` | 192x192 | PWA manifest `"any"` | Badge centered, ~80% fill |
| `server/assets/icon-512.png` | 512x512 | PWA manifest `"any"` | Badge centered, ~80% fill |
| `server/assets/icon-maskable-192.png` | 192x192 | PWA manifest `"maskable"` | Badge at ~64% fill for safe zone |
| `server/assets/icon-maskable-512.png` | 512x512 | PWA manifest `"maskable"` | Badge at ~64% fill for safe zone |

## SVG Structure

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1a3a5c"/>
      <stop offset="40%" stop-color="#115e59"/>
      <stop offset="100%" stop-color="#0d9488"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <!-- badge-check scaled to ~80% fill -->
  <g transform="translate(256,256) scale(20.5)">
    <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0
             4 4 0 0 1 4.78 4.77 4 4 0 0 1 0 6.74
             4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0
             4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
          transform="translate(-12,-12)"
          fill="rgba(255,255,255,0.93)" stroke="none"/>
    <path d="m9 12 2 2 4-4"
          transform="translate(-12,-12)"
          fill="none" stroke="#115e59"
          stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
```

**Note**: The badge-check path should be verified against the pinned Lucide version in `server/assets/vendor/lucide.min.js` before committing.

## Liquid Glass Support

The existing `<link rel="apple-touch-icon" href="/assets/icon-192.png">` in `dashboard.html` (line 9) already provides macOS Tahoe Liquid Glass support. No change needed — the new icon files replace the old ones at the same paths.

Design choices that optimize for Liquid Glass:
- Flat white badge (no baked-in shadow) lets the OS apply its own specular highlights
- Bold, simple shape remains legible across Default/Dark/Clear/Tinted modes
- Light badge area shows translucency; gradient background stays rich

## PWA Manifest

Current `manifest.json` icon entries remain unchanged — the files get replaced at the same paths:

```json
{
  "icons": [
    { "src": "/assets/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/assets/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/assets/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/assets/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

## Implementation Steps

1. **Write new SVG** to `server/assets/octopus.svg` (replacing current overlapping-octagons)
2. **Rewrite `scripts/generate-icons.mjs`** — currently renders pixel-art bitmap; must be rewritten to rasterize `octopus.svg` using sharp's SVG input. Generate both `any` (full-size SVG) and `maskable` (SVG with extra padding) variants at 192 and 512.
3. **Update `<link rel="icon">` in `dashboard.html`** — line 10 has an inline data URI of the old pixel-art octopus. Replace with `<link rel="icon" type="image/svg+xml" href="/assets/octopus.svg">`.
4. **Verify** manifest.json icon entries point to correct files (they already do).
5. **Test** at multiple sizes, in PWA install flow, and in macOS Tahoe Liquid Glass modes if available.
