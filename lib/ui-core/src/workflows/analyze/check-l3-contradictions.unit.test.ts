import { describe, it, expect } from "vitest";
import type { L3NodeRow } from "@workspace/contracts";
import { findAnchorContradictions } from "./check-l3-contradictions.js";
import type { ExtractedDecision } from "./analyze-result.js";

function makeRow(overrides: Partial<L3NodeRow> = {}): L3NodeRow {
  return {
    id: 1,
    l2_node_id: 10,
    title: "switched to JWT",
    content: "stateless auth across services",
    node_type: "decision",
    source_commits: "[]",
    commit_hash: "abc1234",
    ai_generated: 1,
    confidence: 0.9,
    noise_score: null,
    created_at: "2026-08-23 00:00:00",
    last_verified_at: null,
    occurrence_count: 1,
    introduced_in_commit: null,
    verified_until_commit: null,
    validity_status: "pending",
    source: "agent-authored",
    content_hash: null,
    extraction_model: null,
    source_files: null,
    initial_source_commits: null,
    ...overrides,
  };
}

const staged: ExtractedDecision[] = [
  {
    title: "Switched to JWT",
    nodeType: "decision",
    content: "session cookies revoked at midnight, JWTs live for 24h",
    confidence: 0.8,
  },
];

describe("findAnchorContradictions()", () => {
  it("flags a same-titled existing decision with divergent content", () => {
    const hits = findAnchorContradictions([makeRow()], staged);

    expect(hits).toEqual([
      expect.objectContaining({
        stagedTitle: "Switched to JWT",
        existingId: 1,
        existingSource: "agent-authored",
        existingCommitHash: "abc1234",
      }),
    ]);
  });

  it("ignores an exact-content duplicate -- that is upsertDecision's dedup path, not a conflict", () => {
    const hits = findAnchorContradictions(
      [makeRow({ content: " stateless auth across services\n" })],
      [{ ...staged[0], content: "stateless auth across services" }],
    );

    expect(hits).toEqual([]);
  });

  it("is whitespace/case insensitive on titles but not fooled by a different claim's title", () => {
    const sameClaimDifferentWords = findAnchorContradictions(
      [makeRow()],
      [{ ...staged[0], title: "  switched   TO jwt " }],
    );
    expect(sameClaimDifferentWords).toHaveLength(1);

    const differentClaim = findAnchorContradictions(
      [makeRow()],
      [{ ...staged[0], title: "kept session cookies" }],
    );
    expect(differentClaim).toEqual([]);
  });

  it("never flags garbage (superseded) rows -- history must not false-positive against a re-statement", () => {
    const hits = findAnchorContradictions(
      [makeRow({ validity_status: "garbage" })],
      staged,
    );

    expect(hits).toEqual([]);
  });

  it("reports one hit per conflicting pair when several staged decisions and rows disagree", () => {
    const hits = findAnchorContradictions(
      [
        makeRow({ id: 1 }),
        makeRow({
          id: 2,
          title: "cache TTL",
          content: "5 minutes",
          source: "analyze",
          commit_hash: null,
        }),
      ],
      [
        ...staged,
        {
          title: "Cache TTL",
          nodeType: "decision",
          content: "60 seconds",
          confidence: 0.7,
        },
      ],
    );

    expect(hits).toHaveLength(2);
    expect(hits[1]).toMatchObject({
      stagedTitle: "Cache TTL",
      existingId: 2,
      existingSource: "analyze",
      existingCommitHash: null,
    });
  });
});
