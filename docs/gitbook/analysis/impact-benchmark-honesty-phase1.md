# Impact benchmark honesty — Phase 1 adversarial corpus

Source: [#508](https://github.com/dyphn1/Docuvia/issues/508).

Phase 1 turns the Phase 0 scoring contract into an end-to-end adversarial
benchmark against the shipped `docuvia impact <target> --format=json` path.

The goal is not to make the benchmark harder by adding arbitrary cases. The
goal is to prove that the benchmark detects false positives and wrong target
resolution instead of rewarding only positive recall.

## Scope

Phase 1 adds a synthetic adversarial corpus and an integration evaluator.

It must:

- keep the existing eight #192/#393 positive corpus cases unchanged;
- score real CLI output through the Phase 0 honesty scorer;
- retain evidence provenance (`static`, `lsp-fallback`,
  `dynamic-candidate`);
- identify the node actually selected by the shipped impact resolver using the
  deterministic STOR-005 `node_key`;
- include negative controls that demonstrate the gate can fail.

Phase 1 does not tune production resolution merely to improve benchmark
numbers. A discovered product defect is reported as a product defect; a test
gap is not rewritten into an expected pass.

## Adversarial fixture contract

The Phase 1 corpus contains the following independent scenarios.

| Scenario | Golden intent | What it proves |
| --- | --- | --- |
| `zero-dependents` | negative | a real target with no dependents produces no confirmed dependency prediction |
| `same-name-lure` | negative + target identity | an unrelated same-name definition with a caller cannot steal the query and create a false positive |
| `duplicate-symbol-resolution` | confirmed positive + target identity | duplicate exact names in separate modules resolve to the fixture's canonical definition, not the decoy |
| `exact-over-like` | negative + target identity | an exact symbol match wins over more-connected LIKE/substring candidates |
| `near-match-noise` | negative | similar module/path/symbol names are not returned as dependents of an exact target |
| `positive-with-decoy` | confirmed positive | the true dependent is returned while an unrelated decoy remains absent |

The duplicate-name fixtures intentionally give the canonical node a
deterministic semantic advantage already documented by the current resolver:
non-test/spec definitions outrank test/spec lures, then connectivity breaks
remaining same-name ties. The benchmark still records the selected
`node_key`; a wrong binding cannot pass because its dependency set happened
to look plausible.

Interface/implementation overload collisions are not added in this phase
because the current L2 CLI surface does not expose a declaration-kind-qualified
target syntax. Treating one bare method name as a uniquely addressable golden
identity would manufacture benchmark truth that the public contract cannot
express. If qualified target syntax is added later, that collision family
becomes mandatory corpus coverage.

## Observing target identity without duplicating the resolver

The evaluator must not run a second copy of `findNodeByName`'s ranking SQL and
call that the observed result.

For symbol targets, `impact` includes the selected symbol's containing file in
the raw blast-radius entries through the graph's `contains` relationship.
The evaluator uses that product output as a fingerprint:

1. read all candidate nodes matching the case target from `l2_nodes`;
2. map each candidate to its deterministic `node_key` and containing file;
3. find which candidate's containing file appears in the real impact result;
4. record that candidate's `node_key` as `observedTargetIdentity`;
5. remove only that containing-file context entry before dependency scoring.

If exactly one candidate cannot be identified, the evaluator must surface an
explicit error/ambiguity outcome rather than silently choosing a database row.

This keeps target-identity measurement independent from the resolver ranking
implementation under test.

## Evidence mapping

A real blast-radius entry maps to Phase 0 evidence as follows:

- omitted `edgeSource` -> `static`;
- `edgeSource: "lsp-fallback"` -> `lsp-fallback`;
- `edgeSource: "dynamic-candidate"` -> `dynamic-candidate`.

The selected target's containing-file context is excluded from dependency
predictions. All other returned files remain visible, including unexpected
ones.

## Phase 1 gates

The adversarial slice passes only when all of these hold:

1. every Phase 1 case executes without evaluator error;
2. every case's observed status matches its golden status;
3. negative specificity is `1.000`;
4. negative false-positive rate is `0.000`;
5. target-resolution wrong-target rate is `0.000`;
6. all identity-checked resolved cases bind to the expected `node_key`;
7. positive cases have precision/recall/F1 `1.000`;
8. the original eight-case positive corpus still produces the same normalized
   results on repeated evaluation;
9. repeated Phase 1 evaluation is byte-for-byte deterministic after
   normalization;
10. a poisoned prediction control makes the negative gate fail;
11. a poisoned target-identity control makes the wrong-target gate fail.

No aggregate average may hide a failed mandatory gate.

## Test lane

The corpus exercises the assembled CLI, SQLite graph, AST ingestion, and impact
workflow, so it belongs in the CLI integration/E2E lane. Pure scorer behavior
remains covered by the Phase 0 unit tests.

TDD sources:

- issue #508;
- issue #192;
- issue #193;
- `docs/gitbook/analysis/impact-benchmark-honesty-phase0.md`;
- `docs/gitbook/architecture/testing-and-quality-architecture.md`;
- `docs/gitbook/guidelines/phase-based-test-quality-hardening.md`.

## Exit gate

Phase 1 is complete when the six adversarial scenarios pass the gates above,
the original eight positive cases remain unchanged, poisoned controls prove
that false positives and wrong-target bindings are observable failures, and the
full repository CI remains green.
