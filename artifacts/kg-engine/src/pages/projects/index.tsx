import { useState } from "react";
import {
  useListProjects,
  getListProjectsQueryKey,
  useCreateProject,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Link } from "wouter";
import { FolderGit2, Plus, Loader2, ExternalLink } from "lucide-react";
import { format } from "date-fns";

const statusColors: Record<string, string> = {
  active: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  indexing: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
  pending: "bg-muted text-muted-foreground border-border",
  error: "bg-destructive/10 border-destructive/20 text-destructive",
};

export default function Projects() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: projects, isLoading } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });

  const createProject = useCreateProject();

  const handleCreate = async () => {
    if (!name.trim() || !repoUrl.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createProject.mutateAsync({ data: { name: name.trim(), repoUrl: repoUrl.trim() } });
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      setOpen(false);
      setName("");
      setRepoUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage indexed repositories</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add Project
        </Button>
      </div>

      <div className="border border-border/50 rounded-lg overflow-hidden bg-card/50">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border/50">
              <TableHead>Name</TableHead>
              <TableHead>Repository</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">L2</TableHead>
              <TableHead className="text-right">L3</TableHead>
              <TableHead className="text-right">Commits</TableHead>
              <TableHead className="text-right">Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects?.map((project) => (
              <TableRow
                key={project.id}
                className="border-border/50 hover:bg-accent/40 group cursor-pointer"
              >
                <TableCell>
                  <Link
                    href={`/projects/${project.id}`}
                    className="flex items-center gap-2 font-medium group-hover:text-primary transition-colors"
                  >
                    <FolderGit2 className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                    {project.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <a
                    href={project.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {project.repoUrl.replace("https://github.com/", "")}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`font-mono text-[10px] uppercase ${statusColors[project.status] ?? ""}`}
                  >
                    {project.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{project.l2Count}</TableCell>
                <TableCell className="text-right font-mono text-sm">{project.l3Count}</TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {project.commitCount}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {format(new Date(project.createdAt), "MMM d, yyyy")}
                </TableCell>
              </TableRow>
            ))}
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Loading projects...
                </TableCell>
              </TableRow>
            )}
            {!isLoading && (!projects || projects.length === 0) && (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <FolderGit2 className="h-8 w-8 opacity-30" />
                    <div className="text-sm">No projects yet</div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setOpen(true)}
                      className="gap-1.5 mt-1"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add your first project
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderGit2 className="h-4 w-4 text-primary" />
              Add New Project
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Project Name</Label>
              <Input
                placeholder="My Repository"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Repository URL</Label>
              <Input
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="h-9 font-mono text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                GitHub URLs are supported for commit ingestion
              </p>
            </div>
            {error && (
              <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-2.5">
                {error}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!name.trim() || !repoUrl.trim() || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Project"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
