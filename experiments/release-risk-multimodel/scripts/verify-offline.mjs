import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { expDir, repoDir, spawnCapture, writeJson, writeText } from './lib.mjs';

const generatedDir = path.join(expDir, 'analysis', 'generated');
const logDir = path.join(generatedDir, 'offline-tests');
const root = await spawnCapture('npm.cmd', ['test'], { cwd: repoDir, timeoutMs: 900000 });
await writeText(path.join(logDir, 'roundtable-tests.stdout.txt'), root.stdout);
await writeText(path.join(logDir, 'roundtable-tests.stderr.txt'), root.stderr);

const testDir = path.join(expDir, 'tests');
const testFiles = (await readdir(testDir)).filter(name => name.endsWith('.test.mjs')).sort().map(name => path.join(testDir, name));
const experiment = await spawnCapture(process.execPath, ['--test', ...testFiles], { cwd: repoDir, timeoutMs: 900000 });
await writeText(path.join(logDir, 'experiment-tests.stdout.txt'), experiment.stdout);
await writeText(path.join(logDir, 'experiment-tests.stderr.txt'), experiment.stderr);

const count = text => Number(text.match(/^(?:#|ℹ) tests (\d+)$/m)?.[1] ?? 0);
const mechanisms = {
  timeout_tree_kill: experiment.stdout.includes('timeout kills the managed Windows process tree'),
  exact_run_stop_tree_kill: experiment.stdout.includes('exact run-id stop kills only the confirmed managed process tree'),
};
const report = {
  schema_version: 1,
  verified_at: new Date().toISOString(),
  all_passed: root.ok && experiment.ok && Object.values(mechanisms).every(Boolean),
  roundtable: { ok: root.ok, tests: count(root.stdout), exit_code: root.exitCode, elapsed_ms: root.elapsedMs },
  experiment: { ok: experiment.ok, tests: count(experiment.stdout), exit_code: experiment.exitCode, elapsed_ms: experiment.elapsedMs },
  mechanisms,
  logs: { directory: path.relative(expDir, logDir).replaceAll('\\', '/') },
};
await writeJson(path.join(generatedDir, 'offline-tests.json'), report);
console.log(`OFFLINE_TESTS ${report.all_passed ? 'PASS' : 'FAIL'} root=${report.roundtable.tests} experiment=${report.experiment.tests}`);
if (!report.all_passed) process.exitCode = 2;
