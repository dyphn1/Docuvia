import { useState } from "react";
import { useListMiscDocuments, getListMiscDocumentsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Inbox, Loader2, AlertCircle, File, Link2 } from "lucide-react";
import { format } from "date-fns";
import { AffiliateDialog } from "./AffiliateDialog";

const docTypeColors: Record<string, string> = {
  markdown: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  txt: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
  pdf: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  docx: "bg-blue-600/10 text-blue-700 dark:text-blue-300 border-blue-600/20",
  pptx: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  build_artifact: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
};

interface MiscDocument {
  id: number;
  filename: string;
  docType: string;
  createdAt: string;
  content: string;
}

interface MiscPoolTabProps {
  projects: { id: number; name: string }[];
}

export function MiscPoolTab({ projects }: MiscPoolTabProps) {
  const [affiliateOpen, setAffiliateOpen] = useState(false);
  const [affiliatingDocId, setAffiliatingDocId] = useState<number | null>(null);
  const [affiliateProjectId, setAffiliateProjectId] = useState<string>("");

  const {
    data: miscDocsData,
    isLoading: miscLoading,
    isError: miscError,
  } = useListMiscDocuments({
    query: { queryKey: getListMiscDocumentsQueryKey() },
  });

  const miscDocs = miscDocsData as MiscDocument[] | undefined;

  const openAffiliateDialog = (docId: number) => {
    setAffiliatingDocId(docId);
    setAffiliateProjectId("");
    setAffiliateOpen(true);
  };

  const handleAffiliateSuccess = () => {
    setAffiliateOpen(false);
    setAffiliatingDocId(null);
    setAffiliateProjectId("");
  };

  return (
    <>
      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Inbox className="h-4 w-4 text-primary" />
            Unaffiliated Documents
            {miscDocs && miscDocs.length > 0 && (
              <Badge variant="secondary" className="ml-auto text-xs">
                {miscDocs.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {miscLoading ? (
            <div className="text-center py-10 text-muted-foreground text-sm flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : miscError ? (
            <div className="text-center py-10 text-destructive text-sm flex items-center justify-center gap-2">
              <AlertCircle className="h-4 w-4" /> Failed to load misc pool
            </div>
          ) : !miscDocs || miscDocs.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <Inbox className="h-10 w-10 mx-auto mb-3 opacity-20" />
              No unaffiliated documents
            </div>
          ) : (
            <div className="space-y-2">
              {miscDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="p-3 border border-border/50 rounded-md bg-background hover:border-primary/30 transition-colors flex items-center gap-3"
                >
                  <File className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-medium truncate">{doc.filename}</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] shrink-0 ${docTypeColors[doc.docType] ?? ""}`}
                      >
                        {doc.docType}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {format(new Date(doc.createdAt), "MMM d, yyyy HH:mm")}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-7 text-xs gap-1.5"
                    onClick={() => openAffiliateDialog(doc.id)}
                  >
                    <Link2 className="h-3 w-3" />
                    Associate with Project
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AffiliateDialog
        open={affiliateOpen}
        onOpenChange={setAffiliateOpen}
        projects={projects}
        affiliatingDocId={affiliatingDocId}
        affiliateProjectId={affiliateProjectId}
        setAffiliateProjectId={setAffiliateProjectId}
        onSuccess={handleAffiliateSuccess}
      />
    </>
  );
}
