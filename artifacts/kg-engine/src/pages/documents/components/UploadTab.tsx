import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useIngestDocument,
  useUploadDocument,
  useListDocuments,
  getListDocumentsQueryKey,
  getListMiscDocumentsQueryKey,
} from "@workspace/api-client-react";
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

const docTypeColors: Record<string, string> = {
  markdown: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  txt: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
  pdf: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  docx: "bg-blue-600/10 text-blue-700 dark:text-blue-300 border-blue-600/20",
  pptx: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  build_artifact: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
};

interface ProjectDocument {
  id: number;
  projectId: number;
  filename: string;
  docType: string;
  content: string;
  createdAt: string;
}

interface UploadTabProps {
  projects: { id: number; name: string }[];
}

export function UploadTab({ projects }: UploadTabProps) {
  const queryClient = useQueryClient();
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingestMutation = useIngestDocument();
  const uploadMutation = useUploadDocument();

  const { data: documentsData, isLoading: loadingDocs } = useListDocuments(
    Number(selectedProject),
    {
      query: {
        enabled: !!selectedProject,
        queryKey: getListDocumentsQueryKey(Number(selectedProject)),
      },
    }
  );

  const documents = (documentsData as ProjectDocument[]) || [];

  const handleIngest = async () => {
    if (!filename.trim() || !content.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(false);

    const onFinish = () => {
      setSuccess(true);
      setFilename("");
      setContent("");
      setLoading(false);
    };

    const onError = (e: Error) => {
      setError(e.message || "Unknown error");
      setLoading(false);
    };

    if (selectedProject) {
      ingestMutation.mutate(
        {
          id: Number(selectedProject),
          data: { filename: filename.trim(), content: content.trim() },
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: getListDocumentsQueryKey(Number(selectedProject)),
            });
            onFinish();
          },
          onError,
        }
      );
    } else {
      const file = new window.File([content.trim()], filename.trim(), { type: "text/plain" });
      uploadMutation.mutate(
        { data: { file } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListMiscDocumentsQueryKey() });
            onFinish();
          },
          onError,
        }
      );
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setContent((ev.target?.result as string) ?? "");
    reader.readAsText(file);
  };

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
                    <span>{format(new Date(doc.createdAt), "MMM d, yyyy HH:mm")}</span>
                    <span>{doc.content.length.toLocaleString()} chars</span>
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
