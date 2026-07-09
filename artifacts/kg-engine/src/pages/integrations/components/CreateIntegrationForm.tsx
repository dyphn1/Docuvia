import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import {
  useCreateProjectIntegration,
  ProjectIntegrationInputIntegrationType,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Switch } from "@/components/ui/Switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { useToast } from "@/hooks/use-toast";
import {
  WEBHOOK_URL_HTTPS_PREFIX,
  WEBHOOK_URL_REQUIRED_MESSAGE,
  WEBHOOK_URL_HTTPS_REQUIRED_MESSAGE,
  WEBHOOK_URL_INVALID_FORMAT_MESSAGE,
  INTEGRATION_ADDED_TOAST,
  INTEGRATION_ADD_FAILED_TOAST,
  ADD_INTEGRATION_TITLE,
  ADD_INTEGRATION_DESCRIPTION,
  INTEGRATION_TYPE_LABEL,
  INTEGRATION_ENABLED_LABEL,
  INTEGRATION_ENABLE_ON_CREATION_ARIA_LABEL,
  WEBHOOK_URL_LABEL,
  WEBHOOK_URL_PLACEHOLDER,
  ADD_INTEGRATION_BUTTON_TEXT,
  INTEGRATION_TYPE_OPTION_LABELS,
} from "@/constants/integrations";

interface CreateIntegrationFormProps {
  projectId: number;
  onCreated: () => void;
}

export function CreateIntegrationForm({ projectId, onCreated }: CreateIntegrationFormProps) {
  const { toast } = useToast();
  const [newType, setNewType] = useState<ProjectIntegrationInputIntegrationType>(
    ProjectIntegrationInputIntegrationType.slack
  );
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [newEnabled, setNewEnabled] = useState(true);
  const [urlError, setUrlError] = useState<string | null>(null);

  const { mutate: createIntegration, isPending: creating } = useCreateProjectIntegration({
    mutation: {
      onSuccess: () => {
        setNewWebhookUrl("");
        setNewEnabled(true);
        toast({ title: INTEGRATION_ADDED_TOAST });
        onCreated();
      },
      onError: () => {
        toast({ title: INTEGRATION_ADD_FAILED_TOAST, variant: "destructive" });
      },
    },
  });

  const validateUrl = (url: string): string | null => {
    if (!url) return WEBHOOK_URL_REQUIRED_MESSAGE;
    if (!url.startsWith(WEBHOOK_URL_HTTPS_PREFIX)) return WEBHOOK_URL_HTTPS_REQUIRED_MESSAGE;
    try {
      new URL(url);
    } catch {
      return WEBHOOK_URL_INVALID_FORMAT_MESSAGE;
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
        integrationType: newType,
        webhookUrl: newWebhookUrl,
        enabled: newEnabled,
      },
    });
  };

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Plus className="h-4 w-4" />
          {ADD_INTEGRATION_TITLE}
        </CardTitle>
        <CardDescription className="text-xs">{ADD_INTEGRATION_DESCRIPTION}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 max-w-lg">
          <div className="flex gap-3">
            <div className="space-y-1 w-36">
              <Label htmlFor="integration-type" className="text-xs">
                {INTEGRATION_TYPE_LABEL}
              </Label>
              <Select
                value={newType}
                onValueChange={(v) => setNewType(v as ProjectIntegrationInputIntegrationType)}
              >
                <SelectTrigger id="integration-type" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ProjectIntegrationInputIntegrationType.slack}>
                    {INTEGRATION_TYPE_OPTION_LABELS.slack}
                  </SelectItem>
                  <SelectItem value={ProjectIntegrationInputIntegrationType.teams}>
                    {INTEGRATION_TYPE_OPTION_LABELS.teams}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 flex flex-col justify-end pb-1">
              <Label className="text-xs">{INTEGRATION_ENABLED_LABEL}</Label>
              <Switch
                checked={newEnabled}
                onCheckedChange={setNewEnabled}
                aria-label={INTEGRATION_ENABLE_ON_CREATION_ARIA_LABEL}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="webhook-url" className="text-xs">
              {WEBHOOK_URL_LABEL}
            </Label>
            <Input
              id="webhook-url"
              placeholder={WEBHOOK_URL_PLACEHOLDER}
              value={newWebhookUrl}
              onChange={(e) => {
                setNewWebhookUrl(e.target.value);
                if (urlError) setUrlError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              className="text-xs h-8"
            />
            {urlError && <p className="text-xs text-destructive mt-0.5">{urlError}</p>}
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
            {ADD_INTEGRATION_BUTTON_TEXT}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
