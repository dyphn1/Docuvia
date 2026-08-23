import { describe, it, expect } from "vitest";
import { getPackageVersion } from "../../../src/utils/package-version.js";

describe("getPackageVersion()", () => {
  it("returns the CLI package.json version as a valid semver string", () => {
    const version = getPackageVersion();

    expect(version).toMatch(/^\d+\.\d+\.\d+(-[\w.-]+)?$/);
  });

  it("stays consistent across repeated calls (single source of truth for --version and the MCP handshake)", () => {
    expect(getPackageVersion()).toBe(getPackageVersion());
  });
});
