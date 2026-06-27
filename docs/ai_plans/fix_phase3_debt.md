# Phase 3 Technical Debt: Implementation Plan

This plan organizes the resolution of Phase 3 technical debt by severity.

## Step 1: Fix CLI Error Handling (Severity: Critical)
* **Description**: The CLI currently crashes due to unhandled promise rejections when the database is missing. 
* **Action**: Implement graceful error handling around DB connection initialization. Ensure the CLI catches these exceptions and outputs a helpful, user-friendly error message instead of crashing.

## Step 2: Resolve Architectural Leaks (Severity: High)
* **Description**: `api-server` (MCP) and `KnowledgeStore.ts` (VS Code Client) are directly accessing the DB.
* **Action**: Refactor both components to route all data access and operations through `@workspace/core`. Remove any direct Drizzle ORM queries from the client and MCP transport layers.

## Step 3: Implement Service Stubs (Severity: Medium)
* **Description**: `AnalyzeService` and `ExtractService` are currently empty stubs.
* **Action**: Build out the actual implementation logic for both services to ensure feature completeness.

## Step 4: Update Project Documentation (Required Final Step)
* **Description**: Documentation must reflect the true state of the architecture once technical debt is cleared.
* **Action**: Update `docs/architecture/local-first-status.md` and any relevant ADRs in `docs/adr/` to explicitly document the enforced `@workspace/core` boundary, error handling standards, and newly implemented services.