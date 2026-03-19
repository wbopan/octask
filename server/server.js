import express from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFileCb);

const app = express();
const PORT = 3847;
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const ASSETS_DIR = path.join(import.meta.dirname, 'assets');
let server;
let lastActivityAt = Date.now();
const IDLE_SHUTDOWN_MS = 24 * 60 * 60 * 1000;
const GREP_MAX_BUFFER = 1024 * 1024;
const SSE_DEBOUNCE_MS = 300;
const OSASCRIPT_TIMEOUT_MS = 5000;
const SHUTDOWN_FORCE_TIMEOUT_MS = 5000;
const IDLE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const JSONL_SCAN_LINES = 20;
const sseConnections = new Set();

app.use((req, _res, next) => {
  lastActivityAt = Date.now();
  next();
});

app.use('/assets', express.static(ASSETS_DIR));
app.use(express.json({ limit: '1mb' }));

// Heartbeat store: sessionId → { state, ts, pid }
// Persisted to disk so state survives server restarts.
const HEARTBEAT_FILE = path.join(os.tmpdir(), 'octask-heartbeats.json');
const heartbeats = new Map();

function loadHeartbeats() {
  try {
    const data = fsSync.readFileSync(HEARTBEAT_FILE, 'utf8');
    const obj = JSON.parse(data);
    for (const [k, v] of Object.entries(obj)) heartbeats.set(k, v);
  } catch { /* ignored */ }
}

function saveHeartbeats() {
  const obj = Object.fromEntries(heartbeats);
  fsSync.writeFileSync(HEARTBEAT_FILE, JSON.stringify(obj), 'utf8');
}

loadHeartbeats();

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
      for (const line of content.split('\n').slice(0, JSONL_SCAN_LINES)) {
        try {
          const evt = JSON.parse(line.trim());
          if (evt.cwd) { realPath = evt.cwd; break; }
        } catch { /* ignored */ }
      }
    } catch { /* ignored */ }
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

// GET /sw.js — service worker bootstrap at root scope
app.get('/sw.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(ASSETS_DIR, 'sw.js'));
});

// GET /offline — shell route for service worker fallback
app.get('/offline', async (req, res) => {
  try {
    const html = await fs.readFile(path.join(ASSETS_DIR, 'dashboard.html'), 'utf8');
    res.type('html').send(html);
  } catch {
    res.status(500).send('dashboard.html not found');
  }
});

// GET / — serve dashboard shell
app.get('/', async (req, res) => {
  try {
    const html = await fs.readFile(path.join(ASSETS_DIR, 'dashboard.html'), 'utf8');
    res.type('html').send(html);
  } catch {
    res.status(500).send('dashboard.html not found');
  }
});

// Helper: build per-project session map from custom-title events + heartbeat state.
async function buildSessionMap(projectId) {
  const projectDir = path.join(PROJECTS_DIR, projectId);
  const sessionMap = new Map();

  try {
    const { stdout } = await execFileAsync('grep', [
      '-r', '--include=*.jsonl', '-h', '"custom-title"', projectDir,
    ], { maxBuffer: GREP_MAX_BUFFER });
    for (const line of stdout.split('\n')) {
      try {
        const evt = JSON.parse(line.trim());
        if (evt.type === 'custom-title' && evt.customTitle && evt.sessionId) {
          sessionMap.set(evt.sessionId, evt.customTitle);
        }
      } catch { /* ignored */ }
    }
  } catch { /* ignored */ }

  const result = {};
  for (const [sessionId, customTitle] of sessionMap) {
    const title = customTitle.trim();
    if (!title) continue;

    let status = 'notfound';
    let childProcesses = 0;
    const hb = heartbeats.get(sessionId);
    if (hb) {
      let alive = true;
      if (hb.pid) {
        try { process.kill(hb.pid, 0); } catch { alive = false; }
      }
      if (alive) {
        status = hb.state;
        if (hb.pid) {
          try {
            const { stdout } = await execFileAsync('pgrep', ['-P', String(hb.pid)]);
            childProcesses = stdout.trim().split('\n').filter(Boolean).length;
          } catch { /* ignored */ }
        }
      } else {
        heartbeats.delete(sessionId);
        saveHeartbeats();
      }
    }

    const stateTs = hb?.stateTs || null;
    result[title] = { sessionId, status, childProcesses, stateTs };
  }

  return result;
}

// GET /api/state — consolidated dashboard state
app.get('/api/state', async (req, res) => {
  const discovered = await discoverProjects();

  // Determine which projects have live heartbeats (avoid expensive jsonl grep for inactive ones).
  // Collect alive heartbeat cwds so we can prefix-match against project paths
  // (heartbeat cwd may be a subdirectory of the project root).
  const aliveCwds = [];
  for (const [, hb] of heartbeats) {
    if (!hb.cwd) continue;
    let alive = true;
    if (hb.pid) { try { process.kill(hb.pid, 0); } catch { alive = false; } }
    if (alive) aliveCwds.push(hb.cwd);
  }

  const projects = await Promise.all(discovered.map(async (p) => {
    let stats = { todo: 0, ongoing: 0, done: 0, backlog: 0, total: 0 };
    let content = '';
    try {
      content = await fs.readFile(path.join(p.path, 'TASKS.md'), 'utf8');
      for (const line of content.split('\n')) {
        if (/^- \[ \]/.test(line)) { stats.todo++; stats.total++; }
        else if (/^- \[\/\]/.test(line)) { stats.ongoing++; stats.total++; }
        else if (/^- \[x\]/i.test(line)) { stats.done++; stats.total++; }
        else if (/^- \[-\]/.test(line)) { stats.backlog++; stats.total++; }
      }
    } catch { /* ignored */ }

    let sessionMap = null;
    let sessions = { running: 0, idle: 0, permission: 0, 'bg-active': 0 };

    const projectActive = aliveCwds.some(cwd => cwd === p.path || cwd.startsWith(p.path + '/'));
    if (projectActive) {
      sessionMap = await buildSessionMap(p.id);
      // Build set of task slugs that are ongoing or todo (exclude done/backlog)
      const activeTaskSlugs = new Set();
      for (const line of content.split('\n')) {
        const m = line.match(/^- \[[ /]\] .+#([\w-]+)\s*$/);
        if (m) activeTaskSlugs.add(m[1]);
      }
      // Derive aggregate counts from sessionMap, only for ongoing/todo tasks
      for (const [title, s] of Object.entries(sessionMap)) {
        if (!activeTaskSlugs.has(title)) continue;
        const isBgActive = s.status === 'idle' && s.childProcesses > 0;
        const key = isBgActive ? 'bg-active' : s.status;
        if (key in sessions) sessions[key]++;
      }
    }

    return { id: p.id, name: p.name, path: p.path, content, stats, sessions, sessionMap };
  }));

  res.json({ projects });
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
  const { sessionId, state, pid, cwd } = req.body;
  if (!sessionId || !state) return res.status(400).json({ error: 'missing sessionId or state' });
  if (state === 'notfound') {
    heartbeats.delete(sessionId);
  } else {
    const prev = heartbeats.get(sessionId);
    const now = Date.now();
    const stateTs = (prev && prev.state === state) ? prev.stateTs : now;
    heartbeats.set(sessionId, { state, ts: now, stateTs, pid: pid || null, cwd: cwd || prev?.cwd || null });
  }
  saveHeartbeats();
  res.json({ ok: true });
});

// POST /api/focus-ghostty-tab — focus a Ghostty tab by matching title substring
app.post('/api/focus-ghostty-tab', async (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title is required' });
  }

  // Use Ghostty 1.3.0 native AppleScript API instead of System Events UI hack
  const escaped = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
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
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: OSASCRIPT_TIMEOUT_MS });
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
  sseConnections.add(res);

  let debounceTimer = null;
  let watcher;
  try {
    watcher = fsSync.watch(dirPath, (eventType, filename) => {
      if (filename !== targetFile) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          res.write('data: {"changed":true}\n\n');
        } catch { /* ignored */ }
      }, SSE_DEBOUNCE_MS);
    });
  } catch (err) {
    res.write(`data: {"error":"watch failed: ${err.message}"}\n\n`);
    res.end();
    return;
  }

  req.on('close', () => {
    clearTimeout(debounceTimer);
    sseConnections.delete(res);
    if (watcher) watcher.close();
  });
});

// ===== OAuth Usage Proxy =====
let cachedOAuthToken = null;
let usageCache = { data: null, fetchedAt: 0 };
const USAGE_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

function getOAuthToken(forceRefresh = false) {
  return new Promise((resolve, reject) => {
    if (cachedOAuthToken && !forceRefresh) return resolve(cachedOAuthToken);
    cachedOAuthToken = null;
    execFileCb('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], (err, stdout) => {
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

function fetchUsageFromAPI(token) {
  return new Promise((resolve, reject) => {
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
          const err = new Error(`API returned ${resp.statusCode}`);
          err.statusCode = resp.statusCode;
          reject(err);
        }
      });
    });
    req.on('error', reject);
  });
}

app.get('/api/usage', async (req, res) => {
  const now = Date.now();
  if (usageCache.data && (now - usageCache.fetchedAt) < USAGE_CACHE_TTL) {
    return res.json(usageCache.data);
  }
  try {
    let token = await getOAuthToken();
    let result;
    try {
      result = await fetchUsageFromAPI(token);
    } catch (err) {
      if (err.statusCode === 401 || err.statusCode === 429) {
        token = await getOAuthToken(true);
        result = await fetchUsageFromAPI(token);
      } else {
        throw err;
      }
    }
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

// Global error handler — catch unhandled route errors
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

function gracefulShutdown() {
  console.log('[octask] Idle for 24h — shutting down');
  for (const res of sseConnections) {
    try { res.end(); } catch { /* connection closed */ }
  }
  sseConnections.clear();
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), SHUTDOWN_FORCE_TIMEOUT_MS);
}

setInterval(() => {
  if (Date.now() - lastActivityAt >= IDLE_SHUTDOWN_MS) {
    gracefulShutdown();
  }
}, IDLE_CHECK_INTERVAL_MS);

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Octask Dashboard running at http://localhost:${PORT}`);
});
