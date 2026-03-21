# Contributing to Cotask

Thanks for your interest in contributing!

## Setup

```bash
# Clone the repo
git clone https://github.com/wbopan/cotask.git
cd cotask

# Start the dashboard with hot reload
bun --watch server/server.js
```

The dashboard runs at `http://localhost:3847`.

## Project Structure

- `server/` — Bun HTTP server and dashboard assets (HTML/CSS/JS, no build step)
- `skills/` — Skills: `cotask` (TASKS.md convention), `creating-task`, `starting-task`, `dashboard`
- `hooks/` — Lifecycle hooks (heartbeat reporting)

## Development

- Run `bun --watch server/server.js` to start the server with hot reload.
- The dashboard is plain HTML/CSS/JS — edit files in `server/assets/` and reload.

## Pull Requests

- Keep changes focused — one concern per PR.
- Follow existing code style (no linter configured yet, just match what's there).
- If you change the TASKS.md convention, update `skills/cotask/SKILL.md` and the eval fixtures.
