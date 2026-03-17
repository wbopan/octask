import express from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { execFile } from 'child_process';

const app = express();
const PORT = 3847;
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const ASSETS_DIR = path.join(import.meta.dirname, 'assets');

app.use('/assets', express.static(ASSETS_DIR));
app.use(express.json({ limit: '1mb' }));

// In-memory heartbeat store: sessionId → { state, ts, pid }
const heartbeats = new Map();

// Encode a filesystem path into Claude Code's project directory name.
// This is the lossless forward direction: path → id.
function encodeProjectPath(absPath) {
  return absPath
    .replace(/^\//,  '-')   // leading '/' → leading '-'
    .replace(/\/\./g, '--') // '/.' (hidden dirs) → '--'
    .replace(/\//g,  '-');  // remaining '/' → '-'
}

// Discover projects by scanning ~/.claude/projects/ for known project dirs,
// then finding which ones have a TASKS.md by using `find` on all parent dirs
// that appear as session working directories.
async function discoverProjects() {
  let entries;
  try {
    entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  // Collect all project dir names as a Set for fast lookup
  const projectDirNames = new Set();
  for (const entry of entries) {
    if (entry.isDirectory()) projectDirNames.add(entry.name);
  }

  // Read the first .jsonl from each project dir to extract the real cwd
  const projects = [];
  for (const dirName of projectDirNames) {
    const projDir = path.join(PROJECTS_DIR, dirName);
    let jsonlFiles;
    try {
      const all = await fs.readdir(projDir);
      jsonlFiles = all.filter(f => f.endsWith('.jsonl'));
    } catch { continue; }
    if (jsonlFiles.length === 0) continue;

    // Read the first few lines of the first jsonl to find cwd
    let realPath = null;
    try {
      const content = await fs.readFile(path.join(projDir, jsonlFiles[0]), 'utf8');
      for (const line of content.split('\n').slice(0, 20)) {
        try {
          const evt = JSON.parse(line.trim());
          if (evt.cwd) { realPath = evt.cwd; break; }
        } catch {}
      }
    } catch {}
    if (!realPath) continue;

    // Verify: encode the real path and check it matches this dir name
    if (encodeProjectPath(realPath) !== dirName) continue;

    // Check for TASKS.md
    try {
      await fs.access(path.join(realPath, 'TASKS.md'));
      projects.push({
        id: dirName,
        name: path.basename(realPath),
        path: realPath,
      });
    } catch {
      // no TASKS.md, skip
    }
  }
  return projects;
}

// In-memory cache for project API routes
let cachedProjects = null;

async function getProjectById(projectId) {
  if (!cachedProjects) {
    cachedProjects = await discoverProjects();
  }
  let project = cachedProjects.find(p => p.id === projectId);
  if (!project) {
    // refresh and retry
    cachedProjects = await discoverProjects();
    project = cachedProjects.find(p => p.id === projectId);
  }
  return project || null;
}

// GET / — project index
app.get('/', async (req, res) => {
  const projects = await discoverProjects();

  const cards = projects.map(p => `
    <a class="card" href="/project/${encodeURIComponent(p.id)}">
      <div class="card-name">${escapeHtml(p.name)}</div>
      <div class="card-path">${escapeHtml(p.path)}</div>
    </a>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Octask Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #f8f6f1;
      --surface: #ffffff;
      --accent: #c4613c;
      --accent-hover: #a84f30;
      --text: #2b2420;
      --text-muted: #8a7f78;
      --border: #e4dfd8;
      --font: 'DM Sans', sans-serif;
      --radius: 10px;
    }
    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 2rem;
    }
    header {
      max-width: 800px;
      margin: 0 auto 2rem;
    }
    header h1 {
      font-size: 1.75rem;
      font-weight: 600;
      color: var(--accent);
    }
    header p {
      color: var(--text-muted);
      margin-top: 0.25rem;
      font-size: 0.95rem;
    }
    .grid {
      max-width: 800px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
    }
    .card {
      display: block;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem 1.5rem;
      text-decoration: none;
      color: inherit;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .card:hover {
      border-color: var(--accent);
      box-shadow: 0 2px 12px rgba(196, 97, 60, 0.12);
    }
    .card-name {
      font-size: 1.05rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 0.35rem;
    }
    .card-path {
      font-size: 0.8rem;
      color: var(--text-muted);
      word-break: break-all;
    }
    .empty {
      max-width: 800px;
      margin: 0 auto;
      color: var(--text-muted);
      font-size: 0.95rem;
    }
  </style>
</head>
<body>
  <header>
    <h1>Octask Dashboard</h1>
    <p>${projects.length} project${projects.length !== 1 ? 's' : ''} with TASKS.md</p>
  </header>
  ${projects.length ? `<div class="grid">${cards}</div>` : '<p class="empty">No projects with TASKS.md found.</p>'}
</body>
</html>`;

  res.type('html').send(html);
});

// GET /project/:projectId — serve dashboard.html with injected projectId
app.get('/project/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const project = await getProjectById(projectId);
  if (!project) return res.status(404).send('Project not found');

  let html;
  try {
    html = await fs.readFile(path.join(ASSETS_DIR, 'dashboard.html'), 'utf8');
  } catch {
    return res.status(500).send('dashboard.html not found in assets/');
  }

  const script = `<script>window.__projectId = ${JSON.stringify(projectId)}; window.__projectName = ${JSON.stringify(project.name)};</script>`;
  html = html.replace('</head>', `${script}\n</head>`);
  res.type('html').send(html);
});

// GET /api/tasks/:projectId
app.get('/api/tasks/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const project = await getProjectById(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const content = await fs.readFile(path.join(project.path, 'TASKS.md'), 'utf8');
    res.json({ content });
  } catch {
    res.status(404).json({ error: 'TASKS.md not found' });
  }
});

// PUT /api/tasks/:projectId
app.put('/api/tasks/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const project = await getProjectById(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { content } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'content must be a string' });
  }

  const filePath = path.join(project.path, 'TASKS.md');
  try {
    await fs.writeFile(filePath, content, 'utf8');
  } catch (err) {
    return res.status(500).json({ error: 'Failed to write TASKS.md: ' + err.message });
  }
  res.json({ ok: true });
});

// POST /api/heartbeat — receive heartbeat from hook
app.post('/api/heartbeat', (req, res) => {
  const { sessionId, state, pid } = req.body;
  if (!sessionId || !state) return res.status(400).json({ error: 'missing sessionId or state' });
  if (state === 'notfound') {
    heartbeats.delete(sessionId);
  } else {
    heartbeats.set(sessionId, { state, ts: Date.now(), pid: pid || null });
  }
  res.json({ ok: true });
});

// GET /api/sessions/:projectId — session status via in-memory heartbeats
app.get('/api/sessions/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const projectDir = path.join(PROJECTS_DIR, projectId);

  // grep custom-title events to build sessionId → customTitle map
  let entries = [];
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('grep', [
      '-r', '--include=*.jsonl', '-h', '"custom-title"', projectDir
    ], { maxBuffer: 1024 * 1024 });
    const titleBySession = new Map();
    for (const line of stdout.split('\n')) {
      try {
        const evt = JSON.parse(line.trim());
        if (evt.type === 'custom-title' && evt.customTitle && evt.sessionId) {
          titleBySession.set(evt.sessionId, evt.customTitle);
        }
      } catch {}
    }
    for (const [sessionId, customTitle] of titleBySession) {
      entries.push({ sessionId, customTitle });
    }
  } catch {}

  // Resolve status from in-memory heartbeats (PID-based liveness)
  const result = {};

  for (const entry of entries) {
    const title = entry.customTitle.trim();
    if (!title) continue;

    let status = 'notfound';
    const hb = heartbeats.get(entry.sessionId);
    if (hb) {
      let alive = true;
      if (hb.pid) {
        try { process.kill(hb.pid, 0); } catch { alive = false; }
      }
      if (alive) {
        status = hb.state;
      } else {
        heartbeats.delete(entry.sessionId);
      }
    }

    result[title] = { sessionId: entry.sessionId, status };
  }

  res.json(result);
});

// POST /api/focus-ghostty-tab — focus a Ghostty tab by matching title substring
app.post('/api/focus-ghostty-tab', async (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title is required' });
  }

  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  // Use Ghostty 1.3.0 native AppleScript API instead of System Events UI hack
  const escaped = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `
tell application "Ghostty"
  set allWindows to every window
  repeat with w in allWindows
    set allTabs to every tab of w
    repeat with t in allTabs
      if name of t contains "${escaped}" then
        focus (focused terminal of t)
        activate
        return "focused"
      end if
    end repeat
  end repeat
  return "not_found"
end tell`;

  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 5000 });
    const result = stdout.trim();
    if (result === 'focused') {
      res.json({ ok: true });
    } else {
      res.json({ ok: false, error: 'No matching tab found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'AppleScript failed: ' + err.message });
  }
});

// GET /api/watch/:projectId — SSE endpoint for file change notifications
// Watches the parent directory instead of the file itself, so atomic writes
// (write temp file → rename) don't break the watcher on macOS.
app.get('/api/watch/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const project = await getProjectById(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const dirPath = project.path;
  const targetFile = 'TASKS.md';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write('data: {"connected":true}\n\n');

  let debounceTimer = null;
  let watcher;
  try {
    watcher = fsSync.watch(dirPath, (eventType, filename) => {
      if (filename !== targetFile) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          res.write('data: {"changed":true}\n\n');
        } catch {}
      }, 300);
    });
  } catch (err) {
    res.write(`data: {"error":"watch failed: ${err.message}"}\n\n`);
    res.end();
    return;
  }

  req.on('close', () => {
    clearTimeout(debounceTimer);
    if (watcher) watcher.close();
  });
});

// ===== OAuth Usage Proxy =====
let cachedOAuthToken = null;
let usageCache = { data: null, fetchedAt: 0 };
const USAGE_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

function getOAuthToken() {
  return new Promise((resolve, reject) => {
    if (cachedOAuthToken) return resolve(cachedOAuthToken);
    execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], (err, stdout) => {
      if (err) return reject(err);
      try {
        const creds = JSON.parse(stdout.trim());
        cachedOAuthToken = creds.claudeAiOauth?.accessToken;
        if (!cachedOAuthToken) return reject(new Error('No accessToken in credentials'));
        resolve(cachedOAuthToken);
      } catch (e) {
        reject(e);
      }
    });
  });
}

app.get('/api/usage', async (req, res) => {
  const now = Date.now();
  if (usageCache.data && (now - usageCache.fetchedAt) < USAGE_CACHE_TTL) {
    return res.json(usageCache.data);
  }
  try {
    const token = await getOAuthToken();
    const result = await new Promise((resolve, reject) => {
      const req = https.get('https://api.anthropic.com/api/oauth/usage', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
        },
      }, (resp) => {
        let body = '';
        resp.on('data', chunk => body += chunk);
        resp.on('end', () => {
          if (resp.statusCode === 200) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(`API returned ${resp.statusCode}`));
          }
        });
      });
      req.on('error', reject);
    });
    usageCache = { data: result, fetchedAt: Date.now() };
    res.json(result);
  } catch (err) {
    if (usageCache.data) return res.json(usageCache.data);
    res.json({ error: err.message });
  }
});

// GET /api/health — connectivity check for client
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Global error handler — catch unhandled route errors
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Octask Dashboard running at http://localhost:${PORT}`);
});
