import { describe, expect, it } from "vitest";
import {
  assertEvaluationRowAllowed,
  classifyEvaluationRowLicense,
  EVALUATION_REPOSITORY_LICENSE_POLICY,
  isExcludedLicensePath,
} from "../../scripts/semantic-corpus/phase2-tiered-call-resolution-license-policy.mjs";

const ONYX_REPO = "github.com/onyx-dot-app/onyx";
const ALLOWED_REPO = "github.com/nestjs/nest";

describe("phase 2 evaluation license policy", () => {
  it("[happy] records every evaluation repository and excludes the disallowed corpus", () => {
    expect(EVALUATION_REPOSITORY_LICENSE_POLICY[ONYX_REPO]).toBe("allowed");
    expect(
      EVALUATION_REPOSITORY_LICENSE_POLICY[
        "github.com/abhigyanpatwari/gitnexus"
      ],
    ).toBe("excluded");
    expect(EVALUATION_REPOSITORY_LICENSE_POLICY["github.com/nestjs/nest"]).toBe(
      "allowed",
    );
  });

  it.each([
    "ee/module.ts",
    "backend/ee/module.ts",
    "web/src/app/ee/module.ts",
    "web/src/ee/module.ts",
  ])("excludes Onyx Enterprise path %s", (filePath) => {
    expect(isExcludedLicensePath(ONYX_REPO, filePath)).toBe(true);
  });

  it("[boundary] does not treat an ee name outside an ee directory as excluded", () => {
    expect(isExcludedLicensePath(ONYX_REPO, "src/enterprise/module.ts")).toBe(
      false,
    );
    expect(isExcludedLicensePath(ALLOWED_REPO, "backend/ee/module.ts")).toBe(
      false,
    );
  });

  it("[invalid-input] filters a sample when the caller or any positive target is excluded", () => {
    expect(
      classifyEvaluationRowLicense({
        repoId: ONYX_REPO,
        callerFilePath: "web/src/ee/caller.ts",
        targetFilePaths: ["web/src/app/service.ts"],
      }),
    ).toBe("excluded-path");
    expect(
      classifyEvaluationRowLicense({
        repoId: ONYX_REPO,
        callerFilePath: "web/src/app/service.ts",
        targetFilePaths: ["backend/ee/service.ts"],
      }),
    ).toBe("excluded-path");
    expect(
      classifyEvaluationRowLicense({
        repoId: ALLOWED_REPO,
        callerFilePath: "src/service.ts",
        targetFilePaths: ["src/ee/service.ts"],
      }),
    ).toBe("allowed");
  });

  it("[error-handling] fails closed when excluded or unknown rows reach an evaluation split", () => {
    expect(() =>
      assertEvaluationRowAllowed({
        repoId: ONYX_REPO,
        callerFilePath: "web/src/ee/caller.ts",
      }),
    ).toThrow(/excluded license path/);
    expect(() =>
      assertEvaluationRowAllowed({
        repoId: "github.com/unknown/repo",
        callerFilePath: "src/caller.ts",
      }),
    ).toThrow(/missing from the evaluation license policy/);
    expect(() =>
      assertEvaluationRowAllowed({
        repoId: "github.com/abhigyanpatwari/GitNexus",
        callerFilePath: "src/caller.ts",
      }),
    ).toThrow(/Excluded repository/);
  });
});
