import path from 'node:path';
import { exists, readJson, writeJson } from './lib.mjs';

export async function readEligibility(runDir) {
  const file = path.join(runDir, 'eligibility.json');
  if (!(await exists(file))) {
    return { schema_version: 1, scorable: false, permanent_exclusion: false, reason_codes: ['eligibility_missing'] };
  }
  return readJson(file);
}

export async function assertScorableRun(runDir) {
  const eligibility = await readEligibility(runDir);
  if (eligibility.scorable !== true) {
    const reasons = eligibility.reason_codes?.join(',') || 'unspecified';
    throw new Error(`Run is not scorable: ${reasons}`);
  }
  const summary = await readJson(path.join(runDir, 'summary.json'));
  if (summary.complete !== true || summary.results?.some(result => result.status !== 'complete')) {
    throw new Error('Run is not scorable: incomplete_or_missing_group_result');
  }
  return { eligibility, summary };
}

export async function writeEligibility(runDir, value) {
  await writeJson(path.join(runDir, 'eligibility.json'), {
    schema_version: 1,
    ...value,
  });
}

