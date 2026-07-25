import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertScorableRun } from './eligibility.mjs';
import { exists, expDir, parseArgs, readJson, seededRandom, writeJson } from './lib.mjs';

const cli = parseArgs(process.argv.slice(2));
let runId = String(cli.run ?? 'latest');
if (runId === 'latest') runId = (await readFile(path.join(expDir, 'runs', 'latest-latency.txt'), 'utf8')).trim();
const runDir = path.join(expDir, 'runs', runId);
const { summary } = await assertScorableRun(runDir);
const privateRoot = path.join(expDir, 'cases', 'private');
const mapping = await readJson(path.join(privateRoot, 'case-map.json'));

function findingText(finding) {
  return [finding.title, finding.mechanism, finding.trigger, finding.affected, finding.validation?.method, finding.validation?.expected, ...(finding.evidence ?? []).flatMap(item => [item.ref, item.detail])].join(' ').toLowerCase();
}
function matchesRisk(finding, risk) {
  if (!['Sev0', 'Sev1'].includes(finding?.severity)) return false;
  if (!finding?.mechanism || !finding?.trigger || !finding?.affected || !finding?.validation?.method || !finding?.evidence?.length) return false;
  const text = findingText(finding);
  return risk.keyword_groups.every(group => group.some(keyword => text.includes(keyword.toLowerCase())));
}
function pairedBootstrap(values, seed) {
  if (!values.length) return [null, null];
  const random = seededRandom(seed);
  const draws = [];
  for (let b = 0; b < 10000; b++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(random() * values.length)];
    draws.push(sum / values.length);
  }
  draws.sort((a, b) => a - b);
  return [draws[Math.floor(draws.length * 0.025)], draws[Math.floor(draws.length * 0.975)]];
}

const rows = [];
for (const [caseId, caseInfo] of Object.entries(mapping.cases)) {
  if (!summary.results.some(result => result.case_id === caseId)) continue;
  const truth = await readJson(path.join(privateRoot, caseId, 'ground-truth.json'));
  for (const group of ['A', 'B', 'C']) {
    const result = await readJson(path.join(runDir, caseId, `group-${group}`, 'final.json'));
    const findings = result.final_output.findings ?? [];
    const matchedRiskIds = truth.known_sev01_risks.filter(risk => findings.some(finding => matchesRisk(finding, risk))).map(risk => risk.risk_id);
    const confirmedFindingIndexes = findings.map((finding, index) => truth.known_sev01_risks.some(risk => matchesRisk(finding, risk)) ? index : null).filter(index => index != null);
    const safeFalseBlock = caseInfo.variant === 'safe' && (result.final_output.release_decision === 'block' || findings.some(finding => ['Sev0', 'Sev1'].includes(finding.severity) && finding.release_action === 'block'));
    rows.push({ case_id: caseId, pair_id: caseInfo.pair_id, variant: caseInfo.variant, group, known_risks: truth.known_sev01_risks.map(risk => risk.risk_id), matched_risks: matchedRiskIds, confirmed_finding_indexes: confirmedFindingIndexes, finding_count: findings.length, safe_false_block: safeFalseBlock, release_decision: result.final_output.release_decision, wall_clock_ms: result.wall_clock_ms, usage: result.usage });
  }
}

const groups = {};
for (const group of ['A', 'B', 'C']) {
  const groupRows = rows.filter(row => row.group === group);
  const defect = groupRows.filter(row => row.variant === 'defect');
  const safe = groupRows.filter(row => row.variant === 'safe');
  const known = defect.reduce((sum, row) => sum + row.known_risks.length, 0);
  const matched = defect.reduce((sum, row) => sum + row.matched_risks.length, 0);
  const confirmed = groupRows.reduce((sum, row) => sum + row.confirmed_finding_indexes.length, 0);
  const totalFindings = groupRows.reduce((sum, row) => sum + row.finding_count, 0);
  groups[group] = { defect_risks_known: known, defect_risks_matched: matched, paired_sev01_recall: known ? matched / known : null, safe_cases: safe.length, safe_false_blocks: safe.filter(row => row.safe_false_block).length, safe_false_block_rate: safe.length ? safe.filter(row => row.safe_false_block).length / safe.length : null, confirmed_findings: confirmed, total_findings: totalFindings, confirmed_finding_precision: totalFindings ? confirmed / totalFindings : null, total_wall_clock_ms: groupRows.reduce((sum, row) => sum + row.wall_clock_ms, 0), total_calls: groupRows.reduce((sum, row) => sum + row.usage.calls, 0) };
}
const defectCases = rows.filter(row => row.group === 'B' && row.variant === 'defect').map(row => row.case_id);
const recallDiffs = defectCases.map(caseId => Number(rows.find(row => row.case_id === caseId && row.group === 'C').matched_risks.length > 0) - Number(rows.find(row => row.case_id === caseId && row.group === 'B').matched_risks.length > 0));
const safeCases = rows.filter(row => row.group === 'B' && row.variant === 'safe').map(row => row.case_id);
const falseBlockDiffs = safeCases.map(caseId => Number(rows.find(row => row.case_id === caseId && row.group === 'C').safe_false_block) - Number(rows.find(row => row.case_id === caseId && row.group === 'B').safe_false_block));
const cOnly = defectCases.filter(caseId => rows.find(row => row.case_id === caseId && row.group === 'C').matched_risks.length > 0 && rows.find(row => row.case_id === caseId && row.group === 'B').matched_risks.length === 0);
const adjudicated = path.join(expDir, 'judging', 'private', runId, 'adjudicated.csv');
const score = {
  schema_version: 1, run_id: runId, generated_at: new Date().toISOString(), calibration_only: true,
  final_human_judgment_complete: await exists(adjudicated),
  deterministic_score_status: 'provisional_program_calibration_not_final_human_judgment',
  groups,
  primary_C_versus_B: { recall_absolute_difference: groups.C.paired_sev01_recall - groups.B.paired_sev01_recall, recall_difference_bootstrap_95_ci: pairedBootstrap(recallDiffs, `${runId}:recall-ci`), safe_false_block_rate_absolute_difference: groups.C.safe_false_block_rate - groups.B.safe_false_block_rate, safe_false_block_difference_bootstrap_95_ci: pairedBootstrap(falseBlockDiffs, `${runId}:false-block-ci`), C_only_matched_risk_cases: cOnly },
  rows,
};
const outDir = path.join(expDir, 'analysis', 'generated', runId);
await writeJson(path.join(outDir, 'calibration-score.json'), score);
console.log(`CALIBRATION_SCORE_CREATED ${runId} human_final=${score.final_human_judgment_complete}`);

