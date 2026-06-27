# 09. Local HTML Visualization

**Severity:** 🟡 MEDIUM
**Domain:** Local UI
**Target:** `@workspace/cli` (`visualize` command)

## Deficit Description

If a developer clones a repository offline, extracting the graph is invisible to them. Starting the `kg-engine` React dashboard requires running a dev server, which is slow and heavy. `code-review-graph` provides a zero-friction CLI command to dump the graph into a standalone HTML file. Docuvia needs this feature for immediate visual validation.

## Acceptance Criteria

1. Add a `docuvia visualize` command to `@workspace/cli`.
2. Query `.docuvia/local.db` for `l2_nodes` and `node_links`.
3. Generate a standalone HTML file embedding D3.js or Mermaid.js.
4. Output the HTML file to the user's workspace (e.g., `.docuvia/graph.html`) and open it in the default browser.
