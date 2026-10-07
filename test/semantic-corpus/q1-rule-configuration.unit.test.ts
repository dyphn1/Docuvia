import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CURRENT_Q1_RULE_CONFIGURATION_SHA256 } from "../../lib/ui-core/src/workflows/analyze/call-resolution-certification.js";
import {
  combineQ1RuleConfigurationFileHashes,
  computeQ1RuleConfiguration,
  Q1_NAMED_IMPORT_RULE_CONFIGURATION_FILES,
} from "../../scripts/semantic-corpus/q1-rule-configuration.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const freezeManifestPath = path.join(
  repositoryRoot,
  "docs/gitbook/analysis/tiered-call-resolution-certification-evidence/freeze-manifest.json",
);

interface FreezeManifest {
  readonly resolverRuleSignatures: {
    readonly "q1:named-import:v1": {
      readonly implementationConfigurationFiles: Readonly<
        Record<string, string>
      >;
      readonly combinedSha256: string;
    };
  };
}

describe("Q1 named-import rule configuration hash guard", () => {
  it("[happy][state-diff] shares the exact Q1 source set frozen for certification", () => {
    const manifest = JSON.parse(
      readFileSync(freezeManifestPath, "utf8"),
    ) as FreezeManifest;
    const frozenFiles = Object.keys(
      manifest.resolverRuleSignatures["q1:named-import:v1"]
        .implementationConfigurationFiles,
    );

    expect(Q1_NAMED_IMPORT_RULE_CONFIGURATION_FILES).toEqual(frozenFiles);
    expect(
      combineQ1RuleConfigurationFileHashes(
        manifest.resolverRuleSignatures["q1:named-import:v1"]
          .implementationConfigurationFiles,
      ),
    ).toBe(
      manifest.resolverRuleSignatures["q1:named-import:v1"].combinedSha256,
    );
  });

  it("[happy][state-diff] recomputes the Q1 source hash pinned by runtime", () => {
    const digest = computeQ1RuleConfiguration(repositoryRoot);

    expect(digest.combinedSha256).toBe(CURRENT_Q1_RULE_CONFIGURATION_SHA256);
  });

  it("[invalid-input][error-handling] fails closed when a frozen source file is missing", () => {
    expect(() =>
      computeQ1RuleConfiguration(path.join(repositoryRoot, "missing-root")),
    ).toThrow();
  });
});
