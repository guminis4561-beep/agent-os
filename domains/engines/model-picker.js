// ═══════════════════════════════════════════════════
// DOMAIN: Shared per-task model picker
// ═══════════════════════════════════════════════════
//
// One small helper reused by every engine view (coding / trading / creation) so
// the per-task model dropdown stays consistent and DRY. The chosen model id is
// persisted in Storage and threaded into POST /api/task as `modelId`, where the
// orchestrator applies it across PLANNING / EXECUTING / VALIDATING.
//
// An empty selection ("") means "use each agent's own model" — the historical
// behaviour — so the picker is purely additive.

import * as Api from '../../core/api-client.js';
import Storage from '../../core/storage.js';

const STORAGE_KEY = 'selectedTaskModel';
let _modelsCache = null; // string[] of model ids (loaded once per session)

/**
 * Fetch the selectable model list and cache it. Never throws.
 * Only a SUCCESSFUL fetch is cached — a failure leaves the cache null so the
 * next mount retries (an empty array is truthy, so caching it on error would
 * permanently wedge the picker at "no models").
 */
export async function loadModels() {
  if (Array.isArray(_modelsCache)) return _modelsCache;
  try {
    const res = await Api.getModels();
    _modelsCache = Array.isArray(res.models) ? res.models : [];
    return _modelsCache;
  } catch {
    return []; // cache stays null → retried on the next call
  }
}

/** Drop the cached list so the next loadModels() re-fetches (e.g. catalogue edited). */
export function invalidateModelsCache() {
  _modelsCache = null;
}

/** The currently selected model id, or '' for "use the agent's own model". */
export function getSelectedModel() {
  return Storage.get(STORAGE_KEY) || '';
}

export function setSelectedModel(id) {
  Storage.set(STORAGE_KEY, id || '');
}

/**
 * Initial markup for the picker. The options are filled in by mountModelPicker()
 * once the model list resolves; until then only the default option is shown.
 */
export function modelSelectHtml(selectId, { compact = true } = {}) {
  const pad = compact ? '2px var(--space-2)' : 'var(--space-2)';
  const fs = compact ? '11px' : 'var(--text-sm)';
  return `<select id="${selectId}" title="Modelis šiai užduočiai"
    style="padding:${pad};background:var(--bg-card);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);font-size:${fs};max-width:200px;">
    <option value="">Numatytasis modelis</option>
  </select>`;
}

/**
 * Populate an already-rendered <select> with the model list and wire change →
 * persistence. Safe to call after every re-render (it re-reads the saved value).
 */
export async function mountModelPicker(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const models = await loadModels();
  const current = getSelectedModel();

  sel.innerHTML = ['<option value="">Numatytasis modelis</option>']
    .concat(models.map((m) =>
      `<option value="${m}" ${m === current ? 'selected' : ''}>${m}</option>`))
    .join('');
  sel.value = current; // ensure selection sticks even if not in list

  sel.addEventListener('change', () => setSelectedModel(sel.value));
}
