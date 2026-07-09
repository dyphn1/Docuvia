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
} from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/Dialog";
import { Link } from "wouter";
import { FolderGit2, Plus, Loader2, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { normalizeProjects } from "@/lib/projects";
import {
  TABLE_COLUMN_COUNT,
  PROJECT_STATUS_COLORS,
  PROJECT_DATE_FORMAT,
  GITHUB_URL_PREFIX,
  PROJECTS_PAGE_TITLE,
  PROJECTS_PAGE_SUBTITLE,
  ADD_PROJECT_BUTTON_LABEL,
  PROJECTS_TABLE_HEADERS,
  PROJECTS_LOADING_MESSAGE,
  PROJECTS_EMPTY_TITLE,
  ADD_FIRST_PROJECT_BUTTON_LABEL,
  ADD_PROJECT_DIALOG_TITLE,
  PROJECT_NAME_LABEL,
  PROJECT_NAME_PLACEHOLDER,
  REPO_URL_LABEL,
  REPO_URL_PLACEHOLDER,
  REPO_URL_HELPER_TEXT,
  CREATE_PROJECT_CANCEL_LABEL,
  CREATING_PROJECT_LABEL,
  CREATE_PROJECT_BUTTON_LABEL,
  PROJECT_CREATE_ERROR_MESSAGE,
} from "@/constants/projects";

export default function Projects() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: projectsData, isLoading } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = normalizeProjects(projectsData);

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
      setError(e instanceof Error ? e.message : PROJECT_CREATE_ERROR_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{PROJECTS_PAGE_TITLE}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{PROJECTS_PAGE_SUBTITLE}</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> {ADD_PROJECT_BUTTON_LABEL}
        </Button>
      </div>

      <div className="border border-border/50 rounded-lg overflow-hidden bg-card/50">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border/50">
              <TableHead>{PROJECTS_TABLE_HEADERS[0]}</TableHead>
              <TableHead>{PROJECTS_TABLE_HEADERS[1]}</TableHead>
              <TableHead>{PROJECTS_TABLE_HEADERS[2]}</TableHead>
              <TableHead className="text-right">{PROJECTS_TABLE_HEADERS[3]}</TableHead>
              <TableHead className="text-right">{PROJECTS_TABLE_HEADERS[4]}</TableHead>
              <TableHead className="text-right">{PROJECTS_TABLE_HEADERS[5]}</TableHead>
              <TableHead className="text-right">{PROJECTS_TABLE_HEADERS[6]}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
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
                    {project.repoUrl.replace(GITHUB_URL_PREFIX, "")}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`font-mono text-[10px] uppercase ${PROJECT_STATUS_COLORS[project.status] ?? ""}`}
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
                  {format(new Date(project.createdAt), PROJECT_DATE_FORMAT)}
                </TableCell>
              </TableRow>
            ))}
            {isLoading && (
              <TableRow>
                <TableCell
                  colSpan={TABLE_COLUMN_COUNT}
                  className="h-24 text-center text-muted-foreground"
                >
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  {PROJECTS_LOADING_MESSAGE}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && projects.length === 0 && (
              <TableRow>
                <TableCell colSpan={TABLE_COLUMN_COUNT} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <FolderGit2 className="h-8 w-8 opacity-30" />
                    <div className="text-sm">{PROJECTS_EMPTY_TITLE}</div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setOpen(true)}
                      className="gap-1.5 mt-1"
                    >
                      <Plus className="h-3.5 w-3.5" /> {ADD_FIRST_PROJECT_BUTTON_LABEL}
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
              {ADD_PROJECT_DIALOG_TITLE}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{PROJECT_NAME_LABEL}</Label>
              <Input
                placeholder={PROJECT_NAME_PLACEHOLDER}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{REPO_URL_LABEL}</Label>
              <Input
                placeholder={REPO_URL_PLACEHOLDER}
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="h-9 font-mono text-sm"
              />
              <p className="text-[10px] text-muted-foreground">{REPO_URL_HELPER_TEXT}</p>
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
              {CREATE_PROJECT_CANCEL_LABEL}
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!name.trim() || !repoUrl.trim() || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                  {CREATING_PROJECT_LABEL}
                </>
              ) : (
                CREATE_PROJECT_BUTTON_LABEL
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
