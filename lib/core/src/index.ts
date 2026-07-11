/**
 * Curated public barrel for `@workspace/core` — the stable surface CLI/MCP callers use.
 *
 * Deliberately NOT a flat re-export of every internal module (see the plan's "no curated
 * public API" finding about old Docuvia's ~93-export barrel). Only composition-root
 * entry points, their result/option types, and the handful of constants presentation-layer
 * packages need directly are exported here. Internal services/interfaces/repos stay
 * unexported — CLI/MCP construct nothing themselves; they only call `buildInitCapability`.
 */
export { buildInitCapability, resolveDbPath } from "./composition/build-init-capability.js";
export type { InitResult } from "./services/init/init-result.js";
export { UTF8_ENCODING } from "./constants/encoding.js";
export { DOCUVIA_DIR_NAME } from "./constants/paths.js";
