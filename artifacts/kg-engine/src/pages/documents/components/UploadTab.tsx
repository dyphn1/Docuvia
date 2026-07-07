import { useListDocuments, getListDocumentsQueryKey, Document } from "@workspace/api-client-react";
import { useUploadDocumentForm } from "../hooks/useUploadDocumentForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Upload, Loader2, CheckCircle2, AlertCircle, File, Inbox, FileText } from "lucide-react";
import { format } from "date-fns";

import { docTypeColors } from "../../../lib/constants";

interface UploadTabProps {
  projects: { id: number; name: string }[];
}

export function UploadTab({ projects }: UploadTabProps) {
  const {
    selectedProject,
    setSelectedProject,
    filename,
    setFilename,
    content,
    setContent,
    loading,
    success,
    error,
    handleIngest,
    handleFileUpload,
  } = useUploadDocumentForm();

  const { data: documentsData, isLoading: loadingDocs } = useListDocuments(
    Number(selectedProject),
    {
      query: {
        enabled: !!selectedProject,
        queryKey: getListDocumentsQueryKey(Number(selectedProject)),
      },
    }
  );

  const documents = (documentsData as Document[]) || [];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            Upload Document
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">
              Project <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Select value={selectedProject} onValueChange={setSelectedProject}>
              <SelectTrigger>
                <SelectValue placeholder="No project — goes to Misc Pool" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!selectedProject && (
              <p className="text-[10px] text-muted-foreground">
                Without a project, the document will be saved to the Misc Pool for later
                affiliation.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Upload File (MD, TXT)</Label>
            <div className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/40 transition-colors">
              <input
                type="file"
                accept=".md,.txt,.markdown,.log,.map"
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                <File className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">Click to upload or drag & drop</p>
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                  .md, .txt, .log, .map files
                </p>
              </label>
            </div>
          </div>

          <div className="relative flex items-center gap-2 text-xs text-muted-foreground">
            <div className="flex-1 border-t border-border" />
            <span>or paste manually</span>
            <div className="flex-1 border-t border-border" />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Filename</Label>
            <Input
              placeholder="README.md"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="text-xs font-mono h-8"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Content</Label>
            <Textarea
              placeholder="Paste document content here..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="text-xs font-mono min-h-32 resize-none"
            />
          </div>

          <Button
            className="w-full"
            size="sm"
            onClick={handleIngest}
            disabled={!filename || !content || loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                Ingesting...
              </>
            ) : selectedProject ? (
              <>
                <Upload className="h-3 w-3 mr-2" />
                Ingest Document
              </>
            ) : (
              <>
                <Inbox className="h-3 w-3 mr-2" />
                Save to Misc Pool
              </>
            )}
          </Button>

          {success && (
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-md text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5" /> Document ingested successfully
            </div>
          )}
          {error && (
            <div className="p-2.5 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Project Documents
            {documents.length > 0 && (
              <Badge variant="secondary" className="ml-auto text-xs">
                {documents.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedProject ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Select a project to view its documents
            </div>
          ) : loadingDocs ? (
            <div className="text-center py-8 text-muted-foreground text-sm flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-20" />
              No documents ingested yet
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="p-3 border border-border/50 rounded-md bg-background hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-xs font-mono font-medium truncate">{doc.filename}</span>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] shrink-0 ${docTypeColors[doc.docType] ?? ""}`}
                    >
                      {doc.docType}
                    </Badge>
                  </div>
                  <div className="mt-1.5 text-[10px] text-muted-foreground flex gap-3">
                    <span>{format(new Date(doc.createdAt as string), "MMM d, yyyy HH:mm")}</span>
                    <span>{doc.content?.length.toLocaleString() || 0} chars</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
