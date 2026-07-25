import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, expDir, listFiles, repoDir, sha256, writeJson, writeText } from './lib.mjs';

const publicRoot = path.join(expDir, 'cases', 'public');
const privateRoot = path.join(expDir, 'cases', 'private');

function git(args) {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
}

function diff(from, to, files) {
  return git(['diff', '--no-ext-diff', '--unified=50', from, to, '--', ...files]);
}

function show(commit, file) {
  return git(['show', `${commit}:${file}`]);
}

const pairs = [
  {
    pairId: 'csrf-origin',
    domain: 'auth_or_permission',
    title: 'Local-only API request-source hardening',
    brief: 'Harden a localhost-only HTTP service against hostile browser pages and DNS rebinding while keeping legitimate loopback browser, CLI, and file-origin use working. Event replay buffers must also remain bounded.',
    constraints: ['Service binds to loopback.', 'Browser clients use fetch and EventSource.', 'Write-capable API routes exist.', 'No new dependency is allowed.'],
    monitoring: 'Log rejected Host/Origin counts without storing full URLs. Monitor 403 spikes, workbench creation rate, and unexpected write-mode actions after release.',
    rollback: 'Revert the request-source guard only if legitimate loopback traffic is blocked; keep the service loopback-bound. A rollback must not expose the listener on a non-loopback interface.',
    baseline: 'f2b257f5a4bcc2e998a81c94ca4ec0a2652b9fd0',
    defectCommit: '8345bc8f327c64f8ff0f5ae2610e2508d11bbb15',
    safeCommit: 'a050d15c652eb2d160d3f36214e1bce09339efc5',
    files: ['src/server.js'],
    ids: { defect: 'CAL-71C4', safe: 'CAL-29AF' },
    risk: {
      risk_id: 'GT-CSRF-01', severity: 'Sev1',
      mechanism: 'Host-only validation does not stop a hostile web origin from sending a simple cross-site request directly to a loopback API; the browser supplies a valid target Host while Origin identifies the hostile page.',
      trigger: 'A user visits a hostile page while the local service is running; the page sends a simple request to a write-capable localhost endpoint.',
      affected: 'Local projects and sessions reachable through write-capable Roundtable routes.',
      validation: 'Send a request with Host set to 127.0.0.1:<port> and Origin set to https://evil.example; the defect returns a non-403 response and the safe variant returns 403.',
      keyword_groups: [['origin', 'cross-site', 'csrf'], ['host', 'loopback', 'localhost'], ['write', 'api', 'request']]
    }
  },
  {
    pairId: 'recoverable-delete',
    domain: 'database_or_state_migration',
    title: 'Recoverable session removal',
    brief: 'Add user-initiated removal for active and archived meeting sessions. Product policy requires accidental removal to remain recoverable by an operator from local storage for at least one maintenance cycle.',
    constraints: ['Session directories are the authoritative local record.', 'The application has no database and no remote backup.', 'Removal must detach active clients and stop active work.', 'No new dependency is allowed.'],
    monitoring: 'Record removal events and track failures to detach active clients. Monitor the recycle directory size and failed restore attempts.',
    rollback: 'Disable the removal buttons/routes. Do not physically erase session directories during rollback; restore moved directories from the local recycle directory.',
    baseline: '3379b2f720be4148c83c1cd2b88ad847d8f30942',
    defectCommit: 'e3083bc1fdcf48fabce1fe50a3c1c678b114d576',
    safeCommit: '258e8a4a9016a36845448834b10be71d53c7e440',
    fixParent: '2a1892bd95a9a2646dfad51374099664c8685190',
    files: ['public/app.js', 'public/style.css', 'src/server.js'],
    ids: { defect: 'CAL-B830', safe: 'CAL-4D12' },
    risk: {
      risk_id: 'GT-DELETE-01', severity: 'Sev1',
      mechanism: 'The DELETE routes recursively remove the authoritative session directory, making an accidental click or wrong-target deletion unrecoverable despite the product recovery requirement.',
      trigger: 'A user confirms deletion of an active or archived session, including a mistaken target selection.',
      affected: 'Meeting transcripts, raw model output, summaries, and audit history stored only in that session directory.',
      validation: 'Delete a prepared archive and inspect storage: the defect removes it with no recycle copy; the safe variant moves it under sessions/.trash.',
      keyword_groups: [['rm', 'recursive', 'physical', 'unrecoverable'], ['trash', 'recycle', 'recover'], ['session', 'archive', 'record']]
    }
  },
  {
    pairId: 'raw-versus-redacted-patch',
    domain: 'infrastructure_or_configuration',
    title: 'Byte-preserving approval of redacted diffs',
    brief: 'Add isolated write mode: an agent edits a worktree, the UI displays a redacted diff, and only an explicitly approved change is applied to the main workspace. Approved file contents must land byte-for-byte unchanged even when they resemble credentials or local paths.',
    constraints: ['Displayed and persisted replay material must be redacted.', 'The executable patch must preserve original bytes.', 'The main workspace must remain untouched until approval.', 'No new dependency is allowed.'],
    monitoring: 'After apply, compare the approved result hash with the worktree result hash. Alert on placeholder strings appearing in applied configuration files.',
    rollback: 'Stop accepting new apply operations, keep pending raw proposals isolated, and use Git to restore any file whose landed hash differs from the approved worktree result.',
    baseline: '5fee9c600728e1baa69da5d4e018491ce29a8a71',
    defectCommit: 'c45b9af7775521cd0c66a2fa440f6e38a65a171a',
    safeCommit: 'e74869171bdf330e43611332d4f9b4c179c8d176',
    fixParent: 'dd6c03fcb51c59e860a5ad0a60444b8e97d84778',
    files: ['src/workbench.js', 'src/worktree.js'],
    ids: { defect: 'CAL-E55A', safe: 'CAL-08D7' },
    risk: {
      risk_id: 'GT-PATCH-01', severity: 'Sev1',
      mechanism: 'The system persists only a redacted patch and later executes that transformed display artifact, so path/credential-shaped content is silently replaced by placeholders in the real workspace.',
      trigger: 'An approved change contains a local home path, token-shaped string, or another redactor match.',
      affected: 'Configuration, source, and deployment files applied from agent worktrees.',
      validation: 'Have the isolated writer create a file containing a home-directory path, approve it, and compare landed bytes. The defect lands a redaction placeholder; the safe variant lands the original bytes while the display patch remains redacted.',
      keyword_groups: [['redact', 'redacted', 'placeholder'], ['patch', 'apply', 'raw'], ['corrupt', 'byte', 'content', 'workspace']]
    }
  }
];

const privateMapping = { schema_version: 1, generated_at: new Date().toISOString(), cases: {} };

for (const pair of pairs) {
  for (const variant of ['defect', 'safe']) {
    const caseId = pair.ids[variant];
    const target = variant === 'defect' ? pair.defectCommit : pair.safeCommit;
    const caseDir = path.join(publicRoot, caseId);
    const privateDir = path.join(privateRoot, caseId);
    await ensureDir(path.join(caseDir, 'source_after'));
    await ensureDir(privateDir);

    let patch = diff(pair.baseline, variant === 'defect' ? pair.defectCommit : (pair.pairId === 'csrf-origin' ? pair.safeCommit : pair.defectCommit), pair.files);
    if (variant === 'safe' && pair.pairId !== 'csrf-origin') {
      patch += '\n\n# Follow-up hardening in the same release candidate\n' + diff(pair.fixParent, pair.safeCommit, ['src/server.js', 'src/workbench.js'].filter(file => pair.files.includes(file)));
    }
    await writeText(path.join(caseDir, 'change.diff'), patch);
    await writeJson(path.join(caseDir, 'case.json'), {
      schema_version: 1,
      case_id: caseId,
      calibration_only: true,
      language: 'JavaScript / Node.js',
      change_domain: pair.domain,
      review_target: 'pre-release change set',
    });
    await writeText(path.join(caseDir, 'brief.md'), `# ${pair.title}\n\n${pair.brief}\n`);
    await writeText(path.join(caseDir, 'release-notes.md'), `# Release note\n\nCandidate change: ${pair.title}. The release is intended to preserve existing local workflows and add no external dependency.\n`);
    await writeText(path.join(caseDir, 'known-constraints.md'), '# Known constraints\n\n' + pair.constraints.map(x => `- ${x}`).join('\n') + '\n');
    await writeText(path.join(caseDir, 'monitoring.md'), `# Monitoring\n\n${pair.monitoring}\n`);
    await writeText(path.join(caseDir, 'rollback.md'), `# Rollback\n\n${pair.rollback}\n`);
    await writeText(path.join(caseDir, 'test-summary.txt'), 'Candidate repository tests were historically green for the submitted change. The evaluator holds back one focused regression probe so participant models cannot read the answer.\n');

    for (const file of pair.files.filter(file => file.startsWith('src/'))) {
      await writeText(path.join(caseDir, 'source_after', file), show(target, file));
    }

    const hashEntries = [];
    for (const file of await listFiles(caseDir)) {
      if (path.basename(file) === 'bundle-manifest.json') continue;
      const rel = path.relative(caseDir, file).replaceAll('\\', '/');
      hashEntries.push({ path: rel, sha256: sha256(await readFile(file)) });
    }
    const bundleSha = sha256(hashEntries.map(x => `${x.path}\0${x.sha256}`).join('\n'));
    await writeJson(path.join(caseDir, 'bundle-manifest.json'), { schema_version: 1, case_id: caseId, files: hashEntries, bundle_sha256: bundleSha });

    const groundTruth = {
      schema_version: 1,
      case_id: caseId,
      pair_id: pair.pairId,
      variant,
      expected_release_decision: variant === 'defect' ? 'block' : 'pass',
      known_sev01_risks: variant === 'defect' ? [pair.risk] : [],
      calibration_only: true,
      source: {
        repository_head_at_preparation: git(['rev-parse', 'HEAD']).trim(),
        baseline_commit: pair.baseline,
        candidate_commit: target,
        confirming_fix_commit: variant === 'defect' ? pair.safeCommit : null,
      },
      public_bundle_sha256: bundleSha,
    };
    await writeJson(path.join(privateDir, 'ground-truth.json'), groundTruth);
    privateMapping.cases[caseId] = { pair_id: pair.pairId, variant, target_commit: target, public_bundle_sha256: bundleSha };
  }
}

await writeJson(path.join(privateRoot, 'case-map.json'), privateMapping);
await writeJson(path.join(publicRoot, 'manifest.json'), {
  schema_version: 1,
  generated_at: privateMapping.generated_at,
  cases: Object.keys(privateMapping.cases).sort().map(case_id => ({ case_id, calibration_only: true })),
});

console.log(`Prepared ${Object.keys(privateMapping.cases).length} opaque public calibration cases.`);
console.log(`Public: ${publicRoot}`);
console.log(`Private evaluator material: ${privateRoot}`);

