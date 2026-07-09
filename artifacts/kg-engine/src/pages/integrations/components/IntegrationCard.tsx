import { useState } from "react";
import { Trash2, FlaskConical, Loader2 } from "lucide-react";
import {
  useUpdateProjectIntegration,
  useDeleteProjectIntegration,
  useTestProjectIntegration,
  type ProjectIntegration,
  type ProjectIntegrationIntegrationType,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";
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
} from "@/components/ui/AlertDialog";
import { useToast } from "@/hooks/use-toast";
import {
  INTEGRATION_BADGE_STYLES,
  INTEGRATION_BADGE_LABELS,
  WEBHOOK_URL_DISPLAY_MAX_LENGTH,
  WEBHOOK_URL_TRUNCATE_LENGTH,
  INTEGRATION_UPDATE_FAILED_TOAST,
  INTEGRATION_DELETED_TOAST,
  INTEGRATION_DELETE_FAILED_TOAST,
  INTEGRATION_TEST_SUCCESS_TOAST,
  INTEGRATION_TEST_FAILED_TOAST_TITLE,
  INTEGRATION_TEST_FAILED_DEFAULT_DESCRIPTION,
  INTEGRATION_TEST_REQUEST_FAILED_TOAST,
  INTEGRATION_TOGGLE_ENABLED_ARIA_LABEL,
  INTEGRATION_SEND_TEST_TITLE,
  INTEGRATION_TEST_BUTTON_TEXT,
  INTEGRATION_DELETE_TITLE,
  INTEGRATION_DELETE_CONFIRM_TITLE,
  INTEGRATION_DELETE_CONFIRM_DESCRIPTION_PREFIX,
  INTEGRATION_DELETE_CONFIRM_DESCRIPTION_SUFFIX,
  INTEGRATION_DELETE_CANCEL_TEXT,
  INTEGRATION_DELETE_CONFIRM_BUTTON_TEXT,
  INTEGRATION_ADDED_DATE_PREFIX,
} from "@/constants/integrations";

function integrationBadge(type: ProjectIntegrationIntegrationType) {
  return (
    <Badge variant="outline" className={INTEGRATION_BADGE_STYLES[type]}>
      {INTEGRATION_BADGE_LABELS[type]}
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
      onError: () => toast({ title: INTEGRATION_UPDATE_FAILED_TOAST, variant: "destructive" }),
    },
  });

  const { mutate: deleteIntegration, isPending: deleting } = useDeleteProjectIntegration({
    mutation: {
      onSuccess: () => {
        toast({ title: INTEGRATION_DELETED_TOAST });
        onDeleted();
      },
      onError: () => toast({ title: INTEGRATION_DELETE_FAILED_TOAST, variant: "destructive" }),
    },
  });

  const { mutate: testIntegration } = useTestProjectIntegration({
    mutation: {
      onMutate: () => setTestPending(true),
      onSuccess: (data) => {
        setTestPending(false);
        if (data.success) {
          toast({ title: INTEGRATION_TEST_SUCCESS_TOAST });
        } else {
          toast({
            title: INTEGRATION_TEST_FAILED_TOAST_TITLE,
            description: data.error ?? INTEGRATION_TEST_FAILED_DEFAULT_DESCRIPTION,
            variant: "destructive",
          });
        }
      },
      onError: () => {
        setTestPending(false);
        toast({ title: INTEGRATION_TEST_REQUEST_FAILED_TOAST, variant: "destructive" });
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
    integration.webhookUrl.length > WEBHOOK_URL_DISPLAY_MAX_LENGTH
      ? integration.webhookUrl.slice(0, WEBHOOK_URL_TRUNCATE_LENGTH) + "…"
      : integration.webhookUrl;

  return (
    <div className="flex items-center justify-between px-4 py-3 rounded-md border border-border/50 bg-background/50 gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5">{integrationBadge(integration.integrationType)}</div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate text-foreground">{shortUrl}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {INTEGRATION_ADDED_DATE_PREFIX} {new Date(integration.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <Switch
          checked={integration.enabled}
          onCheckedChange={handleToggle}
          disabled={updatingEnabled}
          aria-label={INTEGRATION_TOGGLE_ENABLED_ARIA_LABEL}
        />

        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
          onClick={handleTest}
          disabled={testPending}
          title={INTEGRATION_SEND_TEST_TITLE}
        >
          {testPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FlaskConical className="h-3.5 w-3.5" />
          )}
          <span className="ml-1 text-xs">{INTEGRATION_TEST_BUTTON_TEXT}</span>
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              disabled={deleting}
              title={INTEGRATION_DELETE_TITLE}
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
              <AlertDialogTitle>{INTEGRATION_DELETE_CONFIRM_TITLE}</AlertDialogTitle>
              <AlertDialogDescription>
                {INTEGRATION_DELETE_CONFIRM_DESCRIPTION_PREFIX}{" "}
                {INTEGRATION_BADGE_LABELS[integration.integrationType]}{" "}
                {INTEGRATION_DELETE_CONFIRM_DESCRIPTION_SUFFIX}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{INTEGRATION_DELETE_CANCEL_TEXT}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {INTEGRATION_DELETE_CONFIRM_BUTTON_TEXT}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
