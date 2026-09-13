import type {
  RemoteL2NodeSummary,
  SyncPushResult,
} from "@workspace/contracts";

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`);
  }
  return value;
}

/**
 * Validates the required `RemoteL2NodeSummary` fields while preserving remote extension fields.
 */
export function parseRemoteL2NodeSummaries(
  value: unknown,
): RemoteL2NodeSummary[] {
  if (!Array.isArray(value)) {
    throw new TypeError("response must be an array");
  }
  for (const [index, candidate] of value.entries()) {
    const node = record(candidate, `response[${index}]`);
    finiteNumber(node.id, `response[${index}].id`);
    if (typeof node.name !== "string") {
      throw new TypeError(`response[${index}].name must be a string`);
    }
  }
  return value as RemoteL2NodeSummary[];
}

/** Runtime counterpart of `SyncPushResult`: successful JSON must still satisfy the contract. */
export function parseSyncPushResult(value: unknown): SyncPushResult {
  const result = record(value, "response");
  if (typeof result.success !== "boolean") {
    throw new TypeError("response.success must be a boolean");
  }
  finiteNumber(result.processed, "response.processed");
  return value as unknown as SyncPushResult;
}
