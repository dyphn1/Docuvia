import { useState } from "react";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FileText, Upload, Loader2, CheckCircle2, AlertCircle, File, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { normalizeProjects } from "@/lib/projects";

interface Document {
  id: number;
  projectId: number;
  filename: string;
  docType: string;
  content: string;
  createdAt: string;
}

const docTypeColors: Record<string, string> = {
  markdown: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  txt: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
  pdf: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  docx: "bg-blue-600/10 text-blue-700 dark:text-blue-300 border-blue-600/20",
  pptx: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  build_artifact: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
};

export default function Documents() {
  const queryClient = useQueryClient();
  const { data: projectsData } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = normalizeProjects(projectsData);

  const [selectedProject, setSelectedProject] = useState<string>("");
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  const loadDocuments = async (projectId: string) => {
    setLoadingDocs(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/documents`);
      const data = await res.json();
      setDocuments(data);
    } catch {
      setDocuments([]);
    } finally {
      setLoadingDocs(false);
    }
  };

  const handleProjectChange = (id: string) => {
    setSelectedProject(id);
    loadDocuments(id);
  };

  const handleIngest = async () => {
    if (!selectedProject || !filename.trim() || !content.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/projects/${selectedProject}/ingest/document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: filename.trim(), content: content.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to ingest document");
      }
      setSuccess(true);
      setFilename("");
      setContent("");
      await loadDocuments(selectedProject);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
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
    <div className="p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Document Ingestion</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Phase 2 — Parse and store Markdown, TXT, and build artifact documents for knowledge
          extraction
        </p>
      </div>

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
              <Label className="text-xs">Project</Label>
              <Select value={selectedProject} onValueChange={handleProjectChange}>
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
              disabled={!selectedProject || !filename || !content || loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                  Ingesting...
                </>
              ) : (
                <>
                  <Upload className="h-3 w-3 mr-2" />
                  Ingest Document
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
                Select a project to view documents
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
                        <span className="text-xs font-mono font-medium truncate">
                          {doc.filename}
                        </span>
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
    </div>
  );
}
