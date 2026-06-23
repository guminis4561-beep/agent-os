// ═══════════════════════════════════════════════════
// SERVER: Shared filesystem paths
// ═══════════════════════════════════════════════════

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Project root (one level above /server) — also the web root for the static client.
export const PUBLIC_ROOT = resolve(__dirname, '..');

// All server-owned state (API keys, memory) lives here, never under the web root's
// served files. The HTTP layer additionally blocks any request to /.data.
export const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(PUBLIC_ROOT, '.data');

export const CONFIG_FILE = resolve(DATA_DIR, 'config.json');
export const MEMORY_FILE = resolve(DATA_DIR, 'memory.json');
