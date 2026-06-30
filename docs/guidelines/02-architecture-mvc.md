# Architecture & MVC Guidelines

## 1. Strict MVC Boundaries
- **Model**: Data definitions, ORM schemas (Drizzle), and state structures.
- **View**: React components, CLI outputs, or VS Code UI elements. Keep them thin and completely devoid of business logic.
- **Controller/Router**: Responsible only for handling HTTP requests/responses, payload validation, and status codes. They must delegate execution immediately.

## 2. Shared Core Logic (`lib`)
- **Centralized Business Logic**: All reusable business domain logic MUST be extracted to and reside in the shared `lib/` directory (e.g., `lib/core`).
- **No Logic in Presentation**: Controllers, API Routes, and React components must never contain core business rules. They only act as presentation layer adapters.
- **Cross-Package Sharing**: Since this is a monorepo, backend and frontend should share abstract types and core utilities through the `lib/` workspace packages to maintain a single source of truth.
