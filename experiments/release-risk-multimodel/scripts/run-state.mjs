import path from 'node:path';
import { exists, readJson, writeJson } from './lib.mjs';

const stateFile = runDir => path.join(runDir, 'state.json');
const unitKey = (caseId, group) => `${caseId}:${group}`;

export async function createOrLoadState(runDir, manifest) {
  if (await exists(stateFile(runDir))) {
    const state = await readJson(stateFile(runDir));
    if (state.run_id !== manifest.run_id || state.mode !== manifest.mode) throw new Error('Run state identity mismatch');
    return state;
  }
  const units = {};
  for (const caseId of manifest.requested_cases) {
    for (const group of manifest.requested_groups) units[unitKey(caseId, group)] = { case_id: caseId, group, status: 'pending', executions: 0 };
  }
  const state = {
    schema_version: 1,
    run_id: manifest.run_id,
    mode: manifest.mode,
    lifecycle: 'initialized',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    recovered: false,
    units,
    history: [],
  };
  await writeJson(stateFile(runDir), state);
  return state;
}

export async function saveState(runDir, state, event, detail = {}) {
  state.updated_at = new Date().toISOString();
  if (event) state.history.push({ at: state.updated_at, event, ...detail });
  await writeJson(stateFile(runDir), state);
}

export async function prepareRunState(runDir, state) {
  const interrupted = Object.values(state.units).filter(unit => unit.status === 'running');
  if (interrupted.length || ['running', 'failed', 'stopped'].includes(state.lifecycle)) {
    state.recovered = true;
    for (const unit of Object.values(state.units)) if (['running', 'failed', 'stopped'].includes(unit.status)) unit.status = 'pending';
  }
  if (state.lifecycle === 'completed') return state;
  state.lifecycle = 'running';
  await saveState(runDir, state, state.recovered ? 'run_resumed' : 'run_started');
  return state;
}

export async function startUnit(runDir, state, caseId, group) {
  const unit = state.units[unitKey(caseId, group)];
  if (!unit) throw new Error('Unknown run unit');
  unit.status = 'running';
  unit.executions += 1;
  unit.started_at = new Date().toISOString();
  await saveState(runDir, state, 'unit_started', { case_id: caseId, group, execution: unit.executions });
  return unit.executions;
}

export async function finishUnit(runDir, state, caseId, group, status) {
  if (!['complete', 'failed', 'timeout', 'stopped'].includes(status)) throw new Error('Invalid unit status');
  const unit = state.units[unitKey(caseId, group)];
  unit.status = status;
  unit.ended_at = new Date().toISOString();
  await saveState(runDir, state, 'unit_finished', { case_id: caseId, group, status });
}

export function completedCount(state) {
  const units = Object.values(state.units);
  return { complete: units.filter(unit => unit.status === 'complete').length, total: units.length };
}

export async function finishRunState(runDir, state, lifecycle) {
  state.lifecycle = lifecycle;
  state.ended_at = new Date().toISOString();
  await saveState(runDir, state, 'run_finished', { lifecycle });
}

