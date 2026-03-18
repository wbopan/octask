    // ===== STATE =====
    let projectId = window.__projectId || null;
    let allProjects = []; // cached project list from /api/projects
    let preamble = '';
    let sections = [];
    let hasChanges = false;
    let isSaving = false;
    let activeSectionId = null; // selected section in sidebar, null = show all
    let sessionMap = {}; // customTitle → { sessionId, status, summary }
    let hideDone = localStorage.getItem('octask-hide-done') !== 'false';
    let healthPollTimer = null;
    let lastSessionSnapshot = null;
    let lastSavedMarkdown = null;

    // Undo stack — stores snapshots taken before each mutation
    const undoStack = [];
    const MAX_UNDO = 50;
    let lastCleanSnapshot = null;

    function takeSnapshot() {
      return JSON.parse(JSON.stringify(sections));
    }

    // Call this before any mutation to save the pre-mutation state
    function saveForUndo() {
      const snap = lastCleanSnapshot || takeSnapshot();
      undoStack.push(snap);
      if (undoStack.length > MAX_UNDO) undoStack.shift();
    }

    function undo() {
      if (undoStack.length === 0) { showStatus('Nothing to undo'); return; }
      sections = undoStack.pop();
      lastCleanSnapshot = takeSnapshot();
      hasChanges = true;
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(autoSave, 600);
      render();
      showStatus('Undone');
    }

    const STATUS_ORDER = ['ongoing', 'todo', 'canceled', 'done'];
    const STATUS_LABELS = { todo: 'Pending', ongoing: 'Ongoing', done: 'Done', canceled: 'Backlog' };
    const STATUS_SYMBOLS = { todo: '[ ]', ongoing: '[/]', done: '[x]', canceled: '[-]' };
    const STATUS_COLORS = { ongoing: '#2563eb', todo: '#e09400', done: '#16a34a', canceled: '#94a3b8' };

    function statusIcon(status) {
      const c = STATUS_COLORS[status] || '#94a3b8';
      const icons = {
        ongoing: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.5" stroke="${c}" stroke-width="1.8"/><polygon points="6.8,4.8 11.5,8 6.8,11.2" fill="${c}"/></svg>`,
        todo: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.5" stroke="${c}" stroke-width="1.8"/><path d="M8 5v3.5l2.5 1.5" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        done: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.5" stroke="${c}" stroke-width="1.8"/><path d="M5.2 8.2l2 2 3.6-4.4" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        canceled: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 5.5h10v7.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13V5.5z" stroke="${c}" stroke-width="1.6"/><path d="M2 3.8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1.2H2V3.8z" stroke="${c}" stroke-width="1.6"/><path d="M6.5 8v4M9.5 8v4" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/></svg>`,
      };
      return `<span class="status-icon">${icons[status] || ''}</span>`;
    }

    const $ = id => document.getElementById(id);
    const statusEl = $('status');
    const errorBanner = $('errorBanner');
    const errorBannerMsg = $('errorBannerMsg');
    let serverConnected = true;
    let saveRetryCount = 0;
    const MAX_SAVE_RETRIES = 3;

    function showStatus(msg, isError = false) {
      statusEl.textContent = msg;
      statusEl.classList.toggle('error', isError);
      statusEl.classList.add('visible');
      setTimeout(() => statusEl.classList.remove('visible'), isError ? 4000 : 2000);
    }

    function showErrorBanner(msg) {
      errorBannerMsg.textContent = msg;
      errorBanner.classList.add('visible');
      serverConnected = false;
    }

    function hideErrorBanner() {
      errorBanner.classList.remove('visible');
      serverConnected = true;
    }

    function startHealthPolling() {
      if (healthPollTimer) return;
      healthPollTimer = setInterval(async () => {
        try {
          const res = await fetch('/api/health');
          if (res.ok) {
            clearInterval(healthPollTimer);
            healthPollTimer = null;
            location.reload();
          }
        } catch {}
      }, 3000);
    }

    function showOfflineState() {
      const h2 = $('emptyState').querySelector('h2');
      const p = $('emptyState').querySelector('p');
      h2.textContent = 'Server Not Running';
      p.innerHTML = 'Use <code style="font-family:var(--mono);font-size:14px;background:var(--bg-warm);border:1px solid var(--border);padding:6px 14px;border-radius:var(--radius-sm);margin-top:10px;color:var(--accent);user-select:all">/dashboard</code> in Claude Code to start the server.';
      $('emptyState').style.display = 'flex';
      $('sidebar').style.display = 'none';
      $('boardWrapper').style.display = 'none';
      startHealthPolling();
    }

    $('errorBannerRetry').addEventListener('click', async () => {
      errorBannerMsg.textContent = 'Reconnecting...';
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          hideErrorBanner();
          showStatus('Reconnected');
          if (hasChanges) autoSave();
        } else {
          errorBannerMsg.textContent = 'Server returned error — is it running?';
        }
      } catch {
        errorBannerMsg.textContent = 'Still disconnected — check if server is running';
      }
    });

    function makeId(name) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return slug || ('section-' + uid());
    }

    function uid() { return Date.now() + Math.random(); }


    async function focusGhosttyTab(title) {
      try {
        const resp = await fetch('/api/focus-ghostty-tab', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        const data = await resp.json();
        if (data.ok) {
          showStatus('Focused in Ghostty');
        } else {
          showStatus('No matching Ghostty tab found', true);
        }
      } catch {
        showStatus('Failed to focus Ghostty tab', true);
      }
    }

    function getTaskSession(task) {
      if (!task?.slug) return null;
      const key = task.slug.replace(/^#/, '');
      return sessionMap[key] || sessionMap['#' + key] || null;
    }

    function isDeepEqual(a, b) {
      if (a === b) return true;
      if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;

      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      if (aKeys.length !== bKeys.length) return false;

      aKeys.sort();
      bKeys.sort();
      for (let i = 0; i < aKeys.length; i++) {
        if (aKeys[i] !== bKeys[i]) return false;
      }

      for (const key of aKeys) {
        const av = a[key];
        const bv = b[key];
        if (!isDeepEqual(av, bv)) return false;
      }
      return true;
    }

    function getCurrentProjectPath() {
      const current = allProjects.find(p => p.id === projectId);
      return current?.path || '';
    }

    function shellQuote(value) {
      return `'${String(value).replace(/'/g, `'\\''`)}'`;
    }

    function quoteForRename(value) {
      return String(value || '').replace(/"/g, '\\"');
    }

    function flashButton(button, color = 'var(--status-done)') {
      if (!button) return;
      button.style.color = color;
      button.style.borderColor = color;
      setTimeout(() => {
        button.style.color = '';
        button.style.borderColor = '';
      }, 800);
    }

    async function copyToClipboard(text, button, successMessage = 'Copied') {
      if (!text) return showStatus('Nothing to copy', true);
      try {
        await navigator.clipboard.writeText(text);
        flashButton(button);
        showStatus(successMessage);
      } catch {
        showStatus('Failed to copy to clipboard', true);
      }
    }

    async function handleTerminalAction(task, button) {
      const slug = task?.slug ? task.slug.replace(/^#/, '') : '';
      const projectPath = getCurrentProjectPath();
      const session = getTaskSession(task);

      if (session && ['running', 'idle', 'permission'].includes(session.status)) {
        const title = slug || task?.title || '';
        await focusGhosttyTab(title);
        flashButton(button, 'var(--status-ongoing)');
        return;
      }

      if (!slug) return showStatus('Task has no ID', true);
      if (!projectPath) return showStatus('Project path unavailable', true);

      const base = `cd ${shellQuote(projectPath)} && `;
      const cmd = session
        ? `${base}claude -r ${shellQuote(slug)}`
        : `${base}claude "/rename ${quoteForRename(slug)}"`;

      await copyToClipboard(cmd, button, session ? 'Resume command copied' : 'Rename command copied');
    }

    function escapeHtml(text) {
      const d = document.createElement('div');
      d.textContent = text || '';
      return d.innerHTML;
    }

    function escapeAttr(text) {
      return (text || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function splitMultiline(value) {
      return (value || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(line => line.replace(/\s+$/g, ''))
        .filter(line => line !== '');
    }

    function escapeMultilineHtml(value) {
      return splitMultiline(value).map(escapeHtml).join('<br>');
    }

    // ===== PARSE =====
    function parseTasksMd(content) {
      const result = [];
      let pre = '';
      const defaultSection = { id: '__default', name: '', description: '', tasks: [] };
      let currentSection = defaultSection;
      let currentTask = null;
      let inDesc = false;
      let descSectionLines = [];
      let descLines = [];
      let seenSection = false;

      for (const line of content.split('\n')) {
        const sectionMatch = line.match(/^## (.+)$/);
        if (sectionMatch) {
          if (currentTask) { flushTask(currentTask, descLines); currentSection.tasks.push(currentTask); currentTask = null; descLines = []; }
          if (inDesc) { currentSection.description = descSectionLines.join(' ').trim(); inDesc = false; descSectionLines = []; }
          const name = sectionMatch[1].trim();
          currentSection = { id: makeId(name), name, description: '', tasks: [] };
          result.push(currentSection);
          seenSection = true;
          continue;
        }

        if (currentSection && !currentTask) {
          const descStart = line.match(/^Description:\s*(.*)$/);
          if (descStart) { inDesc = true; descSectionLines = [descStart[1]]; continue; }
          if (inDesc) {
            if (line.trim() === '' && descSectionLines.length > 0) { currentSection.description = descSectionLines.join(' ').trim(); inDesc = false; descSectionLines = []; continue; }
            descSectionLines.push(line.trim());
            continue;
          }
        }

        const taskMatch = line.match(/^- \[([ xX\/\-])\]\s*(.*)$/);
        if (taskMatch) {
          if (inDesc) { currentSection.description = descSectionLines.join(' ').trim(); inDesc = false; descSectionLines = []; }
          if (currentTask) { flushTask(currentTask, descLines); currentSection.tasks.push(currentTask); descLines = []; }
          const sym = taskMatch[1];
          let status = 'todo';
          if (sym === 'x' || sym === 'X') status = 'done';
          else if (sym === '/') status = 'ongoing';
          else if (sym === '-') status = 'canceled';
          const rawTitle = taskMatch[2].trim();
          const slugMatch = rawTitle.match(/^(.+?)\s+#([\w-]+)$/);
          const titleText = slugMatch ? slugMatch[1].trim() : rawTitle;
          const slug = slugMatch ? slugMatch[2] : '';
          currentTask = { id: uid(), title: titleText, slug, desc: '', ac: '', cm: '', status, sectionId: currentSection.id };
          descLines = [];
          continue;
        }

        if (currentTask && (line.startsWith('    ') || line.startsWith('\t'))) {
          descLines.push(line.replace(/^    |\t/, ''));
          continue;
        }

        if (currentTask && line.trim() === '') continue;

        if (currentTask && line.trim() !== '') {
          flushTask(currentTask, descLines);
          currentSection.tasks.push(currentTask);
          currentTask = null;
          descLines = [];
        }

        if (!seenSection && !currentTask && defaultSection.tasks.length === 0) pre += line + '\n';
      }

      if (inDesc && currentSection) currentSection.description = descSectionLines.join(' ').trim();
      if (currentTask) { flushTask(currentTask, descLines); currentSection.tasks.push(currentTask); }

      if (defaultSection.tasks.length > 0) {
        result.unshift(defaultSection);
      }

      preamble = pre;
      return result;
    }

    function flushTask(task, descLines) {
      let full = descLines.join('\n').trim();
      const acLines = [...full.matchAll(/^-?\s*AC:\s*(.*)$/gm)]
        .map((m) => (m[1] || '').replace(/\s+$/g, ''))
        .filter((line) => line !== '');
      if (acLines.length) {
        task.ac = acLines.join('\n');
        full = full.replace(/^-?\s*AC:\s*.*$/gm, '');
      }
      const cmLines = [...full.matchAll(/^-?\s*CM:\s*(.*)$/gm)]
        .map((m) => (m[1] || '').replace(/\s+$/g, ''))
        .filter((line) => line !== '');
      if (cmLines.length) {
        task.cm = cmLines.join('\n');
        full = full.replace(/^-?\s*CM:\s*.*$/gm, '');
      }
      task.desc = full.replace(/\n{2,}/g, '\n').trim();
    }

    // ===== SERIALIZE =====
    function toMarkdown() {
      let md = preamble;
      sections.forEach(section => {
        if (section.name) {
          md += `## ${section.name}\n\n`;
          if (section.description) md += `Description: ${section.description}\n\n`;
        }
        section.tasks.forEach(t => {
          md += `- ${STATUS_SYMBOLS[t.status] || '[ ]'} ${t.title}${t.slug ? ' #' + t.slug : ''}\n`;
          if (t.desc) t.desc.split('\n').forEach(l => { md += `    ${l}\n`; });
          if (t.cm) splitMultiline(t.cm).forEach(line => { md += `    CM: ${line}\n`; });
          if (t.ac) splitMultiline(t.ac).forEach(line => { md += `    AC: ${line}\n`; });
        });
      });
      return md.trimEnd() + '\n';
    }

    // ===== STATS =====
    function allTasks() { return sections.flatMap(s => s.tasks); }

    function countByStatus(tasks) {
      const c = { todo: 0, ongoing: 0, done: 0, canceled: 0 };
      tasks.forEach(t => c[t.status]++);
      return c;
    }

    function pctDone(tasks) {
      if (tasks.length === 0) return 0;
      return Math.round((countByStatus(tasks).done / tasks.length) * 100);
    }

    // ===== RENDER =====
    function render() {
      renderSidebar();
      renderBoard();
      lucide.createIcons();
    }

    function flipAnimate(el, oldRect, spring) {
      const cur = el.getBoundingClientRect();
      const dx = oldRect.left - cur.left, dy = oldRect.top - cur.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.transform = `translate(${dx}px,${dy}px)`;
      el.style.transition = 'none';
      el.offsetHeight;
      el.style.transition = `transform 0.35s ${spring}`;
      el.style.transform = '';
      el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
    }

    function animatedRender(skipTaskId) {
      const oldRects = new Map();
      document.querySelectorAll('[data-flip-key]').forEach(el => {
        oldRects.set(el.dataset.flipKey, el.getBoundingClientRect());
      });
      render();
      const spring = 'cubic-bezier(0.22, 1, 0.36, 1)';
      document.querySelectorAll('[data-flip-key]').forEach(el => {
        if (skipTaskId != null && el.dataset.taskId === String(skipTaskId)) return;
        const old = oldRects.get(el.dataset.flipKey);
        if (old) flipAnimate(el, old, spring);
      });
    }


    function renderProjectList() {
      const list = $('projectList');
      list.innerHTML = '';

      for (const proj of allProjects) {
        const isActive = proj.id === projectId;
        const item = document.createElement('div');
        item.className = `project-item ${isActive ? 'active' : ''}`;

        const total = proj.stats.total || 1;
        const donePct = Math.round((proj.stats.done / total) * 100);

        let html = `
          <div class="project-item-header">
            <span class="project-item-name">${escapeHtml(proj.name)}</span>
            <span class="project-item-pct">${donePct}%</span>
          </div>
          <div class="project-mini-bar">
            <div class="done" style="width:${(proj.stats.done/total)*100}%"></div>
            <div class="ongoing" style="width:${(proj.stats.ongoing/total)*100}%"></div>
          </div>
        `;

        if (isActive) {
          html += `<div class="project-expanded">
            <div class="global-stats" id="globalStats"></div>
            <div class="section-list" id="sectionList"></div>
          </div>`;
        }

        item.innerHTML = html;

        if (!isActive) {
          item.addEventListener('click', () => switchProject(proj.id));
        }

        list.appendChild(item);
      }
    }

    function renderSidebar() {
      renderProjectList();

      // Global stats (inside active project's expanded area)
      const globalStatsEl = $('globalStats');
      if (!globalStatsEl) return;
      const all = allTasks();
      const counts = countByStatus(all);
      globalStatsEl.innerHTML = STATUS_ORDER.map(st =>
        `<div class="global-stat">${statusIcon(st)}<span class="num">${counts[st]}</span></div>`
      ).join('');

      // Section list
      const list = $('sectionList');
      list.innerHTML = '';

      if (sections.some(s => s.name)) {
        sections.forEach(section => {
          if (!section.name) return; // skip unnamed default section in list
          const stats = countByStatus(section.tasks);
          const total = section.tasks.length;
          const isActive = activeSectionId === section.id;

          const item = document.createElement('div');
          item.className = `section-item ${isActive ? 'active' : ''}`;

          item.innerHTML = `
            <div class="section-item-header">
              <span class="section-item-name">${escapeHtml(section.name)}</span>
              <span class="section-item-count">${total}</span>
            </div>
            <div class="section-item-bar">
              ${total > 0 ? `
                <div class="done" style="width:${(stats.done/total)*100}%"></div>
                <div class="ongoing" style="width:${(stats.ongoing/total)*100}%"></div>
              ` : ''}
            </div>
            <div class="section-item-counts">
              ${STATUS_ORDER.filter(st => stats[st] > 0).map(st =>
                `<span class="section-mini-stat">${statusIcon(st)}${stats[st]}</span>`
              ).join('')}
            </div>
            ${section.description ? `<div class="section-item-desc">${escapeHtml(section.description)}</div>` : ''}
            <div class="section-item-actions">
              <button data-action="edit-section">Edit</button>
              <button data-action="delete-section">Delete</button>
            </div>
          `;

          item.addEventListener('click', (e) => {
            if (e.target.closest('[data-action]')) return;
            activeSectionId = isActive ? null : section.id;
            render();
          });

          item.querySelector('[data-action="edit-section"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            editSectionModal(section);
          });

          item.querySelector('[data-action="delete-section"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (section.tasks.length > 0) {
              showStatus('Cannot delete a section with tasks');
              return;
            }
            sections = sections.filter(s => s.id !== section.id);
            if (activeSectionId === section.id) activeSectionId = null;
            markChanged();
            render();
          });

          list.appendChild(item);
        });
      }
    }

    function renderBoard() {
      const board = $('boardArea');
      board.innerHTML = '';

      // Determine which sections to show
      const visibleSections = activeSectionId ? sections.filter(s => s.id === activeSectionId) : sections;
      const hasMultipleNamedSections = sections.filter(s => s.name).length > 1 || (sections.some(s => s.name) && sections.some(s => !s.name));

      STATUS_ORDER.forEach(status => {
        const col = document.createElement('div');
        col.className = 'status-column';
        col.dataset.status = status;

        // Gather tasks for this status across visible sections
        let totalCount = 0;
        const sectionGroups = [];
        visibleSections.forEach(section => {
          const tasks = section.tasks.filter(t => t.status === status);
          sectionGroups.push({ section, tasks });
          totalCount += tasks.length;
        });

        // Done column: collapsed state (hides body, keeps header with toggle)
        if (status === 'done' && hideDone) {
          col.classList.add('collapsed');
        }

        // Header
        const header = document.createElement('div');
        header.className = 'status-column-header';
        header.innerHTML = `
          ${statusIcon(status)}
          <span class="status-column-name">${STATUS_LABELS[status]}</span>
          <span class="status-column-count">${totalCount}</span>
        `;

        // Done column: add toggle button (always visible)
        if (status === 'done') {
          const toggleBtn = document.createElement('button');
          toggleBtn.className = 'col-toggle-btn';
          if (hideDone) {
            toggleBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/></svg>Show';
          } else {
            toggleBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/><line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Hide';
          }
          const showSvg = '<svg viewBox="0 0 16 16" fill="none"><path d="M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/></svg>Show';
          const hideSvg = '<svg viewBox="0 0 16 16" fill="none"><path d="M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/><line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Hide';
          toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideDone = !hideDone;
            localStorage.setItem('octask-hide-done', String(hideDone));
            const doneCol = toggleBtn.closest('.status-column');
            doneCol.classList.toggle('collapsed', hideDone);
            toggleBtn.innerHTML = hideDone ? showSvg : hideSvg;
          });
          header.appendChild(toggleBtn);
        }

        col.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'status-column-body';
        body.dataset.status = status;

        sectionGroups.forEach(({ section, tasks }) => {
          const sectionEl = document.createElement('div');
          sectionEl.className = 'section-group';
          sectionEl.dataset.sectionId = section.id;

          // Section header (only show for named sections when there are multiple)
          if (section.name && (visibleSections.length > 1 || hasMultipleNamedSections)) {
            const sHeader = document.createElement('div');
            sHeader.className = 'section-group-header';
            sHeader.textContent = section.name;
            sHeader.dataset.flipKey = `h-${status}-${section.id}`;
            sectionEl.appendChild(sHeader);
          }

          tasks.forEach(task => {
            sectionEl.appendChild(createTaskCard(task, section));
          });

          body.appendChild(sectionEl);
        });

        // Still show drop zone even when empty
        setupColumnDropZone(body, status);

        col.appendChild(body);
        board.appendChild(col);
      });
    }

    function createTaskCard(task, section) {
      const card = document.createElement('div');
      card.className = 'task-card';
      card.draggable = true;
      card.dataset.taskId = task.id;
      card.dataset.sectionId = section.id;
      card.dataset.flipKey = 'c-' + task.id;

      const content = document.createElement('div');
      content.className = 'task-card-content';

      // Actions
      const actions = document.createElement('div');
      actions.className = 'task-card-actions';

      const terminalBtn = document.createElement('button');
      terminalBtn.className = 'terminal-btn';

      const session = getTaskSession(task);
      if (session && ['running', 'idle', 'permission'].includes(session.status)) {
        terminalBtn.innerHTML = '<i data-lucide="ghost"></i>';
        terminalBtn.classList.add('terminal-active');
        terminalBtn.title = 'Open running session in Ghostty';
      } else if (session) {
        terminalBtn.innerHTML = '<i data-lucide="play"></i>';
        terminalBtn.classList.add('terminal-history');
        terminalBtn.title = 'Copy resume command';
      } else {
        terminalBtn.innerHTML = '<i data-lucide="terminal"></i>';
        terminalBtn.classList.add('terminal-no-session');
        terminalBtn.title = 'Copy rename command';
      }

      terminalBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleTerminalAction(task, terminalBtn);
      });
      actions.appendChild(terminalBtn);

      if (task.slug) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-id-btn';
        copyBtn.innerHTML = '<i data-lucide="copy"></i>';
        copyBtn.title = 'Copy ID';
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          copyToClipboard(task.slug, copyBtn, 'Task ID copied');
        });
        actions.appendChild(copyBtn);
      } else {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-id-btn';
        copyBtn.innerHTML = '<i data-lucide="copy"></i>';
        copyBtn.disabled = true;
        copyBtn.title = 'No task ID';
        actions.appendChild(copyBtn);
      }

      const editBtn = document.createElement('button');
      editBtn.className = 'edit-btn';
      editBtn.innerHTML = '<i data-lucide="pencil"></i>';
      editBtn.title = 'Edit';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditTaskModal(task, section);
      });
      actions.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'delete-btn';
      delBtn.innerHTML = '<i data-lucide="x"></i>';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteTask(task, section); });
      actions.appendChild(delBtn);
      card.appendChild(actions);

      // Title
      const title = document.createElement('div');
      title.className = `task-card-title ${task.status === 'done' ? 'crossed' : ''}`;
      title.textContent = task.title;
      title.addEventListener('click', (e) => { e.stopPropagation(); openEditTaskModal(task, section); });
      content.appendChild(title);

      // Description
      if (task.desc) {
        const desc = document.createElement('div');
        desc.className = 'task-card-desc';
        desc.textContent = task.desc;
        desc.addEventListener('click', (e) => { e.stopPropagation(); openEditTaskModal(task, section); });
        content.appendChild(desc);
      }

      // AC
      if (task.ac) {
        const ac = document.createElement('div');
        ac.className = 'task-card-ac';
        ac.innerHTML = `<span class="ac-label">AC</span>${escapeMultilineHtml(task.ac)}`;
        ac.addEventListener('click', (e) => { e.stopPropagation(); openEditTaskModal(task, section); });
        content.appendChild(ac);
      }

      // CM
      if (task.cm) {
        const cm = document.createElement('div');
        cm.className = 'task-card-cm';
        cm.innerHTML = `<span class="cm-label">CM</span>${escapeMultilineHtml(task.cm)}`;
        cm.addEventListener('click', (e) => { e.stopPropagation(); openEditTaskModal(task, section); });
        content.appendChild(cm);
      }

      // Session status dot (ongoing tasks only)
      if (task.status === 'ongoing') {
        const dot = document.createElement('span');
        dot.className = 'session-dot';
        if (session) {
          dot.classList.add(session.status); // running, idle, permission, notfound
          if (session.status === 'running') card.classList.add('session-running');
          if (session.childProcesses > 0) dot.classList.add('has-bg');
          const titles = { running: 'Running', idle: 'Idle', permission: 'Waiting for permission', notfound: 'Session ended' };
          let tip = titles[session.status] || session.status;
          if (session.childProcesses > 0) tip += ` (${session.childProcesses} background)`;
          dot.title = tip;
          if (['running', 'idle', 'permission'].includes(session.status)) {
            dot.classList.add('clickable');
            dot.title += ' — click to focus in Ghostty';
            dot.addEventListener('click', (e) => {
              e.stopPropagation();
              focusGhosttyTab(key);
            });
          }
        } else {
          dot.classList.add('none');
          dot.title = 'No session linked';
        }
        title.prepend(dot);
      }

      card.appendChild(content);

      // Drag
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('application/json', JSON.stringify({ taskId: task.id, sectionId: section.id, fromStatus: task.status }));
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        document.querySelectorAll('.drop-indicator').forEach(el => el.remove());
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });

      return card;
    }

    // Unified hit-testing: headers and cards are equal items in one flat scan
    function findDropPosition(body, clientY) {
      for (const item of body.querySelectorAll('.section-group-header, .task-card:not(.dragging)')) {
        const r = item.getBoundingClientRect();
        if (clientY < r.top + r.height / 2) return item;
      }
      return null;
    }

    function setupColumnDropZone(body, status) {
      body.addEventListener('dragover', (e) => {
        e.preventDefault();
        body.classList.add('drag-over');
        body.querySelectorAll('.drop-indicator').forEach(el => el.remove());

        const insertBefore = findDropPosition(body, e.clientY);
        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        if (insertBefore) insertBefore.before(indicator);
        else body.appendChild(indicator);
      });

      body.addEventListener('dragleave', (e) => {
        if (!body.contains(e.relatedTarget)) {
          body.classList.remove('drag-over');
          body.querySelectorAll('.drop-indicator').forEach(el => el.remove());
        }
      });

      body.addEventListener('drop', (e) => {
        e.preventDefault();
        body.classList.remove('drag-over');
        body.querySelectorAll('.drop-indicator').forEach(el => el.remove());

        try {
          const data = JSON.parse(e.dataTransfer.getData('application/json'));
          const srcSection = sections.find(s => s.id === data.sectionId);
          if (!srcSection) return;
          const taskIdx = srcSection.tasks.findIndex(t => t.id == data.taskId);
          if (taskIdx === -1) return;
          const task = srcSection.tasks[taskIdx];

          task.status = status;
          srcSection.tasks.splice(taskIdx, 1);

          const insertBefore = findDropPosition(body, e.clientY);
          const allGroups = [...body.querySelectorAll('.section-group')];

          if (insertBefore && insertBefore.classList.contains('task-card')) {
            // Insert before a card → same section as that card, before it
            const dstSection = sections.find(s => s.id === insertBefore.dataset.sectionId);
            if (dstSection) {
              const bIdx = dstSection.tasks.findIndex(t => t.id == parseFloat(insertBefore.dataset.taskId));
              if (bIdx !== -1) dstSection.tasks.splice(bIdx, 0, task);
              else dstSection.tasks.push(task);
            } else {
              srcSection.tasks.push(task);
            }
          } else if (insertBefore) {
            // Insert before a section header → end of the PREVIOUS section
            const headerGroup = insertBefore.closest('.section-group');
            const groupIdx = allGroups.indexOf(headerGroup);
            if (groupIdx > 0) {
              const prevId = allGroups[groupIdx - 1].dataset.sectionId;
              const prevSection = sections.find(s => s.id === prevId);
              if (prevSection) prevSection.tasks.push(task);
              else srcSection.tasks.push(task);
            } else {
              // Before the first header → __default section
              let def = sections.find(s => s.id === '__default');
              if (!def) {
                def = { id: '__default', name: '', description: '', tasks: [] };
                sections.unshift(def);
              }
              def.tasks.push(task);
            }
          } else {
            // Below everything → append to last section
            const lastId = allGroups[allGroups.length - 1]?.dataset.sectionId;
            const dstSection = sections.find(s => s.id === lastId) || srcSection;
            dstSection.tasks.push(task);
          }

          markChanged();
          animatedRender(task.id);
        } catch (err) {}
      });
    }

    // ===== TASK OPERATIONS =====
    function deleteTask(task, section) {
      const label = task.slug ? `${task.title} (#${task.slug})` : task.title;
      if (!confirm(`Delete task ${label}?`)) return;

      const idx = section.tasks.findIndex(t => t.id === task.id);
      if (idx !== -1) {
        section.tasks.splice(idx, 1);
        markChanged();
        render();
      }
    }

    // ===== MODALS =====
    let modalSaveCallback = null;

    function openModal(title, bodyHtml, onSave) {
      $('modalTitle').textContent = title;
      $('modalBody').innerHTML = bodyHtml;
      modalSaveCallback = onSave;
      $('modalOverlay').classList.add('visible');
    }

    function closeModal() {
      $('modalOverlay').classList.remove('visible');
      modalSaveCallback = null;
    }

    $('modalClose').addEventListener('click', closeModal);
    $('modalCancel').addEventListener('click', closeModal);
    $('modalSave').addEventListener('click', () => { if (modalSaveCallback) modalSaveCallback(); closeModal(); });
    $('modalOverlay').addEventListener('click', (e) => { if (e.target === $('modalOverlay')) closeModal(); });

    function openNewTaskModal(section, defaultStatus = 'todo') {
      const hasNamedSections = sections.some(s => s.name);
      openModal('New Task', `
        <div class="form-group">
          <label>Title</label>
          <input type="text" id="mTitle" placeholder="What needs to be done?">
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:1">
            <label>ID</label>
            <input type="text" id="mSlug" style="font-family:var(--mono);font-size:13px" placeholder="e.g. fix-auth-bug">
          </div>
          <div class="form-group" style="width:140px">
            <label>Status</label>
            <div class="status-select-wrap">
              <span class="status-select-icon" id="mStatusIcon">${statusIcon(defaultStatus)}</span>
              <select id="mStatus">
                ${STATUS_ORDER.map(st => `<option value="${st}" ${st === defaultStatus ? 'selected' : ''}>${STATUS_LABELS[st]}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
        ${hasNamedSections ? `
        <div class="form-group">
          <label>Section</label>
          <select id="mSection">
            ${sections.filter(s => s.name).map(s => `<option value="${s.id}" ${s.id === section.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
        ` : ''}
        <div class="form-group">
          <label>Description</label>
          <textarea id="mDesc" placeholder="Context and details..." rows="6"></textarea>
        </div>
        <div class="form-group">
          <label>Acceptance Criteria</label>
          <textarea id="mAc" placeholder="Testable, implementation-agnostic..." rows="5"></textarea>
        </div>
        <div class="form-group">
          <label>Completion Memo</label>
          <textarea id="mCm" placeholder="What was done, decisions made, risks found..." rows="4"></textarea>
        </div>
      `, () => {
        const title = $('mTitle').value.trim();
        if (!title) return;
        const selSection = (hasNamedSections && $('mSection')) ? (sections.find(s => s.id === $('mSection').value) || section) : section;
        const selStatus = $('mStatus');
        selSection.tasks.push({
          id: uid(),
          title,
          slug: $('mSlug').value.trim().replace(/^#/, ''),
          desc: $('mDesc').value.trim(),
          ac: ($('mAc').value || '').replace(/\r\n?/g, '\n').trim(),
          cm: ($('mCm').value || '').replace(/\r\n?/g, '\n').trim(),
          status: selStatus ? selStatus.value : defaultStatus,
          sectionId: selSection.id
        });
        markChanged();
        render();
      });
      $('mStatus').addEventListener('change', () => { $('mStatusIcon').innerHTML = statusIcon($('mStatus').value); });
      setTimeout(() => $('mTitle').focus(), 50);
    }

    function openEditTaskModal(task, section) {
      const hasNamedSections = sections.some(s => s.name);
      openModal('Edit Task', `
        <div class="form-group">
          <label>Title</label>
          <input type="text" id="mTitle" value="${escapeAttr(task.title)}">
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:1">
            <label>ID</label>
            <div style="display:flex;gap:6px;align-items:center">
              <button type="button" id="mSlugCopy" title="Copy ID" class="slug-copy-btn">
                <i data-lucide="copy"></i>
              </button>
              <input type="text" id="mSlug" value="${escapeAttr(task.slug || '')}" style="flex:1;font-family:var(--mono);font-size:13px" placeholder="e.g. fix-auth-bug">
            </div>
          </div>
          <div class="form-group" style="width:140px">
            <label>Status</label>
            <div class="status-select-wrap">
              <span class="status-select-icon" id="mStatusIcon">${statusIcon(task.status)}</span>
              <select id="mStatus">
                ${STATUS_ORDER.map(st => `<option value="${st}" ${st === task.status ? 'selected' : ''}>${STATUS_LABELS[st]}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
        ${hasNamedSections ? `
        <div class="form-group">
          <label>Section</label>
          <select id="mSection">
            ${sections.filter(s => s.name).map(s => `<option value="${s.id}" ${s.id === section.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
        ` : ''}
        <div class="form-group">
          <label>Description</label>
          <textarea id="mDesc" rows="8">${escapeHtml(task.desc)}</textarea>
        </div>
        <div class="form-group">
          <label>Acceptance Criteria</label>
          <textarea id="mAc" rows="6">${escapeHtml(task.ac)}</textarea>
        </div>
        <div class="form-group">
          <label>Completion Memo</label>
          <textarea id="mCm" rows="4">${escapeHtml(task.cm)}</textarea>
        </div>
      `, () => {
        const title = $('mTitle').value.trim();
        if (!title) return;
        const selStatus = $('mStatus');
        task.title = title;
        task.slug = $('mSlug').value.trim().replace(/^#/, '');
        task.status = selStatus ? selStatus.value : task.status;
        task.desc = $('mDesc').value.trim();
        task.ac = ($('mAc').value || '').replace(/\r\n?/g, '\n').trim();
        task.cm = ($('mCm').value || '').replace(/\r\n?/g, '\n').trim();

        // Handle section move
        if (hasNamedSections && $('mSection')) {
          const newSectionId = $('mSection').value;
          if (newSectionId !== section.id) {
            const idx = section.tasks.findIndex(t => t.id === task.id);
            if (idx !== -1) section.tasks.splice(idx, 1);
            const newSection = sections.find(s => s.id === newSectionId);
            if (newSection) newSection.tasks.push(task);
          }
        }

        markChanged();
        render();
      });
      $('mStatus').addEventListener('change', () => { $('mStatusIcon').innerHTML = statusIcon($('mStatus').value); });
      lucide.createIcons();
      $('mSlugCopy').addEventListener('click', () => {
        const val = $('mSlug').value.trim().replace(/^#/, '');
        navigator.clipboard.writeText(val);
        const btn = $('mSlugCopy');
        btn.style.color = 'var(--status-done)';
        btn.style.borderColor = 'var(--status-done)';
        setTimeout(() => { btn.style.color = ''; btn.style.borderColor = ''; }, 1000);
      });
      setTimeout(() => $('mTitle').focus(), 50);
    }

    function editSectionModal(section) {
      openModal('Edit Section', `
        <div class="form-group">
          <label>Section Name</label>
          <input type="text" id="mSectionName" value="${escapeAttr(section.name)}">
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="mSectionDesc" rows="4">${escapeHtml(section.description)}</textarea>
        </div>
      `, () => {
        const name = $('mSectionName').value.trim();
        if (name) { section.name = name; section.id = makeId(name); }
        section.description = $('mSectionDesc').value.trim();
        markChanged();
        render();
      });
      setTimeout(() => $('mSectionName').focus(), 50);
    }

    // ===== GLOBAL ADD TASK =====
    $('fabAddTask').addEventListener('click', () => {
      if (!sections.length) return;
      openNewTaskModal(sections[0], 'canceled');
    });

    // ===== ADD SECTION =====
    $('addSectionBtn').addEventListener('click', () => {
      openModal('New Section', `
        <div class="form-group">
          <label>Section Name</label>
          <input type="text" id="mSectionName" placeholder="Section name">
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="mSectionDesc" placeholder="Optional description for this section" rows="3"></textarea>
        </div>
      `, () => {
        const name = $('mSectionName').value.trim();
        if (!name) return;
        sections.push({ id: makeId(name), name, description: $('mSectionDesc').value.trim(), tasks: [] });
        markChanged();
        render();
      });
      setTimeout(() => $('mSectionName').focus(), 50);
    });

    // ===== API I/O =====
    let saveTimeout = null;

    function markChanged() {
      if (lastCleanSnapshot) {
        undoStack.push(lastCleanSnapshot);
        if (undoStack.length > MAX_UNDO) undoStack.shift();
      }
      lastCleanSnapshot = takeSnapshot();

      hasChanges = true;
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(autoSave, 600);
    }

    async function autoSave() {
      if (!projectId || !hasChanges || isSaving) return;
      const md = toMarkdown();
      if (md === lastSavedMarkdown) {
        hasChanges = false;
        return;
      }
      isSaving = true;
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(projectId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: md })
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Server error (${res.status})`);
        }
        hasChanges = false;
        saveRetryCount = 0;
        lastSavedMarkdown = md;
        if (!serverConnected) hideErrorBanner();
        showStatus('Saved');
      } catch (e) {
        const isNetworkError = e.message === 'Failed to fetch' || e.name === 'TypeError';
        if (isNetworkError) {
          showErrorBanner('Server disconnected — unsaved changes will be retried');
        }
        saveRetryCount++;
        if (saveRetryCount <= MAX_SAVE_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, saveRetryCount - 1), 8000);
          showStatus(`Save failed, retrying in ${delay / 1000}s...`, true);
          setTimeout(() => { isSaving = false; autoSave(); }, delay);
          return;
        }
        showStatus('Save failed: ' + e.message, true);
        saveRetryCount = 0;
      }
      isSaving = false;
    }

    // ===== USAGE CARD =====
    let usageData = null;

    async function fetchUsage() {
      try {
        const res = await fetch('/api/usage');
        if (!res.ok) return;
        usageData = await res.json();
        renderUsage();
      } catch {}
    }

    function renderUsage() {
      if (!usageData || usageData.error) {
        $('usageCard').style.display = 'none';
        return;
      }
      $('usageCard').style.display = '';
      const items = [];
      if (usageData.five_hour) {
        items.push(renderUsageBar('5h Window', usageData.five_hour));
      }
      if (usageData.seven_day) {
        items.push(renderUsageBar('7d Total', usageData.seven_day));
      }
      if (usageData.seven_day_sonnet?.utilization != null) {
        items.push(renderUsageBar('7d Sonnet', usageData.seven_day_sonnet));
      }
      if (usageData.seven_day_opus?.utilization != null) {
        items.push(renderUsageBar('7d Opus', usageData.seven_day_opus));
      }
      $('usageContent').innerHTML = items.join('');
    }

    function renderUsageBar(label, data) {
      const pct = data.utilization;
      const color = pct >= 80 ? 'var(--status-todo)' : pct >= 50 ? 'var(--accent)' : 'var(--status-done)';
      const resetStr = data.resets_at
        ? new Date(data.resets_at).toLocaleString('en', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
        : '';
      return `
        <div class="usage-row">
          <div class="usage-row-header">
            <span class="usage-label">${escapeHtml(label)}</span>
            <span class="usage-pct" style="color:${color}">${pct}%</span>
          </div>
          <div class="usage-bar">
            <div class="usage-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          ${resetStr ? `<div class="usage-reset">Resets ${escapeHtml(resetStr)}</div>` : ''}
        </div>
      `;
    }

    async function fetchProjects() {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      allProjects = await res.json();
    }

    async function loadProject({ silent = false, skipRender = false } = {}) {
      if (!projectId) return;
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(projectId)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Server returned ${res.status}`);
        }
        const data = await res.json();
        lastSavedMarkdown = data.content || '';

        let parsed;
        try {
          parsed = parseTasksMd(data.content || '');
        } catch (parseErr) {
          throw new Error('TASKS.md has invalid format: ' + parseErr.message);
        }

        const oldSlugs = silent ? new Set(sections.flatMap(s => s.tasks).map(t => t.slug).filter(Boolean)) : null;
        sections = parsed;

        // Update allProjects entry with accurate stats from parsed sections
        const allParsed = sections.flatMap(p => p.tasks);
        const parsedCounts = countByStatus(allParsed);
        const activeEntry = allProjects.find(p => p.id === projectId);
        if (activeEntry) {
          activeEntry.stats = {
            todo: parsedCounts.todo,
            ongoing: parsedCounts.ongoing,
            done: parsedCounts.done,
            backlog: parsedCounts.canceled,
            total: allParsed.length,
          };
        }

        const projectName = window.__projectName || (allProjects.find(p => p.id === projectId) || {}).name;
        if (projectName) document.title = `${projectName} — Octask`;

        $('emptyState').style.display = 'none';
        $('sidebar').style.display = 'flex';
        $('boardWrapper').style.display = 'flex';

        lastCleanSnapshot = takeSnapshot();
        undoStack.length = 0;
        if (!skipRender) {
          if (silent) {
            // Find tasks added since last load (by slug)
            const addedIds = new Set();
            for (const s of sections) {
              for (const t of s.tasks) {
                if (t.slug && !oldSlugs.has(t.slug)) addedIds.add(String(t.id));
              }
            }
            animatedRender();
            if (addedIds.size) {
              document.querySelectorAll('.task-card').forEach(c => {
                if (addedIds.has(c.dataset.taskId)) {
                  c.classList.add('card-enter');
                  c.addEventListener('animationend', () => c.classList.remove('card-enter'), { once: true });
                }
              });
            }
          } else {
            render();
          }
          if (!silent) showStatus('Loaded');
        }
        fetchUsage();
      } catch (e) {
        const isNetworkError = e.message === 'Failed to fetch' || e.name === 'TypeError';
        if (isNetworkError) return showOfflineState();
        $('emptyState').querySelector('h2').textContent = 'Error';
        $('emptyState').querySelector('p').textContent = e.message;
      }
    }

    async function fetchSessions() {
      if (!projectId) return;
      try {
        const resp = await fetch(`/api/sessions/${encodeURIComponent(projectId)}`);
        if (resp.ok) {
          const nextSessionMap = await resp.json();
          const isChanged = !isDeepEqual(lastSessionSnapshot, nextSessionMap);
          if (isChanged) {
            sessionMap = nextSessionMap;
            lastSessionSnapshot = JSON.parse(JSON.stringify(nextSessionMap));
            render();
          }
          if (!serverConnected) hideErrorBanner();
        }
      } catch {
        if (serverConnected && hasChanges) {
          showErrorBanner('Server disconnected — unsaved changes will be retried when reconnected');
        }
      }
    }

    // ===== FILE WATCH (SSE) =====
    let fileWatchSource = null;
    let selfSaveSuppress = 0; // timestamp until which to ignore change events

    function connectFileWatch() {
      if (!projectId || fileWatchSource) return;
      fileWatchSource = new EventSource(`/api/watch/${encodeURIComponent(projectId)}`);
      fileWatchSource.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (!data.changed) return;
          if (Date.now() < selfSaveSuppress) return; // ignore self-triggered save
          if (hasChanges) {
            $('fileChangedBanner').classList.add('visible');
          } else {
            loadProject({ silent: true });
          }
        } catch {}
      };
      fileWatchSource.onerror = () => {
        // EventSource auto-reconnects; just clean up state
        fileWatchSource.close();
        fileWatchSource = null;
        setTimeout(connectFileWatch, 3000);
      };
    }

    $('fileChangedReload').addEventListener('click', () => {
      $('fileChangedBanner').classList.remove('visible');
      hasChanges = false;
      loadProject();
    });

    async function switchProject(newProjectId) {
      if (newProjectId === projectId) return;

      // Capture old project-item positions for FLIP animation
      const oldProjRects = new Map();
      document.querySelectorAll('.project-item').forEach((el, i) => {
        oldProjRects.set(i, el.getBoundingClientRect());
      });

      // Disconnect old SSE watcher
      if (fileWatchSource) { fileWatchSource.close(); fileWatchSource = null; }

      // Reset state (keep sessionMap — old data won't hurt, avoids flash)
      projectId = newProjectId;
      sections = [];
      preamble = '';
      hasChanges = false;
      isSaving = false;
      activeSectionId = null;
      undoStack.length = 0;
      lastCleanSnapshot = null;

      // Update URL
      history.pushState({}, '', '/project/' + encodeURIComponent(newProjectId));

      // Wait for BOTH tasks and sessions before rendering — no flash
      await Promise.all([
        loadProject({ skipRender: true }),
        fetchSessions(),
      ]);
      render();

      // FLIP animate project items in sidebar
      const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';
      document.querySelectorAll('.project-item').forEach((el, i) => {
        const old = oldProjRects.get(i);
        if (old) flipAnimate(el, old, ease);
      });

      // Animate the newly expanded project panel
      const expanded = document.querySelector('.project-expanded');
      if (expanded) {
        expanded.classList.add('animate-expand');
        expanded.addEventListener('animationend', () => expanded.classList.remove('animate-expand'), { once: true });
      }

      connectFileWatch();
    }

    // Patch autoSave to suppress self-triggered watch events
    const _origAutoSave = autoSave;
    autoSave = async function() {
      selfSaveSuppress = Date.now() + 2000; // suppress before PUT to cover SSE race
      await _origAutoSave();
      selfSaveSuppress = Date.now() + 500; // refresh window after completion
    };

    fetchProjects().then(() => {
      if (!projectId) {
        if (allProjects.length > 0) {
          projectId = allProjects[0].id;
          history.replaceState({}, '', '/project/' + encodeURIComponent(projectId));
        } else {
          $('emptyState').querySelector('h2').textContent = 'No projects found';
          $('emptyState').querySelector('p').textContent = 'No projects with TASKS.md were found in ~/.claude/projects.';
          return;
        }
      }

      loadProject().then(() => {
        fetchSessions().then(() => {
          lastSessionSnapshot = JSON.parse(JSON.stringify(sessionMap));
          render();
        });
        setInterval(fetchSessions, 5000);
        setInterval(fetchUsage, 120000);
        connectFileWatch();
      });
    }).catch(() => {
      showOfflineState();
    });

    window.addEventListener('popstate', () => {
      const match = location.pathname.match(/^\/project\/(.+)/);
      if (match) {
        const newId = decodeURIComponent(match[1]);
        if (newId !== projectId) switchProject(newId);
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (fileWatchSource) fileWatchSource.close();
      if (hasChanges) { e.preventDefault(); e.returnValue = ''; }
    });

    function isTextInput(target) {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'TEXTAREA') return true;
      if (tag === 'INPUT') {
        const type = (target.getAttribute('type') || 'text').toLowerCase();
        return ['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date', 'datetime-local', 'month', 'week', 'time', 'datetime', 'color'].includes(type);
      }
      if (target.isContentEditable) return true;
      return false;
    }

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); autoSave(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && !isTextInput(e.target)) { e.preventDefault(); undo(); }
    });
