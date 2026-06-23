// ═══════════════════════════════════════════════════
// DOMAIN: Chatbot — standalone memory-aware chat
// ═══════════════════════════════════════════════════
//
// A plain conversational view that bypasses the FSM/orchestrator entirely.
// Each turn POSTs the running transcript to /api/chat, where the server injects
// the Memory Fabric (identity + global + recent workspace records) as context.
// History is kept locally (module state + localStorage) so it survives nav.

import EventBus from '../../core/events.js';
import Storage from '../../core/storage.js';
import * as Api from '../../core/api-client.js';
import { loadModels } from '../engines/model-picker.js';

const STORAGE_KEY = 'chatMessages';
const MODEL_KEY = 'chatModel';

// ─── Module state ─────────────────────────────────
let _messages = Storage.get(STORAGE_KEY) || []; // { role: 'user'|'assistant', content, ts }
let _sending = false;

function _save() { Storage.set(STORAGE_KEY, _messages); }
function _getChatModel() { return Storage.get(MODEL_KEY) || ''; }
function _setChatModel(id) { Storage.set(MODEL_KEY, id || ''); }

// ─── Render ───────────────────────────────────────
export function renderChat() {
  return `
    <style>
      .chat-wrapper { height:100%; display:flex; flex-direction:column; background:var(--bg-body); position:relative; }
      .chat-header { flex-shrink:0; display:flex; justify-content:space-between; align-items:center; padding:var(--space-4) var(--space-6); background:rgba(var(--bg-card-rgb, 15,15,15), 0.7); backdrop-filter:blur(12px); border-bottom:1px solid var(--border-subtle, var(--border-default)); z-index:10; }
      .chat-header-info { display:flex; align-items:center; gap:var(--space-3); }
      .chat-icon { width:40px; height:40px; border-radius:12px; background:linear-gradient(135deg, var(--accent-primary), #a29bfe); display:flex; align-items:center; justify-content:center; font-size:1.2rem; box-shadow:0 4px 12px rgba(108,92,231,0.3); }
      .chat-title { margin:0; font-size:var(--text-lg); font-weight:600; color:var(--text-primary); letter-spacing:-0.02em; }
      .chat-subtitle { margin:2px 0 0; font-size:var(--text-xs); color:var(--text-muted); }
      
      .chat-messages { flex:1; overflow-y:auto; padding:var(--space-6); display:flex; flex-direction:column; gap:var(--space-5); scroll-behavior:smooth; }
      
      .msg-bubble { max-width:80%; padding:var(--space-3) var(--space-4); font-size:var(--text-sm); line-height:1.6; white-space:pre-wrap; word-break:break-word; position:relative; animation:slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
      .msg-bubble.user { align-self:flex-end; background:linear-gradient(135deg, var(--accent-primary) 0%, #5a4bcf 100%); color:#fff; border-radius:16px 16px 4px 16px; box-shadow:0 4px 12px rgba(108,92,231,0.2); }
      .msg-bubble.assistant { align-self:flex-start; background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border-default); border-radius:16px 16px 16px 4px; box-shadow:0 2px 8px rgba(0,0,0,0.05); }
      
      .msg-meta { font-size:10px; color:var(--text-muted); margin-bottom:4px; display:flex; align-items:center; gap:6px; }
      .user-meta { align-self:flex-end; }
      .assistant-meta { align-self:flex-start; }
      
      .msg-copy { position:absolute; top:8px; right:8px; opacity:0; transition:opacity 0.2s; background:var(--bg-body); border:1px solid var(--border-default); border-radius:4px; padding:4px; cursor:pointer; color:var(--text-muted); display:flex; align-items:center; justify-content:center; }
      .msg-bubble.assistant:hover .msg-copy { opacity:1; }
      .msg-copy:hover { color:var(--text-primary); background:var(--bg-hover, rgba(255,255,255,0.05)); }
      
      .chat-input-area { flex-shrink:0; padding:var(--space-4) var(--space-6); background:linear-gradient(to top, var(--bg-body) 80%, transparent); position:relative; z-index:10; }
      .chat-input-container { display:flex; gap:var(--space-3); align-items:flex-end; max-width:900px; margin:0 auto; background:var(--bg-card); border:1px solid var(--border-default); border-radius:24px; padding:var(--space-2) var(--space-2) var(--space-2) var(--space-4); box-shadow:0 8px 24px rgba(0,0,0,0.1); transition:border-color 0.2s, box-shadow 0.2s; }
      .chat-input-container:focus-within { border-color:var(--accent-primary); box-shadow:0 8px 24px rgba(108,92,231,0.15); }
      
      #chat-input { flex:1; box-sizing:border-box; resize:none; padding:var(--space-2) 0; background:transparent; border:none; color:var(--text-primary); font-size:var(--text-sm); line-height:1.5; max-height:200px; outline:none; font-family:inherit; }
      #chat-input::placeholder { color:var(--text-muted); }
      
      .btn-send { height:40px; width:40px; border-radius:20px; background:var(--accent-primary); color:#fff; display:flex; align-items:center; justify-content:center; border:none; cursor:pointer; transition:transform 0.2s, background 0.2s; flex-shrink:0; }
      .btn-send:hover:not(:disabled) { transform:scale(1.05); background:#7b6df2; }
      .btn-send:disabled { opacity:0.5; cursor:not-allowed; }
      
      .typing-indicator { display:flex; gap:4px; padding:8px 12px; align-items:center; }
      .typing-dot { width:6px; height:6px; border-radius:50%; background:var(--text-muted); animation:typing 1.4s infinite ease-in-out both; }
      .typing-dot:nth-child(1) { animation-delay:-0.32s; }
      .typing-dot:nth-child(2) { animation-delay:-0.16s; }
      
      .quick-actions { display:flex; flex-wrap:wrap; gap:var(--space-2); justify-content:center; margin-top:var(--space-6); }
      .quick-action-btn { background:var(--bg-card); border:1px solid var(--border-default); border-radius:20px; padding:8px 16px; font-size:var(--text-xs); color:var(--text-secondary); cursor:pointer; transition:all 0.2s; display:flex; align-items:center; gap:6px; }
      .quick-action-btn:hover { background:var(--bg-body); border-color:var(--accent-primary); color:var(--text-primary); transform:translateY(-2px); }
      
      @keyframes slideIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
      @keyframes typing { 0%, 80%, 100% { transform:scale(0); } 40% { transform:scale(1); } }
      
      /* Markdown formatting */
      .msg-bubble pre { background:#1e1e1e !important; color:#d4d4d4 !important; padding:var(--space-3); border-radius:var(--radius-md); overflow-x:auto; margin:var(--space-2) 0; font-family:monospace; font-size:0.85em; border:1px solid #333; }
      .msg-bubble code { font-family:monospace; font-size:0.9em; background:rgba(0,0,0,0.1); padding:2px 4px; border-radius:4px; }
      .msg-bubble.user code { background:rgba(255,255,255,0.2); }
    </style>
    <div class="chat-wrapper">
      <div class="chat-header">
        <div class="chat-header-info">
          <div class="chat-icon">✨</div>
          <div>
            <h2 class="chat-title">Pokalbis su atmintimi</h2>
            <p class="chat-subtitle">Tiesioginis AI pokalbis su Memory Fabric kontekstu</p>
          </div>
        </div>
        <div style="display:flex;gap:var(--space-3);align-items:center;">
          <select id="chat-model-select" style="padding:6px 12px;background:var(--bg-body);border:1px solid var(--border-default);border-radius:var(--radius-full);color:var(--text-primary);font-size:var(--text-xs);outline:none;cursor:pointer;">
            <option value="">Numatytasis modelis</option>
          </select>
          <button class="btn btn--ghost btn--sm" id="chat-clear" style="color:var(--text-muted);border-radius:var(--radius-full);padding:6px;" title="Išvalyti pokalbį">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>

      <div id="chat-history" class="chat-messages">
        ${_renderHistory()}
      </div>

      <div class="chat-input-area">
        <div class="chat-input-container">
          <textarea id="chat-input" rows="1" placeholder="Ko norėtumėte paklausti? (Shift+Enter - nauja eilutė)"></textarea>
          <button class="btn-send" id="chat-send" title="Siųsti (Enter)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:2px;margin-top:2px;"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

function _renderHistory() {
  if (!_messages.length) {
    return `
      <div style="margin:auto;text-align:center;max-width:500px;color:var(--text-muted);animation:slideIn 0.4s ease-out;">
        <div style="width:80px;height:80px;background:linear-gradient(135deg, rgba(108,92,231,0.2), rgba(162,155,254,0.1));border-radius:24px;display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-4);font-size:2.5rem;box-shadow:inset 0 0 20px rgba(108,92,231,0.1);">🧠</div>
        <div style="font-size:var(--text-lg);font-weight:600;color:var(--text-primary);margin-bottom:var(--space-2);">Sistemos Atmintis Paruošta</div>
        <div style="font-size:var(--text-sm);line-height:1.6;margin-bottom:var(--space-6);">Aš esu jūsų AI asistentas. Turiu prieigą prie jūsų darbalaukio konteksto, projektų ir paskutinių užduočių.</div>
        
        <div class="quick-actions">
          <button class="quick-action-btn" data-prompt="Ką aš paskutiniu metu dirbau?"><span>🕰️</span> Ką paskutiniu metu dirbau?</button>
          <button class="quick-action-btn" data-prompt="Apibendrink mano aktyvų projektą"><span>📁</span> Apibendrink projektą</button>
          <button class="quick-action-btn" data-prompt="Kokie yra mano pagrindiniai tikslai?"><span>🎯</span> Kokie mano tikslai?</button>
        </div>
      </div>`;
  }
  return _messages.map(_bubble).join('') + (_sending ? _typingBubble() : '');
}

function _formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function _bubble(m) {
  const isUser = m.role === 'user';
  const label = isUser ? 'Jūs' : 'Asistentas';
  const time = _formatTime(m.ts);
  const timeHtml = time ? `<span style="opacity:0.6;font-weight:normal;margin-left:6px;font-size:9px;">${time}</span>` : '';
  
  if (isUser) {
    return `
      <div style="display:flex;flex-direction:column;gap:4px;" class="user-meta">
        <span class="msg-meta user-meta">${timeHtml}</span>
        <div class="msg-bubble user">${_formatMsg(m.content)}</div>
      </div>`;
  } else {
    const encodedContent = String(m.content || '').replace(/"/g, '&quot;');
    return `
      <div style="display:flex;flex-direction:column;gap:4px;" class="assistant-meta">
        <span class="msg-meta assistant-meta"><span style="color:var(--accent-primary);">🤖</span> ${label} ${timeHtml}</span>
        <div class="msg-bubble assistant">
          <button class="msg-copy" data-content="${encodedContent}" title="Kopijuoti">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
          ${_formatMsg(m.content)}
        </div>
      </div>`;
  }
}

function _typingBubble() {
  return `
    <div style="display:flex;flex-direction:column;gap:4px;" class="assistant-meta">
      <span class="msg-meta assistant-meta"><span style="color:var(--accent-primary);">🤖</span> Asistentas</span>
      <div class="msg-bubble assistant">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    </div>`;
}

function _formatMsg(s) {
  if (!s) return '';
  let escaped = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Bold
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Inline code
  escaped = escaped.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // Code blocks
  escaped = escaped.replace(/```[a-z]*\n([\s\S]*?)```/gi, (match, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });
  return escaped;
}

// ─── Events ───────────────────────────────────────
export function initChatEvents() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const historyEl = document.getElementById('chat-history');

  const send = () => _send();
  sendBtn?.addEventListener('click', send);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  // Auto-grow textarea
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  });

  document.getElementById('chat-clear')?.addEventListener('click', () => {
    if (!_messages.length || confirm('Išvalyti visą pokalbio istoriją?')) {
      _messages = [];
      _save();
      _repaint();
    }
  });

  // Event delegation for dynamically rendered buttons (copy, quick actions)
  historyEl?.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.msg-copy');
    if (copyBtn) {
      const text = copyBtn.getAttribute('data-content');
      navigator.clipboard.writeText(text).then(() => {
        const originalHTML = copyBtn.innerHTML;
        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        setTimeout(() => copyBtn.innerHTML = originalHTML, 2000);
      });
      return;
    }
    
    const quickBtn = e.target.closest('.quick-action-btn');
    if (quickBtn) {
      const prompt = quickBtn.getAttribute('data-prompt');
      if (input && prompt) {
        input.value = prompt;
        input.style.height = 'auto';
        send();
      }
    }
  });

  // Model picker — populate and wire persistence
  _mountChatModelPicker();

  input?.focus();
  _scrollToBottom();
}

async function _mountChatModelPicker() {
  const sel = document.getElementById('chat-model-select');
  if (!sel) return;
  const models = await loadModels();
  const current = _getChatModel();
  sel.innerHTML = ['<option value="">Numatytasis modelis</option>']
    .concat(models.map((m) =>
      `<option value="${m}" ${m === current ? 'selected' : ''}>${m}</option>`))
    .join('');
  sel.value = current;
  sel.addEventListener('change', () => _setChatModel(sel.value));
}

// ─── Send flow ────────────────────────────────────
async function _send() {
  if (_sending) return;
  const input = document.getElementById('chat-input');
  const text = (input?.value || '').trim();
  if (!text) return;

  _messages.push({ role: 'user', content: text, ts: Date.now() });
  _save();
  if (input) { input.value = ''; input.style.height = 'auto'; }
  _sending = true;
  _repaint();

  try {
    // Send only role+content (the API ignores ts).
    const payload = _messages.map(({ role, content }) => ({ role, content }));
    const res = await Api.sendChat(payload, _getChatModel() || undefined);
    _messages.push({ role: 'assistant', content: res.reply || '(tuščias atsakymas)', ts: Date.now() });
  } catch (err) {
    _messages.push({ role: 'assistant', content: `⚠️ Klaida: ${err.message}`, ts: Date.now() });
  } finally {
    _sending = false;
    _save();
    _repaint();
  }
}

// ─── Helpers ──────────────────────────────────────
function _repaint() {
  const el = document.getElementById('chat-history');
  if (!el) return;
  el.innerHTML = _renderHistory();
  _scrollToBottom();
  // Keep the send button state in sync
  const btn = document.getElementById('chat-send');
  if (btn) btn.disabled = _sending;
}

function _scrollToBottom() {
  const el = document.getElementById('chat-history');
  if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}
