---
id: GRPH-004
title: Cross-Project L1 Tag Linking
status: proposed
date: 2026-07-06
domains: [graph]
supersedes: [legacy/ADR-024]
superseded_by: []
---

# Cross-Project L1 Tag Linking

## Context
In a microservices or multi-repo architecture, projects do not exist in isolation. They share concepts, APIs, and domains. A strictly repo-scoped knowledge graph fails to capture these cross-project dependencies, leading to knowledge silos.

## Decision
We introduce Cross-Project Soft Linking via Global L1 Tags. L1 Tags (Domain/System boundary tags) can be defined as "Global" across a Docuvia instance or organization. 

*(In Docuvia2, this is currently limited in scope: `ITagsRepo.getAllTagLinks()` handles reading these links for the `export-topology` command, but active cross-project resolution/linking mechanisms are not yet fully implemented).*

## Consequences
- Requires a central registry or federated approach to resolve Global L1 Tags.
- Exposes risk of naming collisions.
