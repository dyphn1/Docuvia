# Exact caller policy for calls edges

## Meaning of exact caller

The `exact-enclosing-v2` policy assigns each `calls` edge to the unique innermost function node whose AST line span contains the call. It does not trust `ParsedCall.sourceFunction`, which can describe an outer function or callback parameter instead of the function body that encloses the call.

- **Callbacks and arrow functions:** calls in a parsed callback or arrow body use that function's node when its span is uniquely innermost.
- **Nested functions:** the smallest enclosing function span wins, including when the parser's legacy caller hint names an outer function.
- **Class field initializers:** a call evaluated by the initializer itself uses the file node. A call inside a parsed arrow/function body assigned to a field uses that function node.
- **Top-level code:** calls outside every function span use the file node.
- **Tied spans:** when multiple innermost function nodes have the same span, use the file node. This preserves the conservative file-node fallback established by #573.
- **Missing or invalid spans:** use the file node.

Function node keys are the same persisted keys used by the graph: `buildQualifiedBaseKey(file, name, containerName)` followed by `buildUniqueNodeKey`. That yields `<file>#<qualified-name>` normally, `@L<startLine>` on a collision, and a numeric suffix if that key is already occupied. The file-node key is the workspace-relative file path. A call whose parsed function has no graph node falls back to that file key.

## Uniformity and persisted policy

The caller policy applies to every `calls` edge in a graph, whether or not a call has a proven Q1/Q2/Q3 target. Proof projection may replace the target; it uses the same caller policy as unresolved and unproven calls. The exact caller remains separately recorded in `call_site_resolutions.caller_node_key`.

The historical policy is identified as `scope-resolver-v1`; `exact-enclosing-v1` is the earlier exact projection and `exact-enclosing-v2` is the exact projection with lexical context links. `contains` continues to mean file ownership only: each file owns its symbols through `contains` edges under every policy. V2 adds two separate relationships:

- `lexical_parent` links an enclosing function to a nested function when their AST spans identify a unique parent.
- `lexical_owner` links a class or struct to a member function or field-initializer function when no enclosing function span applies.
- `caller_candidate` records the distinct function named by the legacy ScopeResolver attribution when it has no persisted `lexical_parent` path from the exact caller. It is an explicit, lower-confidence context candidate, not a containment or dependency claim.

Impact follows `lexical_parent` links from an exact callback caller, then includes enclosing functions' direct dependents and their containing-file context. When the exact caller has no lexical-parent path to the distinct ScopeResolver-attributed function, impact also includes that function as a `caller-candidate` context row. This preserves the historical named-function impact set without claiming that tied or crossing spans establish containment. Candidate context is terminal: impact does not expand its incoming dependents. `lexical_owner` is also terminal: impact may include the class/struct as context, but does not continue through the owner or expand its incoming dependents. File `contains` links provide ownership context and are never followed as lexical parents. Impact does not recurse over ordinary caller edges, preserving the bounded call-hop behavior. Equal or crossing AST spans remain unlinked, and exact caller attribution still falls back to the file node for ties.

`caller_candidate`, `lexical_parent`, and `lexical_owner` are structural context relations. They are available to impact's bounded context walk but are excluded from query dependency context and topology dependency projections. They never become dependency edges. `contains` remains file ownership only.

Only `exact-enclosing-v2` writes `lexical_parent`, `lexical_owner`, and `caller_candidate`; `scope-resolver-v1` and `exact-enclosing-v1` do not persist these structural links.

The caller candidate rule is deliberately scoped to a missing `lexical_parent` path and an explicit legacy function-node attribution. It does not infer node kinds from keys, alter call targets, or convert ambiguity into containment. This lets v2 preserve ScopeResolver's named-function impact context while retaining exact caller attribution and truthful lexical links.

The deterministic full-source parity audit parsed 926 files and compared ImpactService for all 4,355 callee nodes with incoming `calls` edges under either policy. V2 had zero missing named-function impact nodes against ScopeResolver (`5,666` v1 impact pairs; `7,711` v2 pairs), so `exact-enclosing-v2` is now the default. Its additional function context comes from exact lexical parents and explicit terminal `caller_candidate` rows.

## Selecting the active policy

The product composition path (`registerCoreProviders`) constructs the graph persister with the active policy resolved from `DOCUVIA_CALLS_CALLER_POLICY` (`scope-resolver-v1`, `exact-enclosing-v1` or `exact-enclosing-v2`). Unset or blank means the `exact-enclosing-v2` default; an unknown value fails with `INVALID_INPUT` rather than silently falling back. `docuvia init` and `analyze` persist under the active policy, and `analyze` compares the stored policy with the active policy: a mismatch triggers one full rebuild before the SHA no-op path. This lets historical or explicitly selected ScopeResolver graphs migrate once while preserving the selected policy thereafter.

The completed full-init or full-rebuild workflow records its policy under the project-scoped `docuvia_meta` key `graph.calls-projection.caller-policy.v1:<projectId>`. This caller-policy stamp is separate from strict-proof source-index completeness: a skipped oversized or failed file can prevent strict proofs without making the persisted call edges fall back to legacy impact traversal. The workflow writes the stamp only after its full caller projection and path cleanup finish, so delta ingestion and a fresh init interpret the same stored calls consistently. Snapshot metadata carries a separately versioned `callsProjectionCallerPolicy` capability so hydration can restore the policy. Snapshots without a valid capability are treated as historical ScopeResolver graphs. `analyze` detects a policy mismatch before the SHA no-op path and performs a full graph rebuild. The generic metadata table and additive snapshot capability make a schema migration unnecessary.

V1 and v2 use the same uniform exact caller attribution for every `calls` edge. V2 adds lexical containment links and impact traversal. Strict proof scope, target selection, candidate generation, observations, and source content hash semantics remain unchanged.
