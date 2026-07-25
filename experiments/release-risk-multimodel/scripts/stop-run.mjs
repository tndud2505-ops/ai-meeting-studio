import path from 'node:path';
import { expDir, parseArgs } from './lib.mjs';
import { requestStop } from './managed-process.mjs';

const cli = parseArgs(process.argv.slice(2));
const runId = String(cli['run-id'] ?? '');
const result = await requestStop({ runsRoot: path.join(expDir, 'runs'), runId });
console.log(`STOP_REQUESTED run=${result.run_id} confirmed=${result.confirmed.length} killed=${result.killed.length} skipped=${result.skipped.length}`);
if (result.skipped.length) process.exitCode = 2;

