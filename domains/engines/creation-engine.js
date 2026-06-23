// ═══════════════════════════════════════════════════
// DOMAIN: Creation Engine — AI turinio generavimas
// ═══════════════════════════════════════════════════
//
// Templates → forma (tipas, tema, tonas) → Task FSM domainEngine:'creation'
// SSE terminale rodomas StoryTeller AI generavimo procesas
// Galerija — užbaigtos užduotys iš /api/tasks

import EventBus from '../../core/events.js';
import * as Api from '../../core/api-client.js';
import { showToast } from '../../components/toast.js';
import Storage from '../../core/storage.js';
import { modelSelectHtml, mountModelPicker, getSelectedModel } from './model-picker.js';

// ─── Templates ────────────────────────────────────
const TEMPLATES = [
  { id: 'blog',    icon: '📝', name: 'Blog įrašas',      prompt: 'Parašyk išsamų blog įrašą apie', tone: 'informatyvus' },
  { id: 'story',   icon: '📖', name: 'Trumpa istorija',  prompt: 'Sukurk kūrybišką trumpą istoriją apie', tone: 'kūrybiškas' },
  { id: 'copy',    icon: '📢', name: 'Marketing tekstas',prompt: 'Parašyk įtikinamą marketing tekstą apie', tone: 'įtikinamas' },
  { id: 'docs',    icon: '📄', name: 'Dokumentacija',    prompt: 'Parašyk techninę dokumentaciją', tone: 'techninis' },
  { id: 'social',  icon: '📱', name: 'Social media',     prompt: 'Sukurk paskyrų social media įrašus apie', tone: 'draugiškas' },
  { id: 'email',   icon: '✉️', name: 'Email kampanija',  prompt: 'Parašyk email kampaniją apie', tone: 'profesionalus' },
  { id: 'script',  icon: '🎬', name: 'Video scenarijus', prompt: 'Parašyk video scenarijų apie', tone: 'dinamiškas' },
  { id: 'poem',    icon: '🎭', name: 'Eilėraštis',       prompt: 'Sukurk eilėraštį apie', tone: 'poetiškas' },
];

let _customTemplates = Storage.get('creationCustomTemplates') || [];
function _allTemplates() { return [...TEMPLATES, ..._customTemplates]; }
let _activeTemplateId = Storage.get('creationActiveTemplateId') || TEMPLATES[0].id;
let _activeTemplate = _allTemplates().find(t => t.id === _activeTemplateId) || TEMPLATES[0];
let _taskLogs  = Storage.get('creationTaskLogs') || [];
let _taskState = Storage.get('creationTaskState') || null;
let _taskId    = Storage.get('creationTaskId') || null;
let _editedOutput = Storage.get('creationEditedOutput') || null;
let _sseUnsub  = null;
let _gallery   = [];   // completed creation tasks

function _saveState() {
  Storage.set('creationActiveTemplateId', _activeTemplate.id);
  Storage.set('creationTaskLogs', _taskLogs);
  Storage.set('creationTaskState', _taskState);
  Storage.set('creationTaskId', _taskId);
  Storage.set('creationEditedOutput', _editedOutput);
}

// ─── Render ───────────────────────────────────────

export function renderCreationEngine() {
  return `
    <div class="engine-view" style="height:100%;display:flex;flex-direction:column;">

      <!-- Header -->
      <div class="engine-view__header" style="flex-shrink:0;">
        <div class="engine-view__title">
          <div class="engine-view__title-icon" style="background:var(--creation-bg);color:var(--creation-accent);">✦</div>
          <span>Creation Engine</span>
        </div>
        <div class="engine-view__toolbar">
          <span class="badge badge--creation">StoryTeller</span>
        </div>
      </div>

      <!-- Main layout: forma (kairė) + terminalo (dešinė) -->
      <div style="flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;overflow:hidden;">

        <!-- KAIRĖ: Templates + forma + galerija -->
        <div style="overflow-y:auto;border-right:1px solid var(--border-default);padding:var(--space-4);display:flex;flex-direction:column;gap:var(--space-5);">

          <!-- Templates grid -->
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:var(--space-3);">Šablonai</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-2);">
              ${_allTemplates().map(t => `
                <div class="creation-template-card card card--interactive" data-tpl-id="${t.id}"
                  style="padding:var(--space-3);text-align:center;cursor:pointer;border:1px solid ${_activeTemplate.id===t.id?'var(--creation-accent)':'var(--border-default)'};background:${_activeTemplate.id===t.id?'rgba(234,128,252,.08)':'var(--bg-card)'};">
                  <div style="font-size:1.4rem;margin-bottom:var(--space-1);">${t.icon}</div>
                  <div style="font-size:10px;font-weight:600;color:${_activeTemplate.id===t.id?'var(--creation-accent)':'var(--text-primary)'};">${t.name}</div>
                </div>
              `).join('')}
              <div class="card card--interactive" id="creation-new-template" style="padding:var(--space-3);text-align:center;cursor:pointer;border:1px dashed var(--border-default);background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                <div style="font-size:1.4rem;margin-bottom:var(--space-1);opacity:.5;">+</div>
                <div style="font-size:10px;font-weight:600;color:var(--text-muted);">Naujas šablonas</div>
              </div>
            </div>
          </div>

          <!-- Generavimo forma -->
          <div class="card" style="padding:var(--space-4);">
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:var(--space-3);">
              ${_activeTemplate.icon} ${_activeTemplate.name}
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);margin-bottom:var(--space-3);">
              <div>
                <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Tonas</label>
                <select id="creation-tone" style="width:100%;padding:var(--space-2);background:var(--bg-body);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-size:var(--text-xs);">
                  ${['informatyvus','kūrybiškas','įtikinamas','techninis','draugiškas','profesionalus','dinamiškas','poetiškas','humoristiškas','rimtas'].map(t =>
                    `<option value="${t}" ${t===_activeTemplate.tone?'selected':''}>${t}</option>`
                  ).join('')}
                </select>
              </div>
              <div>
                <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Ilgumas</label>
                <select id="creation-length" style="width:100%;padding:var(--space-2);background:var(--bg-body);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-size:var(--text-xs);">
                  <option value="trumpas">Trumpas (~200 žodžių)</option>
                  <option value="vidutinis" selected>Vidutinis (~500 žodžių)</option>
                  <option value="ilgas">Ilgas (~1000 žodžių)</option>
                </select>
              </div>
            </div>

            <div style="margin-bottom:var(--space-3);">
              <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Tema / Aprašymas *</label>
              <textarea id="creation-topic" rows="4"
                placeholder="${_activeTemplate.prompt}…"
                style="width:100%;box-sizing:border-box;resize:vertical;padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border-default);background:var(--bg-body);color:var(--text-primary);font-size:var(--text-sm);line-height:1.5;"></textarea>
            </div>

            <div style="margin-bottom:var(--space-3);">
              <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Auditorija (neprivaloma)</label>
              <input id="creation-audience" type="text" placeholder="Pvz: pradedantieji programuotojai, verslo vadovai…"
                style="width:100%;padding:var(--space-2) var(--space-3);background:var(--bg-body);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-size:var(--text-xs);">
            </div>

            <div style="margin-bottom:var(--space-3);display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);">
              <label style="font-size:11px;color:var(--text-muted);">Modelis</label>
              ${modelSelectHtml('creation-model-select', { compact: false })}
            </div>

            <button class="btn btn--premium" id="creation-generate" style="width:100%;">
              ✦ Generuoti su StoryTeller AI
            </button>
          </div>

          <!-- Galerija -->
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:var(--space-3);">Sukurta</div>
            <div id="creation-gallery">
              ${_renderGallery()}
            </div>
          </div>

        </div>

        <!-- DEŠINĖ: AI terminalo -->
        <div style="display:flex;flex-direction:column;overflow:hidden;background:var(--bg-body);">
          <div style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-default);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
            <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;">AI Generavimas</span>
            <div style="display:flex;align-items:center;gap:var(--space-2);">
              ${_taskState ? `<span class="badge badge--${_cStateBadge(_taskState)}" style="font-size:9px;">${_taskState}</span>` : ''}
              ${_taskLogs.length ? `<button class="btn btn--ghost btn--sm" id="creation-clear-log" style="font-size:9px;padding:2px 6px;">✕</button>` : ''}
            </div>
          </div>
          <div id="creation-terminal" style="flex:1;overflow-y:auto;padding:var(--space-3);font-family:var(--font-mono);font-size:11px;line-height:1.7;">
            ${_renderTerminal()}
          </div>
          <!-- Copy output button -->
          ${_taskState === 'COMPLETED' && (_editedOutput || _taskLogs.length) ? `
            <div style="padding:var(--space-2) var(--space-3);border-top:1px solid var(--border-default);display:flex;flex-direction:column;gap:var(--space-2);">
              <div style="display:flex;gap:var(--space-2);">
                <button class="btn btn--secondary btn--sm" style="flex:1;" id="creation-refine-longer">✨ Pailginti</button>
                <button class="btn btn--secondary btn--sm" style="flex:1;" id="creation-refine-shorter">🔪 Sutrumpinti</button>
                <button class="btn btn--secondary btn--sm" style="flex:1;" id="creation-refine-rephrase">🔄 Perfrazuoti</button>
              </div>
              <button class="btn btn--ghost btn--sm" id="creation-copy-output" style="width:100%;">📋 Kopijuoti tekstą</button>
            </div>` : ''}
        </div>

      </div>
    </div>
  `;
}

function _renderGallery() {
  if (!_gallery.length) {
    return `<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:var(--space-4);">Dar nieko nesukurta. Spausk „Generuoti".</div>`;
  }
  return `<div style="display:flex;flex-direction:column;gap:var(--space-2);">` +
    _gallery.map(t => {
      const lines = (t.finalOutput || '').split('\n');
      const preview = lines.slice(0,3).join(' ').slice(0,120);
      const tpl = _allTemplates().find(x => t.intent?.toLowerCase().includes(x.name.toLowerCase())) || TEMPLATES[0];
      const sc = t.validationResult?.score;
      return `
        <div class="card" style="padding:var(--space-3);cursor:pointer;" data-creation-id="${t.taskId}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-1);">
            <div style="display:flex;align-items:center;gap:var(--space-2);">
              <span>${tpl.icon}</span>
              <span style="font-size:11px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;">${_escHtml(t.intent?.slice(0,50)||'—')}</span>
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0;">
              ${sc!=null?`<span class="badge badge--success" style="font-size:9px;">★${sc}</span>`:''}
              <span class="badge badge--creation" style="font-size:9px;">DONE</span>
            </div>
          </div>
          <div style="font-size:10px;color:var(--text-muted);line-height:1.4;">${_escHtml(preview)}${preview.length===120?'…':''}</div>
          <div style="font-size:9px;color:var(--text-muted);margin-top:4px;">${_ago(t.startedAt)}</div>
        </div>`;
    }).join('') + '</div>';
}

function _renderTerminal() {
  if (_taskState === 'COMPLETED' && _editedOutput !== null) {
    return `<textarea id="creation-editor-textarea" style="width:100%;height:100%;box-sizing:border-box;resize:none;padding:var(--space-2);border:none;background:transparent;color:var(--text-primary);font-family:inherit;font-size:13px;line-height:1.6;outline:none;">${_escHtml(_editedOutput)}</textarea>`;
  }
  if (!_taskLogs.length) {
    return `
      <div style="color:var(--text-muted);opacity:.5;font-size:11px;">
        $ StoryTeller laukia...<br><br>
        Pasirink šabloną, įvesk temą<br>ir spausk „Generuoti"
      </div>`;
  }
  return _taskLogs.map(e => {
    const c = e.type==='done'?'var(--success)':e.type==='error'?'var(--error)':e.type==='warn'?'var(--warning)':e.type==='state'?'var(--creation-accent)':'var(--text-secondary)';
    return `<div style="color:${c};margin-bottom:1px;"><span style="opacity:.5;">[${e.time}]</span> ${_escHtml(e.message)}</div>`;
  }).join('');
}

// ─── Events ───────────────────────────────────────

export function initCreationEvents() {
  // Template selection
  document.querySelectorAll('.creation-template-card[data-tpl-id]').forEach(el => {
    el.addEventListener('click', () => {
      const tpl = _allTemplates().find(t => t.id === el.dataset.tplId);
      if (tpl) {
        _activeTemplate = tpl;
        _saveState();
        // Update visual
        document.querySelectorAll('.creation-template-card').forEach(c => {
          const isNow = c.dataset.tplId === tpl.id;
          c.style.border = `1px solid ${isNow?'var(--creation-accent)':'var(--border-default)'}`;
          c.style.background = isNow?'rgba(234,128,252,.08)':'var(--bg-card)';
          const label = c.querySelector('div:last-child');
          if (label) label.style.color = isNow?'var(--creation-accent)':'var(--text-primary)';
        });
        // Atnaujinti placeholder
        const ta = document.getElementById('creation-topic');
        if (ta && !ta.value) ta.placeholder = `${tpl.prompt}…`;
        // Atnaujinti toną
        const toneEl = document.getElementById('creation-tone');
        if (toneEl) toneEl.value = tpl.tone;
      }
    });
  });

  // Generate
  document.getElementById('creation-generate')?.addEventListener('click', () => _generate());

  mountModelPicker('creation-model-select');

  // New Template button
  document.getElementById('creation-new-template')?.addEventListener('click', () => {
    const name = prompt('Šablono pavadinimas (pvz: CV, Daina):');
    if (!name) return;
    const promptTxt = prompt('Promptas (pvz: Parašyk profesionalų CV apie...):');
    if (!promptTxt) return;
    const id = 'custom_' + Date.now();
    _customTemplates.push({ id, icon: '⚡', name, prompt: promptTxt, tone: 'informatyvus' });
    Storage.set('creationCustomTemplates', _customTemplates);
    EventBus.emit('navigate', 'creation');
  });

  // Clear log
  document.getElementById('creation-clear-log')?.addEventListener('click', () => {
    _taskLogs = []; _taskState = null; _editedOutput = null;
    _saveState();
    EventBus.emit('navigate', 'creation');
  });

  // Copy output
  document.getElementById('creation-copy-output')?.addEventListener('click', () => {
    const last = _editedOutput || _taskLogs.filter(l => l.type === 'output').map(l => l.message).join('\n')
      || _taskLogs.slice(-1)[0]?.message || '';
    navigator.clipboard.writeText(last).then(() => showToast('Nukopijuota!', 'success'));
  });

  // Textarea syncing
  document.getElementById('creation-terminal')?.addEventListener('input', (e) => {
    if (e.target.id === 'creation-editor-textarea') {
      _editedOutput = e.target.value;
      _saveState();
    }
  });

  // Refinement buttons
  const refine = (action) => {
    if (!_editedOutput) return;
    const topic = document.getElementById('creation-topic');
    if (topic) topic.value = `${action} šį tekstą:\n\n${_editedOutput}`;
    _generate();
  };
  document.getElementById('creation-refine-longer')?.addEventListener('click', () => refine('Pailgink ir išplėsk'));
  document.getElementById('creation-refine-shorter')?.addEventListener('click', () => refine('Sutrumpink ir sukoncentruok'));
  document.getElementById('creation-refine-rephrase')?.addEventListener('click', () => refine('Perfrazuok kitaip'));

  // Gallery item click — show output in terminal
  document.querySelectorAll('[data-creation-id]').forEach(el => {
    el.addEventListener('click', () => {
      const task = _gallery.find(t => t.taskId === el.dataset.creationId);
      if (!task?.finalOutput) return;
      _taskLogs = [];
      _taskState = 'COMPLETED';
      _editedOutput = task.finalOutput;
      _saveState();
      task.finalOutput.split('\n').forEach(line => _appendLog('output', line));
      EventBus.emit('navigate', 'creation');
    });
  });

  _startSse();
  _loadGallery();
}

// ─── Generate ─────────────────────────────────────

async function _generate() {
  const topic     = document.getElementById('creation-topic')?.value.trim();
  const tone      = document.getElementById('creation-tone')?.value || _activeTemplate.tone;
  const length    = document.getElementById('creation-length')?.value || 'vidutinis';
  const audience  = document.getElementById('creation-audience')?.value.trim();

  if (!topic) { showToast('Įvesk temą', 'error'); document.getElementById('creation-topic')?.focus(); return; }

  const lengthDesc = { trumpas:'~200 žodžių', vidutinis:'~500 žodžių', ilgas:'~1000 žodžių' }[length] || length;
  const intent = `[${_activeTemplate.name}] ${_activeTemplate.prompt} "${topic}". Tonas: ${tone}. Ilgumas: ${lengthDesc}.${audience ? ` Tikslinė auditorija: ${audience}.` : ''} Rašyk lietuviškai, jei tema nenurodyta kita kalba. Grąžink tik gatavą tekstą.`;

  _taskLogs = [];
  _taskState = 'STARTING';
  _taskId = null;
  _editedOutput = null;
  _saveState();
  _appendLog('state', `Generuojama: ${_activeTemplate.name} — "${topic.slice(0,50)}"`);
  _patchTerminal();

  const btn = document.getElementById('creation-generate');
  if (btn) { btn.disabled = true; btn.textContent = '…Generuojama'; }

  try {
    const res = await Api.startTask({ intent, domainEngine: 'creation', modelId: getSelectedModel() || undefined });
    _taskId = res.taskId;
    _saveState();
    _appendLog('info', `Task: ${_taskId}`);
    _patchTerminal();
  } catch (err) {
    _appendLog('error', err.message);
    _taskState = 'FAILED';
    _patchTerminal();
    showToast(`Klaida: ${err.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✦ Generuoti su StoryTeller AI'; }
  }
}

// ─── SSE ──────────────────────────────────────────

function _startSse() {
  if (_sseUnsub) return;
  _sseUnsub = Api.subscribeEvents((name, data) => {
    if (data.taskId && _taskId && data.taskId !== _taskId) return;
    if (name === 'task:log') {
      const msg = data.message || data.preview || '';
      if (msg) {
        _appendLog(data.status==='error'?'error':data.status==='done'?'done':'info', `[${data.phase||''}] ${msg}`);
        _patchTerminal();
      }
    } else if (name === 'task:stateChange') {
      _taskState = data.to || data.context?.state;
      _appendLog('state', `→ ${_taskState}`);
      _patchTerminal();
    } else if (name === 'task:done') {
      _taskState = data.state;
      if (data.output) {
        _editedOutput = data.output;
        _saveState();
        _appendLog('state', '─── Sukurtas turinys ───');
        data.output.split('\n').forEach(line => _appendLog('output', line));
      }
      _appendLog('done', '✓ Baigta');
      _patchTerminal();
      const btn = document.getElementById('creation-generate');
      if (btn) { btn.disabled = false; btn.textContent = '✦ Generuoti su StoryTeller AI'; }
      // Atnaujinti galeriją po generavimo
      setTimeout(() => _loadGallery(), 500);
      // Atnaujinti terminalo footer su copy button
      EventBus.emit('navigate', 'creation');
    } else if (name === 'task:error') {
      _appendLog('error', data.message || 'Klaida');
      _taskState = 'FAILED';
      _patchTerminal();
      const btn = document.getElementById('creation-generate');
      if (btn) { btn.disabled = false; btn.textContent = '✦ Generuoti su StoryTeller AI'; }
    }
  });
}

async function _loadGallery() {
  try {
    const res = await Api.getTasks();
    _gallery = (res.tasks || [])
      .filter(t => t.domainEngine === 'creation' && t.state === 'COMPLETED')
      .slice(-8).reverse();
    const el = document.getElementById('creation-gallery');
    if (el) {
      el.innerHTML = _renderGallery();
      el.querySelectorAll('[data-creation-id]').forEach(item => {
        item.addEventListener('click', () => {
          const task = _gallery.find(t => t.taskId === item.dataset.creationId);
          if (!task?.finalOutput) return;
          _taskLogs = [];
          _taskState = 'COMPLETED';
          _editedOutput = task.finalOutput;
          _saveState();
          task.finalOutput.split('\n').forEach(line => _appendLog('output', line));
          EventBus.emit('navigate', 'creation');
        });
      });
    }
  } catch { /* ignore */ }
}

// ─── DOM patches ──────────────────────────────────

function _appendLog(type, message) {
  const now = new Date().toLocaleTimeString('lt-LT',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  _taskLogs.push({ time: now, type, message });
  if (_taskLogs.length > 500) _taskLogs = _taskLogs.slice(-500);
  _saveState();
}
function _patchTerminal() {
  const el = document.getElementById('creation-terminal');
  if (!el) return;
  el.innerHTML = _renderTerminal();
  el.scrollTop = el.scrollHeight;
}

EventBus.on('navigate', route => {
  if (route !== 'creation') { if (_sseUnsub) { _sseUnsub(); _sseUnsub = null; } }
});

// ─── Helpers ─────────────────────────────────────

function _cStateBadge(s) {
  if (s==='COMPLETED') return 'success';
  if (['FAILED','CANCELLED'].includes(s)) return 'error';
  return 'info';
}
function _ago(ts) {
  if (!ts) return '—';
  const s=Math.round((Date.now()-ts)/1000);
  if(s<60) return `${s}s`; if(s<3600) return `${Math.floor(s/60)}min`; return `${Math.floor(s/3600)}h`;
}
function _escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
