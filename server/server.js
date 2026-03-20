import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFileCb);

const PORT = 3847;
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const ASSETS_DIR = path.join(import.meta.dirname, 'assets');
let lastActivityAt = Date.now();
const IDLE_SHUTDOWN_MS = 24 * 60 * 60 * 1000;
const GREP_MAX_BUFFER = 1024 * 1024;
const SSE_DEBOUNCE_MS = 300;
const OSASCRIPT_TIMEOUT_MS = 5000;
const SHUTDOWN_FORCE_TIMEOUT_MS = 5000;
const IDLE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const JSONL_SCAN_LINES = 20;
const TASKS_FILENAME = 'TASKS.md';
const TASKS_DOTCLAUDE = path.join('.claude', TASKS_FILENAME);
const sseConnections = new Set();

// Check if .claude/TASKS.md exists for a project.
async function tasksFileExists(projectPath) {
  try {
    await fs.access(path.join(projectPath, TASKS_DOTCLAUDE));
    return true;
  } catch { return false; }
}

function tasksAbsolute(projectPath) {
  return path.join(projectPath, TASKS_DOTCLAUDE);
}

function tasksDir(projectPath) {
  return path.join(projectPath, '.claude');
}

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

let saveHeartbeatsTimer = null;
function saveHeartbeats() {
  if (saveHeartbeatsTimer) return;
  saveHeartbeatsTimer = setTimeout(() => {
    saveHeartbeatsTimer = null;
    const obj = Object.fromEntries(heartbeats);
    fs.writeFile(HEARTBEAT_FILE, JSON.stringify(obj), 'utf8').catch(() => {});
  }, 5000);
}
function saveHeartbeatsNow() {
  if (saveHeartbeatsTimer) { clearTimeout(saveHeartbeatsTimer); saveHeartbeatsTimer = null; }
  const obj = Object.fromEntries(heartbeats);
  fsSync.writeFileSync(HEARTBEAT_FILE, JSON.stringify(obj), 'utf8');
}

loadHeartbeats();

// Encode a filesystem path into Claude Code's project directory name.
function encodeProjectPath(absPath) {
  return absPath
    .replace(/^\//,  '-')
    .replace(/\/\./g, '--')
    .replace(/\//g,  '-');
}

// Discover projects by scanning ~/.claude/projects/
async function discoverProjects() {
  let entries;
  try {
    entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const projectDirNames = new Set();
  for (const entry of entries) {
    if (entry.isDirectory()) projectDirNames.add(entry.name);
  }

  const projects = [];
  for (const dirName of projectDirNames) {
    const projDir = path.join(PROJECTS_DIR, dirName);
    let jsonlFiles;
    try {
      const all = await fs.readdir(projDir);
      jsonlFiles = all.filter(f => f.endsWith('.jsonl'));
    } catch { continue; }
    if (jsonlFiles.length === 0) continue;

    let realPath = null;
    try {
      const fh = await fs.open(path.join(projDir, jsonlFiles[0]), 'r');
      try {
        const buf = Buffer.alloc(4096);
        const { bytesRead } = await fh.read(buf, 0, 4096, 0);
        const chunk = buf.toString('utf8', 0, bytesRead);
        for (const line of chunk.split('\n').slice(0, JSONL_SCAN_LINES)) {
          try {
            const evt = JSON.parse(line.trim());
            if (evt.cwd) { realPath = evt.cwd; break; }
          } catch { /* ignored */ }
        }
      } finally { await fh.close(); }
    } catch { /* ignored */ }
    if (!realPath) continue;

    if (encodeProjectPath(realPath) !== dirName) continue;

    if (await tasksFileExists(realPath)) {
      projects.push({
        id: dirName,
        name: path.basename(realPath),
        path: realPath,
      });
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
    cachedProjects = await discoverProjects();
    project = cachedProjects.find(p => p.id === projectId);
  }
  return project || null;
}

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

// ===== OAuth Usage Proxy =====
let cachedOAuthToken = null;
let usageCache = { data: null, fetchedAt: 0 };
const USAGE_CACHE_TTL = 2 * 60 * 1000;

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

async function fetchUsageFromAPI(token) {
  const resp = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
    },
  });
  if (resp.ok) {
    return resp.json();
  }
  const err = new Error(`API returned ${resp.status}`);
  err.statusCode = resp.status;
  throw err;
}

// ===== Route handlers =====

async function handleGetState() {
  cachedProjects = await discoverProjects();
  const discovered = cachedProjects;

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
    const activeTaskSlugs = new Set();
    try {
      content = await fs.readFile(tasksAbsolute(p.path), 'utf8');
      for (const line of content.split('\n')) {
        if (/^- \[ \]/.test(line)) { stats.todo++; stats.total++; }
        else if (/^- \[\/\]/.test(line)) { stats.ongoing++; stats.total++; }
        else if (/^- \[x\]/i.test(line)) { stats.done++; stats.total++; }
        else if (/^- \[-\]/.test(line)) { stats.backlog++; stats.total++; }
        const m = line.match(/^- \[[ /]\] .+#([\w-]+)\s*$/);
        if (m) activeTaskSlugs.add(m[1]);
      }
    } catch { /* ignored */ }

    let sessionMap = null;
    let sessions = { running: 0, idle: 0, permission: 0, 'bg-active': 0 };

    const projectActive = aliveCwds.some(cwd => cwd === p.path || cwd.startsWith(p.path + '/'));
    if (projectActive) {
      sessionMap = await buildSessionMap(p.id);
      for (const [title, s] of Object.entries(sessionMap)) {
        if (!activeTaskSlugs.has(title)) continue;
        const isBgActive = s.status === 'idle' && s.childProcesses > 0;
        const key = isBgActive ? 'bg-active' : s.status;
        if (key in sessions) sessions[key]++;
      }
    }

    return { id: p.id, name: p.name, path: p.path, content, stats, sessions, sessionMap };
  }));

  return Response.json({ projects });
}

async function handleServeDashboard() {
  const file = Bun.file(path.join(ASSETS_DIR, 'dashboard.html'));
  if (await file.exists()) {
    return new Response(file, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return new Response('dashboard.html not found', { status: 500 });
}

async function handleProjectDashboard(projectId) {
  const project = await getProjectById(projectId);
  if (!project) return new Response('Project not found', { status: 404 });

  const file = Bun.file(path.join(ASSETS_DIR, 'dashboard.html'));
  if (!(await file.exists())) {
    return new Response('dashboard.html not found in assets/', { status: 500 });
  }

  let html = await file.text();
  const script = `<script>window.__projectId = ${JSON.stringify(projectId)}; window.__projectName = ${JSON.stringify(project.name)};</script>`;
  html = html.replace('</head>', `${script}\n</head>`);
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function handlePutTasks(projectId, req) {
  const project = await getProjectById(projectId);
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

  let body;
  try { body = await req.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { content } = body;
  if (typeof content !== 'string') {
    return Response.json({ error: 'content must be a string' }, { status: 400 });
  }

  const filePath = tasksAbsolute(project.path);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  } catch (err) {
    return Response.json({ error: 'Failed to write TASKS.md: ' + err.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}

async function handleHeartbeat(req) {
  let body;
  try { body = await req.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { sessionId, state, pid, cwd } = body;
  if (!sessionId || !state) return Response.json({ error: 'missing sessionId or state' }, { status: 400 });
  if (state === 'notfound') {
    heartbeats.delete(sessionId);
  } else {
    const prev = heartbeats.get(sessionId);
    const now = Date.now();
    const stateTs = (prev && prev.state === state) ? prev.stateTs : now;
    heartbeats.set(sessionId, { state, ts: now, stateTs, pid: pid || null, cwd: cwd || prev?.cwd || null });
  }
  saveHeartbeats();
  return Response.json({ ok: true });
}

async function handleFocusGhosttyTab(req) {
  let body;
  try { body = await req.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { title } = body;
  if (!title || typeof title !== 'string') {
    return Response.json({ error: 'title is required' }, { status: 400 });
  }

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
      return Response.json({ ok: true });
    }
    return Response.json({ ok: false, error: 'No matching tab found' });
  } catch (err) {
    return Response.json({ error: 'AppleScript failed: ' + err.message }, { status: 500 });
  }
}

async function handleWatch(projectId) {
  const project = await getProjectById(projectId);
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

  const dirPath = tasksDir(project.path);
  const targetFile = TASKS_FILENAME;

  let watcher;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue('data: {"connected":true}\n\n');

      let debounceTimer = null;
      try {
        watcher = fsSync.watch(dirPath, (eventType, filename) => {
          if (filename !== targetFile) return;
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            try {
              controller.enqueue('data: {"changed":true}\n\n');
            } catch { /* ignored */ }
          }, SSE_DEBOUNCE_MS);
        });
      } catch (err) {
        controller.enqueue(`data: {"error":"watch failed: ${err.message}"}\n\n`);
        controller.close();
        return;
      }

      // Store cleanup references on the controller
      controller._debounceTimer = debounceTimer;
      controller._watcher = watcher;
    },
    cancel() {
      if (watcher) watcher.close();
    },
  });

  const response = new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
  sseConnections.add(response);
  return response;
}

async function handleUsage() {
  const now = Date.now();
  if (usageCache.data && (now - usageCache.fetchedAt) < USAGE_CACHE_TTL) {
    return Response.json(usageCache.data);
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
    return Response.json(result);
  } catch (err) {
    if (usageCache.data) return Response.json(usageCache.data);
    return Response.json({ error: err.message });
  }
}

function serveStaticFile(filePath) {
  const file = Bun.file(filePath);
  return new Response(file);
}

// ===== Server =====

const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    lastActivityAt = Date.now();

    const url = new URL(req.url);
    const pathname = url.pathname;
    const method = req.method;

    try {
      // Static assets
      if (pathname.startsWith('/assets/')) {
        const relative = pathname.slice('/assets/'.length);
        // Prevent directory traversal
        if (relative.includes('..')) return new Response('Forbidden', { status: 403 });
        const filePath = path.join(ASSETS_DIR, relative);
        const file = Bun.file(filePath);
        if (await file.exists()) return new Response(file);
        return new Response('Not found', { status: 404 });
      }

      // Service worker
      if (pathname === '/sw.js' && method === 'GET') {
        const file = Bun.file(path.join(ASSETS_DIR, 'sw.js'));
        return new Response(file, {
          headers: {
            'Service-Worker-Allowed': '/',
            'Cache-Control': 'no-cache',
          },
        });
      }

      // Dashboard shell
      if ((pathname === '/' || pathname === '/offline') && method === 'GET') {
        return handleServeDashboard();
      }

      // API routes
      if (pathname === '/api/state' && method === 'GET') return handleGetState();
      if (pathname === '/api/health' && method === 'GET') return Response.json({ ok: true });
      if (pathname === '/api/heartbeat' && method === 'POST') return handleHeartbeat(req);
      if (pathname === '/api/focus-ghostty-tab' && method === 'POST') return handleFocusGhosttyTab(req);
      if (pathname === '/api/usage' && method === 'GET') return handleUsage();

      // Parameterized routes
      const watchMatch = pathname.match(/^\/api\/watch\/(.+)$/);
      if (watchMatch && method === 'GET') return handleWatch(watchMatch[1]);

      const tasksMatch = pathname.match(/^\/api\/tasks\/(.+)$/);
      if (tasksMatch && method === 'PUT') return handlePutTasks(tasksMatch[1], req);

      const projectMatch = pathname.match(/^\/project\/(.+)$/);
      if (projectMatch && method === 'GET') return handleProjectDashboard(projectMatch[1]);

      return new Response('Not found', { status: 404 });
    } catch (err) {
      console.error('Unhandled error:', err);
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
});

console.log(`Octask Dashboard running at http://localhost:${PORT}`);

// ===== Graceful shutdown =====

function gracefulShutdown() {
  console.log('[octask] Idle for 24h — shutting down');
  saveHeartbeatsNow();
  sseConnections.clear();
  server.stop();
  setTimeout(() => process.exit(0), SHUTDOWN_FORCE_TIMEOUT_MS);
}

setInterval(() => {
  if (Date.now() - lastActivityAt >= IDLE_SHUTDOWN_MS) {
    gracefulShutdown();
  }
}, IDLE_CHECK_INTERVAL_MS);

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
