---
name: dashboard
description: Start the Octask Dashboard and open it in the browser
allowed-tools: [Bash]
---

# Dashboard

Start the Octask Dashboard server and open it in the user's browser.

## Instructions

### 1. Check if the server is already running

```bash
curl -s http://localhost:3847/api/health
```

### 2. If NOT running, start it in the background

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/start-server.sh"
```

### 3. Open the dashboard in the browser

```bash
open "http://localhost:3847" 2>/dev/null || xdg-open "http://localhost:3847" 2>/dev/null
```

### 4. Tell the user

Report to the user:
- The dashboard is running at `http://localhost:3847`
- If they want to start it manually outside Claude, they can run: `octask-dashboard`
- Suggest they save the page as a **PWA** (Progressive Web App) for quick access — in Chrome/Edge, click the install icon in the address bar or use Menu → "Install app"
- The server will auto-shutdown after 30 minutes of inactivity
