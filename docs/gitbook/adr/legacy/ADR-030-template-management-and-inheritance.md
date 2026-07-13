---
---

Date: 2026-07-07
Status: Superseded
Supersedes: None
---

# ADR 030: Template Management and Inheritance

## Context

Docuvia's roadmap includes a feature for Template Management and Inheritance (`template-management-inheritance.md`). Currently, our prompt resolution logic in `prompt-service.ts` only implements a simple project-to-global fallback mechanism. If a project-specific prompt template doesn't exist, it falls back to the global template.

As Docuvia scales, users and organizations require more sophisticated prompt template management. We need an architecture that supports template inheritance—allowing a project-specific template to extend a global base template and override only specific blocks (e.g., overriding the tone or output format while inheriting the core instructions). Furthermore, we need versioned management to ensure that updates to base templates cascade cleanly and predictably to child templates without breaking existing implementations.

## Decision

We will adopt a mature, existing templating engine and implement a strict version-pinning system for prompt management.

1. **Adopt Mature Templating Engine**: We will NOT build a custom `{{#block}}` parser. Instead, we will adopt a mature, existing templating engine (such as Handlebars or Liquid) that natively supports partials and block inheritance to handle the prompt compilation in `prompt-service.ts`.
2. **Template Versioning and Strict Pinning**: Every template will be immutable and versioned. Child projects will be strictly PINNED to specific versions of the global base templates (e.g., `v1`). They will not auto-upgrade to `v2` to prevent breaking changes.
3. **Upgrade Notifications (Warning UX)**: When a newer version of a parent template exists, the system (UI/CLI) must surface a clear Warning/Notification to the user. This advises them that an upgrade is available and allows them to migrate and test the new version manually.

## Consequences

### Positive

- **Reliability and Maintainability**: By using a third-party templating engine (Handlebars/Liquid), we avoid the edge cases and maintenance burden of writing and supporting a custom recursive block parser.
- **Safe Updates**: Strict version pinning ensures that changes to a base template do not unexpectedly break downstream child templates. Production systems remain stable.
- **Clear Migration Paths**: The warning/notification UX provides visibility into template updates without forcing potentially breaking changes on the user.

### Negative

- **Storage Overhead**: Immutable versioning means we will store multiple versions of templates over time, increasing database size.
- **UX Friction**: Users will need to manually upgrade child templates to inherit changes from new parent versions, though the warning UX mitigates the discoverability issue.
- **Third-Party Dependency**: We are coupling our prompt rendering to an external template engine's syntax and lifecycle, though Handlebars/Liquid are industry standards.
  superseded_by: []
