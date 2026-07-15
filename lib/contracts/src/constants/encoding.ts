/**
 * Plain string constants shared across layers for file I/O encoding — no logic, just the
 * naming convention every layer must agree on (see `paths.ts`'s doc comment). `UTF8_ENCODING`
 * lives here (rather than only in `lib/core`) because the Presentation layer (`artifacts/cli`)
 * reads it directly for its own file writes, and `artifacts/cli` is only allowed to depend on
 * `lib/contracts` (see docs/gitbook/architecture/virtual-contracts-architecture.md) — never on
 * `lib/core` directly.
 */
export const UTF8_ENCODING = "utf8" as const;
