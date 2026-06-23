// ═══════════════════════════════════════════════════
// COMPONENT: Sidebar Navigation — HUGOFXLAB style (LT)
// ═══════════════════════════════════════════════════

import AppState from '../core/state.js';
import EventBus from '../core/events.js';
import Storage from '../core/storage.js';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Darbo erdvės', icon: '☰', section: 'main' },
  { id: 'engines', label: 'Varikliai', icon: '⬡', section: 'main', chevron: true },
  { id: 'coding', label: 'Programavimas', icon: '⟨/⟩', section: 'sub', parent: 'engines', engine: 'coding' },
  { id: 'trading', label: 'Prekyba', icon: '◇', section: 'sub', parent: 'engines', engine: 'trading' },
  { id: 'creation', label: 'Kūryba', icon: '✦', section: 'sub', parent: 'engines', engine: 'creation' },
  { id: 'divider1', type: 'divider' },
  { id: 'chat', label: 'Pokalbis', icon: '💬', section: 'main', badge: 'AI' },
  { id: 'agents', label: 'Hermes', icon: '⬢', section: 'main', badge: 'Agentai' },
  { id: 'workflows', label: 'Darbo srautai', icon: '⚡', section: 'main', badge: 'Aktyvūs' },
  { id: 'task-execution', label: 'Užduočių FSM', icon: '⚙', section: 'main' },
  { id: 'memory', label: 'Atmintis', icon: '◉', section: 'main' },
  { id: 'sessions', label: 'Sesijos', icon: '🕒', section: 'main' },
];

export function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const activeView = AppState.getState('activeView');

  let html = '<div class="sidebar__section">';

  NAV_ITEMS.forEach(item => {
    if (item.type === 'divider') {
      html += '<div class="sidebar__divider"></div>';
      return;
    }

    const isActive = activeView === item.id;
    const engineAttr = item.engine ? `data-engine="${item.engine}"` : '';
    const subClass = item.section === 'sub' ? ' sub-item' : '';
    const badgeHtml = item.badge ? `<span class="sidebar__nav-badge">${item.badge}</span>` : '';
    const chevronHtml = item.chevron ? `<span class="sidebar__nav-chevron">›</span>` : '';

    html += `
      <div class="sidebar__nav-item${subClass} ${isActive ? 'active' : ''}" 
           data-route="${item.id}" ${engineAttr}
           id="nav-${item.id}">
        <span class="sidebar__nav-icon">${item.icon}</span>
        <span class="sidebar__nav-label">${item.label}</span>
        ${badgeHtml}
        ${chevronHtml}
      </div>
    `;
  });

  html += '</div>';

  // Footer
  html += `
    <div class="sidebar__footer">
      <div class="sidebar__nav-item" id="btn-cmd-palette" style="font-size:var(--text-xs);">
        <span class="sidebar__nav-icon">💬</span>
        <span class="sidebar__nav-label">Komanda</span>
      </div>
      <div class="sidebar__nav-item" id="btn-settings-modal" style="font-size:var(--text-xs);">
        <span class="sidebar__nav-icon">⚙</span>
        <span class="sidebar__nav-label">Nustatymai</span>
      </div>
      <div class="sidebar__nav-item" id="btn-factory-reset" style="font-size:var(--text-xs);color:var(--error);">
        <span class="sidebar__nav-icon">⚠</span>
        <span class="sidebar__nav-label">Išvalyti Atmintį</span>
      </div>
      <div class="sidebar__nav-item" id="btn-logout" style="font-size:var(--text-xs);color:var(--text-muted);">
        <span class="sidebar__nav-icon">↩</span>
        <span class="sidebar__nav-label">Atsijungti</span>
      </div>
    </div>
  `;

  sidebar.innerHTML = html;

  // Attach click handlers
  sidebar.querySelectorAll('.sidebar__nav-item[data-route]').forEach(el => {
    el.addEventListener('click', () => {
      const route = el.dataset.route;
      if (route) {
        EventBus.emit('navigate', route);
      }
    });
  });

  // Komanda
  document.getElementById('btn-cmd-palette')?.addEventListener('click', () => {
    EventBus.emit('commandPalette:toggle');
  });

  // Nustatymai → navigacija į Settings puslapį
  document.getElementById('btn-settings-modal')?.addEventListener('click', () => {
    EventBus.emit('navigate', 'settings');
  });

  // Atsijungti
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    openModal({
      title: 'Atsijungti nuo Sistemos',
      content: '<p>Ar tikrai norite atsijungti nuo savo paskyros?</p>',
      actions: `
        <button class="btn btn--secondary btn--sm" onclick="document.getElementById('global-modal-close').click()">Atšaukti</button>
        <button class="btn btn--error btn--sm" onclick="window.location.reload()">Atsijungti</button>
      `
    });
  });

  // Factory Reset Handler
  document.getElementById('btn-factory-reset')?.addEventListener('click', () => {
    if (confirm('Ar tikrai norite išvalyti visą išsaugotą atmintį (Agentus, Darbo erdves)? Tai atstatys pradinius duomenis.')) {
      Storage.clear();
      window.location.reload();
    }
  });
}

// Re-render on view change
AppState.subscribe('activeView', () => renderSidebar());
