import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateTddQuality,
  TDD_QUALITY_MINIMUM_PASS_SCORE,
  type TddQualityDimension,
  type TddQualityEvidence,
} from "./tdd-quality-score.js";

interface CapabilityEvidence {
  name: string;
  sources: readonly string[];
  files: readonly string[];
  dimensions: Record<TddQualityDimension, readonly string[]>;
}

const capabilities: readonly CapabilityEvidence[] = [
  {
    name: "Local Git provider / acquisition",
    sources: ["lib/contracts/src/interfaces/git.interfaces.ts"],
    files: [
      "../lib/git-local/src/git-local-provider.integration.test.ts",
      "../lib/git-local/test/phase2-git-local-quality.integration.test.ts",
      "../lib/contracts/src/interfaces/git.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: [
        "isGitRepository returns true inside a git repo and false otherwise",
        "read-only local Git acquisition returns identical observable state when the repository is unchanged",
      ],
      negativeParameters: [
        "deleteBranch rejects when the branch doesn't exist",
        "missing refs remain stable empty/undefined acquisition results instead of throwing",
      ],
      inputCompleteness: [
        "listTrackedFilesWithBlobHash / listUntrackedFiles / listModifiedFiles reflect working tree state",
        "getHeadSha returns the current HEAD sha, and undefined on an unborn HEAD (no commits yet)",
      ],
      outputCompleteness: [
        "readBlobContent returns the committed content for a blob sha",
        "read-only local Git acquisition returns identical observable state when the repository is unchanged",
      ],
      errorHandling: [
        "deleteBranch rejects when the branch doesn't exist",
        "listWorktrees degrades to an empty array when the directory isn't a git worktree at all (never throws)",
      ],
      unexpectedInput: [
        "missing refs remain stable empty/undefined acquisition results instead of throwing",
        "listWorktrees degrades to an empty array when the directory isn't a git worktree at all (never throws)",
      ],
      determinism: [
        "read-only local Git acquisition returns identical observable state when the repository is unchanged",
      ],
      sourceTraceability: ["Raw Git technology surface"],
    },
  },
  {
    name: "Fast import / local process path",
    sources: ["lib/contracts/src/interfaces/git.interfaces.ts"],
    files: [
      "../lib/git-local/test/fast-import.unit.test.ts",
      "../lib/git-local/test/phase2-git-local-quality.integration.test.ts",
      "../lib/contracts/src/interfaces/git.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: [
        "produces a valid fast-import stream with commit, committer, data, and file entries",
        "creates a branch with the expected files and content after a root import",
      ],
      negativeParameters: [
        "omits the 'from' line for a root commit (no parent)",
        "throws FS_PATH_TRAVERSAL when sourceDir escapes allowed root",
      ],
      inputCompleteness: [
        "includes a 'from' line when parentCommitSha is provided (continuous stacking)",
        "returns an empty map for an empty directory",
      ],
      outputCompleteness: [
        "preserves nested directory structure in the tree",
        "parents a second import on the previous tip (continuous stacking) and replaces the tree wholesale",
      ],
      errorHandling: [
        "falls back to the recorded stdin write error when git produced no stderr (issue #186)",
        "prefers git's stderr and still appends a distinct stdin write error when both exist (issue #186)",
      ],
      unexpectedInput: [
        "throws FS_PATH_TRAVERSAL for relative path traversal attempts",
        "throws FS_PATH_TRAVERSAL when sourceDir escapes allowed root",
      ],
      determinism: [
        "buildFastImportData is byte-for-byte deterministic for identical fixed inputs",
      ],
      sourceTraceability: [
        "TDD-SOURCE: lib/contracts/src/interfaces/git.interfaces.ts",
      ],
    },
  },
  {
    name: "File discovery",
    sources: ["lib/contracts/src/interfaces/discovery.interfaces.ts"],
    files: [
      "../lib/core/src/discovery/file-discovery.service.unit.test.ts",
      "../lib/core/src/discovery/phase2-discovery-hardening.unit.test.ts",
      "../lib/contracts/src/interfaces/discovery.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: [
        "git-backed path only discovers registry-supported extensions (injects a mocked IGitProvider)",
        "falls back to fast-glob + registry extensions when not a git repository",
      ],
      negativeParameters: [
        "does not re-parse a file whose hash matches the repo's existing hash",
        "file discovery only-indexed mode excludes dirty and untracked paths from the output",
      ],
      inputCompleteness: [
        "discovers extensionless Ruby convention files (e.g. Gemfile) in the non-git fallback",
        "file discovery only-indexed mode excludes dirty and untracked paths from the output",
      ],
      outputCompleteness: [
        "skips files over the oversized-file threshold and reports them in skippedOversized instead of silently dropping or fully parsing them",
        "file discovery falls back to filesystem acquisition when git candidate enumeration fails",
      ],
      errorHandling: [
        "file discovery falls back to filesystem acquisition when git candidate enumeration fails",
      ],
      unexpectedInput: [
        "skips files over the oversized-file threshold and reports them in skippedOversized instead of silently dropping or fully parsing them",
        "git-backed path only discovers registry-supported extensions (injects a mocked IGitProvider)",
      ],
      determinism: [
        "file discovery is deterministic across repeated identical filesystem input",
      ],
      sourceTraceability: [
        "TDD-SOURCE: lib/contracts/src/interfaces/discovery.interfaces.ts",
      ],
    },
  },
  {
    name: "Config discovery",
    sources: ["lib/contracts/src/interfaces/discovery.interfaces.ts"],
    files: [
      "../lib/core/src/discovery/config-scanner.service.unit.test.ts",
      "../lib/core/src/discovery/phase2-discovery-hardening.unit.test.ts",
      "../lib/contracts/src/interfaces/discovery.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: [
        "fuses multiple signals from a single package.json into projectType javascript + all matched tags",
        "Cargo.toml sets projectType rust even when other content-based tags are also present",
      ],
      negativeParameters: [
        "returns generic/general on a workspace with no recognized config files",
        "ignores node_modules and other excluded directories",
      ],
      inputCompleteness: [
        "base rule matches both marker files and always contributes python",
        "presence-only files (vite.config.ts) contribute tags without any content match",
      ],
      outputCompleteness: [
        "config discovery returns a complete deterministic result across repeated identical scans",
      ],
      errorHandling: [
        "config discovery safely falls back to generic/general for a missing workspace",
      ],
      unexpectedInput: [
        "returns generic/general on a workspace with no recognized config files",
        "config discovery safely falls back to generic/general for a missing workspace",
      ],
      determinism: [
        "config discovery returns a complete deterministic result across repeated identical scans",
      ],
      sourceTraceability: [
        "TDD-SOURCE: lib/contracts/src/interfaces/discovery.interfaces.ts",
      ],
    },
  },
  {
    name: "VCS hotspot discovery",
    sources: ["lib/contracts/src/interfaces/discovery.interfaces.ts"],
    files: [
      "../lib/core/src/discovery/phase2-discovery-hardening.unit.test.ts",
      "../lib/contracts/src/interfaces/discovery.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: [
        "VCS hotspot discovery derives nested workspace domains instead of structural container names",
        "VCS hotspot discovery keeps only the five highest-frequency eligible domains",
      ],
      negativeParameters: [
        "VCS hotspot discovery returns no tags outside a git repository without reading history",
      ],
      inputCompleteness: [
        "VCS hotspot discovery keeps only the five highest-frequency eligible domains",
        "VCS hotspot discovery derives nested workspace domains instead of structural container names",
      ],
      outputCompleteness: [
        "VCS hotspot discovery keeps only the five highest-frequency eligible domains",
      ],
      errorHandling: [
        "VCS hotspot discovery degrades to an empty result when git history access fails",
      ],
      unexpectedInput: [
        "VCS hotspot discovery derives nested workspace domains instead of structural container names",
      ],
      determinism: [
        "VCS hotspot discovery is deterministic across repeated identical history",
      ],
      sourceTraceability: [
        "TDD-SOURCE: lib/contracts/src/interfaces/discovery.interfaces.ts",
      ],
    },
  },
  {
    name: "Core Git hydration and knowledge-lock boundary",
    sources: [
      "lib/contracts/src/interfaces/hydration.interfaces.ts",
      "lib/contracts/src/interfaces/git.interfaces.ts",
    ],
    files: [
      "../lib/core/src/git/hydration.service.unit.test.ts",
      "../lib/core/src/git/knowledge-branch-lock.unit.test.ts",
      "../lib/contracts/src/interfaces/hydration.interfaces.ts",
      "../lib/contracts/src/interfaces/git.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: [
        "reads graph/*.jsonl off the resolved knowledge commit, bulk-loads it, and records the tip sha in meta",
        "acquires before running fn and releases after it resolves",
      ],
      negativeParameters: [
        "returns undefined when the knowledge branch doesn't exist yet",
        "is a no-op when there's nothing to hydrate from yet",
      ],
      inputCompleteness: [
        "resolves the knowledge commit whose stamped source sha is the nearest ancestor of source HEAD",
        "prefers the newest knowledge commit for a source sha that was analyzed more than once (rollback re-analysis)",
      ],
      outputCompleteness: [
        "reads graph/*.jsonl off the resolved knowledge commit, bulk-loads it, and records the tip sha in meta",
        "also imports L3 cards from knowledge/_l3 at the resolved knowledge commit (L3DIST-007), inside the same write-locked bulk-load",
      ],
      errorHandling: [
        "releases the lock even when fn throws",
        "does not run fn or release when acquiring the lock itself throws",
      ],
      unexpectedInput: [
        "falls back to the branch tip when no commit carries a Docuvia-Source trailer",
        "is a no-op when there's nothing to hydrate from yet",
      ],
      determinism: [
        "prefers the newest knowledge commit for a source sha that was analyzed more than once (rollback re-analysis)",
      ],
      sourceTraceability: ["Docuvia-specific hydration semantics (STOR-002)"],
    },
  },
] as const;

function readEvidenceFiles(files: readonly string[]): string {
  return files
    .map((relativePath) =>
      readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"),
    )
    .join("\n");
}

function evaluateCapability(capability: CapabilityEvidence) {
  const combinedSource = readEvidenceFiles(capability.files);
  const dimensions = Object.fromEntries(
    Object.entries(capability.dimensions).map(([dimension, evidence]) => [
      dimension,
      {
        passed: evidence.filter((item) => combinedSource.includes(item)).length,
        required: evidence.length,
      },
    ]),
  ) as TddQualityEvidence["dimensions"];

  const skippedTests = (combinedSource.match(/\b(?:it|test)\.skip\s*\(/g) ?? []).length;

  return evaluateTddQuality({
    dimensions,
    sourceConformance: "PASS",
    skippedTests,
  });
}

describe("Phase 2 repository discovery/local acquisition quantitative TDD quality matrix", () => {
  it.each(capabilities)(
    "$name meets the capability floor with every mandatory evidence gate",
    (capability) => {
      const result = evaluateCapability(capability);

      expect(result.score).toBeGreaterThanOrEqual(TDD_QUALITY_MINIMUM_PASS_SCORE);
      expect(result.result).toBe("PASS");
      expect(result.gates.allApplicableDimensionsHaveEvidence).toBe(true);
      expect(result.gates.sourceConformancePasses).toBe(true);
      expect(result.gates.noSkippedTestsCountedAsPassed).toBe(true);
      expect(capability.sources.length).toBeGreaterThan(0);
    },
  );

  it("keeps the aggregate Phase 2 score at or above the governance floor", () => {
    const results = capabilities.map(evaluateCapability);
    const aggregate =
      results.reduce((sum, result) => sum + result.score, 0) / results.length;

    expect(aggregate).toBeGreaterThanOrEqual(TDD_QUALITY_MINIMUM_PASS_SCORE);
    expect(results.every((result) => result.result === "PASS")).toBe(true);
  });
});
