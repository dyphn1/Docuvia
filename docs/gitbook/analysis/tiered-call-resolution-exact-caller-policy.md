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

Impact follows `lexical_parent` links from an exact callback caller, then includes enclosing functions' direct dependents and their containing-file context. `lexical_owner` is terminal: impact may include the class/struct as context, but does not continue through the owner or expand its incoming dependents. File `contains` links provide ownership context and are never followed as lexical parents. Impact does not recurse over ordinary caller edges, preserving the bounded call-hop behavior. Equal or crossing AST spans remain unlinked because exact caller attribution falls back to the file node for ties.

Only `exact-enclosing-v2` writes `lexical_parent` and `lexical_owner`; `scope-resolver-v1` and `exact-enclosing-v1` do not persist either link type. The default remains `scope-resolver-v1`.

The default remains `scope-resolver-v1`: on a deterministic 200-callee Docuvia sample, v2 still omitted four named function nodes from the historical impact set. Those nodes were ScopeResolver attributions without a unique lexical-parent path, so inventing parent links would misstate containment. Exact v1 and v2 remain selectable for evaluation.

## Selecting the active policy

The product composition path (`registerCoreProviders`) constructs the graph persister with the active policy resolved from `DOCUVIA_CALLS_CALLER_POLICY` (`scope-resolver-v1`, `exact-enclosing-v1` or `exact-enclosing-v2`). Unset or blank means the default; an unknown value fails with `INVALID_INPUT` rather than silently falling back. `docuvia init` and `analyze` persist under the active policy, and `analyze` compares the stored policy with the active one, not with the compile-time default: a graph built or hydrated under the active exact policy is kept, while a mismatch triggers one full rebuild under the active policy. This switch is for opt-in evaluation on real repositories until the default changes.

A complete persistence pass records its policy under the project-scoped `docuvia_meta` key `graph.calls-projection.caller-policy.v1:<projectId>`. Snapshot metadata carries a separately versioned `callsProjectionCallerPolicy` capability so hydration can restore the policy. Snapshots without a valid capability are treated as historical ScopeResolver graphs. `analyze` detects a policy mismatch before the SHA no-op path and performs a full graph rebuild. The generic metadata table and additive snapshot capability make a schema migration unnecessary.

V1 and v2 use the same uniform exact caller attribution for every `calls` edge. V2 adds lexical containment links and impact traversal. Strict proof scope, target selection, candidate generation, observations, and source content hash semantics remain unchanged.
