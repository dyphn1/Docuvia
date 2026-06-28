# MCP AI Interfaces Competitor Analysis

## Current State
Docuvia has basic MCP tools but lacks a comprehensive suite. It features an API generation process via OpenAPI spec and Zod validators.

## Competitors
GitNexus

## What Competitors Have That We Don't
- Extensive array of MCP tools for blast radius and impact analysis.
- Deep CLI integrations providing context directly to LLMs.

## What We Have That They Don't
- Direct API generation via OpenAPI spec.
- Strongly typed Zod validators for MCP tool arguments.

## Fatal Flaws
- Missing granular context-savings metadata in MCP responses.
- Lack of comprehensive graph-querying MCP tools.

## Immediate Next Steps
- Build `get_impact_radius` MCP tool.
- Build `semantic_search_nodes` MCP tool.
