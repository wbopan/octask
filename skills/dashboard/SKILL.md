---
name: dashboard
description: Start the Cotask Dashboard and open it in the browser
allowed-tools: [Bash]
---

# Dashboard

Start the Cotask Dashboard server and open it in the user's browser.

## Instructions

### 1. Check if the server is already running

```bash
curl -s http://localhost:3847/api/health
```

### 2. If NOT running, start it in the background

```bash
SERVER_DIR="${CLAUDE_PLUGIN_ROOT}/server"
cd "${SERVER_DIR}" && nohup node server.js > /tmp/task-dashboard.log 2>&1 &
```

Wait up to 6 seconds for the server to become ready:

```bash
for i in $(seq 1 30); do
  curl -s http://localhost:3847/api/health >/dev/null 2>&1 && break
  sleep 0.2
done
```

### 3. Open the dashboard in the browser

```bash
open "http://localhost:3847" 2>/dev/null || xdg-open "http://localhost:3847" 2>/dev/null
```

### 4. Tell the user

Report to the user:
- The dashboard is running at `http://localhost:3847`
- Suggest they save the page as a **PWA** (Progressive Web App) for quick access — in Chrome/Edge, click the install icon in the address bar or use Menu → "Install app"
- The server will auto-shutdown after 24 hours of inactivity
