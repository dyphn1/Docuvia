---
id: PLAT-005
title: SVN Integration Deprecated
status: accepted
date: 2026-07-07
domains: [platform]
supersedes: [legacy/ADR-031]
superseded_by: []
---

# SVN Integration Deprecated

## Context

Early roadmap drafts included potential support for Subversion (SVN) and other centralized version control systems to support legacy enterprise clients. However, integrating SVN directly into a Git-Isomorphic graph presents severe architectural mismatches (e.g., SVN treats branching as a directory copy, and SVN revisions are sequential rather than globally unique hashes). Maintaining dual ingestion pipelines (Git vs SVN) for file discovery, diff parsing, and incremental updates introduces immense complexity into the core architecture.

## Decision

We officially DEPRECATE any planned SVN or non-Git VCS integrations. Docuvia is strictly a **Git-Native** application.

1. The discovery and diffing engines will assume `git` is available and active in the host environment.
2. We will not support or maintain adapters for SVN, Mercurial, or Perforce within the core.
3. Teams exclusively using SVN must set up a `git-svn` translation proxy layer before interfacing with Docuvia.

## Consequences

- **Positive**: Massively simplifies the core architecture, testing surface, and dependency graph. Allows us to leverage powerful Git-specific internals (like `fast-import` and `.git/hooks`).
- **Negative**: Excludes enterprise users stranded on legacy VCS systems, though this market segment is shrinking and generally misaligned with modern AI developer tools.
