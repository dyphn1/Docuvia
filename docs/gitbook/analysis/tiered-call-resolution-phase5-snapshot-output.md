# GRPH-008 Phase 5 — Snapshot and user-facing outputs

Phase 5 preserves current per-call-site certainty across clones and makes the confidence level
visible in query, impact, and MCP responses. It does not change ScopeResolver, Tier B scheduling,
or calibration promotion.

## Portable snapshot capability

Snapshots with current call-site certainty add `graph/call-resolutions.jsonl` and declare
`capabilities.callResolutions.version: 1` in `graph/metadata.json`. The snapshot format remains
version 1; this is an additive capability. `graph/call-sites.jsonl` remains the unchanged raw AST
evidence file.

Each call-resolution row preserves the portable call-site key and identity version, caller and
projection-caller node keys, resolution class, selected target, likely confidence, resolver and
rule signature, verification status and verified target, dependency fingerprint and dependencies,
staleness, and ordinal-ordered candidate targets with evidence. Rows sort by call-site key;
dependencies sort by file path; candidates sort by ordinal. The renderer writes fields in a fixed
order so repeated renders of the same logical rows have stable bytes. SQLite row IDs, project IDs,
observations, and local rule quarantine are not included.

Packing includes the capability only when raw call-site rows and resolution storage are available.
An explicit unavailable marker is preserved as unavailable; it cannot be re-exported as a complete
empty set. Hydration requires the versioned resolution capability and the raw call-site capability.
Missing, malformed, or unsupported payloads clear portable current resolution rows and record
certainty as unavailable for that project. Hydration never promotes an aggregate `calls` edge to
`proven`. Snapshot resolution replacement does not rebuild the graph edge projection.

## Query and impact output

Every returned `calls` edge carries one or more `callResolutions` summaries. Each summary identifies
the resolution class and verification status, plus the selected target when available. A call edge
without a matching per-site record is explicitly `unknown`.

- Proven or Tier B-verified output shows the selected target and an `evidenceLabel`.
- Likely output shows its top target, confidence, and at most two alternatives.
- Ambiguous output shows at most three candidates in resolver order.
- Stale evidence is rendered as unknown certainty.
- Full resolver, dependency, candidate, and verification evidence is omitted by default.

Use `docuvia query <target> --explain-resolution` or
`docuvia impact <target> --explain-resolution` to include the complete record. The MCP query and
impact tools accept `explainResolution: true` for the same detail. Query's prompt formatter renders
the bounded summary and includes the full record only when that option was requested.

Each impact entry retains per-site certainty in `callResolutions`, while the separate
`callResolutionBreakdown` reports `verifiedProven`, `heuristicProvisional`, and `unknown`
contribution counts. Existing `edgeSource` values continue to describe where an edge came from
(such as `lsp-fallback` or `dynamic-candidate`). The existing risk-level calculation continues to
use the existing blast-radius set; the response exposes certainty counts next to it rather than
silently presenting heuristic calls as verified calls.

## Exit-gate coverage

The snapshot renderer test pins stable bytes and confirms the raw call-sites JSONL shape is
unchanged. Packing tests confirm the capability is versioned and quarantine is not read or
serialized. Hydration tests cover versioned restoration and a legacy aggregate `calls` edge that
restores no resolution rows and marks certainty unavailable. SQLite tests round-trip portable rows
and verify resolution replacement does not rewrite graph edges. Query and impact tests pin the
bounded output, explicit unknown fallback, exact target match, and the explain-resolution detail
path. CLI and MCP tests pin their option inputs.

The Phase 5 gate is satisfied when export, hydrate, query, impact, and MCP retain the same per-site
certainty; legacy snapshots remain honestly unknown; likely and ambiguous limits hold; and local
quarantine remains local.
