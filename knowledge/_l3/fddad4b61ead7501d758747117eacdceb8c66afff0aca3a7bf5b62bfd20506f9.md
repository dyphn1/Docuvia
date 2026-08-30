---
{
  "content_hash": "fddad4b61ead7501d758747117eacdceb8c66afff0aca3a7bf5b62bfd20506f9",
  "node_type": "decision",
  "title": "Push HEAD instead of specific branch to avoid pre-push hook race condition",
  "l2_path": "knowledge/artifacts/cli/test/integration/commands/l3-distribution.integration.test.ts.md",
  "source_commits": [
    "27fda0da0299da5296ee4798876433da2c4475b2"
  ],
  "extraction_model": "openrouter/free",
  "source_files": [
    "artifacts/cli/test/integration/commands/l3-distribution.integration.test.ts"
  ],
  "created_at": "2026-08-30 02:08:08"
}
---

In the l3-distribution test, push HEAD (the source branch) rather than pushing docuvia-knowledge directly. This approach still triggers the pre-push hook (which publishes docuvia-knowledge as a side effect), but eliminates the race condition where both the test's direct push and the hook's own sync-knowledge step attempted to create the same ref, causing 'remote rejected ... (reference already exists)' errors.
