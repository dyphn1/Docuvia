import { useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus, Radio, Users, Loader2 } from "lucide-react";
import {
  useListProjects,
  getListProjectsQueryKey,
  useListProjectSubscriptions,
  getListProjectSubscriptionsQueryKey,
  useCreateSubscription,
  useDeleteSubscription,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

export default function Subscriptions() {
  const queryClient = useQueryClient();

  const { data: projects } = useListProjects({ query: { queryKey: getListProjectsQueryKey() } });

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [publisherInput, setPublisherInput] = useState("");

  const projectId = parseInt(selectedProjectId, 10);
  const isValidProject = !!selectedProjectId && !isNaN(projectId);

  const { data: subData, isLoading } = useListProjectSubscriptions(projectId, {
    query: {
      queryKey: getListProjectSubscriptionsQueryKey(projectId),
      enabled: isValidProject,
    },
  });

  const { mutate: createSub, isPending: creating } = useCreateSubscription({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListProjectSubscriptionsQueryKey(projectId),
        });
        setPublisherInput("");
      },
    },
  });

  const { mutate: deleteSub } = useDeleteSubscription({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListProjectSubscriptionsQueryKey(projectId),
        });
      },
    },
  });

  const projectMap = new Map((projects ?? []).map((p) => [p.id, p.name]));

  const subscribedTo =
    subData?.subscriptions.filter((s) => s.subscriberProjectId === projectId) ?? [];
  const subscribers =
    subData?.subscriptions.filter((s) => s.publisherProjectId === projectId) ?? [];

  const handleSubscribe = () => {
    const pubId = parseInt(publisherInput, 10);
    if (isNaN(pubId) || !isValidProject) return;
    createSub({ data: { subscriberProjectId: projectId, publisherProjectId: pubId } });
  };

  return (
    <div className="p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Subscriptions</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage cross-team project subscriptions and notifications
        </p>
      </div>

      {/* Project selector */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Select Project</CardTitle>
          <CardDescription className="text-xs">
            Choose a project to view and manage its subscriptions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="w-full max-w-sm">
              <SelectValue placeholder="Select a project…" />
            </SelectTrigger>
            <SelectContent>
              {(projects ?? []).map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {isValidProject && (
        <>
          {/* Add Subscription */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Subscription
              </CardTitle>
              <CardDescription className="text-xs">
                Subscribe this project to another project's updates
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-2 max-w-sm">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="publisher-id" className="text-xs">
                    Publisher Project ID
                  </Label>
                  <Input
                    id="publisher-id"
                    placeholder="Enter project ID…"
                    value={publisherInput}
                    onChange={(e) => setPublisherInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubscribe()}
                    type="number"
                    min={1}
                  />
                </div>
                <Button
                  onClick={handleSubscribe}
                  disabled={!publisherInput || creating}
                  size="sm"
                  className="mb-0"
                >
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Subscribe"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Separator />

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-md" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Subscribed to */}
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Radio className="h-4 w-4 text-primary" />
                    Subscribed to
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {subscribedTo.length}
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Projects this project is watching
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {subscribedTo.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">
                      Not subscribed to any projects yet
                    </p>
                  ) : (
                    subscribedTo.map((sub) => (
                      <div
                        key={sub.id}
                        className="flex items-center justify-between px-3 py-2 rounded-md border border-border/50 bg-background/50"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {projectMap.get(sub.publisherProjectId) ?? `Project #${sub.publisherProjectId}`}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            Since {format(new Date(sub.createdAt), "MMM d, yyyy")}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteSub({ subscriptionId: sub.id })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Subscribers */}
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    Subscribers
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {subscribers.length}
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Projects watching this project
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {subscribers.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">
                      No subscribers yet
                    </p>
                  ) : (
                    subscribers.map((sub) => (
                      <div
                        key={sub.id}
                        className="flex items-center justify-between px-3 py-2 rounded-md border border-border/50 bg-background/50"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {projectMap.get(sub.subscriberProjectId) ?? `Project #${sub.subscriberProjectId}`}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            Since {format(new Date(sub.createdAt), "MMM d, yyyy")}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          Watching
                        </Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
