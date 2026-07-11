# File Placement & Folder Rules

> **Guideline Protocol:** 
> When creating a new feature, fixing a bug, or adding a new capability, placing the file in the correct directory is just as important as writing correct code. Misplaced files violate the Virtual Contracts Architecture.

---

## 1. Where Does My Code Go?

Ask yourself these questions when creating a new file:

### Q1: Am I defining a shape, an error, or a shared type?
*   **Yes** ➔ `lib/contracts/src/...`
*   **Rule**: This file must contain absolutely zero runtime logic. Only `interface`, `type`, `enum`, or primitive abstract classes.

### Q2: Am I wrapping a third-party technology? (e.g., a new database, a new git tool)
*   **Yes** ➔ `lib/<tech-name>/src/...` (e.g., `lib/schema`, `lib/libgit2`)
*   **Rule**: This is a **Technology Provider**. It must self-register to `docuviaFactory`. It must not contain business logic like "How to calculate a blast radius." It only knows "How to run a SQL query" or "How to run `git diff`."

### Q3: Am I writing Docuvia's core business logic? (e.g., calculating blast radius, semantic diffing)
*   **Yes** ➔ `lib/core/src/<domain>/...`
*   **Rule**: This is the **Domain Core**. It uses the interfaces from `lib/contracts` to perform complex calculations or data transformations. It does not know *how* the data was fetched from the database, only *what* to do with it once it has it.

### Q4: Am I combining multiple tools to complete a user task?
*   **Yes** ➔ `lib/ui-core/src/workflows/...`
*   **Rule**: This is the **Orchestration Layer**. You are fetching tools from `docuviaFactory` and calling them in sequence. This is where `try/catch` logic for graceful degradation lives.

### Q5: Am I formatting output for the user or defining a CLI command?
*   **Yes** ➔ `artifacts/cli/src/commands/...`
*   **Rule**: This is the **Presentation Layer**. You are only allowed to parse arguments, inject configurations into `docuviaMemory`, call `docuviaApi`, and print the results.

---

## 2. Testing Placement Rules

Tests must be colocated with the code they are testing, but their *nature* changes based on the folder:

*   **`lib/ui-core/**/*.unit.test.ts`**: Must use `mock` injections. No disk I/O. Extremely fast.
*   **`lib/core/**/*.unit.test.ts`**: Pure logic tests. In-memory data transformations.
*   **`lib/schema/**/*.integration.test.ts`**: Must test against a real (but temporary/in-memory) database instance.
*   **`artifacts/cli/**/*.e2e.test.ts`**: Must spawn a real child process and test standard output/error.

## 3. Naming Conventions

*   **Files**: Use kebab-case (e.g., `ast-parser.ts`, `database-provider.ts`).
*   **Interfaces**: Prefix with `I` (e.g., `IDatabase`, `IAstNode`) inside `lib/contracts`.
*   **Classes**: PascalCase (e.g., `SqliteDatabaseProvider`).
*   **Functions**: camelCase (e.g., `calculateBlastRadius`).