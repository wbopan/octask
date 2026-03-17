# Octask

A Claude Code plugin that adds task management via `TASKS.md` files and a real-time kanban dashboard.

## What It Does

- **TASKS.md convention** — a lightweight task format with statuses (`[ ]` todo, `[/]` ongoing, `[x]` done, `[-]` backlog), slugs, acceptance criteria, and completion memos.
- **Kanban dashboard** — a browser-based board that parses and renders TASKS.md, with drag-and-drop status changes, live file watching (SSE), multi-project switching, and undo.
- **Slash commands** — `/starting-task` marks a task ongoing and begins work, `/creating-task` adds a new task.
- **Session tracking** — heartbeat hooks report Claude Code session state to the dashboard, with PID-based liveness detection and Ghostty tab focus integration.

## Install

First, add the marketplace:

```bash
claude plugins add-marketplace https://github.com/wbopan/octask.git
```

Then install the plugin:

```bash
claude plugins install octask@octask-marketplace
```

## Usage

```bash
# Open the dashboard from terminal
octask-dashboard

# Start working on a task (inside Claude Code)
/starting-task #my-task-slug

# Create a new task (inside Claude Code)
/creating-task Add dark mode support
```

## Development

```bash
cd server && npm install --production
node --watch server/server.js
```

Dashboard runs at `http://localhost:3847`. See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

## License

[MIT](LICENSE)
