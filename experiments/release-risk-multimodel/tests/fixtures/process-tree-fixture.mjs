import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../../scripts/lib.mjs';

const cli = parseArgs(process.argv.slice(2));
if (cli.child) {
  setInterval(() => {}, 1000);
} else {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], { windowsHide: true, stdio: 'ignore' });
  await writeFile(String(cli['pid-file']), JSON.stringify({ fixture_pid: process.pid, descendant_pid: child.pid }) + '\n', 'utf8');
  setInterval(() => {}, 1000);
}
