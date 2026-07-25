import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expDir, sha256, writeJson } from './lib.mjs';

const source = path.join(expDir, 'preregistration.yaml');
const target = path.join(expDir, 'preregistration.lock.json');
const bytes = await readFile(source);
await writeJson(target, {
  schema_version: 1,
  source: 'preregistration.yaml',
  locked_at: new Date().toISOString(),
  sha256: sha256(bytes),
  rule: 'Do not overwrite preregistration.yaml after lock. Add amendments/amendment-NNN.yaml and lock each amendment separately.',
});
console.log(`Locked preregistration: ${sha256(bytes)}`);

