import { useState } from "react";
import { Webhook } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProjects,
  getListProjectsQueryKey,
  useListProjectIntegrations,
  getListProjectIntegrationsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { normalizeProjects } from "@/lib/projects";
import { IntegrationCard } from "./integrations/components/IntegrationCard";
import { CreateIntegrationForm } from "./integrations/components/CreateIntegrationForm";

export default function Integrations() {
  const queryClient = useQueryClient();

  const { data: projectsData } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = normalizeProjects(projectsData);

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const projectId = parseInt(selectedProjectId, 10);
  const isValidProject = !!selectedProjectId && !isNaN(projectId);

  const { data: integrations, isLoading } = useListProjectIntegrations(projectId, {
    query: {
      queryKey: getListProjectIntegrationsQueryKey(projectId),
      enabled: isValidProject,
    },
  });

  const invalidateList = () => {
    queryClient.invalidateQueries({
      queryKey: getListProjectIntegrationsQueryKey(projectId),
    });
  };

  return (
    <div className="p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Forward Docuvia notifications to Slack or Microsoft Teams channels via incoming webhooks
        </p>
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Slack:</strong> Go to your Slack workspace →{" "}
            <em>Apps → Incoming Webhooks</em> and create a new webhook for the desired channel.
            Paste the generated URL below.
            <br />
            <strong className="text-foreground">Microsoft Teams:</strong> In a Teams channel, click{" "}
            <em>… → Connectors → Incoming Webhook</em>, configure it and copy the webhook URL.
            <br />
            Docuvia will send notifications for new commits ingested, new L3 decision nodes, and
            cross-project links detected.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Select Project</CardTitle>
          <CardDescription className="text-xs">
            Choose a project to view and manage its webhook integrations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="w-full max-w-sm">
              <SelectValue placeholder="Select a project…" />
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
          <CreateIntegrationForm projectId={projectId} onCreated={invalidateList} />

          <Separator />

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-md" />
              ))}
            </div>
          ) : (
            <Card className="border-border/50 bg-card/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Webhook className="h-4 w-4 text-primary" />
                  Configured Webhooks
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {(integrations ?? []).length}
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Toggle, test, or remove webhook integrations for this project
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(integrations ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground py-6 text-center">
                    No integrations configured yet. Add one above to start forwarding notifications.
                  </p>
                ) : (
                  (integrations ?? []).map((integration) => (
                    <IntegrationCard
                      key={integration.id}
                      integration={integration}
                      onDeleted={invalidateList}
                      onUpdated={invalidateList}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
