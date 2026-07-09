// Shared constants for the Pull Requests pages (PullRequests.tsx, pull-requests/components/*).

// --- Timing ---

export const PR_LIST_REFETCH_INTERVAL_MS = 15000;

// --- Layout / sizing ---

export const PR_LIST_SKELETON_COUNT = 3;

// --- Webhook config ---

export const GITHUB_WEBHOOK_PATH_PREFIX = "/api/webhooks/github";
export const GITHUB_WEBHOOK_PATH_PLACEHOLDER = "/api/webhooks/github/{projectId}";
export const GITHUB_WEBHOOK_SECRET_ENV_VAR_NAME = "GITHUB_WEBHOOK_SECRET";
export const GITHUB_WEBHOOK_CONTENT_TYPE = "application/json";
export const GITHUB_WEBHOOK_EVENT_NAME = "pull_request";

// --- PullRequests page copy ---

export const PR_PAGE_TITLE = "GitHub PR Integration";
export const PR_PAGE_SUBTITLE =
  "Automatically ingest PR commits into the knowledge graph and generate AI impact summaries.";
export const PR_PROJECT_SELECT_PLACEHOLDER = "Select a project…";
export const PR_REFRESH_BUTTON_LABEL = "Refresh";
export const PR_WEBHOOK_CARD_TITLE = "Webhook Setup";
export const PR_WEBHOOK_CARD_DESCRIPTION =
  "Configure this endpoint in your GitHub repository settings to receive PR events.";
export const PR_WEBHOOK_PAYLOAD_URL_LABEL = "Payload URL:";
export const PR_WEBHOOK_CONTENT_TYPE_LABEL = "Content type:";
export const PR_WEBHOOK_SECRET_LABEL = "Secret:";
export const PR_WEBHOOK_SECRET_HELPER_TEXT = "Set";
export const PR_WEBHOOK_SECRET_HELPER_SUFFIX = "env var on the server";
export const PR_WEBHOOK_EVENTS_LABEL = "Events:";
export const PR_NO_PROJECT_SELECTED_MESSAGE = "Select a project to view its pull requests.";

// --- PullRequestList copy ---

export const PR_STATE_BADGE_LABELS: Record<string, string> = {
  open: "open",
  merged: "merged",
  closed: "closed",
};

export const PR_ANALYSIS_STATUS_BADGE_LABELS: Record<string, string> = {
  completed: "analyzed",
  in_progress: "analyzing…",
  failed: "failed",
  pending: "pending",
};

export const PR_LIST_CARD_TITLE = "Pull Requests";
export const PR_VIEW_IMPACT_BUTTON_LABEL = "View Impact";
export const PR_ANALYZE_BUTTON_LABEL = "Analyze";
export const PR_LIST_EMPTY_MESSAGE =
  "No pull requests found. Configure the webhook above to start receiving PR events.";
export const PR_AUTHOR_PREFIX = "by ";
export const PR_MERGED_DATE_PREFIX = " · merged ";

// --- PullRequestDetail copy ---

export const PR_DETAIL_TITLE_PREFIX = "PR #";
export const PR_DETAIL_TITLE_SUFFIX = " — Knowledge Impact";
export const PR_DETAIL_DESCRIPTION = "L2 modules and L3 decisions affected by this pull request.";
export const PR_DETAIL_COMMITS_LABEL = "commits";
export const PR_DETAIL_MODULES_LABEL = "modules";
export const PR_DETAIL_DECISIONS_LABEL = "decisions";
export const PR_DETAIL_AI_SUMMARY_HEADING = "AI Impact Summary";
export const PR_DETAIL_MODULES_AFFECTED_HEADING = "Modules Affected";
export const PR_DETAIL_DECISIONS_HEADING = "Decisions & Changes";
export const PR_DETAIL_NO_CHANGES_MESSAGE =
  'No knowledge graph changes detected yet. Try running "Analyze Now".';
