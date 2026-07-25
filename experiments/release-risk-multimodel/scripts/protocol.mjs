import path from 'node:path';
import { expDir, readJson, shuffled } from './lib.mjs';

export const SHARED_MERGE_PIPELINE_ID = 'fixed-codex-merge-verify-v1';

export async function readProtocol() {
  return readJson(path.join(expDir, 'config', 'protocol.json'));
}

export async function assertSharedMergeProtocol() {
  const protocol = await readProtocol();
  const b = protocol.merge_verification_pipelines?.B;
  const c = protocol.merge_verification_pipelines?.C;
  if (b !== SHARED_MERGE_PIPELINE_ID || c !== SHARED_MERGE_PIPELINE_ID || b !== c) {
    throw new Error('Groups B and C must use the same fixed merge-verification pipeline');
  }
  return protocol[b];
}

export function buildVerifierPrompt({ template, schemaText, caseBundle, candidates, seed }) {
  const anonymous = shuffled(candidates, seed).map((value, index) => ({
    candidate_set: index + 1,
    value,
  }));
  return `${template}\n\nThe JSON schema is:\n${schemaText}\n\nPUBLIC CASE BUNDLE\n${caseBundle}\n\nCANDIDATE FINDINGS\n${JSON.stringify(anonymous, null, 2)}`;
}

