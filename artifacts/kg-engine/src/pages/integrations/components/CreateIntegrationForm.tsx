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

interface CreateIntegrationFormProps {
  projectId: number;
  onCreated: () => void;
}

export function CreateIntegrationForm({ projectId, onCreated }: CreateIntegrationFormProps) {
  const { toast } = useToast();
  const [newType, setNewType] = useState<"slack" | "teams">("slack");
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [newEnabled, setNewEnabled] = useState(true);
  const [urlError, setUrlError] = useState<string | null>(null);

  const { mutate: createIntegration, isPending: creating } = useCreateProjectIntegration({
    mutation: {
      onSuccess: () => {
        setNewWebhookUrl("");
        setNewEnabled(true);
        toast({ title: "Integration added successfully" });
        onCreated();
      },
      onError: () => {
        toast({ title: "Failed to add integration", variant: "destructive" });
      },
    },
  });

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
        integrationType:
          newType as (typeof ProjectIntegrationInputIntegrationType)[keyof typeof ProjectIntegrationInputIntegrationType],
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
          Add Integration
        </CardTitle>
        <CardDescription className="text-xs">
          Configure a new Slack or Teams webhook for this project
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 max-w-lg">
          <div className="flex gap-3">
            <div className="space-y-1 w-36">
              <Label htmlFor="integration-type" className="text-xs">
                Type
              </Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as "slack" | "teams")}>
                <SelectTrigger id="integration-type" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="teams">Microsoft Teams</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 flex flex-col justify-end pb-1">
              <Label className="text-xs">Enabled</Label>
              <Switch
                checked={newEnabled}
                onCheckedChange={setNewEnabled}
                aria-label="Enable on creation"
              />
            </div>
          </div>

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
            Add Integration
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
