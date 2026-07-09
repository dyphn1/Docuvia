// Shared constants for the Review pages (Review.tsx, review/components/*).

// --- Timing ---

export const REVIEW_STATS_REFETCH_INTERVAL_MS = 10000;
export const REVIEW_TASKS_REFETCH_INTERVAL_MS = 10000;

// --- Layout / sizing ---

export const REVIEW_TASK_LIST_SKELETON_COUNT = 3;

// --- Date formats ---

export const REVIEW_TASK_DATE_FORMAT = "MMM d HH:mm";

// --- Review task status codes ---

export const REVIEW_TASK_STATUS_PENDING = "pending";
export const REVIEW_TASK_STATUS_APPROVED = "approved";
export const REVIEW_TASK_STATUS_REJECTED = "rejected";
export const REVIEW_TASK_STATUS_DEFERRED = "deferred";

// --- Node type color map ---

export const REVIEW_NODE_TYPE_BADGE_COLORS: Record<string, string> = {
  module: "bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400",
  package: "bg-violet-500/10 border-violet-500/20 text-violet-600 dark:text-violet-400",
  pcd: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
  change: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  rule: "bg-orange-500/10 border-orange-500/20 text-orange-600 dark:text-orange-400",
  decision: "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400",
  context: "bg-sky-500/10 border-sky-500/20 text-sky-600 dark:text-sky-400",
};

// --- ReviewStatsSidebar copy ---

export const REVIEW_STATS_TITLE = "Review Stats";
export const REVIEW_STATS_PENDING_LABEL = "Pending Tasks";
export const REVIEW_STATS_APPROVED_LABEL = "Approved";
export const REVIEW_STATS_REJECTED_LABEL = "Rejected";
export const REVIEW_STATS_DEFERRED_LABEL = "Deferred";
export const REVIEW_STATS_REVIEWED_TODAY_LABEL = "Reviewed Today";
export const REVIEW_HOW_TO_TITLE = "How to Review";
export const REVIEW_HOW_TO_STEPS: string[] = [
  "Click the arrow to expand a card and view full content",
  'Click "Edit & Correct" to modify AI-generated content',
  "Approve/Reject to resolve — corrections write back to the node",
];

// --- ReviewTaskDetail copy ---

export const REVIEW_NO_DESCRIPTION_TEXT = "No description provided.";
export const REVIEW_NODE_CONTENT_LABEL = "Node Content";
export const REVIEW_EDIT_CORRECT_LABEL = "Edit & Correct";
export const REVIEW_CANCEL_EDIT_LABEL = "Cancel Edit";
export const REVIEW_CORRECTION_PLACEHOLDER = "Enter corrected content...";
export const REVIEW_HUMAN_CORRECTION_LABEL = "Human Correction";
export const REVIEW_SHOW_CONTENT_LABEL = "Show";
export const REVIEW_HIDE_CONTENT_LABEL = "Hide";
export const REVIEW_CONTENT_TOGGLE_SUFFIX = "content";
export const REVIEW_DEFER_BUTTON_LABEL = "Defer";
export const REVIEW_REJECT_BUTTON_LABEL = "Reject";
export const REVIEW_SAVE_APPROVE_BUTTON_LABEL = "Save & Approve";
export const REVIEW_APPROVE_BUTTON_LABEL = "Approve";

// --- ReviewTaskList copy ---

export const REVIEW_QUEUE_TITLE = "Review Queue";
export const REVIEW_QUEUE_SUBTITLE =
  "Human validation of AI-extracted knowledge — expand cards to view & correct content";
export const REVIEW_NO_TASKS_TITLE_PREFIX = "No";
export const REVIEW_NO_TASKS_TITLE_SUFFIX = "tasks";
export const REVIEW_NO_PENDING_TASKS_MESSAGE =
  "Run the AI pipeline in Ingest & Generate to create review tasks.";
export const REVIEW_NO_TASKS_RESOLVED_PREFIX = "No tasks have been";
export const REVIEW_NO_TASKS_RESOLVED_SUFFIX = "yet.";
