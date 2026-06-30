# Test-Driven Development (TDD)

## 1. TDD Workflow
- **Red-Green-Refactor**: For complex business logic, practice Test-Driven Development. 
  1. **Red**: Write a failing test for the desired behavior.
  2. **Green**: Write the minimal code required to make the test pass.
  3. **Refactor**: Clean up the code while ensuring the test stays green.

## 2. Testing Standards
- **3A Pattern**: All unit and integration tests must strictly follow the Arrange-Act-Assert (3A) pattern for readability and structure.
- **Test Core Logic, Mock Boundaries**: Focus unit tests on the pure business logic located in `lib/`. Mock external boundaries (like network calls via MSW, or database connections) to keep tests fast and deterministic.
