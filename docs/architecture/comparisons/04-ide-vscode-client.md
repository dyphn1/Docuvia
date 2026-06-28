# IDE & VS Code Client Competitor Analysis

## Current State
Docuvia provides an extensible Webview architecture tied directly to the knowledge graph, with CodeLens and Hover functionalities active.

## Competitors
Cursor (Shadow Workspace)

## What Competitors Have That We Don't
- Native editor integration.
- Shadow workspace for fast applies.
- Zero-latency hover states.

## What We Have That They Don't
- Extensible Webview architecture tied directly to a local-first knowledge graph, keeping context extraction completely local.

## Fatal Flaws
- High latency in agent responses.
- Clunky Webview UX compared to native editor panels.
- No inline diff application.

## Immediate Next Steps
- Implement shadow workspace for fast diff applies.
- Improve inline autocomplete latency.
