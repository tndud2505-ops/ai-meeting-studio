import path from 'node:path';
import { expDir, readJson, spawnCapture, writeJson } from './lib.mjs';

const cfg = await readJson(path.join(expDir, 'config', 'models.json'));
const report = { schema_version: 1, probed_at: new Date().toISOString(), engines: {} };

for (const [id, command, args] of [
  ['codex', cfg.codex.command, ['--version']],
  ['claude', cfg.claude.command, ['--version']],
]) {
  const result = await spawnCapture(command, args, { cwd: expDir, timeoutMs: 30000 });
  report.engines[id] = { available: result.ok, error_type: result.error, version_output: (result.stdout || result.stderr).trim().split(/\r?\n/)[0] || null, elapsed_ms: result.elapsedMs };
}

report.telemetry = {
  codex: ['JSONL event types', 'input tokens', 'cached input tokens', 'output tokens', 'reasoning output tokens', 'tool-call events', 'wall clock'],
  claude: ['model id', 'input/cache/output tokens', 'estimated USD', 'server tool use', 'turn count', 'wall clock'],
  unavailable_comparable_field: 'Codex per-run dollar cost',
};
report.secret_handling = 'No environment variable values, auth files, cookies, or tokens were read by this script.';

await writeJson(path.join(expDir, 'analysis', 'generated', 'cli-probe.json'), report);
console.log(JSON.stringify(report, null, 2));

