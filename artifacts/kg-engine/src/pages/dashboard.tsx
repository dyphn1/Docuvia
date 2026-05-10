import { useGetDashboard, getGetDashboardQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Database, GitMerge, Network, Tag } from "lucide-react";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: stats, isLoading } = useGetDashboard({
    query: { queryKey: getGetDashboardQueryKey() }
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map(i => (
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

  if (!stats) return null;

  const statCards = [
    { title: "Projects", value: stats.totalProjects, icon: Database },
    { title: "L1 Tags", value: stats.totalL1Tags, icon: Tag },
    { title: "L2 Nodes", value: stats.totalL2Nodes, icon: GitMerge },
    { title: "L3 Nodes", value: stats.totalL3Nodes, icon: Network },
    { title: "Pending Reviews", value: stats.pendingReviews, icon: Activity, className: "text-primary" },
  ];

  return (
    <div className="p-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1 text-sm">System-wide metrics and activity</p>
      </div>

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
              <div className="text-2xl font-bold font-mono">{stat.value.toLocaleString()}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {stats.recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-start gap-4 text-sm">
                <div className="w-2 h-2 mt-1.5 rounded-full bg-primary/50" />
                <div className="flex-1 space-y-1">
                  <p className="text-foreground">{activity.description}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{format(new Date(activity.createdAt), "HH:mm:ss")}</span>
                    {activity.projectName && (
                      <>
                        <span>•</span>
                        <span>{activity.projectName}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {stats.recentActivity.length === 0 && (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No recent activity
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}