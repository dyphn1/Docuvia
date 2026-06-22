import { useState } from "react";
import {
  useListProjects,
  getListProjectsQueryKey,
  useListMiscDocuments,
  getListMiscDocumentsQueryKey,
  useAffiliateDocument,
} from "@workspace/api-client-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FileText,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  File,
  Link2,
  Inbox,
} from "lucide-react";
import { format } from "date-fns";
import { normalizeProjects } from "@/lib/projects";

interface ProjectDocument {
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

  // Upload tab state
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // Misc Pool state
  const {
    data: miscDocs,
    isLoading: miscLoading,
    isError: miscError,
  } = useListMiscDocuments({
    query: { queryKey: getListMiscDocumentsQueryKey() },
  });

  // Affiliate dialog state
  const [affiliateOpen, setAffiliateOpen] = useState(false);
  const [affiliatingDocId, setAffiliatingDocId] = useState<number | null>(null);
  const [affiliateProjectId, setAffiliateProjectId] = useState<string>("");
  const affiliateMutation = useAffiliateDocument();

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
    if (!filename.trim() || !content.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const url = selectedProject
        ? `/api/projects/${selectedProject}/ingest/document`
        : `/api/documents/ingest`;
      const res = await fetch(url, {
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
      if (selectedProject) {
        await loadDocuments(selectedProject);
      } else {
        queryClient.invalidateQueries({ queryKey: getListMiscDocumentsQueryKey() });
      }
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

  const openAffiliateDialog = (docId: number) => {
    setAffiliatingDocId(docId);
    setAffiliateProjectId("");
    setAffiliateOpen(true);
  };

  const handleAffiliate = () => {
    if (!affiliatingDocId || !affiliateProjectId) return;
    affiliateMutation.mutate(
      { id: affiliatingDocId, data: { projectId: Number(affiliateProjectId) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMiscDocumentsQueryKey() });
          setAffiliateOpen(false);
          setAffiliatingDocId(null);
          setAffiliateProjectId("");
        },
      }
    );
  };

  return (
    <div className="p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Ingest documents for knowledge extraction, or affiliate unaffiliated documents from the
          Misc Pool
        </p>
      </div>

      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload" className="gap-2">
            <Upload className="h-3.5 w-3.5" />
            Upload
          </TabsTrigger>
          <TabsTrigger value="misc" className="gap-2">
            <Inbox className="h-3.5 w-3.5" />
            Misc Pool
            {miscDocs && miscDocs.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                {miscDocs.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Upload Tab ── */}
        <TabsContent value="upload" className="mt-4">
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
                  <Select value={selectedProject} onValueChange={handleProjectChange}>
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
                      <p className="text-xs text-muted-foreground">
                        Click to upload or drag & drop
                      </p>
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
        </TabsContent>

        {/* ── Misc Pool Tab ── */}
        <TabsContent value="misc" className="mt-4">
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
                          <span className="text-xs font-mono font-medium truncate">
                            {doc.filename}
                          </span>
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
        </TabsContent>
      </Tabs>

      {/* Affiliate Dialog */}
      <Dialog open={affiliateOpen} onOpenChange={setAffiliateOpen}>
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
              onClick={() => setAffiliateOpen(false)}
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
    </div>
  );
}
