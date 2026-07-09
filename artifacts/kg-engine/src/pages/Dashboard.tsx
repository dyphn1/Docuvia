import { useGetDashboard, getGetDashboardQueryKey } from "@workspace/api-client-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Activity, AlertCircle, Database, GitMerge, Network, Tag } from "lucide-react";
import { format } from "date-fns";
import {
  EMPTY_DASHBOARD_STATS,
  STAT_CARD_SKELETON_COUNT,
  ACTIVITY_TIMESTAMP_FORMAT,
  DASHBOARD_PAGE_TITLE,
  DASHBOARD_PAGE_SUBTITLE,
  DASHBOARD_ERROR_TITLE,
  DASHBOARD_ERROR_DESCRIPTION,
  RECENT_ACTIVITY_TITLE,
  NO_RECENT_ACTIVITY_MESSAGE,
  STAT_CARD_TITLES,
} from "@/constants/dashboard";

export default function Dashboard() {
  const {
    data: statsData,
    isError,
    isLoading,
  } = useGetDashboard({
    query: { queryKey: getGetDashboardQueryKey() },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{DASHBOARD_PAGE_TITLE}</h1>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {Array.from({ length: STAT_CARD_SKELETON_COUNT }, (_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const stats = statsData ?? EMPTY_DASHBOARD_STATS;
  const formatStat = (value?: number | null) => (value ?? 0).toLocaleString();
  const recentActivity = stats.recentActivity ?? [];

  const statCards = [
    { title: STAT_CARD_TITLES.projects, value: stats.totalProjects, icon: Database },
    { title: STAT_CARD_TITLES.l1Tags, value: stats.totalL1Tags, icon: Tag },
    { title: STAT_CARD_TITLES.l2Nodes, value: stats.totalL2Nodes, icon: GitMerge },
    { title: STAT_CARD_TITLES.l3Nodes, value: stats.totalL3Nodes, icon: Network },
    {
      title: STAT_CARD_TITLES.pendingReviews,
      value: stats.pendingReviews,
      icon: Activity,
      className: "text-primary",
    },
  ];

  return (
    <div className="p-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{DASHBOARD_PAGE_TITLE}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{DASHBOARD_PAGE_SUBTITLE}</p>
      </div>

      {(isError || !statsData) && (
        <Alert variant="destructive" className="max-w-3xl">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{DASHBOARD_ERROR_TITLE}</AlertTitle>
          <AlertDescription>{DASHBOARD_ERROR_DESCRIPTION}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {statCards.map((stat, i) => (
          <Card key={i} className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className={`h-4 w-4 text-muted-foreground ${stat.className || ""}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono">{formatStat(stat.value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4" />
            {RECENT_ACTIVITY_TITLE}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-start gap-4 text-sm">
                <div className="w-2 h-2 mt-1.5 rounded-full bg-primary/50" />
                <div className="flex-1 space-y-1">
                  <p className="text-foreground">{activity.description}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">
                      {format(new Date(activity.createdAt), ACTIVITY_TIMESTAMP_FORMAT)}
                    </span>
                    {activity.projectName && (
                      <>
                        <span>/</span>
                        <span>{activity.projectName}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {recentActivity.length === 0 && (
              <div className="text-sm text-muted-foreground py-4 text-center">
                {NO_RECENT_ACTIVITY_MESSAGE}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
