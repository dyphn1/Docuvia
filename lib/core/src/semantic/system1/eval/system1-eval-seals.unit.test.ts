import { describe, expect, it } from "vitest";
import {
  SYSTEM1_EXPORT_SCHEMA_VERSION,
  SYSTEM1_PREVIOUS_EXPORT_SCHEMA_VERSION,
} from "../system1-constants.js";
import { isSupportedSystem1DatasetSealSchemaVersion } from "./system1-eval-seals.js";

describe("System-1 dataset seal schema versions", () => {
  it("accepts both emitted dataset export schemas", () => {
    expect(
      isSupportedSystem1DatasetSealSchemaVersion(
        SYSTEM1_PREVIOUS_EXPORT_SCHEMA_VERSION,
      ),
    ).toBe(true);
    expect(
      isSupportedSystem1DatasetSealSchemaVersion(SYSTEM1_EXPORT_SCHEMA_VERSION),
    ).toBe(true);
  });

  it("rejects unsupported and malformed schema versions", () => {
    expect(isSupportedSystem1DatasetSealSchemaVersion(0)).toBe(false);
    expect(
      isSupportedSystem1DatasetSealSchemaVersion(
        SYSTEM1_EXPORT_SCHEMA_VERSION + 1,
      ),
    ).toBe(false);
    expect(
      isSupportedSystem1DatasetSealSchemaVersion(
        String(SYSTEM1_EXPORT_SCHEMA_VERSION),
      ),
    ).toBe(false);
  });
});
