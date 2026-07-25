import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ensureDir, exists, expDir, isSafeRunId, listFiles, parseArgs, readJson,
  serializePublicCase, sha256, shuffled, writeJson, writeText,
} from './lib.mjs';
import { spawnManagedCapture, stopRequested } from './managed-process.mjs';
import { assertSharedMergeProtocol, buildVerifierPrompt, SHARED_MERGE_PIPELINE_ID } from './protocol.mjs';
import { readEligibility, writeEligibility } from './eligibility.mjs';
import {
  completedCount, createOrLoadState, finishRunState, finishUnit,
  prepareRunState, startUnit,
} from './run-state.mjs';

const cli = parseArgs(process.argv.slice(2));
const mode = String(cli.mode ?? 'smoke');
if (!['smoke', 'cost', 'latency'].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
const requestedGroups = [...new Set(String(cli.groups ?? 'A,B,C').split(',').map(value => value.trim().toUpperCase()).filter(Boolean))];
for (const group of requestedGroups) if (!['A', 'B', 'C'].includes(group)) throw new Error(`Unknown group: ${group}`);
const seed = String(cli.seed ?? `rrm-${mode}-20260722-v2`);
const sharedPipeline = await assertSharedMergeProtocol();

const cfg = await readJson(path.join(expDir, 'config', 'models.json'));
const schemaPath = path.join(expDir, 'config', 'finding.schema.json');
const schemaText = await readFile(schemaPath, 'utf8');
const schemaSha256 = sha256(schemaText);
const scoutTemplate = await readFile(path.join(expDir, 'config', 'prompts', 'scout.md'), 'utf8');
const verifierTemplate = await readFile(path.join(expDir, 'config', 'prompts', 'verifier.md'), 'utf8');
const publicManifestPath = path.join(expDir, 'cases', 'public', 'manifest.json');
const publicManifest = await readJson(publicManifestPath);
let caseIds = publicManifest.cases.map(value => value.case_id).sort();
if (cli.case && cli.case !== 'first') caseIds = [String(cli.case)];
else if (cli.case === 'first') caseIds = [caseIds[0]];
else if (cli.cases && cli.cases !== 'all') caseIds = String(cli.cases).split(',').map(value => value.trim()).filter(Boolean);
caseIds = mode === 'smoke' && !cli.case && !cli.cases ? [caseIds[0]] : caseIds;
for (const caseId of caseIds) if (!publicManifest.cases.some(value => value.case_id === caseId)) throw new Error(`Unknown public case: ${caseId}`);

const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const runId = String(cli['run-id'] ?? `${mode}-${stamp}-${sha256(`${seed}:${Date.now()}`).slice(0, 8)}`);
if (!isSafeRunId(runId)) throw new Error('Invalid run id');
const runDir = path.join(expDir, 'runs', runId);
await ensureDir(runDir);

const manifestPath = path.join(runDir, 'run-manifest.json');
let manifest;
if (await exists(manifestPath)) {
  manifest = await readJson(manifestPath);
  const requestedIdentity = JSON.stringify({ mode, caseIds, requestedGroups, seed });
  const storedIdentity = JSON.stringify({ mode: manifest.mode, caseIds: manifest.requested_cases, requestedGroups: manifest.requested_groups, seed: manifest.seed });
  if (manifest.run_id !== runId || requestedIdentity !== storedIdentity) throw new Error('Existing run manifest does not match requested run');
  const priorEligibility = await readEligibility(runDir);
  if (priorEligibility.permanent_exclusion) throw new Error('Permanently excluded run id cannot be resumed or reused');
} else {
  manifest = {
    schema_version: 2,
    run_id: runId,
    mode,
    created_at: new Date().toISOString(),
    seed,
    requested_cases: caseIds,
    requested_groups: requestedGroups,
    preregistration_lock: await readJson(path.join(expDir, 'preregistration.lock.json')),
    amendment_locks: await Promise.all(['amendment-001.lock.json', 'amendment-002.lock.json'].map(name => readJson(path.join(expDir, 'amendments', name)))),
    public_case_manifest_sha256: sha256(await readFile(publicManifestPath)),
    models: cfg,
    shared_merge_verification: { groups: ['B', 'C'], pipeline_id: SHARED_MERGE_PIPELINE_ID, ...sharedPipeline },
    tool_policy: await readJson(path.join(expDir, 'config', 'tool-policy.json')),
  };
  await writeJson(manifestPath, manifest);
  await writeEligibility(runDir, { run_id: runId, mode, scorable: false, permanent_exclusion: false, reason_codes: ['run_incomplete'] });
}

let state = await createOrLoadState(runDir, manifest);
state = await prepareRunState(runDir, state);
if (state.lifecycle === 'completed') {
  console.log(`RUN_ALREADY_COMPLETE ${runId}`);
  process.exit(0);
}

function extractJson(text) {
  const trimmed = String(text ?? '').trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* try next */ }
  }
  return null;
}

function validateOutput(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['output is not an object'];
  if (!['block', 'warn', 'pass'].includes(value.release_decision)) errors.push('invalid release_decision');
  if (typeof value.review_summary !== 'string') errors.push('review_summary missing');
  if (!Array.isArray(value.findings)) errors.push('findings missing');
  else {
    if (value.findings.length > 8) errors.push('more than 8 findings');
    for (const [index, finding] of value.findings.entries()) {
      for (const key of ['finding_id', 'title', 'severity', 'mechanism', 'trigger', 'affected', 'release_action']) {
        if (typeof finding?.[key] !== 'string' || !finding[key].trim()) errors.push(`finding ${index} missing ${key}`);
      }
      if (!['Sev0', 'Sev1', 'Sev2', 'Sev3'].includes(finding?.severity)) errors.push(`finding ${index} invalid severity`);
      if (!['block', 'warn', 'pass'].includes(finding?.release_action)) errors.push(`finding ${index} invalid action`);
      if (!Array.isArray(finding?.evidence) || finding.evidence.length < 1 || finding.evidence.some(item => typeof item?.ref !== 'string' || typeof item?.detail !== 'string')) errors.push(`finding ${index} invalid evidence`);
      if (typeof finding?.validation?.method !== 'string' || typeof finding?.validation?.expected !== 'string') errors.push(`finding ${index} invalid validation`);
      if (typeof finding?.confidence !== 'number' || finding.confidence < 0 || finding.confidence > 1) errors.push(`finding ${index} invalid confidence`);
    }
  }
  return [...new Set(errors)];
}

function codexParsed(run) {
  const events = [];
  for (const line of run.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* raw log retains diagnostics */ }
  }
  const messages = events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message').map(event => event.item.text);
  const usage = events.filter(event => event.type === 'turn.completed' && event.usage).at(-1)?.usage ?? {};
  const threadId = events.find(event => event.type === 'thread.started')?.thread_id ?? null;
  const toolTypes = [];
  for (const event of events) {
    const itemType = event.item?.type ?? '';
    if (/(command|tool|mcp|web|computer|file_change|collab)/i.test(itemType) && itemType !== 'agent_message') toolTypes.push(itemType);
  }
  return { parsed: extractJson(messages.at(-1)), usage, threadId, toolTypes: [...new Set(toolTypes)] };
}

function claudeParsed(run) {
  let outer = null;
  try { outer = JSON.parse(run.stdout); } catch { /* validation handles this */ }
  const parsed = extractJson(outer?.structured_output ? JSON.stringify(outer.structured_output) : outer?.result);
  const models = Object.entries(outer?.modelUsage ?? {}).map(([model, usage]) => ({
    model,
    input_tokens: usage.inputTokens ?? null,
    output_tokens: usage.outputTokens ?? null,
    cache_read_input_tokens: usage.cacheReadInputTokens ?? null,
    cache_creation_input_tokens: usage.cacheCreationInputTokens ?? null,
    estimated_cost_usd: usage.costUSD ?? null,
  }));
  const toolTypes = Object.entries(outer?.usage?.server_tool_use ?? {}).filter(([, count]) => Number(count) > 0).map(([name]) => name);
  return { outer, parsed, models, toolTypes, usage: outer?.usage ?? {}, estimatedCostUsd: outer?.total_cost_usd ?? null };
}

function aggregateCalls(calls) {
  const totals = { calls: calls.length, input_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, claude_estimated_cost_usd: 0, elapsed_call_ms: 0, tool_calls: 0 };
  let hasClaudeCost = false;
  for (const call of calls) {
    totals.elapsed_call_ms += call.process?.elapsed_ms ?? 0;
    totals.tool_calls += call.audit?.tool_types?.length ?? 0;
    if (call.engine === 'codex') {
      totals.input_tokens += call.telemetry?.input_tokens ?? 0;
      totals.cached_input_tokens += call.telemetry?.cached_input_tokens ?? 0;
      totals.output_tokens += call.telemetry?.output_tokens ?? 0;
      totals.reasoning_output_tokens += call.telemetry?.reasoning_output_tokens ?? 0;
    } else {
      totals.input_tokens += call.telemetry?.input_tokens ?? 0;
      totals.cached_input_tokens += call.telemetry?.cache_read_input_tokens ?? 0;
      totals.cache_creation_input_tokens += call.telemetry?.cache_creation_input_tokens ?? 0;
      totals.output_tokens += call.telemetry?.output_tokens ?? 0;
      if (call.telemetry?.estimated_cost_usd != null) {
        totals.claude_estimated_cost_usd += call.telemetry.estimated_cost_usd;
        hasClaudeCost = true;
      }
    }
  }
  if (!hasClaudeCost) totals.claude_estimated_cost_usd = null;
  return totals;
}

async function persistCall(dir, prompt, run, metadata, normalized) {
  await ensureDir(dir);
  await writeText(path.join(dir, 'prompt.txt'), prompt);
  await writeText(path.join(dir, 'stdout.txt'), run.stdout);
  await writeText(path.join(dir, 'stderr.txt'), run.stderr);
  await writeJson(path.join(dir, 'metadata.json'), metadata);
  if (normalized) await writeJson(path.join(dir, 'normalized.json'), normalized);
}

async function expiredCall({ engine, prompt, callDir }) {
  const now = new Date().toISOString();
  const run = { ok: false, error: 'timeout', exitCode: null, stdout: '', stderr: '', elapsedMs: 0, startedAt: now, endedAt: now, timedOut: true };
  const metadata = { engine, process: { ok: false, error_type: 'timeout', exit_code: null, timed_out: true, elapsed_ms: 0, started_at: now, ended_at: now }, telemetry: {}, audit: { tool_types: [], valid_no_tools: true }, schema_errors: ['deadline expired before call'] };
  await writeText(path.join(callDir, 'finding.schema.json'), schemaText);
  await persistCall(callDir, prompt, run, metadata, null);
  return { engine, ok: false, output: null, process: metadata.process, telemetry: {}, audit: metadata.audit, schemaErrors: metadata.schema_errors };
}

async function callCodex({ prompt, callDir, callId, persistent = false, resumeThreadId = null, deadlineAt }) {
  await ensureDir(callDir);
  await writeText(path.join(callDir, 'finding.schema.json'), schemaText);
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return expiredCall({ engine: 'codex', prompt, callDir });
  const common = ['-m', cfg.codex.model, '-c', `model_reasoning_effort="${cfg.codex.reasoning_effort}"`, '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--disable', 'apps', '--disable', 'memories', '--disable', 'plugins', '--disable', 'multi_agent', '--output-schema', 'finding.schema.json', '--json'];
  const args = resumeThreadId
    ? ['exec', 'resume', ...common, resumeThreadId, '-']
    : ['exec', ...common, '--sandbox', 'read-only', ...(persistent ? [] : ['--ephemeral']), '-'];
  const run = await spawnManagedCapture(cfg.codex.command, args, { runId, callId, runDir, callDir, cwd: callDir, input: prompt, timeoutMs: Math.min(cfg.codex.timeout_ms, remaining) });
  const parsed = codexParsed(run);
  const schemaErrors = validateOutput(parsed.parsed);
  const metadata = {
    engine: 'codex', cli_version: cfg.codex.cli_version_verified, requested_model: cfg.codex.model, requested_reasoning_effort: cfg.codex.reasoning_effort,
    process: { ok: run.ok, error_type: run.error, exit_code: run.exitCode, timed_out: run.timedOut, elapsed_ms: run.elapsedMs, started_at: run.startedAt, ended_at: run.endedAt, wrapper_pid: run.wrapperPid },
    telemetry: parsed.usage, thread_id: parsed.threadId ?? resumeThreadId,
    audit: { tool_types: parsed.toolTypes, valid_no_tools: parsed.toolTypes.length === 0 }, schema_errors: schemaErrors, schema_sha256: schemaSha256,
  };
  const normalized = parsed.parsed && schemaErrors.length === 0 ? parsed.parsed : null;
  await persistCall(callDir, prompt, run, metadata, normalized);
  return { engine: 'codex', ok: run.ok && normalized != null && parsed.toolTypes.length === 0, output: normalized, threadId: parsed.threadId ?? resumeThreadId, process: metadata.process, telemetry: parsed.usage, audit: metadata.audit, schemaErrors };
}

async function callClaude({ prompt, callDir, callId, deadlineAt }) {
  await ensureDir(callDir);
  await writeText(path.join(callDir, 'finding.schema.json'), schemaText);
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return expiredCall({ engine: 'claude', prompt, callDir });
  const args = ['-p', '--safe-mode', '--no-session-persistence', '--output-format', 'json', '--permission-mode', 'dontAsk', '--tools', '', '--max-turns', '1', '--model', cfg.claude.model];
  const run = await spawnManagedCapture(cfg.claude.command, args, { runId, callId, runDir, callDir, cwd: callDir, input: prompt, timeoutMs: Math.min(cfg.claude.timeout_ms, remaining) });
  const parsed = claudeParsed(run);
  const schemaErrors = validateOutput(parsed.parsed);
  const model = parsed.models.find(value => value.model === cfg.claude.model) ?? parsed.models.at(-1) ?? {};
  const telemetry = { model_reported: model.model ?? null, input_tokens: model.input_tokens ?? parsed.usage?.input_tokens ?? null, output_tokens: model.output_tokens ?? parsed.usage?.output_tokens ?? null, cache_read_input_tokens: model.cache_read_input_tokens ?? parsed.usage?.cache_read_input_tokens ?? null, cache_creation_input_tokens: model.cache_creation_input_tokens ?? parsed.usage?.cache_creation_input_tokens ?? null, estimated_cost_usd: parsed.estimatedCostUsd, all_model_usage: parsed.models };
  const metadata = {
    engine: 'claude', cli_version: cfg.claude.cli_version_verified, requested_model: cfg.claude.model,
    process: { ok: run.ok, error_type: run.error, exit_code: run.exitCode, timed_out: run.timedOut, elapsed_ms: run.elapsedMs, started_at: run.startedAt, ended_at: run.endedAt, wrapper_pid: run.wrapperPid },
    telemetry, audit: { tool_types: parsed.toolTypes, valid_no_tools: parsed.toolTypes.length === 0 }, schema_errors: schemaErrors, schema_sha256: schemaSha256,
  };
  const normalized = parsed.parsed && schemaErrors.length === 0 ? parsed.parsed : null;
  await persistCall(callDir, prompt, run, metadata, normalized);
  return { engine: 'claude', ok: run.ok && normalized != null && parsed.toolTypes.length === 0, output: normalized, process: metadata.process, telemetry, audit: metadata.audit, schemaErrors };
}

async function withRetry(makeCall, baseDir, callPrefix, maxAttempts) {
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await stopRequested(runDir)) break;
    const result = await makeCall(path.join(baseDir, `attempt-${attempt}`), `${callPrefix}-a${attempt}`);
    attempts.push(result);
    if (result.ok) return { ...result, attempts };
  }
  return attempts.length ? { ...attempts.at(-1), attempts } : { ok: false, attempts, output: null, process: { error_type: 'stopped', timed_out: false }, audit: { tool_types: [] } };
}

const scoutPrompt = caseBundle => `${scoutTemplate}\n\nThe JSON schema is:\n${schemaText}\n\nPUBLIC CASE BUNDLE\n${caseBundle}`;

async function runGroup(caseId, group, caseBundle, groupRoot, execution) {
  const executionDir = path.join(groupRoot, 'executions', `execution-${String(execution).padStart(3, '0')}`);
  await ensureDir(executionDir);
  const groupStarted = performance.now();
  const groupStartedAt = new Date().toISOString();
  const latencyMs = mode === 'latency' ? (await readJson(path.join(expDir, 'config', 'latency-equivalent.json'))).wall_clock_limit_ms : cfg.codex.timeout_ms * 3;
  const deadlineAt = Date.now() + latencyMs;
  const calls = [];
  let finalCall = null;
  const prefix = `${caseId}-${group}-e${execution}`;

  if (group === 'A') {
    const phase1 = await withRetry((dir, callId) => callCodex({ prompt: scoutPrompt(caseBundle), callDir: dir, callId, persistent: true, deadlineAt }), path.join(executionDir, 'phase-1-discover'), `${prefix}-discover`, cfg.codex.max_attempts);
    calls.push(...phase1.attempts);
    if (phase1.ok && phase1.threadId && !(await stopRequested(runDir))) {
      const challenge = `${scoutTemplate}\n\nContinue in the same context. Adversarially challenge your previous review: look for missed high-severity mechanisms and remove speculative or false blocks. Re-read only the public material already in this conversation. Output a complete revised JSON object.`;
      const phase2 = await withRetry((dir, callId) => callCodex({ prompt: challenge, callDir: dir, callId, persistent: true, resumeThreadId: phase1.threadId, deadlineAt }), path.join(executionDir, 'phase-2-challenge'), `${prefix}-challenge`, cfg.codex.max_attempts);
      calls.push(...phase2.attempts);
      if (phase2.ok && !(await stopRequested(runDir))) {
        const finalize = `${verifierTemplate}\n\nFinalize the review in this same context. Validate every retained item against the public evidence already present, deduplicate, and remove unsupported warnings. Output the complete final JSON object.`;
        finalCall = await withRetry((dir, callId) => callCodex({ prompt: finalize, callDir: dir, callId, persistent: true, resumeThreadId: phase1.threadId, deadlineAt }), path.join(executionDir, 'phase-3-finalize'), `${prefix}-finalize`, cfg.codex.max_attempts);
        calls.push(...finalCall.attempts);
      }
    }
  } else {
    const prompt = scoutPrompt(caseBundle);
    const scoutFns = group === 'B'
      ? [
          (dir, callId) => callCodex({ prompt, callDir: dir, callId, deadlineAt }),
          (dir, callId) => callCodex({ prompt, callDir: dir, callId, deadlineAt }),
        ]
      : [
          (dir, callId) => callCodex({ prompt, callDir: dir, callId, deadlineAt }),
          (dir, callId) => callClaude({ prompt, callDir: dir, callId, deadlineAt }),
        ];
    const scouts = await Promise.all(scoutFns.map((makeCall, index) => withRetry(makeCall, path.join(executionDir, `scout-${index + 1}`), `${prefix}-scout${index + 1}`, index === 0 || group === 'B' ? cfg.codex.max_attempts : cfg.claude.max_attempts)));
    for (const scout of scouts) calls.push(...scout.attempts);
    if (scouts.every(value => value.ok) && !(await stopRequested(runDir))) {
      const finalPrompt = buildVerifierPrompt({ template: verifierTemplate, schemaText, caseBundle, candidates: scouts.map(value => value.output), seed: `${seed}:${caseId}:verifier-candidates` });
      finalCall = await withRetry((dir, callId) => callCodex({ prompt: finalPrompt, callDir: dir, callId, deadlineAt }), path.join(executionDir, 'merge-verify'), `${prefix}-merge`, cfg.codex.max_attempts);
      calls.push(...finalCall.attempts);
    }
  }

  const wallMs = Math.round(performance.now() - groupStarted);
  const stopped = await stopRequested(runDir);
  const timedOut = calls.some(call => call.process?.timed_out) || Date.now() > deadlineAt;
  const status = finalCall?.ok ? 'complete' : (stopped ? 'stopped' : (timedOut ? 'timeout' : 'failed'));
  const result = {
    schema_version: 2, run_id: runId, mode, case_id: caseId, group, execution,
    merge_verification_pipeline_id: ['B', 'C'].includes(group) ? SHARED_MERGE_PIPELINE_ID : null,
    status, started_at: groupStartedAt, ended_at: new Date().toISOString(), wall_clock_ms: wallMs,
    deadline_ms: latencyMs, within_latency_budget: wallMs <= latencyMs,
    final_output: finalCall?.ok ? finalCall.output : null,
    usage: aggregateCalls(calls),
    attempts: calls.map(call => ({ engine: call.engine, ok: call.ok, process: call.process, telemetry: call.telemetry, audit: call.audit, schema_errors: call.schemaErrors })),
    missing_run_policy: finalCall?.ok ? null : 'Missing run; never treated as a no-risk finding.',
  };
  await writeJson(path.join(executionDir, 'result.json'), result);
  if (status === 'complete' && !(await exists(path.join(groupRoot, 'final.json')))) await writeJson(path.join(groupRoot, 'final.json'), result);
  return result;
}

const orderedCases = shuffled(caseIds, `${seed}:cases`);
for (const caseId of orderedCases) {
  const caseDir = path.join(expDir, 'cases', 'public', caseId);
  const caseBundle = await serializePublicCase(caseDir);
  for (const group of shuffled(requestedGroups, `${seed}:${caseId}:groups`)) {
    const groupRoot = path.join(runDir, caseId, `group-${group}`);
    const finalFile = path.join(groupRoot, 'final.json');
    if (await exists(finalFile)) {
      const existing = await readJson(finalFile);
      if (existing.run_id === runId && existing.status === 'complete') {
        state.units[`${caseId}:${group}`].status = 'complete';
        continue;
      }
    }
    if (await stopRequested(runDir)) break;
    const execution = await startUnit(runDir, state, caseId, group);
    console.log(`[${runId}] ${caseId} group ${group} starting execution=${execution}`);
    const result = await runGroup(caseId, group, caseBundle, groupRoot, execution);
    await finishUnit(runDir, state, caseId, group, result.status);
    console.log(`[${runId}] ${caseId} group ${group} ${result.status} wall=${result.wall_clock_ms}ms findings=${result.final_output?.findings?.length ?? 'missing'}`);
  }
  if (await stopRequested(runDir)) break;
}

const results = [];
for (const caseId of orderedCases) {
  for (const group of requestedGroups) {
    const finalFile = path.join(runDir, caseId, `group-${group}`, 'final.json');
    if (await exists(finalFile)) {
      const result = await readJson(finalFile);
      results.push({ case_id: caseId, group, status: result.status, wall_clock_ms: result.wall_clock_ms, within_latency_budget: result.within_latency_budget, findings: result.final_output?.findings?.length ?? null, release_decision: result.final_output?.release_decision ?? null, usage: result.usage, merge_verification_pipeline_id: result.merge_verification_pipeline_id });
    } else {
      const unit = state.units[`${caseId}:${group}`];
      results.push({ case_id: caseId, group, status: unit?.status ?? 'pending', wall_clock_ms: null, within_latency_budget: null, findings: null, release_decision: null, usage: null, merge_verification_pipeline_id: ['B', 'C'].includes(group) ? SHARED_MERGE_PIPELINE_ID : null });
    }
  }
}
const complete = results.length === caseIds.length * requestedGroups.length && results.every(result => result.status === 'complete');
const stopped = await stopRequested(runDir);
const summary = { schema_version: 2, run_id: runId, mode, complete, stopped, state: completedCount(state), results };
await writeJson(path.join(runDir, 'summary.json'), summary);

let smokeChecks = null;
if (mode === 'smoke') {
  const files = await listFiles(runDir);
  const promptFiles = files.filter(file => path.basename(file) === 'prompt.txt');
  const metadataFiles = files.filter(file => path.basename(file) === 'metadata.json');
  const promptIsolation = [];
  for (const file of promptFiles) {
    const text = await readFile(file, 'utf8');
    promptIsolation.push(!/cases[/\\]private|ground-truth|case-map|private-reproducer|expected_release_decision|known_sev01_risks|"variant"\s*:/i.test(text));
  }
  const metadata = await Promise.all(metadataFiles.map(file => readJson(file)));
  const offlineFile = path.join(expDir, 'analysis', 'generated', 'offline-tests.json');
  const offline = await readJson(offlineFile).catch(() => null);
  const checks = {
    abc_complete: complete && requestedGroups.length === 3 && ['A', 'B', 'C'].every(group => requestedGroups.includes(group)),
    input_isolation: promptFiles.length > 0 && promptIsolation.every(Boolean),
    schema_integrity: metadata.length > 0 && metadata.every(value => value.schema_sha256 === schemaSha256),
    no_tool_calls: metadata.length > 0 && metadata.every(value => value.audit?.valid_no_tools === true),
    no_timeouts: metadata.every(value => value.process?.timed_out !== true),
    timeout_mechanism_tested: offline?.mechanisms?.timeout_tree_kill === true,
    stop_mechanism_tested: offline?.mechanisms?.exact_run_stop_tree_kill === true,
    logs_complete: metadataFiles.length > 0 && metadataFiles.every(file => ['prompt.txt', 'stdout.txt', 'stderr.txt', 'finding.schema.json', 'process-spec.json'].every(name => files.includes(path.join(path.dirname(file), name)))),
    usage_present: results.every(result => result.usage?.calls > 0 && result.usage?.input_tokens > 0 && result.usage?.output_tokens > 0),
    statistics_complete: results.length === 3 && ['A', 'B', 'C'].every(group => results.some(result => result.group === group)),
    shared_BC_merge_pipeline: results.filter(result => ['B', 'C'].includes(result.group)).every(result => result.merge_verification_pipeline_id === SHARED_MERGE_PIPELINE_ID),
  };
  smokeChecks = { schema_version: 1, run_id: runId, checks, all_passed: Object.values(checks).every(Boolean) };
  await writeJson(path.join(runDir, 'smoke-checks.json'), smokeChecks);
}

const cleanComplete = complete && !state.recovered && !stopped && results.every(result => (result.usage?.tool_calls ?? 0) === 0);
const scorable = cleanComplete && ['cost', 'latency'].includes(mode);
const reasonCodes = [];
if (!complete) reasonCodes.push('abc_or_case_matrix_incomplete');
if (state.recovered) reasonCodes.push('recovered_run_budget_not_pristine');
if (stopped) reasonCodes.push('stop_requested');
if (mode === 'smoke') reasonCodes.push('smoke_diagnostic_only');
if (mode === 'cost') reasonCodes.push('cost_mode_calibration_only_no_equal_cost_claim');
await writeEligibility(runDir, { run_id: runId, mode, scorable, permanent_exclusion: false, calibration_only: true, formal_product_evidence: false, reason_codes: reasonCodes });

const lifecycle = complete ? 'completed' : (stopped ? 'stopped' : 'failed');
await finishRunState(runDir, state, lifecycle);
if ((mode === 'smoke' && smokeChecks?.all_passed) || (mode !== 'smoke' && scorable)) await writeText(path.join(expDir, 'runs', `latest-${mode}.txt`), runId + '\n');
console.log(`${complete ? 'RUN_COMPLETE' : 'RUN_INCOMPLETE'} ${runId}`);
if (!complete || (mode === 'smoke' && !smokeChecks?.all_passed)) process.exitCode = 2;

