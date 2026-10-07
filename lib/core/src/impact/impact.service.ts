import type {
  BlastRadiusEntry,
  IGraphStore,
  IImpactService,
  ILogger,
  RiskLevel,
} from "@workspace/contracts";
import {
  BlastRadiusEdgeSources,
  createNoopLogger,
  LinkTypes,
  StructuralLinkTypes,
  RiskLevels,
  SNAPSHOT_CALL_SITE_UNAVAILABLE_REASON,
  SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX,
  SnapshotCallSiteAvailabilityStates,
  CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX,
  CallsProjectionCallerPolicies,
} from "@workspace/contracts";
import {
  getCallResolutionSummariesForEdge,
  getCurrentCallResolutionRows,
} from "../semantic/call-resolution-output.js";

const ImpactMessages = {
  NO_NODE_RESOLVED: "No node resolved for impact target",
  RESOLVED_BLAST_RADIUS: "Resolved blast radius",
  LSP_FALLBACK_APPLIED: "Applied ast_call_sites fallback for blast radius",
} as const;

/**
 * Absolute-count FLOORS `computeRiskLevel()`'s scaled thresholds can never fall below -- the
 * exact original flat thresholds (ported from old Docuvia's
 * `change-detection-service.ts#IMPACT_RISK_THRESHOLDS`, modeled on GitNexus's own
 * LOW/MEDIUM/HIGH/CRITICAL scale). Kept as the same name/values through the
 * impact-risk-thresholds-not-scaled-to-repo-size fix
 * (docs/ai_plans/implement_scale-impact-risk-thresholds.md) -- every repo at or below
 * IMPACT_RISK_REFERENCE_NODE_COUNT classifies identically to before this fix, byte-for-byte.
 * Shared by the standalone `docuvia impact <target>` command and `review`'s per-diff aggregate
 * count so the two never drift apart on what counts as "risky".
 */
export const IMPACT_RISK_THRESHOLDS = {
  HIGH_MIN: 6,
  CRITICAL_MIN: 21,
} as const;

/**
 * `l2_nodes` count the floors above were empirically correct for -- nest's own measured graph
 * size (16,159 l2_nodes, typescript-cli-benchmark.md's `impact "Injectable"` row: 9 impacted ->
 * HIGH, the one impact-risk classification result the benchmark series never flagged as wrong).
 * Rounded to a clean constant, not the exact 16,159, to avoid implying false precision -- this is
 * a calibration anchor, not a live measurement of any specific repo. Repos at or below this size
 * get exactly IMPACT_RISK_THRESHOLDS' flat 6/21; above it, thresholds grow by
 * sqrt(l2Nodes / this) -- sub-linear, so the bar rises with repo size without becoming
 * unreachable on very large graphs. See docs/ai_plans/implement_scale-impact-risk-thresholds.md's
 * §3.1 for the full nest/vscode derivation and why sqrt was chosen over a flat percentage.
 */
export const IMPACT_RISK_REFERENCE_NODE_COUNT = 16_000;

function scaledRiskThreshold(floor: number, totalNodeCount: number): number {
  if (totalNodeCount <= IMPACT_RISK_REFERENCE_NODE_COUNT) return floor;
  const scaleFactor = Math.sqrt(
    totalNodeCount / IMPACT_RISK_REFERENCE_NODE_COUNT,
  );
  return Math.max(floor, Math.round(floor * scaleFactor));
}

/**
 * Pure banding formula, deliberately split out of `ImpactService.computeRiskLevel()` so the
 * scaling math itself is directly unit-testable without a real/mocked `IGraphStore` (mirrors
 * `resolveTierBCoverageHint()`'s own "pure logic, cheapest tests in the plan" precedent).
 */
export function computeRiskLevelFromCounts(
  impactedCount: number,
  totalNodeCount: number,
): RiskLevel {
  const criticalMin = scaledRiskThreshold(
    IMPACT_RISK_THRESHOLDS.CRITICAL_MIN,
    totalNodeCount,
  );
  const highMin = scaledRiskThreshold(
    IMPACT_RISK_THRESHOLDS.HIGH_MIN,
    totalNodeCount,
  );
  if (impactedCount >= criticalMin) return RiskLevels.CRITICAL;
  if (impactedCount >= highMin) return RiskLevels.HIGH;
  if (impactedCount >= 1) return RiskLevels.MEDIUM;
  return RiskLevels.LOW;
}

function getCallResolutionsByCallerId(
  store: IGraphStore,
  targetNodeId: number,
  targetNodeKey: string | undefined,
  options?: { explainResolution?: boolean },
): Map<number, NonNullable<BlastRadiusEntry["callResolutions"]>> {
  const resolutionRows = getCurrentCallResolutionRows(store);
  const byCallerId = new Map<
    number,
    NonNullable<BlastRadiusEntry["callResolutions"]>
  >();
  for (const relation of store.graph.getIncomingRelations(targetNodeId) ?? []) {
    if (relation.linkType !== LinkTypes.CALLS) continue;
    const callResolutions = getCallResolutionSummariesForEdge(
      store,
      store.graph.getNodeKeyById?.(relation.id),
      targetNodeKey,
      options?.explainResolution,
      resolutionRows,
    );
    if (
      callResolutions.every((resolution) => resolution.callSiteKey === null)
    ) {
      continue;
    }
    const existing = byCallerId.get(relation.id) ?? [];
    byCallerId.set(relation.id, [...existing, ...callResolutions]);
  }
  return byCallerId;
}

/**
 * Blast-radius resolution + risk scoring — the "calculating blast radius"/"risk scoring" example
 * named directly in docs/gitbook/architecture/virtual-contracts-architecture.md's Domain Core
 * section. Built entirely on `IGraphStore`'s repo interfaces; if `lib/schema` is ever swapped for
 * another storage backend, this class is untouched.
 */
export class ImpactService implements IImpactService {
  constructor(private readonly logger: ILogger = createNoopLogger()) {}

  computeRiskLevel(store: IGraphStore, impactedCount: number): RiskLevel {
    const { l2Nodes } = store.graph.count();
    return computeRiskLevelFromCounts(impactedCount, l2Nodes);
  }

  getBlastRadius(
    store: IGraphStore,
    target: string,
    options?: { explainResolution?: boolean },
  ): BlastRadiusEntry[] | undefined {
    const node = store.graph.findNodeByName(target);
    if (!node) {
      this.logger.debug(ImpactMessages.NO_NODE_RESOLVED, { target });
      return undefined;
    }

    const directIncoming = store.graph.getIncomingEdges(node.id);
    const targetNodeKey = store.graph.getNodeKeyById?.(node.id);
    const callResolutionsByCallerId = getCallResolutionsByCallerId(
      store,
      node.id,
      targetNodeKey,
      options,
    );
    const blastRadius = directIncoming.map(({ id, name, type }) =>
      this.buildDirectIncomingEntry(
        store,
        id,
        name,
        type,
        callResolutionsByCallerId.get(id),
      ),
    );

    // Issue #192 real-repository acceptance case: a file is represented by one file node plus
    // child symbol nodes. Calls/imports/extends normally point at the child symbol, not the file
    // node itself, so querying a file used to miss real dependents such as
    // persist-ast-graph.ts -> ScopeResolver in scope-resolver.ts. Fold those child-symbol
    // dependents back to their containing files without mutating the graph or double-counting a
    // caller already visible through a direct file-level edge.
    if (this.isFileNode(node)) {
      blastRadius.push(
        ...this.resolveContainedSymbolDependents(
          store,
          node.id,
          new Set(directIncoming.map(({ id }) => id)),
        ),
      );
    }

    // Issue #217: when nothing except the trivial self-file `contains` link points at a
    // symbol target, ScopeResolver never resolved any real caller -- exactly where
    // dynamic-loading dependents (runtime-variable plugin paths, computed `import()` specifiers)
    // hide. The ast_call_sites reverse read is keyed by symbol name, so file targets use the
    // contained-symbol aggregation above instead of an ineffective file-path call-site lookup.
    if (!this.isFileNode(node) && !this.hasStaticCallerEdge(store, node.id)) {
      const staticNames = new Set(blastRadius.map((entry) => entry.name));
      const fallbackEntries = this.resolveCallSiteFallback(
        store,
        node,
        staticNames,
      );
      if (fallbackEntries.length > 0) {
        this.logger.debug(ImpactMessages.LSP_FALLBACK_APPLIED, {
          target,
          count: fallbackEntries.length,
        });
      }
      blastRadius.push(...fallbackEntries);
    }

    if (this.usesExactEnclosingV2(store)) {
      blastRadius.push(
        ...this.resolveExactCallerContext(
          store,
          node.id,
          new Set(directIncoming.map(({ id }) => id)),
        ),
      );
    }

    this.logger.debug(ImpactMessages.RESOLVED_BLAST_RADIUS, {
      target,
      count: blastRadius.length,
    });
    return blastRadius;
  }

  private buildDirectIncomingEntry(
    store: IGraphStore,
    id: number,
    name: string,
    type: string,
    callResolutions:
      NonNullable<BlastRadiusEntry["callResolutions"]> | undefined,
  ): BlastRadiusEntry {
    const entry = this.buildEntry(store, id, name, type);
    if (!callResolutions) return entry;
    return {
      ...entry,
      callResolutions,
    };
  }

  getCallResolutionForEdge(
    store: IGraphStore,
    callerNodeKey: string | undefined,
    targetNodeKey: string | undefined,
    options?: { explainResolution?: boolean },
  ) {
    return getCallResolutionSummariesForEdge(
      store,
      callerNodeKey,
      targetNodeKey,
      options?.explainResolution,
    );
  }

  getCallSiteFallbackUnavailableReason(
    store: IGraphStore,
    target: string,
  ): string | undefined {
    const projectId = store.projects.getFirst()?.id;
    if (!projectId) return undefined;

    const availability = store.meta.get(
      `${SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX}${projectId}`,
    );
    if (
      availability === undefined ||
      availability === SnapshotCallSiteAvailabilityStates.AVAILABLE
    ) {
      return undefined;
    }

    const node = store.graph.findNodeByName(target);
    if (
      !node ||
      this.isFileNode(node) ||
      this.hasStaticCallerEdge(store, node.id)
    ) {
      return undefined;
    }

    return SNAPSHOT_CALL_SITE_UNAVAILABLE_REASON;
  }

  private isFileNode(node: { name: string; filePath?: string }): boolean {
    return node.filePath !== undefined && node.name === node.filePath;
  }

  /** Exact callback callers walk back through lexical-parent links so impact retains the
   *  enclosing function and that function's direct callers. This is policy-gated because legacy
   *  ScopeResolver graphs attribute those calls to the enclosing caller already. */
  private usesExactEnclosingV2(store: IGraphStore): boolean {
    const projectId = store.projects.getFirst()?.id;
    if (projectId === undefined) return false;
    return (
      store.meta.get(
        `${CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX}${projectId}`,
      ) === CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2
    );
  }

  /**
   * Resolves an exact caller's lexical parents and includes each enclosing function's direct
   * incoming dependents. Only lexical-parent links continue the walk; file ownership and class
   * ownership are context edges. Ordinary caller edges do not recurse, preserving the bounded
   * single-call-hop behavior while recovering the prior outer-function projection.
   */
  private resolveExactCallerContext(
    store: IGraphStore,
    targetNodeId: number,
    alreadyResolvedIds: ReadonlySet<number>,
  ): BlastRadiusEntry[] {
    const callers = store.graph
      .getIncomingRelations(targetNodeId)
      .filter(({ linkType }) => linkType === LinkTypes.CALLS)
      .map(({ id }) => id);
    const queue: number[] = [];
    const visitedParentIds = new Set<number>();
    const resolvedIds = new Set(alreadyResolvedIds);
    const entries: BlastRadiusEntry[] = [];

    const append = (node: { id: number; name: string; type: string }): void => {
      if (resolvedIds.has(node.id)) return;
      resolvedIds.add(node.id);
      entries.push(this.buildEntry(store, node.id, node.name, node.type));
    };

    for (const callerId of callers) {
      this.appendContainerChain(store, callerId, append);
      for (const parent of this.lexicalParents(store, callerId)) {
        append(parent);
        if (parent.linkType === LinkTypes.LEXICAL_PARENT) queue.push(parent.id);
      }
    }

    for (let index = 0; index < queue.length; index++) {
      const parentId = queue[index];
      if (parentId === undefined || visitedParentIds.has(parentId)) continue;
      visitedParentIds.add(parentId);
      queue.push(...this.appendParentDependents(store, parentId, append));
    }

    return entries;
  }

  private lexicalParents(
    store: IGraphStore,
    childId: number,
  ): ReturnType<IGraphStore["graph"]["getIncomingRelations"]> {
    return store.graph
      .getIncomingRelations(childId)
      .filter(
        ({ linkType }) =>
          linkType === LinkTypes.LEXICAL_PARENT ||
          linkType === LinkTypes.LEXICAL_OWNER,
      );
  }

  /** Appends one incoming hop from an enclosing function and returns nested callers to revisit. */
  private appendParentDependents(
    store: IGraphStore,
    parentId: number,
    append: (node: { id: number; name: string; type: string }) => void,
  ): number[] {
    const lexicalParents: number[] = [];
    for (const dependent of store.graph.getIncomingRelations(parentId)) {
      append(dependent);
      if (StructuralLinkTypes.includes(dependent.linkType)) {
        if (dependent.linkType === LinkTypes.LEXICAL_PARENT) {
          lexicalParents.push(dependent.id);
        }
        continue;
      }
      this.appendContainerChain(store, dependent.id, append);
    }
    return lexicalParents;
  }

  private appendContainerChain(
    store: IGraphStore,
    nodeId: number,
    append: (node: { id: number; name: string; type: string }) => void,
  ): void {
    const containers = [nodeId];
    const visited = new Set<number>();
    while (containers.length > 0) {
      const childId = containers.shift();
      if (childId === undefined || visited.has(childId)) continue;
      visited.add(childId);
      const fileOwner = store.graph
        .getIncomingRelations(childId)
        .find(({ linkType }) => linkType === LinkTypes.CONTAINS);
      if (fileOwner) append(fileOwner);
      for (const parent of this.lexicalParents(store, childId)) {
        append(parent);
        if (parent.linkType === LinkTypes.LEXICAL_PARENT)
          containers.push(parent.id);
      }
    }
  }

  /**
   * File-level impact is the union of direct file callers plus callers of symbols contained by
   * that file. A symbol caller is projected back to its containing file when one exists, so the
   * result remains a file-level blast radius rather than leaking implementation-level symbols.
   */
  private resolveContainedSymbolDependents(
    store: IGraphStore,
    fileNodeId: number,
    alreadyResolvedIds: ReadonlySet<number>,
  ): BlastRadiusEntry[] {
    const entries: BlastRadiusEntry[] = [];
    const seen = new Set(alreadyResolvedIds);
    const containedSymbols = store.graph
      .getOutgoingRelations(fileNodeId)
      .filter(({ linkType }) => linkType === LinkTypes.CONTAINS);

    for (const symbol of containedSymbols) {
      for (const incoming of store.graph.getIncomingRelations(symbol.id)) {
        if (StructuralLinkTypes.includes(incoming.linkType)) continue;
        const dependent = this.resolveContainingFile(store, incoming);
        if (dependent.id === fileNodeId || seen.has(dependent.id)) continue;
        seen.add(dependent.id);
        entries.push(
          this.buildEntry(store, dependent.id, dependent.name, dependent.type),
        );
      }
    }

    return entries;
  }

  /** Returns a symbol's containing file when the neighbor is a symbol; file nodes pass through. */
  private resolveContainingFile(
    store: IGraphStore,
    node: { id: number; name: string; type: string },
  ): { id: number; name: string; type: string } {
    const container = store.graph
      .getIncomingRelations(node.id)
      .find(({ linkType }) => linkType === LinkTypes.CONTAINS);
    return container ?? node;
  }

  /** `true` when an incoming edge is a dependency, excluding file and lexical context links. */
  private hasStaticCallerEdge(store: IGraphStore, nodeId: number): boolean {
    return store.graph
      .getIncomingRelations(nodeId)
      .some((relation) => !StructuralLinkTypes.includes(relation.linkType));
  }

  /** Issue #217: reverse-reads `ast_call_sites` for call sites naming the target symbol and
   *  maps each calling file back to its module node, labeled
   *  `edgeSource: "lsp-fallback"` -- a same-named call exists here, which is weaker evidence
   *  than a ScopeResolver-resolved edge but strictly better than an invisible dependent. */
  private resolveCallSiteFallback(
    store: IGraphStore,
    node: { id: number; name: string; type: string; filePath?: string },
    alreadyResolvedNames: ReadonlySet<string>,
  ): BlastRadiusEntry[] {
    const projectId = store.projects.getFirst()?.id;
    if (!projectId) return [];

    const sitesByFile = store.callSites.getByTargetFunctions(projectId, [
      node.name,
    ]);

    const entries: BlastRadiusEntry[] = [];
    for (const filePath of sitesByFile.keys()) {
      // A file calling itself is recursion, not a dependent; files already visible via static
      // edges (the `contains` link included) must not be double-counted -- the radius count
      // feeds risk scoring directly (IMPT-001).
      if (filePath === node.filePath) continue;
      if (alreadyResolvedNames.has(filePath)) continue;
      const dependent = store.graph.findNodeByName(filePath);
      // Guard against findNodeByName's LIKE stage: only an exact-name module row counts as
      // the dependent -- a substring match is coincidence, not evidence.
      if (!dependent || dependent.name !== filePath) continue;
      entries.push({
        ...this.buildEntry(store, dependent.id, dependent.name, dependent.type),
        edgeSource: BlastRadiusEdgeSources.LSP_FALLBACK,
      });
    }
    return entries;
  }

  /** One blast-radius entry with its optional L3 "why" payload attached (shared by the static
   *  edge path and the #217 fallback so both carry identical enrichment). */
  private buildEntry(
    store: IGraphStore,
    nodeId: number,
    name: string,
    type: string,
  ): BlastRadiusEntry {
    const l3Rows = store.l3.getByL2NodeId(nodeId);
    const why =
      l3Rows.length > 0
        ? l3Rows.map((row) => ({ title: row.title, content: row.content }))
        : undefined;
    return why ? { name, type, why } : { name, type };
  }
}
