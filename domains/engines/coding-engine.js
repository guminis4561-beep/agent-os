// ═══════════════════════════════════════════════════
// DOMAIN: Coding Engine — tikras IDE
// ═══════════════════════════════════════════════════
//
// Trys paneliai:
//   Kairė  — File Tree (iš /api/workspace/files)
//   Centras — Code Viewer (turinys iš /api/workspace/file)
//   Dešinė — Task Terminal (SSE task:log srautas)
//
// "▶ Run" → intent modal → POST /api/task { domainEngine:'coding', workspaceId }

import EventBus from '../../core/events.js';
import * as Api from '../../core/api-client.js';
import { showToast } from '../../components/toast.js';
import Storage from '../../core/storage.js';
import AppState from '../../core/state.js';
import { modelSelectHtml, mountModelPicker, getSelectedModel } from './model-picker.js';

// ─── Module state ─────────────────────────────────
let _wsRoot    = Storage.get('codingWsRoot') || '';
let _files     = [];       // flat string[] from server
let _activeFile = Storage.get('codingActiveFile') || null;    // relative path
let _content   = Storage.get('codingContent') || '';       // file content string
let _loading   = false;    // file tree loading
let _fileLoading = false;  // single file loading
let _taskLogs  = Storage.get('codingTaskLogs') || [];       // { time, type, message }[]
let _taskState = Storage.get('codingTaskState') || null;     // last FSM state
let _taskId    = Storage.get('codingTaskId') || null;
let _sseUnsub  = null;     // SSE unsubscribe fn
let _dirty     = false;    // editor modified (future: save)
let _expandedDirs = new Set(); // Stores expanded directory paths
let _monacoEditor = null;
let _monacoLoading = false;

function _saveState() {
  Storage.set('codingActiveFile', _activeFile);
  Storage.set('codingContent', _content);
  Storage.set('codingTaskLogs', _taskLogs);
  Storage.set('codingTaskState', _taskState);
  Storage.set('codingTaskId', _taskId);
}

// ─── Render ───────────────────────────────────────

export function renderCodingEngine() {
  return `
    <div class="engine-view" style="height:100%;display:flex;flex-direction:column;">

      <!-- Header toolbar -->
      <div class="engine-view__header" style="flex-shrink:0;display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;">
        <div class="engine-view__title">
          <div class="engine-view__title-icon" style="background:var(--coding-bg);color:var(--coding-accent);">⟨/⟩</div>
          <span>Coding Engine</span>
        </div>

        <!-- Workspace path input -->
        <div style="display:flex;align-items:center;gap:var(--space-2);flex:1;min-width:200px;max-width:480px;">
          <span style="font-size:var(--text-xs);color:var(--text-muted);white-space:nowrap;">📁 Workspace:</span>
          <input id="coding-ws-input" type="text"
            value="${_escAttr(_wsRoot)}"
            placeholder="C:\\mano\\projektas arba /home/user/projektas"
            style="flex:1;padding:var(--space-1) var(--space-2);background:var(--bg-body);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-size:var(--text-xs);font-family:var(--font-mono);">
          <button class="btn btn--secondary btn--sm" id="coding-ws-load" style="white-space:nowrap;">Atidaryti</button>
        </div>

        <div class="engine-view__toolbar" style="margin-left:auto;">
          <span class="badge badge--coding" id="coding-agent-badge">CodeWeaver</span>
          <button class="btn btn--primary btn--sm" id="coding-run" ${!_wsRoot ? 'disabled title="Pirmiausia pasirinkite workspace"' : ''}>▶ Vykdyti</button>
          <button class="btn btn--ghost btn--sm" id="coding-save" ${!_activeFile ? 'disabled' : ''}>💾 Išsaugoti</button>
        </div>
      </div>

      <!-- 3-column IDE layout -->
      <div class="code-editor" id="coding-editor-grid" style="flex:1;min-height:0;display:grid;grid-template-columns:var(--coding-left-w, 220px) 4px 1fr 4px var(--coding-right-w, 300px);grid-template-rows:1fr;overflow:hidden;">

        <!-- FILE TREE -->
        <div class="code-editor__files" style="overflow-y:auto;display:flex;flex-direction:column;">
          <div style="padding:var(--space-2) var(--space-3);font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;border-bottom:1px solid var(--border-default);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <span>Explorer</span>
            <div style="display:flex;gap:var(--space-2);align-items:center;">
              ${_wsRoot ? `<button id="coding-new-file-btn" class="btn btn--ghost btn--sm" style="padding:2px 4px;font-size:10px;" title="Naujas failas">➕</button>` : ''}
              ${_wsRoot ? `<span style="font-size:9px;opacity:.6;">${_files.length} failų</span>` : ''}
            </div>
          </div>
          <div id="coding-file-tree" style="padding:var(--space-1) 0;flex:1;overflow-y:auto;">
            ${_renderFileTree()}
          </div>
        </div>

        <!-- SPLITTER 1 -->
        <div id="coding-resizer-1" class="engine-resizer" style="cursor:col-resize;background:transparent;border-right:1px solid var(--border-default);z-index:10;transition:background 0.2s;" onmouseover="this.style.background='var(--coding-accent)'" onmouseout="this.style.background='transparent'"></div>

        <!-- CODE AREA -->
        <div class="code-editor__main" style="display:flex;flex-direction:column;overflow:hidden;">

          <!-- Tab bar -->
          <div style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-default);display:flex;align-items:center;gap:var(--space-2);flex-shrink:0;background:var(--bg-body);">
            ${_activeFile
              ? `<span style="padding:2px var(--space-3);background:var(--coding-bg);color:var(--coding-accent);border-radius:var(--radius-sm);font-size:11px;font-weight:600;">${_activeFile.split('/').pop()}</span>
                 <span style="font-size:10px;color:var(--text-muted);margin-left:4px;">${_activeFile}</span>
                 <span style="margin-left:auto;font-size:10px;color:var(--text-muted);">${_langLabel(_activeFile)}</span>`
              : `<span style="font-size:var(--text-xs);color:var(--text-muted);">${_wsRoot ? 'Pasirinkite failą iš medžio' : 'Pasirinkite workspace'}</span>`
            }
          </div>

          <!-- Code content -->
          <div id="coding-code-area" style="flex:1;overflow:hidden;display:flex;flex-direction:column;padding:0;background:var(--bg-card);">
            ${_renderCodeArea()}
          </div>
        </div>

        <!-- SPLITTER 2 -->
        <div id="coding-resizer-2" class="engine-resizer" style="cursor:col-resize;background:transparent;border-left:1px solid var(--border-default);z-index:10;transition:background 0.2s;" onmouseover="this.style.background='var(--coding-accent)'" onmouseout="this.style.background='transparent'"></div>

        <!-- TASK TERMINAL -->
        <div style="display:flex;flex-direction:column;overflow:hidden;background:var(--bg-body);">
          <div style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-default);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
            <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;">Task Terminal</span>
            <div style="display:flex;align-items:center;gap:var(--space-2);">
              ${_taskState ? `<span class="badge badge--${_taskStateBadge(_taskState)}" style="font-size:9px;">${_taskState}</span>` : ''}
              ${_taskLogs.length ? `<button class="btn btn--ghost btn--sm" id="coding-clear-log" style="font-size:9px;padding:2px 6px;">✕ Išvalyti</button>` : ''}
            </div>
          </div>
          <div id="coding-terminal" style="flex:1;overflow-y:auto;padding:var(--space-2) var(--space-3);font-family:var(--font-mono);font-size:11px;line-height:1.6;">
            ${_renderTerminal()}
          </div>
          <!-- Task intent input (compact) -->
          <div style="padding:var(--space-2) var(--space-3);border-top:1px solid var(--border-default);display:flex;gap:var(--space-2);align-items:center;">
            <input id="coding-intent-input" type="text"
              placeholder="Pvz: Sukurk REST endpoint POST /users..."
              style="flex:1;padding:var(--space-1) var(--space-2);background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-size:11px;"
              ${!_wsRoot ? 'disabled' : ''}>
            ${modelSelectHtml('coding-model-select')}
            <button class="btn btn--primary btn--sm" id="coding-run-bottom" ${!_wsRoot ? 'disabled' : ''}>▶</button>
          </div>
        </div>

      </div>
    </div>
  `;
}

// ─── File tree renderer ───────────────────────────

function _renderFileTree() {
  if (_loading) {
    return `<div style="padding:var(--space-4);color:var(--text-muted);font-size:var(--text-xs);">Kraunama…</div>`;
  }
  if (!_wsRoot) {
    return `
      <div style="padding:var(--space-4);text-align:center;">
        <div style="font-size:1.5rem;margin-bottom:var(--space-2);opacity:.3;">📁</div>
        <div style="font-size:11px;color:var(--text-muted);line-height:1.5;">Įveskite<br>workspace kelią<br>ir spauskite „Atidaryti"</div>
      </div>`;
  }
  if (!_files.length) {
    return `<div style="padding:var(--space-4);color:var(--text-muted);font-size:11px;">Failų nerasta</div>`;
  }
  return _buildTreeHtml(_buildTreeNode(_files));
}

function _buildTreeNode(paths) {
  const root = {};
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node[part]) node[part] = i === parts.length - 1 ? null : {};
      if (i < parts.length - 1) node = node[part];
    }
  }
  return root;
}

function _buildTreeHtml(node, prefix = '', depth = 0) {
  const indent = depth * 14;
  const entries = Object.entries(node).sort(([a, av], [b, bv]) => {
    // folders first
    const aIsDir = av !== null, bIsDir = bv !== null;
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.localeCompare(b);
  });

  return entries.map(([name, children]) => {
    const fullPath = prefix ? `${prefix}/${name}` : name;
    const isDir = children !== null;

    if (isDir) {
      const isExpanded = _expandedDirs.has(fullPath);
      return `
        <div>
          <div class="code-editor__file" data-dir="${_escAttr(fullPath)}" style="padding-left:${indent + 8}px;color:var(--coding-accent);cursor:pointer;font-size:11px;user-select:none;">
            <span style="margin-right:4px;font-size:9px;display:inline-block;transition:transform 0.2s;transform:${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'}">▶</span>${name}
          </div>
          ${isExpanded ? _buildTreeHtml(children, fullPath, depth + 1) : ''}
        </div>`;
    }

    const isActive = fullPath === _activeFile;
    const ext = name.split('.').pop();
    const icon = _fileIcon(ext);
    return `
      <div class="code-editor__file ${isActive ? 'active' : ''}"
           data-file="${_escAttr(fullPath)}"
           style="padding-left:${indent + 20}px;cursor:pointer;font-size:11px;${isActive ? 'background:var(--coding-bg);color:var(--coding-accent);' : ''}">
        <span style="margin-right:4px;opacity:.7;">${icon}</span>${name}
      </div>`;
  }).join('');
}

// ─── Code area renderer ───────────────────────────

function _renderCodeArea() {
  if (_fileLoading) {
    return `<div style="padding:var(--space-4);color:var(--text-muted);font-size:var(--text-xs);">Kraunama…</div>`;
  }
  if (!_activeFile) {
    return `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:var(--space-3);opacity:.4;">
        <div style="font-size:3rem;">⟨/⟩</div>
        <div style="font-size:var(--text-sm);color:var(--text-muted);">Pasirinkite failą</div>
      </div>`;
  }

  return `
    <div id="coding-editor-container" style="flex:1;width:100%;height:100%;"></div>
  `;
}

// ─── Terminal renderer ────────────────────────────

function _renderTerminal() {
  if (!_taskLogs.length) {
    return `
      <div style="color:var(--text-muted);font-size:11px;line-height:1.6;">
        <div style="opacity:.5;">$ Laukiama užduoties…</div>
        <div style="opacity:.3;margin-top:var(--space-2);">Įveskite intent'ą apačioje ir spauskite ▶</div>
      </div>`;
  }

  return _taskLogs.map(e => {
    const color = e.type === 'done'   ? 'var(--success)'
                : e.type === 'error'  ? 'var(--error)'
                : e.type === 'warn'   ? 'var(--warning)'
                : e.type === 'state'  ? 'var(--accent-primary)'
                : 'var(--text-secondary)';
    return `<div style="color:${color};margin-bottom:1px;">
      <span style="opacity:.5;">[${e.time}]</span> ${_escHtml(e.message)}
    </div>`;
  }).join('');
}

// ─── Events ───────────────────────────────────────

export function initCodingEvents() {
  // Workspace load
  const wsInput = document.getElementById('coding-ws-input');
  document.getElementById('coding-ws-load')?.addEventListener('click', () => {
    const root = wsInput?.value.trim();
    if (!root) { showToast('Įveskite workspace kelią', 'error'); return; }
    _loadWorkspace(root);
  });
  wsInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('coding-ws-load')?.click();
  });

  // Attach file tree events
  _attachTreeEvents();

  // Grid Resizers
  let isResizing = 0;
  document.getElementById('coding-resizer-1')?.addEventListener('mousedown', () => isResizing = 1);
  document.getElementById('coding-resizer-2')?.addEventListener('mousedown', () => isResizing = 2);
  document.addEventListener('mousemove', e => {
    if (!isResizing) return;
    const grid = document.getElementById('coding-editor-grid');
    if (!grid) return;
    if (isResizing === 1) {
      const newW = Math.max(100, Math.min(e.clientX, 600));
      grid.style.setProperty('--coding-left-w', `${newW}px`);
    } else if (isResizing === 2) {
      const rect = grid.getBoundingClientRect();
      const newW = Math.max(150, Math.min(rect.right - e.clientX, 800));
      grid.style.setProperty('--coding-right-w', `${newW}px`);
    }
  });
  document.addEventListener('mouseup', () => { isResizing = 0; });

  // Run buttons
  const runHandler = () => {
    const intent = document.getElementById('coding-intent-input')?.value.trim();
    if (!intent) {
      showToast('Įveskite užduoties aprašymą', 'error');
      document.getElementById('coding-intent-input')?.focus();
      return;
    }
    _runTask(intent);
  };
  document.getElementById('coding-run')?.addEventListener('click', runHandler);
  document.getElementById('coding-run-bottom')?.addEventListener('click', runHandler);
  document.getElementById('coding-intent-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') runHandler();
  });

  // Save
  document.getElementById('coding-save')?.addEventListener('click', () => _saveFile());

  // Clear log
  document.getElementById('coding-clear-log')?.addEventListener('click', () => {
    _taskLogs = [];
    _taskState = null;
    _saveState();
    const term = document.getElementById('coding-terminal');
    if (term) term.innerHTML = _renderTerminal();
    const badge = document.querySelector('#coding-agent-badge')?.closest('[style]');
    // re-render header badge area
    EventBus.emit('navigate', 'coding');
  });

  // Populate the per-task model dropdown
  mountModelPicker('coding-model-select');

  // Start SSE listener for this view
  _startSse();

  if (_wsRoot && !_files.length) {
    _reloadTreeSilent();
  }
}

async function _reloadTreeSilent() {
  if (!_wsRoot) return;
  try {
    const res = await Api.getWorkspaceFiles(_wsRoot);
    _files = res.files || [];
    _renderTreePatch();
  } catch (e) {}
}

// ─── Async operations ─────────────────────────────

async function _loadWorkspace(root) {
  _loading = true;
  _files = [];
  _activeFile = null;
  _content = '';
  _saveState();
  _renderTreePatch();

  try {
    const res = await Api.getWorkspaceFiles(root);
    _wsRoot = root;
    Storage.set('codingWsRoot', root);
    _files = res.files || [];
    _loading = false;
    showToast(`Atidarytas workspace: ${_files.length} failų`, 'success');
  } catch (err) {
    _loading = false;
    _wsRoot = '';
    Storage.set('codingWsRoot', '');
    showToast(`Nepavyko atidaryti: ${err.message}`, 'error');
  }

  // Full re-render to update disabled states on buttons
  EventBus.emit('navigate', 'coding');
}

async function _loadFile(relPath) {
  if (!_wsRoot) return;
  _activeFile = relPath;
  _fileLoading = true;
  _dirty = false;
  _saveState();
  _patchCodeArea();
  _highlightActiveFile(relPath);

  try {
    const res = await Api.getWorkspaceFile(_wsRoot, relPath);
    _content = res.content || '';
    _fileLoading = false;
    _saveState();
    _patchCodeArea();
  } catch (err) {
    _fileLoading = false;
    _content = `// Nepavyko nuskaityti: ${err.message}`;
    _patchCodeArea();
  }
}

async function _saveFile() {
  if (!_wsRoot || !_activeFile) return;
  try {
    await Api.writeWorkspaceFile(_wsRoot, _activeFile, _content);
    showToast(`Išsaugota: ${_activeFile}`, 'success');
    _dirty = false;
  } catch (err) {
    showToast(`Klaida išsaugant: ${err.message}`, 'error');
  }
}

async function _runTask(intent) {
  if (!_wsRoot) { showToast('Pasirinkite workspace', 'error'); return; }

  _taskLogs = [];
  _taskState = 'STARTING';
  _taskId = null;
  _saveState();
  _appendLog('state', `Paleidžiama užduotis: ${intent}`);
  _patchTerminal();

  try {
    const res = await Api.startTask({
      intent,
      domainEngine: 'coding',
      workspaceId: _wsRoot,
      modelId: getSelectedModel() || undefined,
    });
    _taskId = res.taskId;
    _saveState();
    _appendLog('info', `Task ID: ${_taskId}`);
    _patchTerminal();
    showToast('Užduotis paleista', 'success');
  } catch (err) {
    _appendLog('error', `Nepavyko paleisti: ${err.message}`);
    _taskState = 'FAILED';
    _patchTerminal();
    showToast(`Klaida: ${err.message}`, 'error');
  }
}

// ─── SSE listener ─────────────────────────────────

function _startSse() {
  // Unsubscribe previous if still alive
  if (_sseUnsub) return; // already listening

  _sseUnsub = Api.subscribeEvents((name, data) => {
    // Only react to our active task OR to any task if no taskId yet
    if (data.taskId && _taskId && data.taskId !== _taskId) return;

    if (name === 'task:log') {
      const msg = data.message || data.preview || '';
      const type = data.status === 'error' ? 'error'
                 : data.status === 'warn'  ? 'warn'
                 : data.status === 'done'  ? 'done'
                 : 'info';
      if (msg) {
        _appendLog(type, `[${data.phase || ''}] ${msg}`);
        _patchTerminal();
      }
    } else if (name === 'task:stateChange') {
      _taskState = data.to || data.context?.state;
      _appendLog('state', `→ ${_taskState}`);
      _patchTerminal();
    } else if (name === 'task:done') {
      _taskState = data.state;
      _appendLog('done', `Baigta: ${_taskState}`);
      _patchTerminal();
      // Reload file tree tik jei coding domain
      if (_wsRoot && data.domainEngine === 'coding') {
        setTimeout(() => _reloadFiles(), 1500);
      }
    } else if (name === 'task:error') {
      _appendLog('error', data.message || 'Klaida');
      _taskState = 'FAILED';
      _patchTerminal();
    }
  });
}

function _stopSse() {
  if (_sseUnsub) { _sseUnsub(); _sseUnsub = null; }
}

async function _reloadFiles() {
  if (!_wsRoot) return;
  try {
    const res = await Api.getWorkspaceFiles(_wsRoot);
    _files = res.files || [];
    _renderTreePatch();
    // Reload active file if it still exists
    if (_activeFile && _files.includes(_activeFile)) {
      await _loadFile(_activeFile);
    }
  } catch { /* ignore */ }
}

// ─── Surgical DOM patches ─────────────────────────

function _appendLog(type, message) {
  const now = new Date().toLocaleTimeString('lt-LT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  _taskLogs.push({ time: now, type, message });
  // Keep last 200
  if (_taskLogs.length > 200) _taskLogs = _taskLogs.slice(-200);
  _saveState();
}

function _patchTerminal() {
  const el = document.getElementById('coding-terminal');
  if (!el) return;
  el.innerHTML = _renderTerminal();
  el.scrollTop = el.scrollHeight;
}

function _patchCodeArea() {
  const el = document.getElementById('coding-code-area');
  if (!el) return;

  // If loading, we destroy old monaco
  if (_fileLoading) {
    if (_monacoEditor) {
      _monacoEditor.dispose();
      _monacoEditor = null;
    }
    el.innerHTML = _renderCodeArea();
    return;
  }

  if (_activeFile && _monacoEditor && document.getElementById('coding-editor-container')) {
    // Fast path: update existing monaco
    const model = _monacoEditor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, _getMonacoLang(_activeFile));
      if (_monacoEditor.getValue() !== _content) {
        _monacoEditor.setValue(_content);
      }
    }
    return;
  }

  // Full re-render
  el.innerHTML = _renderCodeArea();
  if (_activeFile && window.require) {
    if (_monacoEditor) { _monacoEditor.dispose(); _monacoEditor = null; }
    _initMonaco('coding-editor-container');
  }
}

function _initMonaco(containerId) {
  if (_monacoEditor || _monacoLoading) return;
  _monacoLoading = true;

  window.require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }});
  window.MonacoEnvironment = {
    getWorkerUrl: function(workerId, label) {
      return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
        self.MonacoEnvironment = {
          baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/'
        };
        importScripts('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/base/worker/workerMain.js');
      `)}`;
    }
  };

  window.require(['vs/editor/editor.main'], function() {
    _monacoLoading = false;
    const el = document.getElementById(containerId);
    if (!el) return;

    monaco.editor.defineTheme('hugo-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#15151e'
      }
    });

    _monacoEditor = monaco.editor.create(el, {
      value: _content,
      language: _getMonacoLang(_activeFile),
      theme: 'hugo-dark',
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 12,
      fontFamily: 'Consolas, "Courier New", monospace',
      scrollBeyondLastLine: false
    });

    _monacoEditor.onDidChangeModelContent(() => {
      _content = _monacoEditor.getValue();
      _dirty = true;
      _saveState();
    });

    _monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      _saveFile();
    });
  });
}

function _getMonacoLang(path) {
  if (!path) return 'plaintext';
  const ext = path.split('.').pop().toLowerCase();
  const map = {
    js:'javascript', ts:'typescript', tsx:'typescript', jsx:'javascript', json:'json',
    py:'python', go:'go', rs:'rust', md:'markdown', css:'css', html:'html',
    sh:'shell', sql:'sql', yaml:'yaml', yml:'yaml'
  };
  return map[ext] || 'plaintext';
}

function _renderTreePatch() {
  const el = document.getElementById('coding-file-tree');
  if (el) el.innerHTML = _renderFileTree();
  _attachTreeEvents();
}

function _attachTreeEvents() {
  document.querySelectorAll('.code-editor__file[data-file]').forEach(f => {
    f.addEventListener('click', () => _loadFile(f.dataset.file));
  });
  document.querySelectorAll('.code-editor__file[data-dir]').forEach(f => {
    f.addEventListener('click', () => {
      const dir = f.dataset.dir;
      if (_expandedDirs.has(dir)) _expandedDirs.delete(dir);
      else _expandedDirs.add(dir);
      _renderTreePatch();
    });
  });

  const newFileBtn = document.getElementById('coding-new-file-btn');
  if (newFileBtn) {
    if (!newFileBtn.dataset.bound) {
      newFileBtn.dataset.bound = '1';
      newFileBtn.addEventListener('click', async () => {
        const name = prompt("Įveskite naujo failo pavadinimą (pvz. 'src/app.js'):");
        if (!name || !_wsRoot) return;
        try {
          await Api.writeWorkspaceFile(_wsRoot, name, '');
          showToast(`Sukurtas failas: ${name}`, 'success');
          await _reloadFiles();
          await _loadFile(name);
        } catch(e) {
          showToast(`Nepavyko sukurti: ${e.message}`, 'error');
        }
      });
    }
  }
}

function _highlightActiveFile(path) {
  document.querySelectorAll('.code-editor__file.active').forEach(el => {
    el.classList.remove('active');
    el.style.background = '';
    el.style.color = '';
  });
  const target = document.querySelector(`.code-editor__file[data-file="${CSS.escape(path)}"]`);
  if (target) {
    target.classList.add('active');
    target.style.background = 'var(--coding-bg)';
    target.style.color = 'var(--coding-accent)';
  }
}

// ─── Helpers ─────────────────────────────────────

function _fileIcon(ext) {
  const map = {
    js:'🟨', ts:'🔷', tsx:'🔷', jsx:'🟨', json:'{ }',
    py:'🐍', go:'🐹', rs:'🦀', md:'📝', css:'🎨',
    html:'🌐', sh:'⚙', sql:'🗄', yaml:'📋', yml:'📋',
    env:'🔑',
  };
  return map[ext] || '◇';
}

function _langLabel(path) {
  const ext = (path || '').split('.').pop().toLowerCase();
  const map = { js:'JavaScript', ts:'TypeScript', tsx:'TSX', jsx:'JSX', py:'Python',
    go:'Go', rs:'Rust', json:'JSON', md:'Markdown', css:'CSS', html:'HTML',
    sh:'Shell', sql:'SQL', yaml:'YAML', yml:'YAML', env:'ENV' };
  return map[ext] || ext.toUpperCase() || 'Text';
}

function _taskStateBadge(state) {
  if (!state) return 'info';
  if (['COMPLETED'].includes(state)) return 'success';
  if (['FAILED','CANCELLED'].includes(state)) return 'error';
  if (['REVIEW_REQUIRED'].includes(state)) return 'warning';
  return 'info';
}

function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _escAttr(str) {
  return String(str || '').replace(/"/g, '&quot;');
}

// Stop SSE when navigating away
EventBus.on('navigate', (route) => {
  if (route !== 'coding') _stopSse();
});
