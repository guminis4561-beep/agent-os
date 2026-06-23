// ═══════════════════════════════════════════════════
// SERVER: Memory Fabric (durable 4-layer store)
// ═══════════════════════════════════════════════════
//
// File-backed persistence for the PERSISTING state. Four scopes mirror the UI's
// memory layers: identity (who the user is), global (cross-workspace knowledge),
// workspace (project-scoped), session (ephemeral run context).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DATA_DIR, MEMORY_FILE } from './paths.js';

const LAYERS = ['identity', 'global', 'workspace', 'session'];

let cache = null;
let writeChain = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    const raw = await readFile(MEMORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = normalize(parsed);
  } catch {
    cache = normalize({});
  }
  return cache;
}

function normalize(obj) {
  const out = {};
  for (const layer of LAYERS) out[layer] = Array.isArray(obj?.[layer]) ? obj[layer] : [];
  return out;
}

// Serialize writes so concurrent persists can't clobber the file.
function flush() {
  writeChain = writeChain.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(MEMORY_FILE, JSON.stringify(cache, null, 2), 'utf8');
  }).catch((e) => console.error('[Memory] flush failed:', e.message));
  return writeChain;
}

/**
 * Persist a result into a memory layer. Returns the created record id.
 * @param {Object} opts
 * @param {string} [opts.layer='workspace']
 * @param {string} opts.key
 * @param {*} opts.value
 * @param {string} [opts.workspaceId]
 * @param {Object} [opts.meta]
 */
export function persist({ layer = 'workspace', key, value, workspaceId = null, meta = {} }) {
  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  
  writeChain = writeChain.then(async () => {
    const store = await load();
    if (!LAYERS.includes(layer)) layer = 'workspace';
    store[layer].push({ id, key, value, workspaceId, meta, ts: Date.now() });
    // Keep each layer bounded so the file stays small.
    if (store[layer].length > 500) store[layer] = store[layer].slice(-500);
    
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(MEMORY_FILE, JSON.stringify(store, null, 2), 'utf8');
  }).catch((e) => console.error('[Memory] persist failed:', e.message));

  return writeChain.then(() => id);
}

/** Read back records from a layer, newest first. */
export async function query({ layer = 'workspace', workspaceId = null, limit = 50 } = {}) {
  const store = await load();
  let items = store[layer] || [];
  if (workspaceId) items = items.filter((i) => i.workspaceId === workspaceId);
  return items.slice(-limit).reverse();
}

/** Lightweight counts per layer for dashboards/status. */
export async function summary() {
  const store = await load();
  return Object.fromEntries(LAYERS.map((l) => [l, store[l].length]));
}

/**
 * Count memory items grouped by workspaceId across all layers.
 * Returns { [workspaceId]: count, __none__: count_without_wsId, __total__: total }
 */
export async function workspaceSummary() {
  const store = await load();
  const counts = { __none__: 0 };
  let total = 0;
  for (const layer of LAYERS) {
    for (const item of store[layer]) {
      total++;
      const key = item.workspaceId || '__none__';
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  counts.__total__ = total;
  return counts;
}

export { LAYERS };
