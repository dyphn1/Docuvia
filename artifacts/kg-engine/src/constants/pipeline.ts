// Pipeline.tsx
export const PROJECT_STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive"> =
  {
    active: "default",
    indexing: "secondary",
  };
export const PIPELINE_PAGE_TITLE = "Ingest & Generate Pipeline";
export const PIPELINE_PAGE_DESCRIPTION =
  "Phase 2 & 3 — Pull commits from VCS, then run the AI knowledge construction pipeline";
export const PIPELINE_SELECT_PROJECT_CARD_TITLE = "Select Project";
export const PIPELINE_SELECT_PROJECT_PLACEHOLDER = "Choose a project...";
export const PIPELINE_COMMITS_SUFFIX_LABEL = "commits";
export const PIPELINE_L2_NODES_SUFFIX_LABEL = "L2 nodes";
export const PIPELINE_L3_NODES_SUFFIX_LABEL = "L3 nodes";

// Shared between GenerateCard.tsx and IngestCard.tsx sync-mode Select
export const SYNC_MODE_FULL_LABEL = "Full Sync";
export const SYNC_MODE_INCREMENTAL_LABEL = "Incremental Sync";

// GenerateCard.tsx
export const MODEL_OPTIONS = [
  { value: "gpt-5.2", label: "gpt-5.2 (recommended)" },
  { value: "gpt-5.4", label: "gpt-5.4 (most capable)" },
  { value: "gpt-5-mini", label: "gpt-5-mini (fast)" },
  { value: "gpt-5-nano", label: "gpt-5-nano (cheapest)" },
] as const;
export const DEFAULT_MODEL = MODEL_OPTIONS[0].value;
export const DEFAULT_MAX_COMMITS = "50";
export const MIN_SIGNAL_SCORE = "0.4";
export const GENERATE_CARD_TITLE = "Phase 3 — AI Knowledge Generation";
export const GENERATE_CARD_DESCRIPTION =
  "Run L1 Tagger → L2 Extractor → L3 Generator pipeline on filtered commits.";
export const GENERATE_STEP_1_TEXT = "Filter commits by signal score (≥";
export const GENERATE_STEP_2_TEXT = "L1 Tagger — generate global classification tags";
export const GENERATE_STEP_3_TEXT = "L2 Extractor — extract modules & packages";
export const GENERATE_STEP_4_TEXT = "L3 Generator — rules, decisions & rationale";
export const GENERATE_STEP_5_TEXT = "Queue review tasks for human validation";
export const GENERATE_MODEL_FIELD_LABEL = "Model";
export const GENERATE_MAX_COMMITS_FIELD_LABEL = "Max Commits";
export const GENERATE_MODE_FIELD_LABEL = "Generation Mode";
export const GENERATE_RUNNING_LABEL = "Running pipeline...";
export const GENERATE_RUN_BUTTON_LABEL = "Run AI Pipeline";
export const GENERATE_COMPLETE_LABEL = "Pipeline Complete";
export const GENERATE_L1_TAGS_LABEL = "L1 Tags";
export const GENERATE_L2_NODES_LABEL = "L2 Nodes";
export const GENERATE_L3_NODES_LABEL = "L3 Nodes";
export const GENERATE_REVIEW_TASKS_LABEL = "Review Tasks";
export const GENERATE_UPDATED_SUFFIX_LABEL = "upd";
export const GENERATE_COMMITS_PROCESSED_SUFFIX = "commits processed → go to Review Queue";
export const GENERATE_DOCS_USED_SUFFIX = "docs used as context";
export const GENERATE_ERROR_FALLBACK = "Generation failed";

// IngestCard.tsx
export const DEFAULT_BRANCH = "main";
export const DEFAULT_COMMIT_LIMIT = "100";
export const INGEST_CARD_TITLE = "Phase 2 — Git Ingest";
export const INGEST_CARD_DESCRIPTION =
  "Fetch commit history from GitHub. Leave URL blank to use project's repo URL.";
export const INGEST_REPO_URL_FIELD_LABEL = "Repository URL (optional override)";
export const INGEST_REPO_URL_PLACEHOLDER_FALLBACK = "https://github.com/owner/repo";
export const INGEST_BRANCH_FIELD_LABEL = "Branch";
export const INGEST_COMMIT_LIMIT_FIELD_LABEL = "Commit Limit";
export const INGEST_GITHUB_TOKEN_FIELD_LABEL = "GitHub Token (optional, for private repos)";
export const INGEST_GITHUB_TOKEN_PLACEHOLDER = "ghp_...";
export const INGEST_SYNC_MODE_FIELD_LABEL = "Sync Mode";
export const INGEST_FETCHING_LABEL = "Fetching commits...";
export const INGEST_BUTTON_LABEL = "Ingest from GitHub";
export const INGEST_COMPLETE_LABEL = "Ingest Complete";
export const INGEST_INGESTED_LABEL = "Ingested";
export const INGEST_SKIPPED_LABEL = "Skipped";
export const INGEST_TOTAL_LABEL = "Total";
export const INGEST_ERROR_FALLBACK = "Ingest failed";
