import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export const expDir = path.resolve(scriptsDir, '..');
export const repoDir = path.resolve(expDir, '..', '..');

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  const temp = file + '.tmp-' + process.pid;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temp, file);
}

export async function writeText(file, value) {
  await ensureDir(path.dirname(file));
  const temp = file + '.tmp-' + process.pid;
  await writeFile(temp, String(value), 'utf8');
  await rename(temp, file);
}

export async function listFiles(root) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  await walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

export async function serializePublicCase(caseDir) {
  const files = (await listFiles(caseDir)).filter(file => path.basename(file) !== 'bundle-manifest.json');
  const chunks = [];
  for (const file of files) {
    const rel = path.relative(caseDir, file).replaceAll('\\', '/');
    const body = await readFile(file, 'utf8');
    chunks.push(`\n===== FILE: ${rel} =====\n${body.trimEnd()}\n`);
  }
  return chunks.join('');
}

function cmdQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+,-]+$/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function spawnCapture(command, args, options = {}) {
  const startedAt = new Date();
  const started = performance.now();
  const timeoutMs = options.timeoutMs ?? 240000;
  return new Promise(resolve => {
    let file = command;
    let argv = [...args];
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
      file = process.env.ComSpec || 'cmd.exe';
      argv = ['/d', '/s', '/c', [command, ...args].map(cmdQuote).join(' ')];
    }
    let child;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      try { options.onClose?.(result); } catch { /* diagnostics must not hide the process result */ }
      resolve(result);
    };
    try {
      child = spawn(file, argv, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish({ ok: false, error: 'spawn:' + (error.code ?? error.name), exitCode: null, stdout, stderr, elapsedMs: Math.round(performance.now() - started), startedAt: startedAt.toISOString(), endedAt: new Date().toISOString(), timedOut });
      return;
    }
    try { options.onSpawn?.(child); } catch { /* capture remains authoritative */ }
    const timer = setTimeout(() => {
      timedOut = true;
      if (options.killTreeOnTimeout === false) {
        try { child.kill(); } catch { /* already gone */ }
      } else {
        void terminateProcessTree(child.pid).finally(() => {
          try { child.kill(); } catch { /* already gone */ }
        });
      }
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; options.onStdout?.(chunk); });
    child.stderr.on('data', chunk => { stderr += chunk; options.onStderr?.(chunk); });
    child.on('error', error => {
      clearTimeout(timer);
      finish({ ok: false, error: 'spawn:' + (error.code ?? error.name), exitCode: null, stdout, stderr, elapsedMs: Math.round(performance.now() - started), startedAt: startedAt.toISOString(), endedAt: new Date().toISOString(), timedOut });
    });
    child.on('close', exitCode => {
      clearTimeout(timer);
      finish({ ok: exitCode === 0 && !timedOut, error: timedOut ? 'timeout' : (exitCode === 0 ? null : 'exit'), exitCode, stdout, stderr, elapsedMs: Math.round(performance.now() - started), startedAt: startedAt.toISOString(), endedAt: new Date().toISOString(), timedOut });
    });
    if (options.input != null) child.stdin.end(String(options.input));
    else child.stdin.end();
  });
}

export function isSafeRunId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/.test(String(value ?? ''));
}

export async function terminateProcessTree(pid) {
  const numericPid = Number(pid);
  if (!Number.isSafeInteger(numericPid) || numericPid <= 0 || numericPid === process.pid) {
    return { ok: false, error: 'invalid_pid' };
  }
  if (process.platform === 'win32') {
    const result = await spawnCapture('taskkill.exe', ['/PID', String(numericPid), '/T', '/F'], { timeoutMs: 15000, killTreeOnTimeout: false });
    const alreadyGone = /not found|no running instance|not exist/i.test(`${result.stdout}\n${result.stderr}`);
    return { ok: result.ok || alreadyGone, error: result.ok || alreadyGone ? null : result.error, exitCode: result.exitCode };
  }
  try {
    process.kill(-numericPid, 'SIGTERM');
    return { ok: true, error: null };
  } catch {
    try {
      process.kill(numericPid, 'SIGTERM');
      return { ok: true, error: null };
    } catch (error) {
      return { ok: error?.code === 'ESRCH', error: error?.code === 'ESRCH' ? null : (error?.code ?? error?.name) };
    }
  }
}

export function seededRandom(seedText) {
  let state = Number.parseInt(sha256(seedText).slice(0, 8), 16) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(values, seedText) {
  const out = [...values];
  const random = seededRandom(seedText);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [rawKey, inline] = token.slice(2).split('=', 2);
    if (inline != null) out[rawKey] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[rawKey] = argv[++i];
    else out[rawKey] = true;
  }
  return out;
}

export async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

export function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows, headers) {
  return [headers.join(','), ...rows.map(row => headers.map(header => csvCell(row[header])).join(','))].join('\n') + '\n';
}
