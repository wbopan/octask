import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFileCb);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 3847;
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const ASSETS_DIR = path.join(__dirname, 'assets');
let lastActivityAt = Date.now();
const IDLE_SHUTDOWN_MS = 24 * 60 * 60 * 1000;
const GREP_MAX_BUFFER = 1024 * 1024;
const SSE_DEBOUNCE_MS = 300;
const OSASCRIPT_TIMEOUT_MS = 5000;
const SHUTDOWN_FORCE_TIMEOUT_MS = 5000;
const IDLE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const JSONL_SCAN_LINES = 20;
const TASKS_FILENAME = 'TASKS.md';
const DISCOVER_CACHE_TTL = 10_000;
const TASKS_CONTENT_CACHE_TTL = 60_000;
const CUSTOM_TITLE_CACHE_TTL = 10_000;
const sseConnections = new Set();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// --- Response helpers ---

function jsonResponse(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function textResponse(res, text, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(text);
}

function htmlResponse(res, html, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function fileResponse(res, filePath) {
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
    res.end(data);
  } catch {
    textResponse(res, 'Not found', 404);
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Check if TASKS.md exists for a project (root level).
async function tasksFileExists(projectPath) {
  try {
    await fs.access(path.join(projectPath, TASKS_FILENAME));
    return true;
  } catch { return false; }
}

function tasksAbsolute(projectPath) {
  return path.join(projectPath, TASKS_FILENAME);
}

function tasksDir(projectPath) {
  return projectPath;
}

// Heartbeat store: sessionId → { state, ts, pid }
// Persisted to disk so state survives server restarts.
const HEARTBEAT_FILE = path.join(os.tmpdir(), 'cotask-heartbeats.json');
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

// --- Caches ---
// discoverProjects cache
let discoverCache = { projects: null, fetchedAt: 0 };
// TASKS.md content cache: projectId → { content, stats, activeTaskSlugs, mtimeMs }
const tasksContentCache = new Map();
// custom-title grep cache: projectId → { titleMap, fetchedAt }
const customTitleCache = new Map();

// Discover projects by scanning ~/.claude/projects/
async function discoverProjects(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && discoverCache.projects && (now - discoverCache.fetchedAt) < DISCOVER_CACHE_TTL) {
    return discoverCache.projects;
  }

  let entries;
  try {
    entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return discoverCache.projects || [];
  }

  const projectDirNames = new Set();
  for (const entry of entries) {
    if (entry.isDirectory()) projectDirNames.add(entry.name);
  }

  // Parallelize per-project discovery
  const results = await Promise.all([...projectDirNames].map(async (dirName) => {
    const projDir = path.join(PROJECTS_DIR, dirName);
    let jsonlFiles;
    try {
      const all = await fs.readdir(projDir);
      jsonlFiles = all.filter(f => f.endsWith('.jsonl'));
    } catch { return null; }
    if (jsonlFiles.length === 0) return null;

    let realPath = null;
    for (const jf of jsonlFiles) {
      try {
        const fh = await fs.open(path.join(projDir, jf), 'r');
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
      if (realPath) break;
    }
    if (!realPath) return null;
    if (encodeProjectPath(realPath) !== dirName) return null;
    if (!(await tasksFileExists(realPath))) return null;

    return { id: dirName, name: path.basename(realPath), path: realPath };
  }));

  const projects = results.filter(Boolean);
  discoverCache = { projects, fetchedAt: Date.now() };
  return projects;
}

async function getProjectById(projectId) {
  let projects = await discoverProjects();
  let project = projects.find(p => p.id === projectId);
  if (!project) {
    projects = await discoverProjects(true);
    project = projects.find(p => p.id === projectId);
  }
  return project || null;
}

// Read TASKS.md with mtime-based cache
async function readTasksContentCached(project) {
  const filePath = tasksAbsolute(project.path);
  try {
    const stat = await fs.stat(filePath);
    const cached = tasksContentCache.get(project.id);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached;
    }

    const content = await fs.readFile(filePath, 'utf8');
    const stats = { todo: 0, ongoing: 0, done: 0, backlog: 0, total: 0 };
    const activeTaskSlugs = new Set();
    for (const line of content.split('\n')) {
      if (/^- \[ \]/.test(line)) { stats.todo++; stats.total++; }
      else if (/^- \[\/\]/.test(line)) { stats.ongoing++; stats.total++; }
      else if (/^- \[x\]/i.test(line)) { stats.done++; stats.total++; }
      else if (/^- \[-\]/.test(line)) { stats.backlog++; stats.total++; }
      const m = line.match(/^- \[[ /]\] .+#([\w-]+)\s*$/);
      if (m) activeTaskSlugs.add(m[1]);
    }

    const entry = { content, stats, activeTaskSlugs, mtimeMs: stat.mtimeMs };
    tasksContentCache.set(project.id, entry);
    return entry;
  } catch {
    return { content: '', stats: { todo: 0, ongoing: 0, done: 0, backlog: 0, total: 0 }, activeTaskSlugs: new Set(), mtimeMs: 0 };
  }
}

// Grep custom-title events with cache
async function getCustomTitles(projectId) {
  const now = Date.now();
  const cached = customTitleCache.get(projectId);
  if (cached && (now - cached.fetchedAt) < CUSTOM_TITLE_CACHE_TTL) {
    return cached.titleMap;
  }

  const projectDir = path.join(PROJECTS_DIR, projectId);
  const titleMap = new Map();
  try {
    const { stdout } = await execFileAsync('grep', [
      '-r', '--include=*.jsonl', '-h', '"custom-title"', projectDir,
    ], { maxBuffer: GREP_MAX_BUFFER });
    for (const line of stdout.split('\n')) {
      try {
        const evt = JSON.parse(line.trim());
        if (evt.type === 'custom-title' && evt.customTitle && evt.sessionId) {
          titleMap.set(evt.sessionId, evt.customTitle);
        }
      } catch { /* ignored */ }
    }
  } catch { /* ignored */ }

  customTitleCache.set(projectId, { titleMap, fetchedAt: Date.now() });
  return titleMap;
}

// Helper: build per-project session map from custom-title events + heartbeat state.
async function buildSessionMap(projectId) {
  const sessionMap = await getCustomTitles(projectId);

  // Collect sessions that need PID/process checks
  const entries = [];
  for (const [sessionId, customTitle] of sessionMap) {
    const title = customTitle.trim();
    if (!title) continue;
    entries.push({ sessionId, title });
  }

  // Parallelize all per-session checks
  const results = await Promise.all(entries.map(async ({ sessionId, title }) => {
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
            const childPids = stdout.trim().split('\n').filter(Boolean);
            if (childPids.length > 0) {
              const { stdout: psOut } = await execFileAsync('ps', ['-p', childPids.join(','), '-o', 'command=']);
              const IGNORED_PROCESSES = ['caffeinate', 'langserver'];
              childProcesses = psOut.split('\n').filter(Boolean).filter(cmd => !IGNORED_PROCESSES.some(p => cmd.includes(p))).length;
            }
          } catch { /* ignored */ }
        }
      } else {
        heartbeats.delete(sessionId);
        saveHeartbeats();
      }
    }

    const backgroundTasks = await scanBackgroundTasks(projectId, sessionId);
    const stateTs = hb?.stateTs || null;
    return { title, data: { sessionId, status, childProcesses, backgroundTasks, stateTs } };
  }));

  const result = {};
  for (const { title, data } of results) {
    result[title] = data;
  }
  return result;
}

async function scanBackgroundTasks(projectId, sessionId) {
  const bgTasksDir = path.join('/private/tmp', 'claude-501', projectId, sessionId, 'tasks');
  let taskFiles;
  try {
    taskFiles = await fs.readdir(bgTasksDir, { withFileTypes: true });
  } catch { return []; }

  const tasks = [];
  for (const file of taskFiles) {
    if (!file.name.endsWith('.output')) continue;
    const id = file.name.slice(0, -7);
    if (!/^[ab]/.test(id)) continue;

    const filePath = path.join(bgTasksDir, file.name);
    try {
      const st = await fs.lstat(filePath);

      let type;
      if (st.isSymbolicLink()) {
        type = 'agent';
      } else if (st.isFile() && /^b/.test(id)) {
        type = 'bash';
      } else {
        continue;
      }

      tasks.push({ id, type, output: filePath });
    } catch { /* ignored */ }
  }

  return tasks;
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

async function handleGetState(res) {
  const discovered = await discoverProjects();

  // Precompute alive CWDs once (process.kill is sync, very fast)
  const aliveCwds = [];
  for (const [, hb] of heartbeats) {
    if (!hb.cwd) continue;
    let alive = true;
    if (hb.pid) { try { process.kill(hb.pid, 0); } catch { alive = false; } }
    if (alive) aliveCwds.push(hb.cwd);
  }

  const projects = await Promise.all(discovered.map(async (p) => {
    const { content, stats, activeTaskSlugs } = await readTasksContentCached(p);

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

  jsonResponse(res, { projects });
}

async function handleServeDashboard(res) {
  const filePath = path.join(ASSETS_DIR, 'dashboard.html');
  try {
    const html = await fs.readFile(filePath, 'utf8');
    htmlResponse(res, html);
  } catch {
    textResponse(res, 'dashboard.html not found', 500);
  }
}

async function handleProjectDashboard(res, projectId) {
  const project = await getProjectById(projectId);
  if (!project) return textResponse(res, 'Project not found', 404);

  const filePath = path.join(ASSETS_DIR, 'dashboard.html');
  let html;
  try {
    html = await fs.readFile(filePath, 'utf8');
  } catch {
    return textResponse(res, 'dashboard.html not found in assets/', 500);
  }

  const script = `<script>window.__projectId = ${JSON.stringify(projectId)}; window.__projectName = ${JSON.stringify(project.name)};</script>`;
  html = html.replace('</head>', `${script}\n</head>`);
  htmlResponse(res, html);
}

async function handlePutTasks(res, projectId, req) {
  const project = await getProjectById(projectId);
  if (!project) return jsonResponse(res, { error: 'Project not found' }, 404);

  let body;
  try { body = await parseBody(req); } catch {
    return jsonResponse(res, { error: 'Invalid JSON' }, 400);
  }

  const { content } = body;
  if (typeof content !== 'string') {
    return jsonResponse(res, { error: 'content must be a string' }, 400);
  }

  const filePath = tasksAbsolute(project.path);
  try {
    await fs.writeFile(filePath, content, 'utf8');
    tasksContentCache.delete(projectId); // invalidate cache on write
  } catch (err) {
    return jsonResponse(res, { error: 'Failed to write TASKS.md: ' + err.message }, 500);
  }
  jsonResponse(res, { ok: true });
}

async function handleHeartbeat(res, req) {
  let body;
  try { body = await parseBody(req); } catch {
    return jsonResponse(res, { error: 'Invalid JSON' }, 400);
  }

  const { sessionId, state, pid, cwd } = body;
  if (!sessionId || !state) return jsonResponse(res, { error: 'missing sessionId or state' }, 400);
  if (state === 'notfound') {
    heartbeats.delete(sessionId);
  } else {
    const prev = heartbeats.get(sessionId);
    const now = Date.now();
    const stateTs = (prev && prev.state === state) ? prev.stateTs : now;
    heartbeats.set(sessionId, { state, ts: now, stateTs, pid: pid || null, cwd: cwd || prev?.cwd || null });
  }
  // Invalidate custom-title cache for this project so renames propagate immediately
  const hbCwd = cwd || heartbeats.get(sessionId)?.cwd;
  if (hbCwd) customTitleCache.delete(encodeProjectPath(hbCwd));
  saveHeartbeats();
  jsonResponse(res, { ok: true });
}

async function handleFocusGhosttyTab(res, req) {
  let body;
  try { body = await parseBody(req); } catch {
    return jsonResponse(res, { error: 'Invalid JSON' }, 400);
  }

  const { title } = body;
  if (!title || typeof title !== 'string') {
    return jsonResponse(res, { error: 'title is required' }, 400);
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
      return jsonResponse(res, { ok: true });
    }
    jsonResponse(res, { ok: false, error: 'No matching tab found' });
  } catch (err) {
    jsonResponse(res, { error: 'AppleScript failed: ' + err.message }, 500);
  }
}

async function handleWatch(res, projectId) {
  const project = await getProjectById(projectId);
  if (!project) return jsonResponse(res, { error: 'Project not found' }, 404);

  const dirPath = tasksDir(project.path);
  const targetFile = TASKS_FILENAME;

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
        } catch { /* ignored */ }
      }, SSE_DEBOUNCE_MS);
    });
  } catch (err) {
    res.write(`data: {"error":"watch failed: ${err.message}"}\n\n`);
    res.end();
    return;
  }

  sseConnections.add(res);

  res.on('close', () => {
    clearTimeout(debounceTimer);
    if (watcher) watcher.close();
    sseConnections.delete(res);
  });
}

async function handleUsage(res) {
  const now = Date.now();
  if (usageCache.data && (now - usageCache.fetchedAt) < USAGE_CACHE_TTL) {
    return jsonResponse(res, usageCache.data);
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
    jsonResponse(res, result);
  } catch (err) {
    if (usageCache.data) return jsonResponse(res, usageCache.data);
    jsonResponse(res, { error: err.message });
  }
}

// ===== Server =====

const server = http.createServer(async (req, res) => {
  lastActivityAt = Date.now();

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;

  try {
    // Static assets
    if (pathname.startsWith('/assets/')) {
      const relative = pathname.slice('/assets/'.length);
      // Prevent directory traversal
      if (relative.includes('..')) return textResponse(res, 'Forbidden', 403);
      const filePath = path.join(ASSETS_DIR, relative);
      return fileResponse(res, filePath);
    }

    // Service worker
    if (pathname === '/sw.js' && method === 'GET') {
      const filePath = path.join(ASSETS_DIR, 'sw.js');
      try {
        const data = await fs.readFile(filePath);
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Service-Worker-Allowed': '/',
          'Cache-Control': 'no-cache',
        });
        res.end(data);
      } catch {
        textResponse(res, 'Not found', 404);
      }
      return;
    }

    // Dashboard shell
    if ((pathname === '/' || pathname === '/offline') && method === 'GET') {
      return handleServeDashboard(res);
    }

    // API routes
    if (pathname === '/api/state' && method === 'GET') return handleGetState(res);
    if (pathname === '/api/health' && method === 'GET') return jsonResponse(res, { ok: true });
    if (pathname === '/api/heartbeat' && method === 'POST') return handleHeartbeat(res, req);
    if (pathname === '/api/focus-ghostty-tab' && method === 'POST') return handleFocusGhosttyTab(res, req);
    if (pathname === '/api/usage' && method === 'GET') return handleUsage(res);

    // Parameterized routes
    const watchMatch = pathname.match(/^\/api\/watch\/(.+)$/);
    if (watchMatch && method === 'GET') return handleWatch(res, watchMatch[1]);

    const tasksMatch = pathname.match(/^\/api\/tasks\/(.+)$/);
    if (tasksMatch && method === 'PUT') return handlePutTasks(res, tasksMatch[1], req);

    const projectMatch = pathname.match(/^\/project\/(.+)$/);
    if (projectMatch && method === 'GET') return handleProjectDashboard(res, projectMatch[1]);

    textResponse(res, 'Not found', 404);
  } catch (err) {
    console.error('Unhandled error:', err);
    jsonResponse(res, { error: 'Internal server error' }, 500);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Cotask Dashboard running at http://localhost:${PORT}`);
});

// Warm all caches at startup so the first dashboard load is fast
handleGetState({ writeHead() {}, end() {} }).catch(() => {});

// ===== Graceful shutdown =====

function gracefulShutdown() {
  console.log('[cotask] Idle for 24h — shutting down');
  saveHeartbeatsNow();
  for (const conn of sseConnections) {
    try { conn.end(); } catch { /* ignored */ }
  }
  sseConnections.clear();
  server.close();
  setTimeout(() => process.exit(0), SHUTDOWN_FORCE_TIMEOUT_MS);
}

setInterval(() => {
  if (Date.now() - lastActivityAt >= IDLE_SHUTDOWN_MS) {
    gracefulShutdown();
  }
}, IDLE_CHECK_INTERVAL_MS);

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

