import { useState } from "react";
import { Trash2, FlaskConical, Loader2 } from "lucide-react";
import {
  useUpdateProjectIntegration,
  useDeleteProjectIntegration,
  useTestProjectIntegration,
  type ProjectIntegration,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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

export function IntegrationCard({ integration, onDeleted, onUpdated }: IntegrationCardProps) {
  const { toast } = useToast();
  const [testPending, setTestPending] = useState(false);

  const { mutate: updateIntegration, isPending: updatingEnabled } = useUpdateProjectIntegration({
    mutation: {
      onSuccess: () => onUpdated(),
      onError: () => toast({ title: "Failed to update integration", variant: "destructive" }),
    },
  });

  const { mutate: deleteIntegration, isPending: deleting } = useDeleteProjectIntegration({
    mutation: {
      onSuccess: () => {
        toast({ title: "Integration deleted" });
        onDeleted();
      },
      onError: () => toast({ title: "Failed to delete integration", variant: "destructive" }),
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
                This will permanently remove the{" "}
                {integration.integrationType === "slack" ? "Slack" : "Teams"} webhook. Notifications
                will no longer be sent to this endpoint.
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
