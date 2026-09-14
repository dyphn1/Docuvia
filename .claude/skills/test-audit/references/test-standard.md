# Docuvia Test Quality Standard

This standard deliberately separates two independent questions:

1. **Coverage shape** — does a feature have tests for the important classes of behavior?
2. **Assertion honesty** — do those tests prove exact correctness instead of merely proving that something exists?

The category scanner implements Axis 1. The existing weak-assertion audit implements Axis 2. Neither metric replaces the phase-based contract score from #371 or behavioral precision/recall/F1 from #192.

## Axis 1 — Functional test categories

Use these explicit markers in test names or nearby test descriptions:

- `[happy]` — normal supported inputs and expected successful behavior.
- `[invalid-input]` — invalid/unsupported caller input and boundary validation.
- `[error-handling]` — a deliberately triggered failure path with exact error/result assertions.
- `[stress]` — load, concurrency, scale, repeated execution, or another capacity boundary that can expose state/race/resource defects.
- `[state-diff]` — persisted or externally observable state is captured before and after the operation and the exact intended delta is asserted.

Markers are evidence labels only. A marker does not prove the test is good; assertions still need to satisfy Axis 2 and the #371 quality rules.

## Tier requirements

The scanner classifies each tracked `*.test.*` / `*.spec.*` file deterministically.

| Tier | Detection | Required categories |
| --- | --- | --- |
| persistence | `*.integration.test.*` or `*.integration.spec.*` | all five |
| workflow | path contains `/workflows/` or filename contains `workflow` | happy, invalid-input, error-handling, state-diff |
| utility | all other test/spec files | happy, invalid-input, error-handling |

`stress` remains optional for workflow/utility files because requiring synthetic load tests for every narrow pure contract would create noise rather than useful signal. A persistence integration test has no such exemption: the launch-gate target is 5/5.

## Scanner output

Run:

```bash
bash .claude/skills/test-audit/scripts/category-scan.sh
```

The scanner prints one deterministic row per tracked test file and finishes with:

```text
FAIL_COUNT=N
```

For machine-readable evidence:

```bash
bash .claude/skills/test-audit/scripts/category-scan.sh \
  --json-out /tmp/test-category.json
```

The JSON report includes:

- `filesScanned`
- `passCount`
- `failCount`
- `missingRequiredTotal`
- per-tier totals
- per-file observed/required/missing categories and `X/5` score

A file is counted in `FAIL_COUNT` when at least one category required by its tier is missing.

## CI ratchet

`scripts/test-category-ratchet.sh` scans the exact PR base and the current HEAD with the same scanner.

Initial rollout is deliberately **ratchet-only**:

- HEAD `FAIL_COUNT` may be equal to or lower than base.
- HEAD `FAIL_COUNT` may not increase.
- The repository is not forced to reach 5/5 everywhere in one migration PR.
- The base result is recomputed every run; no historical hand-entered baseline is trusted.

CI uploads both base/head JSON reports as evidence. As category coverage improves, the executable baseline automatically tightens with main.

## `[state-diff]` requirement

A real state-diff test must assert a meaningful before/after transition, not merely perform the operation twice. For graph persistence, a useful shape is:

1. persist source call-sites;
2. read the durable `ast_call_sites` and `node_links` state;
3. re-persist changed call-sites;
4. assert the stale call-site/edge disappeared and the new state is exact.

This directly targets the class of defect described by #230: parsing may find call-sites while persistence silently loses or retains the wrong graph edges.

## Relationship to other quality metrics

- **#263 category coverage**: whether the repository has the right *kinds* of tests.
- **#371 phase score**: whether tests validate the complete contract honestly, deterministically, and with source traceability.
- **#192 impact eval**: behavioral accuracy measured by precision/recall/F1.

These are complementary axes. Do not translate `5/5` into a contract score, and do not translate F1 into category coverage.