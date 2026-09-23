---
id: PLAT-011
title: Isolate Local Semantic Models in a Feature Provider Package
status: accepted
date: 2026-09-20
domains: [platform, impact, retrieval]
supersedes: []
superseded_by: []
---

# Isolate Local Semantic Models in a Feature Provider Package

## Context

Issue #468 reframes semantic enrichment around a small CPU-local, non-generative decision layer:
Docuvia supplies bounded structural evidence/candidates, a local model scores those candidates, and
authoritative mechanisms such as LSP remain available for verification.

The model is intentionally expected to change faster than Docuvia's graph/orchestration contracts.
Candidate experiments include generic encoders, pair classifiers, and CUA/Jev-style option
scorers. Allowing any model runtime, tokenizer, tensor, embedding shape, model path, or weight
format to leak into `lib/core` or `lib/ui-core` would couple product semantics to whichever POC
wins first and would violate PLAT-001's Virtual Contracts architecture.

We therefore need the architecture boundary before we need the model.

## Decision

Create a standalone implementation package, `lib/semantic-decision`
(`@workspace/semantic-decision`), as the exclusive home of the local semantic model and its
runtime dependencies.

The integration shape is:

```text
Docuvia Tier A / workflow
        |
        | bounded context + options
        v
@workspace/contracts
ISemanticDecisionProvider
        |
        | docuviaFactory token
        v
@workspace/semantic-decision
(model + runtime stay here)
        |
        v
option probabilities + model provenance
```

### Contract boundary

`lib/contracts` owns only model-agnostic types:

- a typed task;
- compact caller-prepared context;
- a complete bounded option set;
- explicit `candidate`, `unknown`, and `verify` option kinds;
- per-option probability-like scores;
- minimal model identity for provenance/calibration;
- availability/honest-degradation state.

The provider **must score only the supplied option set**. It cannot crawl the repository or invent
an out-of-band dependency target.

### Policy stays in Docuvia

The provider does **not** own product thresholds. Accept/abstain/verify policy, required precision,
risk-specific escalation, provenance persistence, and LSP routing remain Docuvia
domain/orchestration responsibilities.

This prevents a model replacement or recalibration from silently changing product semantics.

### Package ownership

All model-specific artifacts belong only to `lib/semantic-decision`, including future:

- weights/model files;
- tokenizer or byte encoder;
- ONNX/WASM/native inference runtime;
- tensor/embedding types;
- model loading/cache details;
- model-specific preprocessing/postprocessing.

No other implementation package may import these details. Unlike ordinary PLAT-009 Domain →
Technology Provider directionality, `lib/core` is also forbidden from directly importing
`@workspace/semantic-decision`; it and all upper layers reach the capability only through
`@workspace/contracts` and `TOKENS.SemanticDecisionProvider`. This exception is mechanically
enforced by the layer-boundary lint/test suite.

The Presentation composition root may import `@workspace/semantic-decision` solely for its
self-registration side effect, matching the existing provider bootstrap pattern.

### First slice

This ADR's first implementation intentionally includes **no model**. The feature provider
self-registers and reports honest unavailability. This proves the package/contract/layer boundary
before introducing model/runtime dependencies.

A resident machine-wide service, shared model lifetime, thresholds, graph persistence, training,
and a specific model choice are separate follow-up decisions. This ADR does not introduce a
daemon.

## Consequences

- **Positive:** model/runtime churn is quarantined from Docuvia core and workflows.
- **Positive:** CUA/Jev-style scorers, pair classifiers, or encoder baselines can implement the same
  contract without changing consumers.
- **Positive:** bounded candidates are enforced at the interface boundary; unknown/verify remain
  explicit legal outcomes.
- **Positive:** tests can mock `ISemanticDecisionProvider` without loading a model.
- **Positive:** model provenance can be carried without leaking runtime details.
- **Negative:** one extra package, factory token, and mapping layer are required.
- **Negative:** model-specific optimizations cannot bypass the contract; changing the contract
  requires an explicit architecture/API change.
- **Deferred:** lifecycle optimization such as one loaded model per machine remains unresolved until
  benchmarks justify it.

## Phase 0 contract amendment (2026-09-21)

The [Phase 0 scope and acceptance contract](../../analysis/semantic-decision-phase0-contract.md)
fixes schema version 1, request/evidence identity, capability/size limits, control/error semantics
and boundary validation. All three tasks use independent option scores; edge-relation is
multi-target, not a forced single-target softmax. Raw scores, calibrated confidence, versioned
policy decisions and authoritative facts are separate concepts. Only a calibrated response may
claim a calibration version; no score becomes verified evidence.

Pure validators live in Domain Core behind a contracts token. The existing isolated provider
continues to report unavailable with no supported capabilities. No production workflow invokes
it, so IMPT-002 and all existing deterministic/LSP behavior remain in force. Corpus, model,
shadow/policy, persistence and shared-service gates remain future work.
