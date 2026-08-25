/**
 * Plain string constants shared across layers for file I/O encoding and hashing — no logic, just
 * the naming convention every layer must agree on (see `paths.ts`'s doc comment). `UTF8_ENCODING`
 * lives here (rather than only in `lib/core`) because the Presentation layer (`artifacts/cli`)
 * reads it directly for its own file writes, and `artifacts/cli` is only allowed to depend on
 * `lib/contracts` (see docs/gitbook/architecture/virtual-contracts-architecture.md) — never on
 * `lib/core` directly.
 *
 * The hash-algorithm/digest-encoding constants (issue #211) live here because the same values are
 * needed by two different implementation packages that must never drift apart: `lib/core` hashes
 * symbol content for `content_hash` (both main thread and inside the `worker_threads` AST worker),
 * and `lib/schema` re-hashes L3 card payloads for upsert identity — a mismatch on either side
 * would silently break dedup.
 */
export const UTF8_ENCODING = "utf8" as const;

export const ENCODING_HEX = "hex" as const;
export const ENCODING_BASE64 = "base64" as const;

export const HASH_ALGO_SHA256 = "sha256" as const;
export const HASH_ALGO_MD5 = "md5" as const;
