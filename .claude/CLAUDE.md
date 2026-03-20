# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Octask — a Claude Code plugin that adds task management via `TASKS.md` files and a real-time kanban dashboard. Installed as a Claude Code plugin, it provides skills (`/octask`, `/dashboard`, `/starting-task`, `/creating-task`), hooks (heartbeat reporting), and a dashboard server.

## Development Commands

```bash
# Start the dashboard server (port 3847, idempotent — skips if already running)
./scripts/start-server.sh

# Or run directly with hot reload
node --watch server/server.js

# Install server dependencies
cd server && npm install --production

# Run evals
claude evals run evals/evals.json
```

## Architecture

### Plugin Integration

The plugin is discovered via `.claude-plugin/plugin.json`. It registers:

- **Hooks** (`hooks/hooks.json`): `heartbeat.sh` runs async on 6 lifecycle events (SessionStart, UserPromptSubmit, PostToolUse, Stop, Notification, SessionEnd), POSTing session state (`idle`/`running`/`permission`/`notfound`) to `localhost:3847/api/heartbeat`.
- **Skills** (`skills/`): `octask` (TASKS.md convention), `creating-task`, `starting-task`, `dashboard`. All are skills (not commands) so they're invoked as `/creating-task` without a `pluginName:` prefix.
- **Post-install** (`hooks/post-install.sh`): Runs `npm install` in `server/`.

### Server (`server/server.js`)

Single-file Express server (ESM, port 3847). No build step.

- **Project discovery**: Scans `~/.claude/projects/`, reads `.jsonl` session files to extract `cwd`, encodes paths with `encodeProjectPath()`, checks for `TASKS.md` existence.
- **Dashboard**: `server/assets/dashboard.html` + `dashboard.css` + `dashboard.js` — no build step. Served at `/project/:projectId` with injected `window.__projectId`.
- **SSE file watch**: `/api/watch/:projectId` uses `fs.watch()` on the project directory (not the file directly) to survive atomic writes on macOS. 300ms debounce.
- **Session liveness**: In-memory `heartbeats` Map, keyed by sessionId. `/api/sessions/:projectId` greps `.jsonl` for `custom-title` events, then checks PID liveness via `process.kill(pid, 0)`.
- **Usage proxy**: `/api/usage` reads OAuth token from macOS keychain (`security find-generic-password`), proxies to Anthropic's usage API with 2-minute TTL cache.
- **Ghostty integration**: `/api/focus-ghostty-tab` uses osascript with Ghostty 1.3.0 native AppleScript API.

### Dashboard SPA (`server/assets/dashboard.html`)

Three files (HTML structure, CSS, JS), no framework or build tooling. Key internals:

- **Parser** (`parseTasksMd`): Line-by-line state machine parsing `## Section` headers, `Description:` lines, and `- [status] Title #slug` task items with indented description/AC.
- **Serializer** (`toMarkdown`): Reconstructs TASKS.md from the in-memory model, preserving preamble text.
- **Board**: 4 columns (ongoing/todo/backlog/done), HTML5 drag-and-drop, section grouping.
- **Sidebar**: Progress stats, per-section breakdown, usage bars from `/api/usage`.
- **State**: Undo stack (50 deep, Cmd+Z), auto-save with 600ms debounce + exponential backoff retries, SSE-based external change detection with conflict banner.

### TASKS.md Convention (from skill spec)

- Status symbols: `[ ]` todo, `[/]` ongoing, `[x]` done, `[-]` backlog
- Tasks must have `#slug` IDs
- `[/]` must be marked before starting any work
- `[x]` requires user confirmation — never mark done autonomously
- `CM:` (completion memo) line required before marking done
- AC lines must be testable, implementation-agnostic, black-box observable

## Marketplace

Marketplace config is in `.claude-plugin/marketplace.json` with `"source": "./"` pointing to the repo root. When bumping versions, update the `version` field in both `plugin.json` and `marketplace.json`.

## Key Paths

| Purpose | Path |
|---------|------|
| Plugin manifest | `.claude-plugin/plugin.json` |
| Marketplace manifest | `.claude-plugin/marketplace.json` |
| Hook definitions | `hooks/hooks.json` |
| Octask skill | `skills/octask/SKILL.md` |
| Creating-task skill | `skills/creating-task/SKILL.md` |
| Starting-task skill | `skills/starting-task/SKILL.md` |
| Dashboard skill | `skills/dashboard/SKILL.md` |
| TASKS.md template | `skills/octask/references/template.md` |
| Eval suite | `evals/evals.json` |
| Eval fixture | `evals/test-fixture-tasks.md` |
