import { describe, expect, it } from "vitest";
import { SemanticDecisionOptionKinds } from "@workspace/contracts";
import {
  SYSTEM1_OPTION_IDS,
  SYSTEM1_BYTE_LIMITS,
} from "./system1-constants.js";
import {
  buildSystem1State,
  encodeSystem1Options,
} from "./system1-state-builder.js";
import type { System1StateInput } from "./system1-types.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase0-contract.md
// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase2-system1-encoding.md
const candidate = {
  id: "tierA:aaaaaaaaaaaaaaaa",
  targetId: "src/target.ts#run",
  tierARank: 1 as const,
  tierAEvidence: "tier-a-imports-file" as const,
  evidenceStatus: "present" as const,
  declarationKind: "function" as const,
  signatureSnippet: "export function run(input: Input): Output",
  overloadCount: 1,
  generatedMarker: false,
  forwardingWrapper: false,
};

const input: System1StateInput = {
  sampleId: "owner/repo@revision::src/caller.ts:4:2",
  repoId: "owner/repo",
  worktreeId: "revision",
  projectId: "tsconfig.json",
  snapshotHash: "a".repeat(64),
  candidateSetTruncated: false,
  caller: { filePath: "src/caller.ts", symbol: "Caller.run" },
  call: {
    calleeName: "run",
    expression: "run(input)",
    sourceWindow: "const result = run(input);",
    sourceWindowTruncated: false,
    kind: "bare",
    receiverHint: null,
    genericHints: [],
  },
  importBinding: {
    kind: "named",
    local: "run",
    imported: "run",
    sourceSpecifier: "./target",
    barrelStatus: "no",
    pathAlias: false,
  },
  candidates: [candidate],
};

describe("System-1 option encoding", () => {
  it("[happy] preserves Tier A order and appends one UNKNOWN and one VERIFY option", () => {
    const candidates = [
      candidate,
      {
        ...candidate,
        id: "tierA:bbbbbbbbbbbbbbbb",
        targetId: "src/other.ts#run",
      },
    ];
    const options = encodeSystem1Options(candidates);

    expect(options.map((option) => option.id)).toEqual([
      candidates[0].id,
      candidates[1].id,
      SYSTEM1_OPTION_IDS.UNKNOWN,
      SYSTEM1_OPTION_IDS.VERIFY_WITH_LSP,
    ]);
    expect(options.map((option) => option.kind)).toEqual([
      SemanticDecisionOptionKinds.CANDIDATE,
      SemanticDecisionOptionKinds.CANDIDATE,
      SemanticDecisionOptionKinds.UNKNOWN,
      SemanticDecisionOptionKinds.VERIFY,
    ]);
  });

  it("[happy] places candidate identity, Tier A evidence and declaration syntax on each option", () => {
    const option = encodeSystem1Options([candidate])[0];

    expect(option).toMatchObject({
      id: candidate.id,
      kind: SemanticDecisionOptionKinds.CANDIDATE,
      text: candidate.signatureSnippet,
      attributes: {
        targetId: candidate.targetId,
        tierARank: candidate.tierARank,
        tierAEvidence: candidate.tierAEvidence,
        evidenceStatus: candidate.evidenceStatus,
        declarationKind: candidate.declarationKind,
        overloadCount: candidate.overloadCount,
      },
    });
  });

  it("[boundary] bounds source text by UTF-8 byte counts and records truncation", () => {
    const state = buildSystem1State({
      ...input,
      call: {
        ...input.call,
        sourceWindow: "🙂".repeat(SYSTEM1_BYTE_LIMITS.SOURCE_WINDOW + 10),
        sourceWindowTruncated: false,
      },
    });

    expect(Buffer.byteLength(state.context.text, "utf8")).toBeLessThanOrEqual(
      SYSTEM1_BYTE_LIMITS.CONTEXT,
    );
    expect(state.evidence.truncated).toBe(true);
  });

  it("[leakage] emits no label, oracle, review or checker fields from contaminated input", () => {
    const contaminated = {
      ...input,
      oracle: { status: "secret-oracle-status" },
      review: { status: "secret-review-status", positiveTargetIds: ["gold"] },
      checker: { declarations: ["secret-checker-target"] },
      labels: { positiveTargetIds: ["secret-label-target"] },
    } as System1StateInput;
    const state = buildSystem1State(contaminated);
    const serialized = JSON.stringify(state);
    const keys = collectKeys(state);

    expect(keys.join(" ").toLowerCase()).not.toMatch(
      /label|oracle|review|checker/,
    );
    expect(serialized).not.toContain("secret-oracle-status");
    expect(serialized).not.toContain("secret-review-status");
    expect(serialized).not.toContain("secret-checker-target");
    expect(serialized).not.toContain("secret-label-target");
  });
});

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    key,
    ...collectKeys(child),
  ]);
}
