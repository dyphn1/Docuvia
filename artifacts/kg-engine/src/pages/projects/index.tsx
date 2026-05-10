import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { FolderGit2 } from "lucide-react";
import { format } from "date-fns";

export default function Projects() {
  const { data: projects, isLoading } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() }
  });

  return (
    <div className="p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage indexed repositories</p>
        </div>
      </div>

      <div className="border border-border/50 rounded-lg overflow-hidden bg-card/50 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border/50">
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">L2 Nodes</TableHead>
              <TableHead className="text-right">L3 Nodes</TableHead>
              <TableHead className="text-right">Commits</TableHead>
              <TableHead className="text-right">Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects?.map((project) => (
              <TableRow key={project.id} className="border-border/50 transition-colors hover:bg-accent/50 group cursor-pointer">
                <TableCell>
                  <Link href={`/projects/${project.id}`} className="flex items-center gap-2 font-medium group-hover:text-primary transition-colors">
                    <FolderGit2 className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    {project.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={project.status === 'active' ? 'default' : 'secondary'} className="font-mono text-[10px] uppercase">
                    {project.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{project.l2Count}</TableCell>
                <TableCell className="text-right font-mono text-sm">{project.l3Count}</TableCell>
                <TableCell className="text-right font-mono text-sm">{project.commitCount}</TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {format(new Date(project.createdAt), "MMM d, yyyy")}
                </TableCell>
              </TableRow>
            ))}
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  Loading projects...
                </TableCell>
              </TableRow>
            )}
            {!isLoading && projects?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No projects found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}