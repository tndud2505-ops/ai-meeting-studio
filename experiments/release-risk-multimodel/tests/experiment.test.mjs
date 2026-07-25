import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertScorableRun } from '../scripts/eligibility.mjs';
import { expDir, listFiles, readJson, sha256, terminateProcessTree, writeJson } from '../scripts/lib.mjs';
import { requestStop, spawnManagedCapture } from '../scripts/managed-process.mjs';
import { assertSharedMergeProtocol, SHARED_MERGE_PIPELINE_ID } from '../scripts/protocol.mjs';

const fixture = fileURLToPath(new URL('./fixtures/process-tree-fixture.mjs', import.meta.url));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(file, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { await stat(file); return; } catch { await wait(50); }
  }
  throw new Error(`Timed out waiting for ${file}`);
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('locked preregistration and amendments match SHA-256 records', async () => {
  for (const [source, lock] of [
    ['preregistration.yaml', 'preregistration.lock.json'],
    ['amendments/amendment-001.yaml', 'amendments/amendment-001.lock.json'],
    ['amendments/amendment-002.yaml', 'amendments/amendment-002.lock.json'],
  ]) {
    const actual = sha256(await readFile(path.join(expDir, source)));
    assert.equal(actual, (await readJson(path.join(expDir, lock))).sha256, source);
  }
});

test('six calibration variants retain three confirmed defects and three safe controls', async () => {
  const summary = await readJson(path.join(expDir, 'cases', 'private', 'verification-summary.json'));
  assert.equal(summary.all_confirmed, true);
  assert.equal(summary.count, 6);
  assert.equal(summary.defect_reproductions, 3);
  assert.equal(summary.safe_controls, 3);
  assert.equal(summary.results.every(result => result.confirmed), true);
});

test('public cases contain no hidden labels, answers, private paths, or fix commits', async () => {
  const publicRoot = path.join(expDir, 'cases', 'public');
  const privateRoot = path.join(expDir, 'cases', 'private');
  const files = (await listFiles(publicRoot)).filter(file => !file.endsWith('.json') || true);
  const text = (await Promise.all(files.map(file => readFile(file, 'utf8')))).join('\n');
  assert.doesNotMatch(text, /cases[/\\]private|ground-truth|case-map|private-reproducer|expected_release_decision|known_sev01_risks|"pair_id"\s*:|"variant"\s*:|GT-[A-Z-]+-\d+/i);
  const map = await readJson(path.join(privateRoot, 'case-map.json'));
  for (const caseId of Object.keys(map.cases)) {
    const truth = await readJson(path.join(privateRoot, caseId, 'ground-truth.json'));
    if (truth.source.confirming_fix_commit) assert.equal(text.includes(truth.source.confirming_fix_commit), false);
    for (const risk of truth.known_sev01_risks) assert.equal(text.includes(risk.mechanism), false);
  }
});

test('every public bundle and private public-hash reference is intact', async () => {
  const publicRoot = path.join(expDir, 'cases', 'public');
  const map = await readJson(path.join(expDir, 'cases', 'private', 'case-map.json'));
  for (const [caseId, privateEntry] of Object.entries(map.cases)) {
    const caseDir = path.join(publicRoot, caseId);
    const manifest = await readJson(path.join(caseDir, 'bundle-manifest.json'));
    for (const entry of manifest.files) assert.equal(sha256(await readFile(path.join(caseDir, ...entry.path.split('/')))), entry.sha256, `${caseId}/${entry.path}`);
    const bundleHash = sha256(manifest.files.map(entry => `${entry.path}\0${entry.sha256}`).join('\n'));
    assert.equal(bundleHash, manifest.bundle_sha256);
    assert.equal(bundleHash, privateEntry.public_bundle_sha256);
  }
});

test('legacy smoke runs are permanently non-scorable and non-reusable', async () => {
  const exclusions = await readJson(path.join(expDir, 'runs', 'exclusions.json'));
  for (const runId of ['smoke-2026-07-22T12-16-08-086Z-45949776', 'smoke-compat-20260722-v2']) {
    const entry = exclusions.runs[runId];
    const eligibility = await readJson(path.join(expDir, 'runs', runId, 'eligibility.json'));
    assert.equal(entry.scorable, false);
    assert.equal(entry.permanent_exclusion, true);
    assert.equal(entry.may_reuse_outputs, false);
    assert.equal(eligibility.scorable, false);
    assert.equal(eligibility.permanent_exclusion, true);
  }
});

test('invalid or incomplete runs cannot enter scoring', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rrm-invalid-'));
  try {
    await writeJson(path.join(dir, 'eligibility.json'), { schema_version: 1, scorable: false, reason_codes: ['manually_stopped'] });
    await writeJson(path.join(dir, 'summary.json'), { schema_version: 1, complete: true, results: [] });
    await assert.rejects(() => assertScorableRun(dir), /not scorable/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('groups B and C use one identical fixed merge-verification pipeline', async () => {
  const pipeline = await assertSharedMergeProtocol();
  assert.equal(pipeline.engine, 'codex');
  assert.equal(SHARED_MERGE_PIPELINE_ID, 'fixed-codex-merge-verify-v1');
});

test('timeout kills the managed Windows process tree', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rrm-timeout-'));
  const runId = 'timeout-tree-test';
  const runDir = path.join(root, runId);
  const callDir = path.join(runDir, 'call');
  const pidFile = path.join(runDir, 'fixture-pids.json');
  await writeJson(path.join(runDir, 'run-manifest.json'), { schema_version: 1, run_id: runId });
  try {
    const result = await spawnManagedCapture(process.execPath, [fixture, '--pid-file', pidFile], { runId, callId: 'timeout-call', runDir, callDir, cwd: runDir, timeoutMs: 1200 });
    assert.equal(result.timedOut, true);
    const pids = await readJson(pidFile);
    await wait(300);
    assert.equal(alive(pids.fixture_pid), false);
    assert.equal(alive(pids.descendant_pid), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('exact run-id stop kills only the confirmed managed process tree', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rrm-stop-'));
  const runId = 'exact-stop-test';
  const runDir = path.join(root, runId);
  const callDir = path.join(runDir, 'call');
  const pidFile = path.join(runDir, 'fixture-pids.json');
  await writeJson(path.join(runDir, 'run-manifest.json'), { schema_version: 1, run_id: runId });
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  try {
    const running = spawnManagedCapture(process.execPath, [fixture, '--pid-file', pidFile], { runId, callId: 'stop-call', runDir, callDir, cwd: runDir, timeoutMs: 15000 });
    await waitFor(pidFile);
    await waitFor(path.join(runDir, 'processes.json'));
    const stopped = await requestStop({ runsRoot: root, runId });
    assert.equal(stopped.confirmed.length, 1);
    assert.equal(stopped.killed.length, 1);
    await running;
    const pids = await readJson(pidFile);
    await wait(300);
    assert.equal(alive(pids.fixture_pid), false);
    assert.equal(alive(pids.descendant_pid), false);
    assert.equal(alive(unrelated.pid), true);
  } finally {
    await terminateProcessTree(unrelated.pid);
    await rm(root, { recursive: true, force: true });
  }
});

