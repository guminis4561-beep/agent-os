// ═══════════════════════════════════════════════════
// COMPONENT: Modals & Command Palette
// ═══════════════════════════════════════════════════

import EventBus from '../core/events.js';

const COMMANDS = [
  { group: 'Navigation', items: [
    { id: 'nav-dashboard', label: 'Go to Dashboard', icon: '⌂', shortcut: '' },
    { id: 'nav-workflows', label: 'Go to Workflows', icon: '⚡', shortcut: '' },
    { id: 'nav-agents', label: 'Go to Agents', icon: '⬡', shortcut: '' },
    { id: 'nav-memory', label: 'Go to Memory', icon: '◉', shortcut: '' },
  ]},
  { group: 'Engines', items: [
    { id: 'nav-coding', label: 'Open Coding Engine', icon: '⟨/⟩', shortcut: '' },
    { id: 'nav-trading', label: 'Open Trading Engine', icon: '◇', shortcut: '' },
    { id: 'nav-creation', label: 'Open Creation Engine', icon: '✦', shortcut: '' },
  ]},
  { group: 'Actions', items: [
    { id: 'action-new-workflow', label: 'Create New Workflow', icon: '＋', shortcut: 'Ctrl+N' },
    { id: 'action-new-agent', label: 'Register New Agent', icon: '＋', shortcut: '' },
    { id: 'action-run-all', label: 'Run All Workflows', icon: '▶', shortcut: 'Ctrl+R' },
    { id: 'action-toggle-inspector', label: 'Toggle Inspector', icon: '◧', shortcut: 'Ctrl+I' },
  ]},
];

let isOpen = false;
let filteredCommands = COMMANDS;

export function initCommandPalette() {
  // Create the palette element
  const palette = document.createElement('div');
  palette.id = 'command-palette';
  palette.className = 'command-palette hidden';
  document.body.appendChild(palette);

  // Listen for toggle events
  EventBus.on('commandPalette:toggle', () => {
    isOpen = !isOpen;
    if (isOpen) openPalette();
    else closePalette();
  });
}

function openPalette() {
  isOpen = true;
  filteredCommands = COMMANDS;
  const palette = document.getElementById('command-palette');
  palette.classList.remove('hidden');
  renderPaletteContent('');
  
  // Focus input after render
  setTimeout(() => {
    const input = palette.querySelector('.command-palette__input');
    if (input) input.focus();
  }, 50);

  // Close on backdrop click
  palette.addEventListener('click', (e) => {
    if (e.target === palette) closePalette();
  });

  // Close on Escape
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closePalette();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function closePalette() {
  isOpen = false;
  const palette = document.getElementById('command-palette');
  palette.classList.add('hidden');
}

function renderPaletteContent(query) {
  const palette = document.getElementById('command-palette');
  
  // Filter commands
  const q = query.toLowerCase();
  const filtered = COMMANDS.map(group => ({
    group: group.group,
    items: group.items.filter(item => 
      item.label.toLowerCase().includes(q)
    ),
  })).filter(group => group.items.length > 0);

  palette.innerHTML = `
    <div class="command-palette__dialog">
      <div class="command-palette__input-wrapper">
        <span class="command-palette__icon">⌕</span>
        <input class="command-palette__input" 
               type="text" 
               placeholder="Type a command or search..." 
               value="${query}"
               id="cmd-palette-input">
      </div>
      <div class="command-palette__results">
        ${filtered.map(group => `
          <div class="command-palette__group">
            <div class="command-palette__group-title">${group.group}</div>
            ${group.items.map(item => `
              <div class="command-palette__item" data-command="${item.id}">
                <div class="command-palette__item-icon">${item.icon}</div>
                <span class="command-palette__item-label">${item.label}</span>
                ${item.shortcut ? `
                  <div class="command-palette__item-shortcut">
                    ${item.shortcut.split('+').map(k => `<span class="topbar__kbd">${k}</span>`).join('')}
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        `).join('')}
        ${filtered.length === 0 ? `
          <div style="padding:var(--space-6);text-align:center;color:var(--text-muted);">
            No commands found
          </div>
        ` : ''}
      </div>
    </div>
  `;

  // Input handler
  const input = palette.querySelector('#cmd-palette-input');
  input.addEventListener('input', (e) => {
    renderPaletteContent(e.target.value);
    // Re-focus after re-render
    const newInput = palette.querySelector('#cmd-palette-input');
    newInput.focus();
    newInput.selectionStart = newInput.selectionEnd = newInput.value.length;
  });

  // Command click handlers
  palette.querySelectorAll('.command-palette__item').forEach(item => {
    item.addEventListener('click', () => {
      const cmdId = item.dataset.command;
      executeCommand(cmdId);
      closePalette();
    });
  });
}

function executeCommand(cmdId) {
  if (cmdId.startsWith('nav-')) {
    const route = cmdId.replace('nav-', '');
    EventBus.emit('navigate', route);
  } else if (cmdId === 'action-toggle-inspector') {
    const app = document.getElementById('app');
    app.classList.toggle('inspector-collapsed');
  } else if (cmdId === 'action-new-workflow') {
    EventBus.emit('navigate', 'workflows');
  } else if (cmdId === 'action-new-agent') {
    EventBus.emit('navigate', 'agents');
  } else if (cmdId === 'action-run-all') {
    EventBus.emit('workflows:runAll');
  }
}

// ═══════════════════════════════════════════════════
// GLOBAL MODAL API
// ═══════════════════════════════════════════════════
export function openModal({ title, content, actions }) {
  closeModal(); // Ensure only one modal exists

  const overlay = document.createElement('div');
  overlay.className = 'global-modal-overlay';
  overlay.id = 'global-modal';

  const actionsHtml = actions ? `
    <div class="global-modal-actions">
      ${actions}
    </div>
  ` : '';

  overlay.innerHTML = `
    <div class="global-modal-container">
      <div class="global-modal-header">
        <h3 style="font-size:var(--text-lg);font-weight:var(--weight-semibold);">${title}</h3>
        <button class="global-modal-close" id="global-modal-close">×</button>
      </div>
      <div class="global-modal-body">
        ${content}
      </div>
      ${actionsHtml}
    </div>
  `;

  document.body.appendChild(overlay);

  // Animate in
  requestAnimationFrame(() => {
    overlay.classList.add('active');
  });

  // Close handlers
  overlay.querySelector('#global-modal-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
}

export function closeModal() {
  const overlay = document.getElementById('global-modal');
  if (overlay) {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 200); // Wait for transition
  }
}
