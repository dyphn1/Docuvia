/**
 * Git's ref namespace prefix for local branches — used to build explicit refspecs so the
 * knowledge branch (which is normally never checked out) can be referenced/updated without
 * ambiguity (`update-ref`, `push`, `fast-import`'s `commit <ref>` line).
 */
export const GIT_BRANCH_REF_PREFIX = "refs/heads/" as const;

/**
 * Git's symbolic ref to the current checkout position — used as the default base when no
 * explicit ref is supplied for a diff/comparison.
 */
export const GIT_HEAD_REF = "HEAD" as const;
