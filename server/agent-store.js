// ═══════════════════════════════════════════════════
// SERVER: Custom Agent Store (file-backed)
// ═══════════════════════════════════════════════════
//
// Stores user-created agents in .data/agents.json.
// Built-in registry profiles (Hermes Supervisor, Judge, workers) are read-only
// and come from agent-registry.js — this store only manages custom ones.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DATA_DIR } from './paths.js';
import { join } from 'node:path';

const AGENTS_FILE = join(DATA_DIR, 'agents.json');
let cache = null;

async function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(AGENTS_FILE, 'utf8'));
    if (!Array.isArray(cache)) cache = [];
  } catch {
    cache = [];
  }
  return cache;
}

async function flush() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(AGENTS_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

/** List all custom agents. */
export async function listCustom() {
  return [...(await load())];
}

/** Create a new custom agent. Returns the saved record. */
export async function createAgent({ name, type, description, capabilities, icon, engine, temperature }) {
  const agents = await load();
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  const agent = {
    id,
    name: String(name || 'Unnamed').slice(0, 80),
    role: 'worker',
    type: type || 'coding',
    icon: icon || { coding: '💻', trading: '◇', creation: '✦' }[type] || '🤖',
    engine: engine || 'glm',
    temperature: Number.isFinite(temperature) ? temperature : 0.7,
    capabilities: Array.isArray(capabilities) ? capabilities : ['Custom'],
    description: String(description || '').slice(0, 300),
    status: 'idle',
    custom: true,
    createdAt: Date.now(),
  };
  agents.push(agent);
  cache = agents;
  await flush();
  return agent;
}

/** Update fields on an existing custom agent. Returns updated record or null. */
export async function updateAgent(id, patch) {
  const agents = await load();
  const idx = agents.findIndex(a => a.id === id);
  if (idx === -1) return null;
  const ALLOWED = ['name', 'description', 'capabilities', 'icon', 'engine', 'temperature', 'status', 'type'];
  for (const key of ALLOWED) {
    if (key in patch) agents[idx][key] = patch[key];
  }
  agents[idx].updatedAt = Date.now();
  cache = agents;
  await flush();
  return agents[idx];
}

/** Delete a custom agent by id. Returns true if removed. */
export async function deleteAgent(id) {
  const agents = await load();
  const before = agents.length;
  cache = agents.filter(a => a.id !== id);
  if (cache.length === before) return false;
  await flush();
  return true;
}
