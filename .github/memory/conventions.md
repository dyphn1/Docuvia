# Conventions & Best Practices

- **Read Guidelines First**: Always check `docs/gitbook/guidelines/*.md` for specific rules (TypeScript style, MVC, POP, Clean Code, SRE) before implementation.
- **TDD & 3A Pattern**: Enforce Red-Green-Refactor. Tests must follow Arrange-Act-Assert. Use shared DB factories for integration tests to avoid state pollution.
- **API-First Enforcement**: Never use manual `fetch()`. Always use auto-generated Orval hooks (`@workspace/api-client-react`).
- **Component Colocation (Frontend)**: Avoid "Fat Components". Extract logic, list views, and forms into localized `components/` subdirectories.
- **Transactions**: Wrap multi-step database mutations inside a transaction block (`await db.transaction(async (tx) => { ... })`). Ensure `tx` is explicitly passed down.
