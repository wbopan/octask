<p align="center">
  <img src="server/assets/Icon-iOS-Default-256x256@1x.png" width="128" height="128" alt="Cotask icon">
</p>

<h1 align="center">Cotask</h1>

<p align="center">Easy parallel project management for Claude Code agents.</p>

<p align="center">
  <a href="https://github.com/wbopan/cotask"><img src="https://img.shields.io/github/v/tag/wbopan/cotask?style=for-the-badge&label=version&color=0d9488" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/wbopan/cotask?style=for-the-badge&color=0d9488" alt="License"></a>
  <a href="https://github.com/wbopan/cotask"><img src="https://img.shields.io/badge/runtime-Bun-f472b6?style=for-the-badge" alt="Bun"></a>
  <a href="https://github.com/wbopan/cotask"><img src="https://img.shields.io/badge/plugin-Claude_Code-7c3aed?style=for-the-badge" alt="Claude Code"></a>
</p>

<p align="center">
  <img src="server/assets/screenshot.png" alt="Cotask dashboard screenshot" width="800">
</p>

## Why Cotask

1. **A skill and a dashboard for your TASKS.md.** Cotask is a Claude Code skill that manages tasks through a single `TASKS.md` file. Both you and your agents read and update it. A local web dashboard lets you view, drag-and-drop, and edit tasks intuitively.

2. **Driven by project management best practices.** Each task has acceptance criteria that define what "done" looks like, and a completion memo where the agent records what it actually did. Tasks follow a clear lifecycle — backlog, todo, ongoing, done, each serving clear purpose.

3. **Monitor and navigate your running sessions.** When a task is ongoing and bound to an active Claude Code session, the dashboard shows its state in real-time — running, idle, or waiting for permission. Click to jump straight to that terminal session.

<p align="center">
  <img src="server/assets/demo.gif" alt="Cotask dashboard demo" width="800">
</p>

## Design Philosophy

1. **Human-in-the-loop, not human-out-of-the-loop.** Cotask is not about making agents fully autonomous. It's about letting you manage and intervene more efficiently — define what needs to be done, set the acceptance criteria, and approve when it's done.

2. **The right interface for each species.** Humans get a visual web dashboard. Agents get a structured skill that reads and writes markdown. Same underlying data, two interfaces, each suited to how its species operates.

3. **More parallel work, less cognitive overhead.** Managing multiple agents across multiple tasks is mentally taxing. Cotask consolidates everything into one view, shows you what needs your attention, and lets you navigate to any session directly.

## Getting Started

### 1. Install the plugin

```bash
claude plugins marketplace add wbopan/cotask-marketplace
claude plugins install cotask@cotask-marketplace
```

### 2. Create your first task

Open any project in Claude Code and run:

```
/creating-task Set up project README
```

This creates a `TASKS.md` file in your project with your first task.

### 3. Open the dashboard

```
/dashboard
```

Claude will start the dashboard server and open it in your browser.

### 4. Work on tasks

Tell Claude to start a task by slug:

```
/starting-task #set-up-project-readme
```

Claude marks the task as ongoing, understands the requirements, plans the approach, then executes. The dashboard updates in real-time as work progresses.

## Commands

| Command | Description |
|---------|-------------|
| `/dashboard` | Start the dashboard server and open it in the browser |
| `/creating-task <description>` | Create a new task in TASKS.md |
| `/starting-task #slug` | Mark a task as ongoing and begin working on it |
| `/cotask` | View the full TASKS.md convention reference |

## How It Works

Cotask tracks tasks in a `TASKS.md` file at the project root using a simple markdown format:

```markdown
# TASKS

Project description here.

- [ ] Add user authentication #add-auth
    Implement OAuth2 login flow.
    AC: Users can log in with Google and GitHub accounts.
- [/] Fix search performance #fix-search
    Search queries over 1s need optimization.
    AC: Search returns results in under 200ms.
- [x] Set up CI pipeline #setup-ci
    CM: Configured GitHub Actions with lint, test, and build steps.
    AC: PRs run tests automatically before merge.
```

Status symbols: `[ ]` todo, `[/]` ongoing, `[x]` done, `[-]` backlog.

## Requirements

- **macOS** — project discovery and session monitoring use macOS-specific APIs (Keychain, AppleScript).
- **Bun** — used as the runtime for the dashboard server.
- **Ghostty** (optional) — the "jump to terminal session" feature uses Ghostty's AppleScript API. Without Ghostty, all other features work normally.

## License

[MIT](LICENSE)
