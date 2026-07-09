import { container } from "@workspace/core";

/**
 * Resolves a service from the DI container and assigns post-construction
 * fields onto it (workspaceRoot, logCallback, etc. via DI_KEYS).
 * The unsafe cast this requires is centralized here instead of repeated
 * at every command call site.
 */
export function resolveConfiguredService<T extends object>(
  token: symbol,
  fields: Record<string, unknown>
): T {
  const service = container.resolve<T>(token);
  Object.assign(service, fields);
  return service;
}
