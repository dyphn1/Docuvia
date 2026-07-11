# Conventions & Best Practices

- **TDD & 3A Pattern**: Tests must follow Arrange-Act-Assert. Use isolated fixtures per test (a fresh temp SQLite file for `GraphStore`, or a fresh `TestSandbox` directory for CLI subprocess tests) to avoid state pollution — see `testing_and_quality.md` for the concrete patterns.
- **Constructor Injection, No Internal Construction**: Every service dependency is a required constructor parameter (no defaults); no service constructs its own dependencies. See `architecture.md` for the composition-root-function convention this supports.
- **Single-Connection Data Access**: All SQLite access goes through `GraphStore`'s narrow, typed repo methods (`lib/core/src/memory/repos/`) — there is no generic raw-SQL escape hatch and no per-service DB connection.
