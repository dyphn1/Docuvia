import { useQueryClient } from "@tanstack/react-query";
import { useAffiliateDocument, getListMiscDocumentsQueryKey } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Loader2, AlertCircle, Link2 } from "lucide-react";

interface AffiliateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: { id: number; name: string }[];
  affiliatingDocId: number | null;
  affiliateProjectId: string;
  setAffiliateProjectId: (id: string) => void;
  onSuccess: () => void;
}

export function AffiliateDialog({
  open,
  onOpenChange,
  projects,
  affiliatingDocId,
  affiliateProjectId,
  setAffiliateProjectId,
  onSuccess,
}: AffiliateDialogProps) {
  const queryClient = useQueryClient();
  const affiliateMutation = useAffiliateDocument();

  const handleAffiliate = () => {
    if (!affiliatingDocId || !affiliateProjectId) return;
    affiliateMutation.mutate(
      { id: affiliatingDocId, data: { projectId: Number(affiliateProjectId) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMiscDocumentsQueryKey() });
          onSuccess();
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Associate with Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Project</Label>
            <Select value={affiliateProjectId} onValueChange={setAffiliateProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select project..." />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {affiliateMutation.isError && (
            <div className="p-2.5 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {affiliateMutation.error instanceof Error
                ? affiliateMutation.error.message
                : "Failed to affiliate document"}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={affiliateMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleAffiliate}
            disabled={!affiliateProjectId || affiliateMutation.isPending}
          >
            {affiliateMutation.isPending ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                Associating...
              </>
            ) : (
              <>
                <Link2 className="h-3 w-3 mr-1.5" />
                Confirm
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
