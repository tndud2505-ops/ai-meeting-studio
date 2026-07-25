import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, exists, isSafeRunId, readJson, spawnCapture, terminateProcessTree, writeJson } from './lib.mjs';

const hostScript = fileURLToPath(new URL('./process-host.mjs', import.meta.url));
const registryPath = runDir => path.join(runDir, 'processes.json');

function updateRegistrySync(runDir, runId, mutate) {
  const file = registryPath(runDir);
  let value = { schema_version: 1, run_id: runId, active: {} };
  try { value = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first process */ }
  if (value.run_id !== runId) throw new Error('process registry run-id mismatch');
  mutate(value.active);
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export async function spawnManagedCapture(command, args, options) {
  const { runId, callId, runDir, callDir } = options;
  if (!isSafeRunId(runId)) throw new Error('Invalid run id');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,159}$/.test(callId)) throw new Error('Invalid call id');
  await ensureDir(callDir);
  await ensureDir(runDir);
  const specFile = path.join(callDir, 'process-spec.json');
  await writeJson(specFile, { schema_version: 1, command, args, cwd: options.cwd });
  let wrapperPid = null;
  const result = await spawnCapture(process.execPath, [hostScript, '--run-id', runId, '--call-id', callId, '--spec', specFile], {
    cwd: options.cwd,
    input: options.input,
    timeoutMs: options.timeoutMs,
    killTreeOnTimeout: true,
    onSpawn(child) {
      wrapperPid = child.pid;
      updateRegistrySync(runDir, runId, active => {
        active[callId] = { run_id: runId, call_id: callId, pid: child.pid, started_at: new Date().toISOString(), host_script: hostScript };
      });
    },
    onClose() {
      updateRegistrySync(runDir, runId, active => { delete active[callId]; });
    },
  });
  return { ...result, wrapperPid };
}

function windowsCommandLine(pid) {
  const script = '$p=Get-CimInstance Win32_Process -Filter ("ProcessId = " + $env:RRM_PID); if($null -eq $p){exit 3}; [Console]::Out.Write($p.CommandLine)';
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, RRM_PID: String(pid) },
    });
  } catch { return null; }
}

export function managedProcessMatches(entry, runId) {
  if (!entry || entry.run_id !== runId || !Number.isSafeInteger(Number(entry.pid))) return false;
  let commandLine = null;
  if (process.platform === 'win32') commandLine = windowsCommandLine(entry.pid);
  else {
    try { commandLine = readFileSync(`/proc/${entry.pid}/cmdline`, 'utf8').replaceAll('\0', ' '); } catch { return false; }
  }
  if (!commandLine) return false;
  return commandLine.includes('process-host.mjs') && commandLine.includes(`--run-id ${runId}`) && commandLine.includes(`--call-id ${entry.call_id}`);
}

export async function requestStop({ runsRoot, runId }) {
  if (!isSafeRunId(runId)) throw new Error('Invalid run id');
  const runDir = path.resolve(runsRoot, runId);
  if (path.dirname(runDir) !== path.resolve(runsRoot)) throw new Error('Run path escapes runs root');
  const manifest = await readJson(path.join(runDir, 'run-manifest.json'));
  if (manifest.run_id !== runId) throw new Error('Manifest run-id mismatch');
  await writeJson(path.join(runDir, 'stop-request.json'), { schema_version: 1, run_id: runId, requested_at: new Date().toISOString() });
  let registry = { active: {} };
  try { registry = await readJson(registryPath(runDir)); } catch { /* no active calls */ }
  const result = { run_id: runId, requested: true, confirmed: [], killed: [], skipped: [] };
  for (const entry of Object.values(registry.active ?? {})) {
    if (!managedProcessMatches(entry, runId)) {
      result.skipped.push({ call_id: entry.call_id, pid: entry.pid, reason: 'identity_not_confirmed' });
      continue;
    }
    result.confirmed.push({ call_id: entry.call_id, pid: entry.pid });
    const killed = await terminateProcessTree(entry.pid);
    if (killed.ok) result.killed.push({ call_id: entry.call_id, pid: entry.pid });
    else result.skipped.push({ call_id: entry.call_id, pid: entry.pid, reason: killed.error ?? 'kill_failed' });
  }
  await writeJson(path.join(runDir, 'stop-result.json'), { schema_version: 1, stopped_at: new Date().toISOString(), ...result });
  return result;
}

export async function stopRequested(runDir) {
  return exists(path.join(runDir, 'stop-request.json'));
}

