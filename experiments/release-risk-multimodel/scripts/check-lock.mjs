import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expDir, readJson, sha256 } from './lib.mjs';

const checks = [
  [path.join(expDir, 'preregistration.yaml'), path.join(expDir, 'preregistration.lock.json')],
  [path.join(expDir, 'amendments', 'amendment-001.yaml'), path.join(expDir, 'amendments', 'amendment-001.lock.json')],
  [path.join(expDir, 'amendments', 'amendment-002.yaml'), path.join(expDir, 'amendments', 'amendment-002.lock.json')],
];
const hashes = [];
for (const [source, lockFile] of checks) {
  const lock = await readJson(lockFile);
  const actual = sha256(await readFile(source));
  if (actual !== lock.sha256) {
    console.error(`LOCK MISMATCH source=${path.basename(source)} expected=${lock.sha256} actual=${actual}`);
    process.exit(2);
  }
  hashes.push(`${path.basename(source)}=${actual}`);
}
console.log(`LOCK OK ${hashes.join(' ')}`);

