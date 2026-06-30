# @workspace/api-server

Express API server for Docuvia.

## Testing Prerequisites

To run the integration tests (`pnpm test` or `pnpm run test:coverage`), a PostgreSQL database must be running and reachable.

By default, the tests expect a PostgreSQL database running at `127.0.0.1:5432` with the following credentials:

- **User:** `postgres`
- **Password:** `postgres`
- **Database:** `docuvia_test`

You can override these defaults by setting the `DATABASE_URL` environment variable before running the tests.

If the database is unreachable, the test setup script (`test/setup/setup.ts`) will gracefully abort and display an error message before attempting to execute any tests.
