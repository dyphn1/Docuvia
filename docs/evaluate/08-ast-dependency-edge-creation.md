# 08. AST Dependency Edge Creation

**Severity:** 🟠 HIGH
**Domain:** AST Precision
**Target:** `@workspace/ast-core`

## Deficit Description
Currently, the AST microkernel successfully identifies files and functions to create L2 and L3 nodes, but it fails to map the relationships between them. For Issue #07 (BFS Blast Radius) to work, the graph must actually possess edges.

## Acceptance Criteria
1. Enhance the tree-sitter logic in `@workspace/ast-core` to extract `ImportDeclaration`, `CallExpression`, and interface implementations across supported languages.
2. Resolve local file paths to correctly identify inter-module dependencies.
3. Output these relationships so the CLI sync pipeline can `INSERT` them into the `node_links` table in SQLite.
