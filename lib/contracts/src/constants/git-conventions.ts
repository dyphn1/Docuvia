/**
 * Plain git-configuration conventions shared across `lib/core/git` and `lib/git-local`. Per
 * docs/gitbook/architecture/virtual-contracts-architecture.md, Domain Core (`lib/core`) and Tech
 * Providers (`lib/git-local`) sit at different layers and never import each other directly — "all
 * shared definitions must live in contracts" — so a value both need lives here rather than being
 * duplicated per-package.
 */

/** Git's conventional name for the default/primary remote. */
export const GIT_DEFAULT_REMOTE_NAME = "origin" as const;
