// ═══════════════════════════════════════════════════
// SERVER: Test Runner
// ═══════════════════════════════════════════════════
//
// Detects the project's test setup, runs tests in the workspace directory,
// and returns stdout/stderr. Supported: npm test, pytest.
// The command is NEVER taken from LLM output — only from the project's own
// package.json / config files.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

const TEST_TIMEOUT_MS  = 60_000;   // 60 s hard ceiling
const MAX_OUTPUT_CHARS = 10_000;   // trim to last N chars so LLM doesn't choke

// ── Detection helpers ─────────────────────────────────

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function detectNpm(root) {
  const pkgPath = join(root, 'package.json');
  if (!await fileExists(pkgPath)) return null;
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    const script = pkg.scripts?.test || '';
    // Ignore placeholder scripts that would exit 1 with no tests
    if (!script || script.startsWith('echo') || script.includes('no test specified')) return null;
    return { runner: 'npm', cmd: 'npm', args: ['test'] };
  } catch { return null; }
}

async function detectPytest(root) {
  if (await fileExists(join(root, 'pytest.ini'))) {
    return { runner: 'pytest', cmd: 'python', args: ['-m', 'pytest', '--tb=short', '-q'] };
  }
  if (await fileExists(join(root, 'setup.cfg'))) {
    const cfg = await readFile(join(root, 'setup.cfg'), 'utf8').catch(() => '');
    if (cfg.includes('[tool:pytest]')) {
      return { runner: 'pytest', cmd: 'python', args: ['-m', 'pytest', '--tb=short', '-q'] };
    }
  }
  if (await fileExists(join(root, 'pyproject.toml'))) {
    const cfg = await readFile(join(root, 'pyproject.toml'), 'utf8').catch(() => '');
    if (cfg.includes('[tool.pytest')) {
      return { runner: 'pytest', cmd: 'python', args: ['-m', 'pytest', '--tb=short', '-q'] };
    }
  }
  return null;
}

/**
 * Detect which test runner a workspace uses.
 * @returns {{ runner: string, cmd: string, args: string[] } | null}
 */
export async function detectRunner(root) {
  return (await detectNpm(root)) ?? (await detectPytest(root)) ?? null;
}

// ── Runner ────────────────────────────────────────────

/**
 * Run tests in `root`. Returns a structured result.
 *
 * @param {string} root - Absolute path to workspace
 * @returns {Promise<{
 *   ran: boolean,
 *   runner: string|null,
 *   passed: boolean,
 *   exitCode: number|null,
 *   output: string,
 *   timedOut: boolean,
 * }>}
 */
export async function runTests(root) {
  const r = resolve(root);
  const detected = await detectRunner(r);

  if (!detected) {
    return {
      ran: false,
      runner: null,
      passed: null,
      exitCode: null,
      output: 'No test runner detected. Add a "test" script to package.json or a pytest config to enable automatic testing.',
      timedOut: false,
    };
  }

  const { runner, cmd, args } = detected;

  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: r,
      timeout: TEST_TIMEOUT_MS,
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
      maxBuffer: 4 * 1024 * 1024,
      // shell:true resolves .cmd/.bat wrappers on Windows (npm, pytest scripts, etc.)
      shell: true,
    });
    const raw = (stdout + '\n' + stderr).trim();
    const output = raw.length > MAX_OUTPUT_CHARS
      ? '...[truncated]\n' + raw.slice(-MAX_OUTPUT_CHARS)
      : raw;

    return { ran: true, runner, passed: true, exitCode: 0, output, timedOut: false };
  } catch (err) {
    const timedOut = err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT';
    const raw = ((err.stdout || '') + '\n' + (err.stderr || '')).trim();
    const output = raw.length > MAX_OUTPUT_CHARS
      ? '...[truncated]\n' + raw.slice(-MAX_OUTPUT_CHARS)
      : raw;

    return {
      ran: true,
      runner,
      passed: false,
      exitCode: err.code ?? null,
      output: timedOut ? `Tests timed out after ${TEST_TIMEOUT_MS / 1000}s.\n${output}` : output,
      timedOut,
    };
  }
}
