import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertScorableRun } from './eligibility.mjs';
import { ensureDir, exists, expDir, parseArgs, readJson, serializePublicCase, sha256, shuffled, toCsv, writeJson, writeText } from './lib.mjs';

const cli = parseArgs(process.argv.slice(2));
let runId = String(cli.run ?? 'latest');
if (runId === 'latest') runId = (await readFile(path.join(expDir, 'runs', 'latest-latency.txt'), 'utf8')).trim();
const runDir = path.join(expDir, 'runs', runId);
const { summary } = await assertScorableRun(runDir);
const blindedDir = path.join(expDir, 'judging', 'blinded', runId);
const privateDir = path.join(expDir, 'judging', 'private', runId);
const packetFile = path.join(blindedDir, 'packet.json');
if (await exists(packetFile)) {
  console.log(`BLIND_PACKET_EXISTS ${runId}`);
  process.exit(0);
}
await ensureDir(blindedDir);
await ensureDir(privateDir);

function scrub(value) {
  if (typeof value === 'string') return value.replace(/\b(Codex|Claude(?: Code)?|OpenAI|Anthropic|gpt-[A-Za-z0-9._-]+|claude-[A-Za-z0-9._-]+)\b/gi, '[source removed]');
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
  return value;
}

const caseIds = [...new Set(summary.results.map(result => result.case_id))];
const shuffledCases = shuffled(caseIds, `${runId}:blind-cases`);
const blindCases = Object.fromEntries(shuffledCases.map((caseId, index) => [caseId, `CASE-${String(index + 1).padStart(3, '0')}`]));
const submissions = [];
const mapping = { schema_version: 1, run_id: runId, generated_at: new Date().toISOString(), cases: blindCases, submissions: {} };

for (const caseId of shuffledCases) {
  const groupOrder = shuffled(['A', 'B', 'C'], `${runId}:${caseId}:blind-groups`);
  for (const group of groupOrder) {
    const result = await readJson(path.join(runDir, caseId, `group-${group}`, 'final.json'));
    const submissionId = `SUB-${sha256(`${runId}:${caseId}:${group}`).slice(0, 10).toUpperCase()}`;
    const output = scrub(result.final_output);
    submissions.push({ blind_case_id: blindCases[caseId], submission_id: submissionId, release_decision: output.release_decision, review_summary: output.review_summary, findings: shuffled(output.findings, `${submissionId}:findings`) });
    mapping.submissions[submissionId] = { case_id: caseId, group };
  }
}

const cases = [];
for (const caseId of shuffledCases) {
  cases.push({ blind_case_id: blindCases[caseId], public_bundle: await serializePublicCase(path.join(expDir, 'cases', 'public', caseId)) });
}
await writeJson(packetFile, { schema_version: 1, run_id_alias: `BLIND-${sha256(runId).slice(0, 12).toUpperCase()}`, calibration_only: true, source_identity_removed: true, cases, submissions: shuffled(submissions, `${runId}:submission-order`) });
await writeJson(path.join(privateDir, 'mapping.json'), mapping);

const rows = [];
for (const submission of submissions) {
  rows.push({ reviewer_id: '', blind_case_id: submission.blind_case_id, submission_id: submission.submission_id, item_id: `${submission.submission_id}-DECISION`, item_type: 'release_decision', confirmed_sev01: '', risk_match_id: '', release_block_justified: '', evidence_sufficient: '', confirmation_minutes: '', notes: '' });
  submission.findings.forEach((finding, index) => rows.push({ reviewer_id: '', blind_case_id: submission.blind_case_id, submission_id: submission.submission_id, item_id: `${submission.submission_id}-F${index + 1}`, item_type: 'finding', confirmed_sev01: '', risk_match_id: '', release_block_justified: '', evidence_sufficient: '', confirmation_minutes: '', notes: '' }));
}
const headers = ['reviewer_id', 'blind_case_id', 'submission_id', 'item_id', 'item_type', 'confirmed_sev01', 'risk_match_id', 'release_block_justified', 'evidence_sufficient', 'confirmation_minutes', 'notes'];
const csv = toCsv(rows, headers);
await writeText(path.join(blindedDir, 'reviewer-1.csv'), csv);
await writeText(path.join(blindedDir, 'reviewer-2.csv'), csv);
await writeText(path.join(blindedDir, 'README.txt'), 'Two qualified engineers must review independently. Do not share reviewer files. Use a third qualified engineer only to adjudicate disagreements. Final scoring requires human adjudication; deterministic calibration scoring is provisional only.\n');
await writeText(path.join(expDir, 'judging', 'blinded', `latest-${summary.mode}.txt`), runId + '\n');
console.log(`BLIND_PACKET_CREATED ${runId} submissions=${submissions.length}`);

