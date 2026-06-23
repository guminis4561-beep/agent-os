// ═══════════════════════════════════════════════════
// COMPONENT: Top Bar (Command Bar)
// ═══════════════════════════════════════════════════

import AppState from '../core/state.js';
import EventBus from '../core/events.js';
import { WORKSPACES } from '../data/mock-data.js';
import { openModal } from './modal.js';
import Storage from '../core/storage.js';

function _initials(name) {
  return (name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

export function renderTopbar() {
  const topbar = document.getElementById('topbar');
  if (!topbar) return;

  const activeWorkspace = WORKSPACES.find(w => w.id === AppState.getState('activeWorkspace')) || WORKSPACES[0];
  const userName = Storage.get('userName', 'Vartotojas');



  topbar.innerHTML = `
    <div class="topbar__brand">
      <span class="topbar__title">HUGOFX<span>LAB</span></span>
    </div>

    <div class="topbar__workspace">
      <span class="badge badge--info" style="font-size:var(--text-xs);padding:4px 8px;border-radius:var(--radius-md);background:var(--bg-card);border:1px solid var(--border-default);color:var(--text-primary);">
        <span style="margin-right:4px;color:var(--text-muted);">Workspace:</span>${activeWorkspace.name}
      </span>
    </div>

    <div class="topbar__search">
      <span class="topbar__search-icon">⌕</span>
      <input class="topbar__search-input" type="text" placeholder="Global Search / Command (Ctrl+K)" id="global-search-input">
    </div>

    <div class="topbar__actions">
      <button class="topbar__action-btn" id="btn-help" title="Pagalba">
        ❓ <span class="topbar__action-text">Pagalba</span>
      </button>
    </div>

    <div class="topbar__user" id="user-avatar" title="Vartotojo profilis" style="position:relative;cursor:pointer;">
      <div class="topbar__avatar" id="user-initials">${_initials(userName)}</div>
      <div class="topbar__user-info">
        <span class="topbar__user-name" id="user-display-name">${userName}</span>
        <span class="topbar__user-status">
          <span class="topbar__user-status-dot"></span>Aktyvus
        </span>
      </div>
      <div class="dropdown hidden" id="user-dropdown" style="top:calc(100% + 8px);right:0;left:auto;">
        <div class="dropdown__item" id="dd-settings"><span style="margin-right:var(--space-2);">⚙</span> Nustatymai</div>
        <div class="dropdown__item" id="dd-theme-toggle"><span style="margin-right:var(--space-2);">🌓</span> Pakeisti temą</div>
        <div class="dropdown__divider"></div>
        <div class="dropdown__item" id="dd-logout" style="color:var(--error);"><span style="margin-right:var(--space-2);">↩</span> Atsijungti</div>
      </div>
    </div>
  `;

  // Ctrl+K
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      EventBus.emit('commandPalette:toggle');
    }
  });

  topbar.querySelector('#global-search-input')?.addEventListener('focus', () => {
    EventBus.emit('commandPalette:toggle');
    topbar.querySelector('#global-search-input').blur();
  });

  const userAvatar = topbar.querySelector('#user-avatar');
  const userDropdown = topbar.querySelector('#user-dropdown');

  userAvatar?.addEventListener('click', (e) => {
    e.stopPropagation();
    userDropdown.classList.toggle('hidden');
  });
  document.addEventListener('click', () => userDropdown?.classList.add('hidden'));

  topbar.querySelector('#dd-settings')?.addEventListener('click', (e) => {
    e.stopPropagation();
    userDropdown.classList.add('hidden');
    const currentName = Storage.get('userName', 'Vartotojas');
    openModal({
      title: 'Paskyros Nustatymai',
      content: `
        <div style="display:flex;flex-direction:column;gap:var(--space-4);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span>Vardas</span>
            <input type="text" id="modal-user-name" value="${currentName}"
              style="width:200px;background:var(--bg-card);border:1px solid var(--border-default);padding:var(--space-2);color:var(--text-primary);border-radius:var(--radius-md);">
          </div>
        </div>
      `,
      actions: `
        <button class="btn btn--secondary btn--sm" onclick="document.getElementById('global-modal-close').click()">Atšaukti</button>
        <button class="btn btn--primary btn--sm" id="btn-save-profile">Išsaugoti</button>
      `
    });
    requestAnimationFrame(() => {
      document.getElementById('btn-save-profile')?.addEventListener('click', () => {
        const name = (document.getElementById('modal-user-name')?.value || '').trim();
        if (name) {
          Storage.set('userName', name);
          const el = document.getElementById('user-display-name');
          const ini = document.getElementById('user-initials');
          if (el) el.textContent = name;
          if (ini) ini.textContent = _initials(name);
        }
        document.getElementById('global-modal-close')?.click();
      });
    });
  });

  topbar.querySelector('#dd-theme-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    userDropdown.classList.add('hidden');
    const currentTheme = AppState.getState('theme') || 'dark';
    const themes = ['dark', 'light', 'claude'];
    const nextIdx = (themes.indexOf(currentTheme) + 1) % themes.length;
    const newTheme = themes[nextIdx];
    AppState.setState('theme', newTheme);
    Storage.set('theme', newTheme);
  });

  topbar.querySelector('#dd-logout')?.addEventListener('click', (e) => {
    e.stopPropagation();
    userDropdown.classList.add('hidden');
    openModal({
      title: 'Atsijungti nuo Sistemos',
      content: '<p>Ar tikrai norite atsijungti?</p>',
      actions: `
        <button class="btn btn--secondary btn--sm" onclick="document.getElementById('global-modal-close').click()">Atšaukti</button>
        <button class="btn btn--error btn--sm" onclick="window.location.reload()">Atsijungti</button>
      `
    });
  });
}
