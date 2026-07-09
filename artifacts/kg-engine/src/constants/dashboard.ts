import type { DashboardStats } from "@workspace/api-client-react";

export const EMPTY_DASHBOARD_STATS: DashboardStats = {
  totalProjects: 0,
  totalL1Tags: 0,
  totalL2Nodes: 0,
  totalL3Nodes: 0,
  pendingReviews: 0,
  recentActivity: [],
};

export const STAT_CARD_SKELETON_COUNT = 5;
export const ACTIVITY_TIMESTAMP_FORMAT = "HH:mm:ss";

export const DASHBOARD_PAGE_TITLE = "Overview";
export const DASHBOARD_PAGE_SUBTITLE = "System-wide metrics and activity";

export const DASHBOARD_ERROR_TITLE = "Dashboard data unavailable";
export const DASHBOARD_ERROR_DESCRIPTION =
  "The overview is shown with empty values because the API server did not return dashboard stats.";

export const RECENT_ACTIVITY_TITLE = "Recent Activity";
export const NO_RECENT_ACTIVITY_MESSAGE = "No recent activity";

export const STAT_CARD_TITLES = {
  projects: "Projects",
  l1Tags: "L1 Tags",
  l2Nodes: "L2 Nodes",
  l3Nodes: "L3 Nodes",
  pendingReviews: "Pending Reviews",
} as const;
