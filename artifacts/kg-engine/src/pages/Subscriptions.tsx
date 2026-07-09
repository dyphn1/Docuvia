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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Label } from "@/components/ui/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Separator } from "@/components/ui/Separator";
import { normalizeProjects } from "@/lib/projects";
import {
  SUBSCRIPTION_SKELETON_COUNT,
  SUBSCRIPTION_DATE_FORMAT,
  SUBSCRIPTIONS_PAGE_TITLE,
  SUBSCRIPTIONS_PAGE_SUBTITLE,
  SELECT_PROJECT_TITLE,
  SELECT_PROJECT_SUBSCRIPTIONS_DESCRIPTION,
  SELECT_PROJECT_PLACEHOLDER,
  ADD_SUBSCRIPTION_TITLE,
  ADD_SUBSCRIPTION_DESCRIPTION,
  PUBLISHER_PROJECT_ID_LABEL,
  PUBLISHER_PROJECT_ID_PLACEHOLDER,
  PUBLISHER_PROJECT_ID_MIN,
  SUBSCRIBE_BUTTON_TEXT,
  SUBSCRIBED_TO_TITLE,
  SUBSCRIBED_TO_DESCRIPTION,
  NO_SUBSCRIPTIONS_MESSAGE,
  SUBSCRIBERS_TITLE,
  SUBSCRIBERS_DESCRIPTION,
  NO_SUBSCRIBERS_MESSAGE,
  WATCHING_BADGE_TEXT,
  SUBSCRIPTION_SINCE_PREFIX,
  UNKNOWN_PROJECT_NAME_PREFIX,
} from "@/constants/subscriptions";

function SubscriptionRow({
  projectName,
  createdAt,
  action,
}: {
  projectName: string;
  createdAt: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-md border border-border/50 bg-background/50">
      <div>
        <p className="text-sm font-medium">{projectName}</p>
        <p className="text-[10px] text-muted-foreground">
          {SUBSCRIPTION_SINCE_PREFIX} {format(new Date(createdAt), SUBSCRIPTION_DATE_FORMAT)}
        </p>
      </div>
      {action}
    </div>
  );
}

export default function Subscriptions() {
  const queryClient = useQueryClient();

  const { data: projectsData } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = normalizeProjects(projectsData);

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

  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

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
        <h1 className="text-2xl font-bold tracking-tight">{SUBSCRIPTIONS_PAGE_TITLE}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{SUBSCRIPTIONS_PAGE_SUBTITLE}</p>
      </div>

      {/* Project selector */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">{SELECT_PROJECT_TITLE}</CardTitle>
          <CardDescription className="text-xs">
            {SELECT_PROJECT_SUBSCRIPTIONS_DESCRIPTION}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="w-full max-w-sm">
              <SelectValue placeholder={SELECT_PROJECT_PLACEHOLDER} />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
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
                {ADD_SUBSCRIPTION_TITLE}
              </CardTitle>
              <CardDescription className="text-xs">{ADD_SUBSCRIPTION_DESCRIPTION}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-2 max-w-sm">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="publisher-id" className="text-xs">
                    {PUBLISHER_PROJECT_ID_LABEL}
                  </Label>
                  <Input
                    id="publisher-id"
                    placeholder={PUBLISHER_PROJECT_ID_PLACEHOLDER}
                    value={publisherInput}
                    onChange={(e) => setPublisherInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubscribe()}
                    type="number"
                    min={PUBLISHER_PROJECT_ID_MIN}
                  />
                </div>
                <Button
                  onClick={handleSubscribe}
                  disabled={!publisherInput || creating}
                  size="sm"
                  className="mb-0"
                >
                  {creating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    SUBSCRIBE_BUTTON_TEXT
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Separator />

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: SUBSCRIPTION_SKELETON_COUNT }, (_, i) => (
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
                    {SUBSCRIBED_TO_TITLE}
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {subscribedTo.length}
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-xs">{SUBSCRIBED_TO_DESCRIPTION}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {subscribedTo.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">
                      {NO_SUBSCRIPTIONS_MESSAGE}
                    </p>
                  ) : (
                    subscribedTo.map((sub) => (
                      <SubscriptionRow
                        key={sub.id}
                        projectName={
                          projectMap.get(sub.publisherProjectId) ??
                          `${UNKNOWN_PROJECT_NAME_PREFIX}${sub.publisherProjectId}`
                        }
                        createdAt={sub.createdAt}
                        action={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteSub({ subscriptionId: sub.id })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Subscribers */}
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    {SUBSCRIBERS_TITLE}
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {subscribers.length}
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-xs">{SUBSCRIBERS_DESCRIPTION}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {subscribers.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">
                      {NO_SUBSCRIBERS_MESSAGE}
                    </p>
                  ) : (
                    subscribers.map((sub) => (
                      <SubscriptionRow
                        key={sub.id}
                        projectName={
                          projectMap.get(sub.subscriberProjectId) ??
                          `${UNKNOWN_PROJECT_NAME_PREFIX}${sub.subscriberProjectId}`
                        }
                        createdAt={sub.createdAt}
                        action={
                          <Badge variant="outline" className="text-xs">
                            {WATCHING_BADGE_TEXT}
                          </Badge>
                        }
                      />
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
