# Experiment readiness check — 2026-07-22

## Verified facts

- Repository: `C:\Users\xiaoJ\Documents\Roundtable`, branch `master`, HEAD `7c4639b2b628b76ec18ab45ce375b5972c77ba54` at experiment preparation.
- Existing user work is present in eight tracked product/test files. The experiment does not reset, delete, overwrite, or modify those files.
- No repository-level `AGENTS.md` exists. The root project has no dependencies/devDependencies and requires Node 20 or newer.
- Before this refactor, `npm.cmd test` passed 179/179 on the live dirty worktree.
- Docker and Podman are absent. Historical snapshots and focused reproducers are the available safe calibration mechanism.
- The original preregistration SHA-256 is `3ad86f61f252a8186dc82a8c1bf5cc927b07319fc6f692d92dd32ac794bc9d65` and must remain unchanged.
- Six public calibration bundles exist. Private executable probes confirmed three defect variants and three safe controls.
- Codex CLI 0.144.6 and Claude Code 2.1.186 previously completed real minimal calls. No separately billed API is used.
- The first historical smoke failed on Windows absolute-schema path handling. The second was manually stopped with A/B/C incomplete. Both are permanently non-scorable and non-reusable.

## Execution interpretation

- Equal call count is only a call-equivalent calibration proxy, not equal cost.
- The formal executable comparison uses the strict 240-second wall-clock regime.
- B and C use the same fixed Codex merge/verification function and prompt. C versus B is primary; A is secondary.
- A timeout, process failure, tool violation, schema failure, or manual stop is a missing run, never a zero-finding run.
- A resumed run preserves records but is non-scorable because its original budget is not pristine.

## Evidence limits

- One small Node repository does not meet the formal domain or repository gate.
- Process and prompt isolation are auditable but are not an OS/container security principal.
- Human review time cannot be fabricated. Two engineers and a disagreement reviewer remain external requirements.
- Six-case results can show that the procedure works; they cannot prove Roundtable product effectiveness.

## Formal requirements still missing

- At least 24 preregistered pairs across at least four repositories and all required domains.
- Two independent qualified blind reviewers, plus a third reviewer only for disagreements.
- Delayed validation against real release outcomes.

