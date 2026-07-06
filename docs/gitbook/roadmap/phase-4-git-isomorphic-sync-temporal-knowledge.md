# Phase 4: Git-Isomorphic Sync & Temporal Knowledge

## 🎯 Objective

Align the Knowledge Graph directly with the underlying Git commit history to enable temporal delta projections.

## 🛠️ Implementation Method

- **Orphan Branch Protocol:** Serialize knowledge graph nodes as JSON/Markdown to a hidden docuvia-knowledge branch.
- **Cross-Project Linking:** Inject context across linked projects without hard foreign keys via Global Tags.
- **Temporal Linking:** Define explicit graph edge semantics (IMPLEMENTS, EXPLAINS) tied to specific commits.

## 📋 Feature Tracking

This phase tracks the following specific features. Click on any feature to view its real implementation details, tests, and up-to-date status.

| Feature                           | Status     | Link                                                        |
| :-------------------------------- | :--------- | :---------------------------------------------------------- |
| Orphan Branch R/W Protocol        | ✅ Done    | [View Details](features/orphan-branch-r-w-protocol.md)      |
| Cross-project linking             | ✅ Done    | [View Details](features/cross-project-linking.md)           |
| Temporal Decay Scoring            | ✅ Done    | [View Details](features/temporal-decay-scoring.md)          |
| Template management & Inheritance | ⚠️ WARN    | [View Details](features/template-management-inheritance.md) |
| `docuvia sync` Bidirectional CLI  | ✅ Done    | [View Details](features/docuvia-sync-bidirectional-cli.md)  |
| SVN integration                   | ⏸️ Pending | [View Details](features/svn-integration.md)                 |
