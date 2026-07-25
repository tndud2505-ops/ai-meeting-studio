import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ensureDir, expDir, readJson, repoDir, spawnCapture, writeJson, writeText } from './lib.mjs';

const privateRoot = path.join(expDir, 'cases', 'private');
const mapping = await readJson(path.join(privateRoot, 'case-map.json'));
const runRoot = path.join(expDir, 'runs', '_case-verification', new Date().toISOString().replaceAll(/[:.]/g, '-'));
await ensureDir(runRoot);

const reproducers = {
  'csrf-origin': `
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from './src/server.js';

const sessionsDir = mkdtempSync(path.join(tmpdir(), 'rrm-csrf-'));
const srv = await startServer({ port: 0, agentsFile: 'test/agents.fixture.json', sessionsDir });
const status = await new Promise(resolve => {
  const req = http.request({
    host: '127.0.0.1', port: srv.port, path: '/api/config', method: 'GET',
    headers: { host: \`127.0.0.1:\${srv.port}\`, origin: 'https://evil.example' },
  }, res => { res.resume(); resolve(res.statusCode); });
  req.on('error', () => resolve(-1));
  req.end();
});
srv.close();
const safe = status === 403;
console.log(JSON.stringify({ probe: 'cross-site-origin-to-loopback', observed_status: status, expected_status: 403, safe }));
process.exit(safe ? 0 : 10);
`,
  'recoverable-delete': `
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from './src/server.js';

const sessionsDir = mkdtempSync(path.join(tmpdir(), 'rrm-delete-'));
const archiveName = '2026-01-01-release-record';
const archiveDir = path.join(sessionsDir, archiveName);
mkdirSync(archiveDir, { recursive: true });
writeFileSync(path.join(archiveDir, 'metadata.json'), JSON.stringify({ status: 'done', topic: 'release', rounds: 1 }));
writeFileSync(path.join(archiveDir, 'session.md'), 'authoritative record');
const agentsFile = path.join(sessionsDir, 'agents.json');
const mock = name => ({ name, command: [process.execPath, '-e', 'console.log(\"ok\")'], input: 'stdin', output: 'text', timeoutMs: 5000, envWhitelist: ['PATH', 'SYSTEMROOT'], cwd: process.cwd(), roles: ['debater', 'judge', 'summarizer'] });
writeFileSync(agentsFile, JSON.stringify({ mockA: mock('Mock A'), mockB: mock('Mock B') }));
const srv = await startServer({ port: 0, agentsFile, sessionsDir });
const response = await fetch(\`http://127.0.0.1:\${srv.port}/api/archive/\${encodeURIComponent(archiveName)}\`, { method: 'DELETE' });
const body = await response.json();
srv.close();
const trashDir = path.join(sessionsDir, '.trash');
const recycled = existsSync(trashDir) ? readdirSync(trashDir).some(name => name.startsWith(archiveName)) : false;
const safe = body.ok === true && !existsSync(archiveDir) && recycled;
console.log(JSON.stringify({ probe: 'recoverable-session-delete', http_ok: body.ok === true, original_exists: existsSync(archiveDir), recycled, safe }));
process.exit(safe ? 0 : 10);
`,
  'raw-versus-redacted-patch': `
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workbench } from './src/workbench.js';

const workspace = mkdtempSync(path.join(tmpdir(), 'rrm-patch-ws-'));
const git = (...args) => execFileSync('git', ['-C', workspace, ...args], { windowsHide: true });
git('init'); git('config', 'user.email', 'probe@example.invalid'); git('config', 'user.name', 'probe');
writeFileSync(path.join(workspace, 'readme.md'), 'base\\n'); git('add', '-A'); git('commit', '-m', 'base');
const expected = 'sk-' + 'A'.repeat(24);
const writer = {
  name: 'Writer',
  command: [process.execPath, '-e', \`require('fs').writeFileSync('cfg.txt', \${JSON.stringify(JSON.stringify(expected))}); console.log('wrote cfg')\`],
  input: 'stdin', output: 'text', timeoutMs: 15000,
  envWhitelist: ['PATH', 'SYSTEMROOT'], cwd: process.cwd(),
};
const agents = { m1: { name: 'M1', command: [process.execPath, '-e', 'console.log(\"ok\")'], input: 'stdin', output: 'text', timeoutMs: 5000, envWhitelist: ['PATH', 'SYSTEMROOT'], cwd: process.cwd() } };
const baseDir = mkdtempSync(path.join(tmpdir(), 'rrm-patch-session-'));
const bench = new Workbench({ name: 'probe', agents, participants: ['m1'], baseDir, emit: () => {}, workspace, writeAgents: { m1: writer } });
await bench.init();
await bench.build('write configuration', 'm1');
const buildId = bench.builds[0].buildId;
await bench.applyBuild(buildId);
const landed = readFileSync(path.join(workspace, 'cfg.txt'), 'utf8');
const safe = landed === JSON.stringify(expected);
console.log(JSON.stringify({ probe: 'byte-preserving-redacted-patch', expected_sha_input: 'synthetic-token-shape', landed_contains_placeholder: landed.includes('[REDACTED]'), safe }));
process.exit(safe ? 0 : 10);
`,
};

const results = [];
for (const [caseId, entry] of Object.entries(mapping.cases)) {
  const snapshot = path.join(runRoot, caseId);
  await ensureDir(snapshot);
  const archive = path.join(runRoot, caseId + '.tar');
  execFileSync('git', ['-C', repoDir, 'archive', '--format=tar', '--output', archive, entry.target_commit], { windowsHide: true });
  execFileSync('tar', ['-xf', archive, '-C', snapshot], { windowsHide: true });
  const reproducer = reproducers[entry.pair_id];
  if (!reproducer) throw new Error(`No reproducer for ${entry.pair_id}`);
  await writeText(path.join(snapshot, 'private-reproducer.mjs'), reproducer.trimStart());
  await writeText(path.join(privateRoot, caseId, 'reproducer.mjs'), reproducer.trimStart());
  const run = await spawnCapture(process.execPath, ['private-reproducer.mjs'], { cwd: snapshot, timeoutMs: 90000 });
  let observation = null;
  for (const line of run.stdout.trim().split(/\r?\n/).reverse()) {
    try { observation = JSON.parse(line); break; } catch { /* find final JSON line */ }
  }
  const expectedSafe = entry.variant === 'safe';
  const observedSafe = observation?.safe === true;
  const confirmed = observation != null && observedSafe === expectedSafe && (expectedSafe ? run.exitCode === 0 : run.exitCode === 10);
  const record = {
    schema_version: 1,
    case_id: caseId,
    pair_id: entry.pair_id,
    variant: entry.variant,
    expected_safe_behavior: expectedSafe,
    confirmed,
    observation,
    process: { exit_code: run.exitCode, error_type: run.error, timed_out: run.timedOut, elapsed_ms: run.elapsedMs },
    verified_at: new Date().toISOString(),
  };
  await writeJson(path.join(privateRoot, caseId, 'verification.json'), record);
  results.push(record);
  console.log(`${confirmed ? 'PASS' : 'FAIL'} ${caseId} ${entry.pair_id} ${entry.variant} observed_safe=${observedSafe}`);
}

const summary = {
  schema_version: 1,
  verified_at: new Date().toISOString(),
  all_confirmed: results.every(x => x.confirmed),
  count: results.length,
  defect_reproductions: results.filter(x => x.variant === 'defect' && x.confirmed).length,
  safe_controls: results.filter(x => x.variant === 'safe' && x.confirmed).length,
  results: results.map(({ case_id, pair_id, variant, confirmed, observation, process }) => ({ case_id, pair_id, variant, confirmed, observation, process })),
};
await writeJson(path.join(privateRoot, 'verification-summary.json'), summary);
if (!summary.all_confirmed) process.exitCode = 2;
else console.log(`All ${summary.count} calibration variants confirmed by executable probes.`);
