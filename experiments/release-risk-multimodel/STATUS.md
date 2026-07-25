# Status

- Phase: human blind review pending
- Offline gate: Roundtable 179/179; experiment harness 9/9; real timeout-tree and exact-run-id stop tests passed
- Smoke: `smoke-abcv3-20260722` completed A/B/C, passed every isolation/schema/tool/timeout/log/usage/statistics check, and remains non-scorable because smoke is diagnostic only
- Equal-wall-clock calibration: `latency-calibration-20260722-v1` completed all 18 case/group units under 240 seconds with zero failed, timed-out, stopped, or tool-using attempts
- Provisional deterministic calibration match: A recall 1/3 and safe false blocks 2/3; B recall 3/3 and safe false blocks 2/3; C recall 1/3 and safe false blocks 1/3
- Primary provisional comparison: C minus B recall is -2/3 with bootstrap 95% interval [-1, 0]; C-only matched cases are zero. This is not final human adjudication.
- Blind packet: 18 anonymous submissions plus two independent reviewer CSVs generated under `judging/blinded/latency-calibration-20260722-v1/`
- Evidence boundary: six local calibration cases are three executable historical defect/safe pairs from one repository; they test the program, not Roundtable product effectiveness
- Blocking final conclusion: two qualified blind reviewers, possible third-reviewer adjudication, formal cross-repository sample, and delayed outcome evidence remain unavailable
- Current product action: downgrade multimodel release review to an experiment; do not treat it as the product center or a proven release gate
- Idempotent resume command: `node experiments/release-risk-multimodel/scripts/status.mjs`

Detailed status is machine-written to `analysis/generated/status-detail.json`; aggregate analysis is under `analysis/generated/latency-calibration-20260722-v1/`.
