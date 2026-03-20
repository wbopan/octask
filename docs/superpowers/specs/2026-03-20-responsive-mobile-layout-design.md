# Responsive Mobile Layout — Design Spec

## Goal

Make the Octask dashboard usable at smaller window sizes by progressively hiding less-important UI elements. Currently the dashboard requires a wide window (~1200px+) because the 350px sidebar + 4 board columns all render simultaneously.

## Breakpoints

### Wide (>1100px) — No change

Current layout: sidebar 350px + 4 board columns. Nothing changes.

### Medium (≤1100px) — Sidebar collapses to overlay

**Trigger:** Sidebar (350px) + 4 columns (min 260px each) can't fit.

**Changes:**
- Sidebar hidden by default via CSS `display:none` at this breakpoint
- Hamburger button (`☰`) appears in `.board-header`, left of the project name
- Clicking hamburger toggles sidebar as a **slide-over overlay**:
  - Sidebar gets `position:fixed; left:0; top:0; bottom:0; z-index:200`
  - Semi-transparent backdrop (`rgba(26,26,26,0.25)`) behind it
  - Click backdrop or hamburger again to close
  - CSS transition for slide-in/out animation
- Board area gets full viewport width — 4 columns fit comfortably

**No JS state changes needed** — sidebar DOM stays in place, just toggled via a CSS class (e.g., `.sidebar-open`).

### Narrow (≤850px) — Column picker

**Trigger:** 4 columns at min-width 260px can't fit even with full width.

**Changes:**
- A "Columns" dropdown button appears in `.board-header`, right side
  - Shows `N / 4` indicator (e.g., "2 / 4")
  - Dropdown lists all 4 columns with colored checkboxes and task counts
  - Clicking a row toggles that column's visibility
- **Default visible columns:** Ongoing + Pending (internal status keys: `ongoing`, `todo`)
- Hidden columns get `display:none` on their `.status-column`
- **Persistence:** Visible column set saved to `localStorage` key `octask-visible-columns` as JSON array (e.g., `["ongoing","todo"]`)
- On wide/medium breakpoints, column picker is hidden and all columns render normally
- **Interaction with existing Done toggle:** The Done column's existing show/hide toggle (eye icon) remains independent. If the column picker hides Done, the eye toggle is irrelevant. If the column picker shows Done, the eye toggle controls whether the Done body is collapsed. The two controls are orthogonal.

## Implementation Details

### CSS

Add two `@media` blocks to `dashboard.css`:

```css
@media (max-width: 1100px) {
  .sidebar { display: none; }
  .sidebar.sidebar-open { /* overlay styles */ }
  .sidebar-backdrop { /* backdrop styles */ }
  .hamburger-btn { display: flex; }
}

@media (max-width: 850px) {
  .column-picker { display: flex; }
  .status-column.column-hidden { display: none; }
}
```

### HTML

Add to `dashboard.html`:
- Hamburger button inside `.board-header` (hidden by default, shown at ≤1100px)
- Column picker button + dropdown inside `.board-header` (hidden by default, shown at ≤850px)
- Backdrop div as static sibling of `.sidebar` (hidden by default, shown via `.sidebar-open` class on a parent)

### JS

Add to `dashboard.js`:
- `toggleSidebar()` — adds/removes `.sidebar-open` class on `.app-body`, which shows/hides the static backdrop div via CSS
- `toggleColumn(status)` — toggles column visibility, updates localStorage, re-renders column picker count
- `initColumnPicker()` — reads localStorage, applies initial visibility
- Column picker dropdown open/close logic (click outside to close)
- On `render()` / `renderBoard()`: apply column visibility classes based on current state

### What doesn't change

- **Modal:** Already responsive (92% width, max 720px)
- **FAB / Quick create:** Fixed position, works at any width
- **Drag-and-drop:** Works on visible columns; hidden columns can't receive drops (acceptable)
- **Existing Done column toggle:** Remains as-is, independent of column picker
- **Card hover actions:** Remain hover-triggered (this is a desktop/tablet feature, not phone)

## Acceptance Criteria

- At >1100px: dashboard looks identical to current layout
- At ≤1100px: sidebar is hidden; hamburger button in board header opens it as overlay; clicking backdrop closes it
- At ≤850px: column picker dropdown appears; default shows Ongoing + Pending (`ongoing` + `todo`); user can toggle any column; preference persists across reloads
- Column picker button shows count of visible columns (e.g., "2 / 4")
- All existing functionality (drag-drop, edit, save, SSE, undo) works at every breakpoint
