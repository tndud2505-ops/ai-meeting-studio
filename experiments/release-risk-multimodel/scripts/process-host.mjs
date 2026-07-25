import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isSafeRunId, parseArgs, terminateProcessTree } from './lib.mjs';

const cli = parseArgs(process.argv.slice(2));
const runId = String(cli['run-id'] ?? '');
const callId = String(cli['call-id'] ?? '');
if (!isSafeRunId(runId) || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,159}$/.test(callId)) {
  console.error('invalid managed process identity');
  process.exit(64);
}

const spec = JSON.parse(await readFile(String(cli.spec), 'utf8'));
if (!spec || typeof spec.command !== 'string' || !Array.isArray(spec.args) || typeof spec.cwd !== 'string') {
  console.error('invalid managed process spec');
  process.exit(64);
}

function cmdQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+,-]+$/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

let file = spec.command;
let args = [...spec.args];
if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
  args = ['/d', '/s', '/c', [file, ...args].map(cmdQuote).join(' ')];
  file = process.env.ComSpec || 'cmd.exe';
}

const child = spawn(file, args, {
  cwd: spec.cwd,
  env: process.env,
  windowsHide: true,
  shell: false,
  stdio: ['pipe', 'pipe', 'pipe'],
});
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  await terminateProcessTree(child.pid);
  process.exitCode = signal === 'SIGINT' ? 130 : 143;
}
process.on('SIGINT', () => { void stop('SIGINT'); });
process.on('SIGTERM', () => { void stop('SIGTERM'); });
child.on('error', error => {
  console.error(`managed child spawn failed: ${error.code ?? error.name}`);
  process.exitCode = 70;
});
child.on('close', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});

