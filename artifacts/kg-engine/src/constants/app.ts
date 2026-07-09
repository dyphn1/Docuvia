/**
 * Centralized application constants for kg-engine "logic" files.
 *
 * Tailwind className strings are intentionally NOT extracted here (they are
 * exempt from this consolidation). This file only holds semantically
 * meaningful copy/text, status/type codes, keys, thresholds, and similar
 * config-like literal values that previously lived inline in source files.
 *
 * Grouped by originating source file for readability.
 */

// ============================================================================
// src/App.tsx
// ============================================================================

/** React Query default option: disable automatic retry on failed queries. */
export const QUERY_CLIENT_DEFAULT_RETRY = false;
/** React Query default option: disable refetching when the window regains focus. */
export const QUERY_CLIENT_REFETCH_ON_WINDOW_FOCUS = false;

// ============================================================================
// src/main.tsx
// ============================================================================

/** DOM element id that the React app root is mounted into (see index.html). */
export const ROOT_ELEMENT_ID = "root";

// ============================================================================
// src/components/Layout.tsx
// ============================================================================

export const LAYOUT_BRAND_NAME = "Docuvia";
export const LAYOUT_TAGLINE = "Knowledge Graph Engine";
export const LAYOUT_VERSION_LABEL = "Docuvia v0.2";
export const LAYOUT_FOOTER_TEXT = "Universal VCS Knowledge Graph";
export const LAYOUT_PROJECT_PLACEHOLDER = "Select project…";

// ============================================================================
// src/components/NotificationBell.tsx
// ============================================================================

export const NOTIFICATION_POLL_INTERVAL_MS = 30_000;
export const RECENT_NOTIFICATIONS_LIMIT = 10;
export const UNREAD_COUNT_DISPLAY_CAP = 9;
export const PAYLOAD_SUMMARY_MAX_LENGTH = 80;

export const NOTIFICATION_TYPE_LABELS: Record<string, { label: string; className: string }> = {
  new_commit: {
    label: "New Commit",
    className: "bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400",
  },
  new_l3_node: {
    label: "New L3 Node",
    className: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  },
  cross_link_detected: {
    label: "Cross Link",
    className: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
  },
};

export const NOTIFICATION_BELL_HEADER_TEXT = "Notifications";
export const NOTIFICATION_BELL_MARK_ALL_READ_TEXT = "Mark all read";
export const NOTIFICATION_BELL_EMPTY_TEXT = "No notifications";

// ============================================================================
// src/components/IngestStatusCard.tsx
// ============================================================================

export const VCS_TYPE_GIT = "git";
export const INGEST_MODE_INCREMENTAL = "incremental";
export const NEVER_SYNCED_LABEL = "Never synced";
export const SVN_REVISION_LABEL_PREFIX = "Rev. ";

export const INGEST_STATUS_CARD_TITLE = "Incremental Sync Status";
export const INGEST_STATUS_LOAD_ERROR_TEXT = "Failed to load ingest status";
export const VCS_LABEL_GIT = "Git";
export const VCS_LABEL_SVN = "SVN";
export const INGEST_STATUS_VCS_LABEL = "VCS";
export const INGEST_STATUS_LAST_SYNC_LABEL = "Last sync";
export const INGEST_STATUS_PENDING_LABEL = "Pending";
export const INGEST_STATUS_COMMITS_SUFFIX = "commits";
export const INGEST_STATUS_SYNC_BUTTON_TEXT = "Sync (Incremental)";
export const INGEST_STATUS_GENERATE_BUTTON_TEXT = "Generate (Delta)";

// ============================================================================
// src/components/L2BootstrapReview.tsx
// ============================================================================

export const DECISION_APPROVE = "approve" as const;
export const DECISION_REJECT = "reject" as const;
export const UNCATEGORIZED_TAG_LABEL = "Uncategorized";

export const L2_EXISTING_MODULE_BADGE_TEXT = "Existing";
export const L2_NO_PATHS_TEXT = "No paths";
export const L2_NEW_MODULE_BADGE_TEXT = "New";
export const L2_APPROVED_BADGE_TEXT = "Approved";
export const L2_REJECTED_BADGE_TEXT = "Rejected";
export const L2_NO_DESCRIPTION_TEXT = "No description provided.";
export const L2_APPROVE_BUTTON_TEXT = "Approve";
export const L2_REJECT_BUTTON_TEXT = "Reject";
export const L2_PATH_PATTERNS_LABEL = "Path Patterns (Glob)";
export const L2_PATH_PATTERNS_PLACEHOLDER = "e.g. src/components/**/*.tsx\nsrc/lib/**/*.ts";
export const L2_BOOTSTRAP_CONFIRMED_TOAST = "Bootstrap confirmed successfully";
export const L2_BOOTSTRAP_CONFIRM_ERROR_PREFIX = "Failed to confirm: ";
export const L2_SELECT_DECISION_ERROR_TOAST = "Please make a decision for at least one module";
export const L2_REVIEW_TITLE = "Review L2 Modules";
export const L2_REVIEW_DESCRIPTION =
  "Approve or reject AI-generated modules to bootstrap this project.";
export const L2_APPROVE_ALL_BUTTON_TEXT = "Approve All";
export const L2_SUBMIT_SAVING_TEXT = "Saving...";
export const L2_SUBMIT_BUTTON_TEXT = "Submit Decisions";
export const L2_NO_MODULES_TEXT = "No new modules require confirmation.";

// ============================================================================
// src/hooks/use-current-project.ts
// ============================================================================

export const CURRENT_PROJECT_STORAGE_KEY = "docuvia_current_project_id";
