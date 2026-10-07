import { readFileSync } from "node:fs";
import path from "node:path";
import { sha256 } from "./phase2-tiered-call-resolution-support.mjs";

/** The Q1 rule inputs frozen in the certification manifest. Keep this list shared by the
 * certification audit and the source-hash guard so their configuration boundaries cannot drift. */
export const Q1_NAMED_IMPORT_RULE_CONFIGURATION_FILES = Object.freeze([
  "lib/core/src/semantic/call-resolution-hypothesis.service.ts",
  "lib/core/src/semantic/call-resolution-hypothesis-index.ts",
  "lib/core/src/semantic/call-resolution-hypothesis-internal.ts",
  "lib/core/src/semantic/call-resolution-strict-proof.ts",
  "lib/contracts/src/interfaces/call-resolution-hypothesis.interfaces.ts",
  "lib/contracts/src/interfaces/call-site-shape-facts.interfaces.ts",
  "lib/contracts/src/interfaces/declared-type-facts.interfaces.ts",
] as const);

export interface Q1RuleConfigurationDigest {
  readonly fileHashes: Readonly<Record<string, string>>;
  readonly combinedSha256: string;
}

export function combineQ1RuleConfigurationFileHashes(
  fileHashes: Readonly<Record<string, string>>,
): string {
  return sha256(JSON.stringify(fileHashes));
}

/** Hash each frozen rule input's raw bytes, then SHA-256 its compact JSON hash map. */
export function computeQ1RuleConfiguration(
  repositoryRoot: string,
): Q1RuleConfigurationDigest {
  const fileHashes = Object.fromEntries(
    Q1_NAMED_IMPORT_RULE_CONFIGURATION_FILES.map((file) => [
      file,
      sha256(readFileSync(path.resolve(repositoryRoot, file))),
    ]),
  );
  return {
    fileHashes,
    combinedSha256: combineQ1RuleConfigurationFileHashes(fileHashes),
  };
}
