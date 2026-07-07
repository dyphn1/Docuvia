export const meta = {
  name: "docuvia-feature-audit",
  description:
    "Audit every Done/WARN Docuvia roadmap feature: Haiku gathers evidence, Sonnet 5 judges fabrication/defects/ADR-compliance/doc-staleness",
  phases: [
    { title: "Read", detail: "Haiku reads roadmap doc + ADR + evidence source files per feature" },
    {
      title: "Analyze",
      detail: "Sonnet 5 judges fabrication, defects, ADR compliance, doc staleness",
    },
  ],
};

const ROOT = "D:\\GitHub\\Docuvia";
const FEATDIR = ROOT + "\\docs\\gitbook\\roadmap\\features";
const ADRDIR = ROOT + "\\docs\\gitbook\\adr";

const FEATURES = [
  {
    taskId: "1",
    slug: "agentic-rag-intent-router",
    file: "agentic-rag-intent-router.md",
    status: "Done",
  },
  {
    taskId: "2",
    slug: "ast-microkernel-architecture",
    file: "ast-microkernel-architecture.md",
    status: "WARN",
  },
  {
    taskId: "3",
    slug: "ast-plugin-architecture",
    file: "ast-plugin-architecture.md",
    status: "Done",
  },
  {
    taskId: "4",
    slug: "background-agentic-rag",
    file: "background-agentic-rag.md",
    status: "Done",
  },
  { taskId: "5", slug: "ci-cd-pipeline", file: "ci-cd-pipeline.md", status: "Done" },
  {
    taskId: "6",
    slug: "cli-commands-analyze-init",
    file: "cli-commands-analyze-init.md",
    status: "WARN",
  },
  {
    taskId: "7",
    slug: "comprehensive-documentation-alignment",
    file: "comprehensive-documentation-alignment.md",
    status: "Done",
  },
  { taskId: "8", slug: "concurrency-locks", file: "concurrency-locks.md", status: "Done" },
  {
    taskId: "9",
    slug: "core-db-schemas-defined",
    file: "core-db-schemas-defined.md",
    status: "Done",
  },
  {
    taskId: "10",
    slug: "core-services-test-hardening",
    file: "core-services-test-hardening.md",
    status: "Done",
  },
  { taskId: "11", slug: "cross-project-linking", file: "cross-project-linking.md", status: "Done" },
  {
    taskId: "12",
    slug: "cross-team-subscription",
    file: "cross-team-subscription.md",
    status: "Done",
  },
  { taskId: "13", slug: "dashboard-stats", file: "dashboard-stats.md", status: "Done" },
  { taskId: "14", slug: "document-upload-ui", file: "document-upload-ui.md", status: "Done" },
  {
    taskId: "15",
    slug: "docuvia-sync-bidirectional-cli",
    file: "docuvia-sync-bidirectional-cli.md",
    status: "Done",
  },
  {
    taskId: "16",
    slug: "domain-plugin-architecture",
    file: "domain-plugin-architecture.md",
    status: "Done",
  },
  { taskId: "17", slug: "export-markdown-json", file: "export-markdown-json.md", status: "Done" },
  {
    taskId: "18",
    slug: "feedback-loop-corrections",
    file: "feedback-loop-corrections.md",
    status: "Done",
  },
  {
    taskId: "19",
    slug: "generate-pipeline-orchestrator",
    file: "generate-pipeline-orchestrator.md",
    status: "Done",
  },
  { taskId: "20", slug: "github-pr-integration", file: "github-pr-integration.md", status: "Done" },
  { taskId: "21", slug: "graph-index", file: "graph-index.md", status: "Done" },
  { taskId: "22", slug: "headless-lsp-manager", file: "headless-lsp-manager.md", status: "Done" },
  {
    taskId: "23",
    slug: "incremental-update-delta-only",
    file: "incremental-update-delta-only.md",
    status: "Done",
  },
  {
    taskId: "24",
    slug: "interactive-topology-maps",
    file: "interactive-topology-maps.md",
    status: "WARN",
  },
  { taskId: "25", slug: "l1-tagger", file: "l1-tagger.md", status: "Done" },
  { taskId: "26", slug: "l2-extractor", file: "l2-extractor.md", status: "Done" },
  { taskId: "27", slug: "l3-generator", file: "l3-generator.md", status: "Done" },
  { taskId: "28", slug: "llm-abstraction-layer", file: "llm-abstraction-layer.md", status: "Done" },
  {
    taskId: "29",
    slug: "local-context-compression",
    file: "local-context-compression.md",
    status: "Done",
  },
  { taskId: "30", slug: "logging", file: "logging.md", status: "Done" },
  { taskId: "31", slug: "mcp-dashboard-ui", file: "mcp-dashboard-ui.md", status: "Done" },
  { taskId: "32", slug: "mcp-route-scaffolding", file: "mcp-route-scaffolding.md", status: "WARN" },
  {
    taskId: "33",
    slug: "monorepo-directory-layout",
    file: "monorepo-directory-layout.md",
    status: "Done",
  },
  {
    taskId: "34",
    slug: "multi-root-workspace-support",
    file: "multi-root-workspace-support.md",
    status: "Done",
  },
  { taskId: "35", slug: "natural-language-ui", file: "natural-language-ui.md", status: "WARN" },
  { taskId: "36", slug: "noise-detection", file: "noise-detection.md", status: "Done" },
  {
    taskId: "37",
    slug: "orphan-branch-r-w-protocol",
    file: "orphan-branch-r-w-protocol.md",
    status: "WARN",
  },
  {
    taskId: "38",
    slug: "parallel-swarm-review-concepts",
    file: "parallel-swarm-review-concepts.md",
    status: "Done",
  },
  {
    taskId: "39",
    slug: "per-project-model-switching",
    file: "per-project-model-switching.md",
    status: "Done",
  },
  { taskId: "40", slug: "pgvector-migration", file: "pgvector-migration.md", status: "Done" },
  {
    taskId: "41",
    slug: "presentation-layer-di-composition",
    file: "presentation-layer-di-composition.md",
    status: "Done",
  },
  { taskId: "42", slug: "review-ui-frontend", file: "review-ui-frontend.md", status: "Done" },
  { taskId: "43", slug: "security-hardening", file: "security-hardening.md", status: "Done" },
  {
    taskId: "44",
    slug: "semantic-deduplication-in-agentic-rag",
    file: "semantic-deduplication-in-agentic-rag.md",
    status: "Done",
  },
  { taskId: "45", slug: "semantic-search", file: "semantic-search.md", status: "Done" },
  {
    taskId: "46",
    slug: "server-side-metabolism",
    file: "server-side-metabolism.md",
    status: "WARN",
  },
  {
    taskId: "47",
    slug: "shared-core-di-orchestrator",
    file: "shared-core-di-orchestrator.md",
    status: "Done",
  },
  { taskId: "48", slug: "slack-teams-bot", file: "slack-teams-bot.md", status: "WARN" },
  {
    taskId: "49",
    slug: "smart-blast-radius-wasm-semantic-diff",
    file: "smart-blast-radius-wasm-semantic-diff.md",
    status: "WARN",
  },
  {
    taskId: "50",
    slug: "standalone-engine-graceful-degradation",
    file: "standalone-engine-graceful-degradation.md",
    status: "Done",
  },
  {
    taskId: "51",
    slug: "sub-second-incremental-watch",
    file: "sub-second-incremental-watch.md",
    status: "Done",
  },
  {
    taskId: "52",
    slug: "template-management-inheritance",
    file: "template-management-inheritance.md",
    status: "Done",
  },
  {
    taskId: "53",
    slug: "temporal-decay-scoring",
    file: "temporal-decay-scoring.md",
    status: "WARN",
  },
  {
    taskId: "54",
    slug: "token-limits-chunking-configs",
    file: "token-limits-chunking-configs.md",
    status: "Done",
  },
  {
    taskId: "55",
    slug: "vector-index-search",
    file: "vector-index-search.md",
    status: "Done (Deprecated)",
  },
  {
    taskId: "56",
    slug: "vs-code-blast-radius-ui",
    file: "vs-code-blast-radius-ui.md",
    status: "WARN",
  },
  {
    taskId: "57",
    slug: "vs-code-extension-endpoints",
    file: "vs-code-extension-endpoints.md",
    status: "WARN",
  },
  {
    taskId: "58",
    slug: "vs-code-search-results-ui",
    file: "vs-code-search-results-ui.md",
    status: "Done",
  },
  {
    taskId: "59",
    slug: "vs-code-webview-infrastructure",
    file: "vs-code-webview-infrastructure.md",
    status: "Done",
  },
  {
    taskId: "60",
    slug: "workspace-onboarding-init",
    file: "workspace-onboarding-init.md",
    status: "Done",
  },
  {
    taskId: "61",
    slug: "zero-server-deep-traversal",
    file: "zero-server-deep-traversal.md",
    status: "Done",
  },
];

const READ_SCHEMA = {
  type: "object",
  properties: {
    slug: { type: "string" },
    docStatusClaim: { type: "string" },
    adrId: { type: "string" },
    adrSummary: { type: "string" },
    evidenceFiles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          exists: { type: "boolean" },
          notes: { type: "string" },
          suspiciousFindings: { type: "string" },
        },
        required: ["path", "exists", "notes"],
      },
    },
    testFilesFound: { type: "string" },
    rawNotes: { type: "string" },
  },
  required: ["slug", "docStatusClaim", "evidenceFiles", "rawNotes"],
};

const ANALYZE_SCHEMA = {
  type: "object",
  properties: {
    slug: { type: "string" },
    fabrication: {
      type: "object",
      properties: {
        verdict: { enum: ["ok", "issue_found", "unable_to_verify"] },
        detail: { type: "string" },
      },
      required: ["verdict", "detail"],
    },
    defects: {
      type: "object",
      properties: {
        verdict: { enum: ["ok", "issue_found", "unable_to_verify"] },
        detail: { type: "string" },
      },
      required: ["verdict", "detail"],
    },
    adrCompliance: {
      type: "object",
      properties: {
        verdict: { enum: ["ok", "issue_found", "unable_to_verify"] },
        detail: { type: "string" },
      },
      required: ["verdict", "detail"],
    },
    docsNeedUpdate: {
      type: "object",
      properties: {
        verdict: { enum: ["ok", "issue_found", "unable_to_verify"] },
        detail: { type: "string" },
      },
      required: ["verdict", "detail"],
    },
    overallRisk: { enum: ["none", "low", "medium", "high"] },
    summary: { type: "string" },
  },
  required: [
    "slug",
    "fabrication",
    "defects",
    "adrCompliance",
    "docsNeedUpdate",
    "overallRisk",
    "summary",
  ],
};

function readPrompt(f) {
  const docPath = FEATDIR + "\\" + f.file;
  return `You are gathering raw evidence for an audit of the Docuvia feature "${f.slug}" (roadmap claims status: ${f.status}).

1. Read the roadmap doc: ${docPath}
2. It will reference an ADR (e.g. ADR-0xx) and an "Evidence / Verification Target" file path, plus more paths under "Implementation Details". ADRs live under ${ADRDIR}\\ADR-0xx-*.md (glob for the right number). Read the referenced ADR in full.
3. Resolve every evidence/implementation source file path (they are relative to the repo root ${ROOT}, e.g. a path like lib/core/src/services/foo.ts resolves to ${ROOT}\\lib\\core\\src\\services\\foo.ts). Read each file. If a path doesn't resolve directly, use Glob/Grep under ${ROOT} to locate the real file (things get renamed/moved).
4. For each evidence file, actually inspect the logic relevant to this feature's claimed behavior. Explicitly look for and flag: stub/no-op functions, hardcoded or mocked return values presented as real logic, TODO/FIXME/"not implemented" markers, empty catch blocks swallowing errors, functions that just log and return without doing the claimed work, or tests that only assert against mocks (never touching real logic).
5. Look for nearby test files (*.test.ts, *.spec.ts) covering this code and summarize what they actually assert (real behavior vs. trivial/mocked assertions).

Return concrete, quotable findings (file paths + line numbers/snippets) via the schema — this is raw material for a later judgment pass, so be thorough and literal, not impressionistic. Do not skip step 3 even if step 1 makes the feature sound simple; shallow-looking docs are exactly where fabrication hides.`;
}

function analyzePrompt(f, read) {
  return `You are auditing whether the Docuvia feature "${f.slug}" (roadmap doc claims status: ${f.status}, ADR: ${read && read.adrId ? read.adrId : "see notes"}) is genuinely and correctly implemented.

Below is raw research gathered by another agent that already read the roadmap doc, the linked ADR, and the evidence source files:

${JSON.stringify(read, null, 2)}

Using this material as your primary evidence (you may use Read/Grep to spot-check something specific if the notes seem inconsistent or incomplete, but don't redo the whole investigation), answer these four questions. Each needs a verdict and a concrete 1-3 sentence justification citing specific evidence (file:line or quoted code/text) — no vague hand-waving:

1. 造假 (Fabrication): Is the implementation fake/stubbed/mocked in a way that contradicts the claimed status? (hardcoded returns, TODO stubs, tests asserting only against mocks, code that logs but doesn't act, etc.)
2. 功能瑕疵 (Functional defects): Are there real bugs, unhandled edge cases, or broken error handling that would break this feature in normal use?
3. ADR 符合性 (ADR compliance): Does the implementation match the architecture/decisions in the linked ADR? Note any meaningful drift (not cosmetic naming differences).
4. 文件更新需求 (Docs need update): Does the roadmap feature doc or ADR need updating to match current reality (wrong status label, stale evidence path, missing follow-ups, etc.)?

Set overallRisk to "high" if fabrication was found, "medium" if real defects or ADR drift were found without fabrication, "low" if only doc staleness was found, "none" if everything checks out. Set a verdict to "unable_to_verify" only if the gathered evidence genuinely doesn't cover the question.`;
}

const results = await pipeline(
  FEATURES,
  (f) =>
    agent(readPrompt(f), {
      model: "haiku",
      phase: "Read",
      label: `read:${f.slug}`,
      schema: READ_SCHEMA,
    }),
  (read, f) => {
    log(`Read done for ${f.slug}, analyzing...`);
    return agent(analyzePrompt(f, read), {
      phase: "Analyze",
      label: `analyze:${f.slug}`,
      schema: ANALYZE_SCHEMA,
    }).then((a) => ({ feature: f, read, analysis: a }));
  }
);

const rows = results.filter(Boolean);
log(`Completed ${rows.length}/${FEATURES.length} feature audits`);

return { rows };
