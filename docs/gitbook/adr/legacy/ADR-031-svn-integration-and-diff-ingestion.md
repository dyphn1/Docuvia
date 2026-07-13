---
---

Date: 2026-07-07
Status: Deprecated
Supersedes: None
Supplements: ADR-004
---

# ADR 031: SVN Integration Deprecation (Pending Git-Bridge Translation)

## Status

Accepted — the decision to halt native SVN ingestion and defer to an external `git-svn` bridge is final. ("Pending" describes the deferred _feature_, not the status of this _decision_.)

## Context

Docuvia's core architecture relies heavily on a Git-first, isomorphic knowledge graph as outlined in [ADR-004](ADR-004-git-isomorphic-graph.md). In this model, version control system (VCS) diffs and commit SHAs are treated as first-class citizens, enabling Abstract Syntax Tree (AST) analysis and deeper structural context for agentic reasoning.

Currently, Docuvia has basic Subversion (SVN) support through `svn-client.ts`. However, integrating SVN directly into a Git-Isomorphic graph presents severe architectural mismatches:

1. **Identity Crisis**: Git SHAs are globally unique; SVN revisions (`r123`) are sequential and scoped only to the repository, requiring a synthetic composite key design to prevent database collisions.
2. **Branch is a Folder Illusion**: SVN treats branching as a directory copy (`svn copy trunk branches/feat`). Attempting to diff this as a standard VCS branch would crash the AST Blast Radius engine by appearing as tens of thousands of newly created files.
3. **External Links**: SVN's `svn:externals` creates fragmented data structures that break the clean boundary of a repository.
4. **Revision Ambiguity**: Relationships between commits (parents/children) are not explicitly DAG-linked in SVN in the same way they are in Git.

## Decision

We will **halt** direct SVN diff ingestion and formally mark SVN integration as `Pending`.

Instead of bloating the core Docuvia `ingestion-pipeline.ts` with complex SVN-to-Git bridging logic, the future solution will be an external translation tool (e.g., leveraging `git-svn`). This tool will convert an SVN repository into a standard Git repository _before_ it interfaces with Docuvia.

Docuvia will remain strictly a Git-Isomorphic system.

## Consequences

- **Positive**: The core API, ingestion pipeline, and database schema (`local.db` and PostgreSQL) remain pure and unpolluted by SVN-specific hacks or composite keys.
- **Positive**: Ast engines do not need to be refactored to filter out SVN's directory-based branching logic.
- **Negative**: Teams exclusively using SVN cannot use Docuvia natively without first setting up a `git-svn` translation proxy layer.
  superseded_by: []
