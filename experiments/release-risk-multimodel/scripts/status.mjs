import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expDir, exists, readJson, sha256, writeJson } from './lib.mjs';

const milestones = [];
let next = 'node experiments/release-risk-multimodel/scripts/check-lock.mjs';
let stage = 'LOCK_INVALID';

async function lockOk(source, lockFile) {
  try { return sha256(await readFile(source)) === (await readJson(lockFile)).sha256; } catch { return false; }
}
const locks = await Promise.all([
  lockOk(path.join(expDir, 'preregistration.yaml'), path.join(expDir, 'preregistration.lock.json')),
  lockOk(path.join(expDir, 'amendments', 'amendment-001.yaml'), path.join(expDir, 'amendments', 'amendment-001.lock.json')),
  lockOk(path.join(expDir, 'amendments', 'amendment-002.yaml'), path.join(expDir, 'amendments', 'amendment-002.lock.json')),
]);
milestones.push({ code: 'LOCKS', complete: locks.every(Boolean) });

const verification = await readJson(path.join(expDir, 'cases', 'private', 'verification-summary.json')).catch(() => null);
milestones.push({ code: 'CASES', complete: verification?.all_confirmed === true && verification?.count === 6 && verification?.defect_reproductions === 3 && verification?.safe_controls === 3 });
const exclusions = await readJson(path.join(expDir, 'runs', 'exclusions.json')).catch(() => null);
const legacyIds = ['smoke-2026-07-22T12-16-08-086Z-45949776', 'smoke-compat-20260722-v2'];
milestones.push({ code: 'LEGACY_EXCLUDED', complete: legacyIds.every(id => exclusions?.runs?.[id]?.scorable === false && exclusions?.runs?.[id]?.permanent_exclusion === true) });
const offline = await readJson(path.join(expDir, 'analysis', 'generated', 'offline-tests.json')).catch(() => null);
milestones.push({ code: 'OFFLINE_TESTS', complete: offline?.all_passed === true });

let smoke = null;
try {
  const id = (await readFile(path.join(expDir, 'runs', 'latest-smoke.txt'), 'utf8')).trim();
  const eligibility = await readJson(path.join(expDir, 'runs', id, 'eligibility.json'));
  const checks = await readJson(path.join(expDir, 'runs', id, 'smoke-checks.json'));
  if (!eligibility.permanent_exclusion && checks.all_passed) smoke = id;
} catch { /* no valid smoke */ }
milestones.push({ code: 'SMOKE', complete: smoke != null });

let calibration = null;
try {
  const id = (await readFile(path.join(expDir, 'runs', 'latest-latency.txt'), 'utf8')).trim();
  const eligibility = await readJson(path.join(expDir, 'runs', id, 'eligibility.json'));
  const summary = await readJson(path.join(expDir, 'runs', id, 'summary.json'));
  if (eligibility.scorable && summary.complete) calibration = id;
} catch { /* no valid calibration */ }
milestones.push({ code: 'CALIBRATION', complete: calibration != null });
const blind = calibration ? await exists(path.join(expDir, 'judging', 'blinded', calibration, 'packet.json')) : false;
milestones.push({ code: 'BLIND_PACKET', complete: blind });
const analysis = calibration ? await exists(path.join(expDir, 'analysis', 'generated', calibration, 'analysis.json')) : false;
milestones.push({ code: 'ANALYSIS', complete: analysis });

if (milestones[0].complete && milestones[1].complete && milestones[2].complete && milestones[3].complete) {
  stage = 'SMOKE_PENDING';
  next = 'node experiments/release-risk-multimodel/scripts/run-experiment.mjs --mode smoke --case first --groups A,B,C --run-id smoke-abcv3-20260722';
}
if (smoke) {
  stage = 'CALIBRATION_PENDING';
  next = 'node experiments/release-risk-multimodel/scripts/run-experiment.mjs --mode latency --cases all --groups A,B,C --run-id latency-calibration-20260722-v1';
}
if (calibration) {
  stage = 'BLINDING_PENDING';
  next = 'node experiments/release-risk-multimodel/scripts/blind.mjs --run latency-calibration-20260722-v1';
}
if (blind) {
  stage = 'SCORING_PENDING';
  next = 'node experiments/release-risk-multimodel/scripts/score-calibration.mjs --run latency-calibration-20260722-v1';
}
if (analysis) {
  stage = 'HUMAN_REVIEW_PENDING';
  next = `complete judging/blinded/${calibration}/reviewer-1.csv and reviewer-2.csv`;
}
const complete = milestones.filter(item => item.complete).length;
await writeJson(path.join(expDir, 'analysis', 'generated', 'status-detail.json'), { schema_version: 1, generated_at: new Date().toISOString(), stage, complete, total: milestones.length, next, milestones, smoke_run: smoke, calibration_run: calibration });
console.log(`STAGE=${stage}`);
console.log(`COMPLETE=${complete}/${milestones.length}`);
console.log(`NEXT=${next}`);

