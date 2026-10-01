import { SYSTEM1_SUPPORTED_EXPORT_SCHEMA_VERSIONS } from "../system1-constants.js";

/** Seal manifests are written by the dataset exporter, whose schema is versioned separately. */
export function isSupportedSystem1DatasetSealSchemaVersion(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    SYSTEM1_SUPPORTED_EXPORT_SCHEMA_VERSIONS.includes(
      value as (typeof SYSTEM1_SUPPORTED_EXPORT_SCHEMA_VERSIONS)[number],
    )
  );
}
