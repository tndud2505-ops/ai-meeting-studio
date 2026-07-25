import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expDir, parseArgs, readJson, writeJson, writeText } from './lib.mjs';

const cli = parseArgs(process.argv.slice(2));
let runId = String(cli.run ?? 'latest');
if (runId === 'latest') runId = (await readFile(path.join(expDir, 'runs', 'latest-latency.txt'), 'utf8')).trim();
const score = await readJson(path.join(expDir, 'analysis', 'generated', runId, 'calibration-score.json'));
const b = score.groups.B;
const c = score.groups.C;
const diff = score.primary_C_versus_B.recall_absolute_difference;
const provisionalWinner = diff > 0 ? 'C' : (diff < 0 ? 'B' : 'tie');
const analysis = {
  schema_version: 1, run_id: runId, generated_at: new Date().toISOString(),
  completed_stages: ['offline_harness', 'one_full_smoke', 'six_case_wall_clock_calibration', 'blind_packet', 'provisional_deterministic_calibration_score'],
  primary_comparison: 'C versus B', provisional_C_versus_B: { winner: provisionalWinner, recall_difference: diff, recall_difference_bootstrap_95_ci: score.primary_C_versus_B.recall_difference_bootstrap_95_ci, safe_false_block_difference: score.primary_C_versus_B.safe_false_block_rate_absolute_difference },
  group_results: score.groups,
  C_wins_B_final: score.final_human_judgment_complete ? provisionalWinner === 'C' : null,
  multimodel_product_decision: 'downgrade_to_experimental_until_formal_cross_repository_human_review_evidence',
  evidence_strength: 'process_calibration_only',
  evidence_boundary: 'Six cases are three defect/safe pairs from one repository. They test harness behavior and cannot prove product effectiveness.',
  missing: ['two independent qualified human blind reviews', 'third reviewer for disagreements if any', 'at least 24 formal pairs across at least four repositories and all preregistered domains', 'delayed real-release outcome validation'],
  conclusion: 'insufficient evidence for a product-validity claim',
};
const report = `# Release-risk A/B/C calibration analysis\n\n- Primary comparison: C versus B.\n- Provisional deterministic calibration result: ${provisionalWinner}; recall difference ${diff}.\n- B recall: ${b.paired_sev01_recall}; C recall: ${c.paired_sev01_recall}.\n- B safe false-block rate: ${b.safe_false_block_rate}; C safe false-block rate: ${c.safe_false_block_rate}.\n- Final C-wins-B judgment: ${analysis.C_wins_B_final == null ? 'evidence insufficient pending human blind review' : analysis.C_wins_B_final}.\n- Product action: keep multimodel only as an experiment; do not make it the product center.\n- Evidence boundary: ${analysis.evidence_boundary}\n`;
const outDir = path.join(expDir, 'analysis', 'generated', runId);
await writeJson(path.join(outDir, 'analysis.json'), analysis);
await writeText(path.join(outDir, 'report.md'), report);
console.log(`ANALYSIS_CREATED ${runId} conclusion=insufficient_evidence`);

