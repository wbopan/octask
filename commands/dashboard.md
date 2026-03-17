---
description: Start the Octask Dashboard and open it in the browser
allowed-tools: [Bash]
---

# Dashboard

Start the Octask Dashboard server and open it in a browser.

## Instructions

1. Run the start-server script to ensure the server is running:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/start-server.sh"
```

2. Open the dashboard in the default browser:

```bash
open "http://localhost:3847" 2>/dev/null || xdg-open "http://localhost:3847" 2>/dev/null
```

3. Report the URL to the user: `http://localhost:3847`
