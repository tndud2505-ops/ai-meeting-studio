# Release-risk multimodel experiment

This directory tests one narrow claim:

> Under a strictly matched wall-clock budget, does heterogeneous independent discovery (Codex + Claude) followed by fixed validation find more real Sev0/Sev1 release risks than isolated same-model self-ensembling followed by the identical validation stage, without increasing false release blocks or human review burden?

The formal primary comparison is **C versus B**. Group A is a secondary baseline. The six local cases are calibration cases only: three executable historical defect/safe pairs from one repository. They verify the harness, budgets, leakage controls, scoring, and blind-review materials. They never enter a formal product score.

## Measurement amendment

`amendments/amendment-002.yaml` records the interpretation correction without changing the locked preregistration:

- Equal invocation counts are not equal cost.
- Codex and Claude do not expose a comparable per-run incremental subscription-cost field.
- `cost` mode remains a program calibration only and cannot support an equal-cost conclusion.
- The executable primary regime is the preregistered 240-second equal-wall-clock mode.

## Safety and evidence boundary

- Participant prompts contain only a serialized copy of one `cases/public/<case-id>` directory.
- Claude is launched with `--safe-mode`, no session persistence, and an empty tool set.
- Codex is launched read-only with user config, rules, apps, memories, plugins, and multi-agent behavior disabled. Any emitted tool call invalidates the attempt.
- Each managed CLI call runs below a wrapper whose command line contains the exact experiment run id and call id. `stop-run.mjs` terminates a process tree only after both identities are confirmed.
- Hidden answers, paired identities, fix commits, reproducer output, group outputs, and judge decisions never enter participant prompts.
- Calibration ground truth comes from historical fixes plus focused executable reproducers. Model assertions are never promoted to ground truth.
- No Roundtable product file, CI/CD flow, external repository, or release flow is changed by the experiment.

## Groups

- **A — continuous strongest model:** three sequential turns in one Codex context: discover, challenge, finalize.
- **B — isolated same-model ensemble:** two independent Codex scouts followed by `fixed-codex-merge-verify-v1`.
- **C — isolated heterogeneous ensemble:** one Codex scout and one Claude scout followed by the same `fixed-codex-merge-verify-v1`.

The shared B/C pipeline is machine-declared in `config/protocol.json` and tested.

## Offline gate

From the repository root:

```powershell
node experiments/release-risk-multimodel/scripts/check-lock.mjs
node experiments/release-risk-multimodel/scripts/verify-cases.mjs
node experiments/release-risk-multimodel/scripts/verify-offline.mjs
node experiments/release-risk-multimodel/scripts/status.mjs
```

`verify-offline.mjs` runs both the unchanged Roundtable test suite and the experiment tests. Detailed logs stay under `analysis/generated/offline-tests/`. `status.mjs` prints only a stage code, completed milestone count, and one next command; its detailed record is `analysis/generated/status-detail.json`.

## Run, resume, and stop

A stable run id makes the command idempotent. Complete group outputs are reused; incomplete execution directories are preserved and a new execution record is created on resume. A recovered run is marked non-scorable because its original budget is no longer pristine.

```powershell
node experiments/release-risk-multimodel/scripts/run-experiment.mjs --mode smoke --case first --groups A,B,C --run-id smoke-abcv3-20260722
node experiments/release-risk-multimodel/scripts/stop-run.mjs --run-id smoke-abcv3-20260722
```

The two pre-refactor smoke runs are permanently listed in `runs/exclusions.json` with `scorable=false` and `may_reuse_outputs=false`. Their original manifests, logs, partial outputs, and failure evidence remain unchanged.

After one full smoke passes every check:

```powershell
node experiments/release-risk-multimodel/scripts/run-experiment.mjs --mode latency --cases all --groups A,B,C --run-id latency-calibration-20260722-v1
node experiments/release-risk-multimodel/scripts/blind.mjs --run latency-calibration-20260722-v1
node experiments/release-risk-multimodel/scripts/score-calibration.mjs --run latency-calibration-20260722-v1
node experiments/release-risk-multimodel/scripts/analyze.mjs --run latency-calibration-20260722-v1
```

`cost` mode may also be exercised as call-equivalent program calibration, but it is not a formal equal-cost regime.

## Human blind review

`blind.mjs` strips model, group, timing, CLI, and vendor identity, randomizes case/submission/finding order, and creates two independent review CSVs. Two qualified engineers review independently; disagreements go to a third engineer. Deterministic calibration scoring is explicitly provisional. It cannot substitute for final human blind adjudication.

## Formal gate

Formal product evidence requires the preregistered minimum sample, cross-repository/domain coverage, complete two-reviewer adjudication, and delayed outcome validation. If those gates are absent, the conclusion is **evidence insufficient**, not a padded case pool or a model self-grade.

