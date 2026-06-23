// ═══════════════════════════════════════════════════
// SERVER: Workspace — safe file I/O
// ═══════════════════════════════════════════════════
//
// All operations are scoped to a root directory. Path traversal is rejected
// before any fs call. File reads are capped to avoid flooding the model
// context window.

import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve, relative, extname, dirname, sep } from 'node:path';

// ── Limits ────────────────────────────────────────────
const MAX_FILE_CHARS  = 8_000;   // chars per file (truncated beyond this)
const MAX_FILES_READ  = 14;      // max files we send to the model
const MAX_TOTAL_CHARS = 50_000;  // hard ceiling across all file content
const MAX_FILES_LIST  = 500;     // max files returned by listFiles
const MAX_WALK_DEPTH  = 8;       // max directory nesting depth

// ── Allowed source extensions ────────────────────────
const READABLE_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h',
  '.json', '.yaml', '.yml', '.toml', '.md', '.txt', '.sh', '.bash',
  '.css', '.html', '.htm', '.sql', '.env',
]);

// Files readable by exact name (no extension match needed)
const READABLE_NAMES = new Set(['Makefile', 'Dockerfile', '.env.example', 'Procfile']);

// Directories that are never walked
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.data', '.claude',
  'dist', 'build', 'out', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', 'env',
  '.cache', 'coverage', '.nyc_output', '.turbo',
]);

// Root path segments that are always blocked (case-insensitive on Windows)
const BLOCKED_ROOT_PATTERNS = [
  /[/\\]\.data([/\\]|$)/i,          // our own data dir (API keys, memory)
  /[/\\]\.claude([/\\]|$)/i,        // claude session data
  /^[a-z]:[/\\]windows([/\\]|$)/i,  // C:\Windows
  /^[a-z]:[/\\]program files/i,     // C:\Program Files
  /^[/\\]{2}/,                       // UNC paths (\\server\share)
];

/**
 * Reject root paths that point to sensitive system or data directories.
 * Called before assertWorkspace so we never stat a blocked path.
 */
function assertSafeRoot(root) {
  const r = resolve(root);
  for (const pat of BLOCKED_ROOT_PATTERNS) {
    if (pat.test(r)) {
      throw new WorkspaceError('BLOCKED_ROOT',
        `Root path is not allowed: ${r}`);
    }
  }
  // Must be an absolute path with at least 2 path components (no bare drive roots like C:\)
  const parts = r.replace(/\\/g, '/').replace(/\/$/, '').split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new WorkspaceError('BLOCKED_ROOT', `Root too shallow (must be a subdirectory): ${r}`);
  }
}

// ── Error ─────────────────────────────────────────────
export class WorkspaceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

// ── Internal helpers ─────────────────────────────────

/**
 * Resolve `childPath` relative to `root` and assert it stays inside.
 * Throws WorkspaceError if the resolved path escapes the root.
 */
function safePath(root, childPath) {
  const r = resolve(root);
  const t = resolve(join(r, childPath));
  if (t !== r && !t.startsWith(r + sep)) {
    throw new WorkspaceError('PATH_TRAVERSAL',
      `Refusing path outside workspace: ${childPath}`);
  }
  return t;
}

function isReadable(name) {
  return READABLE_EXTS.has(extname(name).toLowerCase()) || READABLE_NAMES.has(name);
}

// ── Public API ────────────────────────────────────────

/**
 * Verify the workspace root exists and is a directory.
 * @throws WorkspaceError('NOT_FOUND') if missing
 */
export async function assertWorkspace(root) {
  assertSafeRoot(root);
  try {
    const s = await stat(resolve(root));
    if (!s.isDirectory()) throw new WorkspaceError('NOT_DIR', `${root} is not a directory`);
  } catch (err) {
    if (err instanceof WorkspaceError) throw err;
    throw new WorkspaceError('NOT_FOUND', `Workspace not found: ${root}`);
  }
}

/**
 * Recursively list all source files under root, skipping noise dirs.
 * Returns paths relative to root, sorted.
 * @returns {Promise<string[]>}
 */
export async function listFiles(root) {
  assertSafeRoot(root);
  const r = resolve(root);
  const results = [];

  async function walk(dir, depth = 0) {
    if (results.length >= MAX_FILES_LIST) return;
    if (depth > MAX_WALK_DEPTH) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }

    for (const e of entries) {
      if (results.length >= MAX_FILES_LIST) break;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name), depth + 1);
      } else if (e.isFile() && isReadable(e.name)) {
        results.push(relative(r, join(dir, e.name)).replace(/\\/g, '/'));
      }
    }
  }

  await walk(r);
  return results.sort();
}

/**
 * Read up to MAX_FILES_READ files from the workspace, truncating each to
 * MAX_FILE_CHARS and stopping when MAX_TOTAL_CHARS is reached.
 * @param {string} root
 * @param {string[]} filePaths - relative paths (from listFiles)
 * @returns {Promise<Record<string, string>>} path → content
 */
export async function readFiles(root, filePaths) {
  assertSafeRoot(root);
  const r = resolve(root);
  const out = {};
  let total = 0;

  const selectedPaths = filePaths.slice(0, MAX_FILES_READ);
  const withStats = [];
  for (let i = 0; i < selectedPaths.length; i++) {
    const p = selectedPaths[i];
    try {
      const s = await stat(safePath(r, p));
      withStats.push({ p, size: s.size, originalIndex: i });
    } catch { /* skip un-statable */ }
  }

  // Sort by size ascending so small files consume quota first, large files are kept at the end
  withStats.sort((a, b) => a.size - b.size || a.originalIndex - b.originalIndex);

  for (const { p } of withStats) {
    if (total >= MAX_TOTAL_CHARS) break;
    try {
      const abs = safePath(r, p);
      let content = await readFile(abs, 'utf8');
      if (content.length > MAX_FILE_CHARS) {
        content = content.slice(0, MAX_FILE_CHARS) +
          `\n...[truncated — ${content.length - MAX_FILE_CHARS} more chars]`;
      }
      out[p] = content;
      total += content.length;
    } catch { /* unreadable — skip silently */ }
  }
  return out;
}

/**
 * Write a batch of files to the workspace. Each item:
 *   { path: string, content: string }      — write / overwrite
 *   { path: string, action: 'delete' }     — noted but NOT deleted (safety)
 *
 * Returns a summary of what was written.
 * @param {string} root
 * @param {Array<{path:string, content?:string, action?:string}>} files
 * @returns {Promise<Array<{path:string, action:string}>>}
 */
export async function writeFiles(root, files) {
  assertSafeRoot(root);
  const r = resolve(root);
  const summary = [];

  for (const f of files) {
    if (!f || typeof f.path !== 'string' || !f.path.trim()) continue;

    if (f.action === 'delete') {
      // We do NOT delete files automatically — flag for user review.
      summary.push({ path: f.path, action: 'delete_skipped_manual_review_required' });
      continue;
    }

    if (typeof f.content !== 'string') continue;

    try {
      const abs = safePath(r, f.path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, f.content, 'utf8');
      summary.push({ path: f.path, action: 'written' });
    } catch (err) {
      summary.push({ path: f.path, action: 'error', error: err.message });
    }
  }

  return summary;
}

// Priority tiers for buildContext file selection (lower number = higher priority).
// Files not listed here fall into tier 4 and are sorted by depth then name.
const _PRIORITY_NAMES = new Map([
  // Tier 0 — project manifests (always include these first)
  ['package.json', 0], ['pyproject.toml', 0], ['cargo.toml', 0], ['go.mod', 0],
  ['composer.json', 0], ['pom.xml', 0], ['build.gradle', 0], ['gemfile', 0],
  // Tier 1 — human-readable project overview
  ['readme.md', 1], ['readme.txt', 1], ['readme', 1],
  // Tier 2 — common entry points
  ['index.js', 2], ['index.ts', 2], ['index.mjs', 2],
  ['main.js', 2], ['main.ts', 2], ['main.py', 2], ['main.go', 2], ['main.rs', 2],
  ['app.js', 2], ['app.ts', 2], ['app.py', 2],
  ['server.js', 2], ['server.ts', 2],
  ['__init__.py', 2],
  // Tier 3 — build / test config
  ['tsconfig.json', 3], ['jsconfig.json', 3],
  ['vite.config.js', 3], ['vite.config.ts', 3],
  ['webpack.config.js', 3], ['rollup.config.js', 3],
  ['jest.config.js', 3], ['jest.config.ts', 3], ['vitest.config.ts', 3],
  ['.env.example', 3], ['dockerfile', 3], ['makefile', 3],
]);

/**
 * Return a [tier, depth, path] sort key for a workspace-relative path.
 * Lower values sort first so the most contextually useful files are picked
 * when MAX_FILES_READ forces truncation.
 */
function _filePriority(relPath) {
  const depth = relPath.split('/').length - 1; // 0 = root level
  const name = relPath.split('/').at(-1).toLowerCase();
  const tier = _PRIORITY_NAMES.get(name) ?? 4;
  return [tier, depth, relPath];
}

/**
 * Build a compact text snapshot of the workspace suitable for an LLM prompt.
 * Includes the file listing and the content of up to MAX_FILES_READ files.
 * Files are selected by priority (manifests → entry points → config → depth)
 * so the most contextually useful files survive truncation.
 */
export async function buildContext(root) {
  const files = await listFiles(root);

  // Stable-sort by (tier, depth, path) so important files are always included
  // even when the full file list exceeds MAX_FILES_READ.
  const prioritized = [...files].sort((a, b) => {
    const [ta, da, pa] = _filePriority(a);
    const [tb, db, pb] = _filePriority(b);
    return ta - tb || da - db || pa.localeCompare(pb);
  });

  const contents = await readFiles(root, prioritized);

  const listing = files.length
    ? `Files in workspace (${files.length} total):\n${files.map((f) => `  ${f}`).join('\n')}`
    : 'Workspace appears empty.';

  const bodies = Object.entries(contents)
    .map(([p, c]) => `=== ${p} ===\n${c}`)
    .join('\n\n');

  return {
    listing,
    bodies,
    fileCount: files.length,
    filesRead: Object.keys(contents),
    text: `${listing}\n\n${bodies}`.trim(),
  };
}
