import { useState } from "react";
import { Webhook, Plus, Trash2, FlaskConical, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProjects,
  getListProjectsQueryKey,
  useListProjectIntegrations,
  getListProjectIntegrationsQueryKey,
  useCreateProjectIntegration,
  useUpdateProjectIntegration,
  useDeleteProjectIntegration,
  useTestProjectIntegration,
  type ProjectIntegration,
  ProjectIntegrationInputIntegrationType,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

function integrationBadge(type: string) {
  if (type === "slack") {
    return (
      <Badge variant="outline" className="text-[#4A154B] border-[#4A154B]/30 bg-[#4A154B]/5">
        Slack
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[#005BA1] border-[#005BA1]/30 bg-[#005BA1]/5">
      Teams
    </Badge>
  );
}

interface IntegrationCardProps {
  integration: ProjectIntegration;
  onDeleted: () => void;
  onUpdated: () => void;
}

function IntegrationCard({ integration, onDeleted, onUpdated }: IntegrationCardProps) {
  const { toast } = useToast();
  const [testPending, setTestPending] = useState(false);

  const { mutate: updateIntegration, isPending: updatingEnabled } = useUpdateProjectIntegration({
    mutation: {
      onSuccess: () => onUpdated(),
      onError: () =>
        toast({ title: "Failed to update integration", variant: "destructive" }),
    },
  });

  const { mutate: deleteIntegration, isPending: deleting } = useDeleteProjectIntegration({
    mutation: {
      onSuccess: () => {
        toast({ title: "Integration deleted" });
        onDeleted();
      },
      onError: () =>
        toast({ title: "Failed to delete integration", variant: "destructive" }),
    },
  });

  const { mutate: testIntegration } = useTestProjectIntegration({
    mutation: {
      onMutate: () => setTestPending(true),
      onSuccess: (data) => {
        setTestPending(false);
        if (data.success) {
          toast({ title: "Test message sent successfully!" });
        } else {
          toast({
            title: "Test failed",
            description: data.error ?? "Webhook returned an error.",
            variant: "destructive",
          });
        }
      },
      onError: () => {
        setTestPending(false);
        toast({ title: "Test request failed", variant: "destructive" });
      },
    },
  });

  const handleToggle = (checked: boolean) => {
    updateIntegration({ integrationId: integration.id, data: { enabled: checked } });
  };

  const handleDelete = () => {
    deleteIntegration({ integrationId: integration.id });
  };

  const handleTest = () => {
    testIntegration({ integrationId: integration.id });
  };

  const shortUrl =
    integration.webhookUrl.length > 60
      ? integration.webhookUrl.slice(0, 57) + "…"
      : integration.webhookUrl;

  return (
    <div className="flex items-center justify-between px-4 py-3 rounded-md border border-border/50 bg-background/50 gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5">{integrationBadge(integration.integrationType)}</div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate text-foreground">{shortUrl}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Added {new Date(integration.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <Switch
          checked={integration.enabled}
          onCheckedChange={handleToggle}
          disabled={updatingEnabled}
          aria-label="Toggle enabled"
        />

        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
          onClick={handleTest}
          disabled={testPending}
          title="Send a test notification"
        >
          {testPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FlaskConical className="h-3.5 w-3.5" />
          )}
          <span className="ml-1 text-xs">Test</span>
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              disabled={deleting}
              title="Delete integration"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete integration?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove the {integration.integrationType === "slack" ? "Slack" : "Teams"} webhook. Notifications will no longer be sent to this endpoint.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export default function Integrations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: projects } = useListProjects({ query: { queryKey: getListProjectsQueryKey() } });

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [newType, setNewType] = useState<"slack" | "teams">("slack");
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [newEnabled, setNewEnabled] = useState(true);
  const [urlError, setUrlError] = useState<string | null>(null);

  const projectId = parseInt(selectedProjectId, 10);
  const isValidProject = !!selectedProjectId && !isNaN(projectId);

  const { data: integrations, isLoading } = useListProjectIntegrations(projectId, {
    query: {
      queryKey: getListProjectIntegrationsQueryKey(projectId),
      enabled: isValidProject,
    },
  });

  const { mutate: createIntegration, isPending: creating } = useCreateProjectIntegration({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListProjectIntegrationsQueryKey(projectId),
        });
        setNewWebhookUrl("");
        setNewEnabled(true);
        toast({ title: "Integration added successfully" });
      },
      onError: () => {
        toast({ title: "Failed to add integration", variant: "destructive" });
      },
    },
  });

  const invalidateList = () => {
    queryClient.invalidateQueries({
      queryKey: getListProjectIntegrationsQueryKey(projectId),
    });
  };

  const validateUrl = (url: string): string | null => {
    if (!url) return "Webhook URL is required.";
    if (!url.startsWith("https://")) return "Webhook URL must start with https://";
    try {
      new URL(url);
    } catch {
      return "Invalid URL format.";
    }
    return null;
  };

  const handleAdd = () => {
    const err = validateUrl(newWebhookUrl);
    if (err) {
      setUrlError(err);
      return;
    }
    setUrlError(null);
    createIntegration({
      id: projectId,
      data: {
        integrationType: newType as typeof ProjectIntegrationInputIntegrationType[keyof typeof ProjectIntegrationInputIntegrationType],
        webhookUrl: newWebhookUrl,
        enabled: newEnabled,
      },
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

      {/* Help text */}
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

      {/* Project selector */}
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
          {/* Add Integration Form */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Integration
              </CardTitle>
              <CardDescription className="text-xs">
                Configure a new Slack or Teams webhook for this project
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3 max-w-lg">
                <div className="flex gap-3">
                  {/* Type */}
                  <div className="space-y-1 w-36">
                    <Label htmlFor="integration-type" className="text-xs">
                      Type
                    </Label>
                    <Select
                      value={newType}
                      onValueChange={(v) => setNewType(v as "slack" | "teams")}
                    >
                      <SelectTrigger id="integration-type" className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="slack">Slack</SelectItem>
                        <SelectItem value="teams">Microsoft Teams</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Enabled toggle */}
                  <div className="space-y-1 flex flex-col justify-end pb-1">
                    <Label className="text-xs">Enabled</Label>
                    <Switch
                      checked={newEnabled}
                      onCheckedChange={setNewEnabled}
                      aria-label="Enable on creation"
                    />
                  </div>
                </div>

                {/* Webhook URL */}
                <div className="space-y-1">
                  <Label htmlFor="webhook-url" className="text-xs">
                    Webhook URL
                  </Label>
                  <Input
                    id="webhook-url"
                    placeholder="https://hooks.slack.com/services/…"
                    value={newWebhookUrl}
                    onChange={(e) => {
                      setNewWebhookUrl(e.target.value);
                      if (urlError) setUrlError(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                    className="text-xs h-8"
                  />
                  {urlError && (
                    <p className="text-xs text-destructive mt-0.5">{urlError}</p>
                  )}
                </div>

                <Button
                  onClick={handleAdd}
                  disabled={!newWebhookUrl || creating}
                  size="sm"
                  className="self-start"
                >
                  {creating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Add Integration
                </Button>
              </div>
            </CardContent>
          </Card>

          <Separator />

          {/* Integration List */}
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
