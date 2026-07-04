# TypeScript & React Style Guide

## 1. File and Directory Naming

- **TypeScript Logic Files**: Use `kebab-case` universally (e.g., `user-service.ts`, `api-client.ts`, `string-utils.ts`).
- **React Components**: Use `PascalCase` strictly for both the file name and the component name (e.g., `UserProfile.tsx`, `DashboardSettings.tsx`).
- **Directories**: Use `kebab-case` for all folders (e.g., `components/`, `data-access/`, `hooks/`).
- **Interfaces and Types**: Use `PascalCase`. Do not use the `I` prefix (e.g., use `User`, not `IUser`).

## 2. Code Organization

- **Feature/Domain Grouping**: Group files by domain or feature (e.g., `features/authentication/`) rather than by technical type (e.g., avoid dumping everything into a massive `services/` or `components/` folder).
- **Exports**: Prefer named exports over default exports for better refactoring support and strict naming resolution across the codebase.

## 3. React Specific Rules

- **Functional Components**: Strictly use functional components with React Hooks. Do not use class components.
- **Separation of Concerns**: Isolate state management and data fetching (e.g., custom hooks, React Query) from UI rendering logic.
