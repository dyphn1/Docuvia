import { L1Template, ProjectType } from "../types.js";

export const L1_TEMPLATES: L1Template[] = [
  {
    projectType: ProjectType.Frontend,
    label: "Frontend Application",
    keywords: ["react", "vue", "angular", "svelte", "vite", "next", "nuxt", "gatsby"],
    tags: [
      {
        slug: "ui-components",
        name: "UI Components",
        description: "Reusable visual building blocks",
      },
      {
        slug: "routing",
        name: "Routing",
        description: "Client-side navigation and route definitions",
      },
      {
        slug: "state-management",
        name: "State Management",
        description: "Global and local state handling",
      },
      { slug: "styling", name: "Styling", description: "CSS, theming, and design tokens" },
      {
        slug: "api-integration",
        name: "API Integration",
        description: "Data fetching and API client configuration",
      },
    ],
  },
  {
    projectType: ProjectType.Backend,
    label: "Backend / API Server",
    keywords: ["express", "fastify", "hapi", "koa", "nestjs", "django", "flask", "rails", "spring"],
    tags: [
      {
        slug: "api-routes",
        name: "API Routes",
        description: "HTTP endpoint definitions and middleware",
      },
      { slug: "database", name: "Database", description: "Schema, ORM, and query patterns" },
      {
        slug: "authentication",
        name: "Authentication",
        description: "Identity, sessions, and JWT handling",
      },
      { slug: "services", name: "Services", description: "Business logic and domain services" },
      {
        slug: "infrastructure",
        name: "Infrastructure",
        description: "Deployment, configuration, and environment",
      },
    ],
  },
  {
    projectType: ProjectType.Fullstack,
    label: "Fullstack Application",
    keywords: ["fullstack", "full-stack", "trpc", "remix", "sveltekit"],
    tags: [
      { slug: "frontend", name: "Frontend", description: "Client-side UI layer" },
      { slug: "backend", name: "Backend", description: "Server-side API and logic" },
      { slug: "database", name: "Database", description: "Data persistence layer" },
      {
        slug: "api-contract",
        name: "API Contract",
        description: "Shared types and OpenAPI/tRPC schema",
      },
      { slug: "devops", name: "DevOps", description: "CI/CD, deployment, and infrastructure" },
    ],
  },
  {
    projectType: ProjectType.Monorepo,
    label: "Monorepo / Multi-package",
    keywords: ["monorepo", "workspace", "turborepo", "nx", "lerna", "pnpm-workspace"],
    tags: [
      { slug: "core", name: "Core", description: "Shared foundation utilities and types" },
      { slug: "ui-layer", name: "UI Layer", description: "Frontend packages and design system" },
      { slug: "api-layer", name: "API Layer", description: "Backend packages and services" },
      {
        slug: "shared",
        name: "Shared",
        description: "Cross-cutting libraries used by multiple packages",
      },
      {
        slug: "build-system",
        name: "Build System",
        description: "Tooling, bundlers, and pipeline configuration",
      },
    ],
  },
  {
    projectType: ProjectType.Library,
    label: "Library / SDK / Package",
    keywords: ["library", "sdk", "package", "npm", "publish"],
    tags: [
      { slug: "core-api", name: "Core API", description: "Primary public surface area" },
      { slug: "utilities", name: "Utilities", description: "Internal helpers and abstractions" },
      { slug: "types", name: "Types", description: "TypeScript type definitions and schemas" },
      { slug: "testing", name: "Testing", description: "Test utilities and mocking helpers" },
      {
        slug: "documentation",
        name: "Documentation",
        description: "Docs, examples, and changelogs",
      },
    ],
  },
  {
    projectType: ProjectType.Cli,
    label: "CLI Tool",
    keywords: ["cli", "command-line", "commander", "yargs", "oclif", "bin"],
    tags: [
      {
        slug: "commands",
        name: "Commands",
        description: "Individual CLI commands and their arguments",
      },
      { slug: "io", name: "I/O", description: "Input parsing, output formatting, and prompts" },
      {
        slug: "configuration",
        name: "Configuration",
        description: "Config file resolution and environment handling",
      },
      {
        slug: "core-logic",
        name: "Core Logic",
        description: "Domain operations invoked by commands",
      },
      {
        slug: "distribution",
        name: "Distribution",
        description: "Packaging, publishing, and update mechanisms",
      },
    ],
  },
];
