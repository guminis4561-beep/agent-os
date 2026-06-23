// ═══════════════════════════════════════════════════
// COMPONENT: Toast Notifications
// ═══════════════════════════════════════════════════

const TOAST_ICONS = {
  success: '✓',
  warning: '⚠',
  error: '✕',
  info: 'ℹ',
};

const TOAST_DURATION = 4000;

/**
 * Show a toast notification
 * @param {string} message - Toast message
 * @param {'success'|'warning'|'error'|'info'} type - Toast type
 */
export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <span class="toast__icon">${TOAST_ICONS[type]}</span>
    <span class="toast__message">${message}</span>
    <button class="toast__close">✕</button>
  `;

  container.appendChild(toast);

  // Close button
  toast.querySelector('.toast__close').addEventListener('click', () => {
    removeToast(toast);
  });

  // Differentiate dismiss timing
  let duration = 4000;
  if (type === 'error') duration = 8000;
  if (type === 'warning') duration = 6000;

  setTimeout(() => removeToast(toast), duration);
}

function removeToast(toast) {
  toast.classList.add('removing');
  setTimeout(() => toast.remove(), 300);
}

export default { showToast };
