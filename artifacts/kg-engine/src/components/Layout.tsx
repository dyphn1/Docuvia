import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  FolderGit2,
  Tags,
  CheckCircle,
  Search,
  GitBranch,
  Cpu,
  FileText,
  SlidersHorizontal,
  ChevronRight,
  Users,
  GitPullRequest,
  Webhook,
  Network,
} from "lucide-react";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { NotificationBell } from "@/components/NotificationBell";
import { useCurrentProject } from "@/hooks/use-current-project";
import { normalizeProjects } from "@/lib/projects";
import {
  LAYOUT_BRAND_NAME,
  LAYOUT_TAGLINE,
  LAYOUT_VERSION_LABEL,
  LAYOUT_FOOTER_TEXT,
  LAYOUT_PROJECT_PLACEHOLDER,
} from "@/constants/app";

interface LayoutProps {
  children: React.ReactNode;
}

const NAV_SECTIONS = [
  {
    label: "Core",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/projects", label: "Projects", icon: FolderGit2 },
    ],
  },
  {
    label: "Knowledge Graph",
    items: [
      { href: "/l1-tags", label: "L1 Tag Pool", icon: Tags },
      { href: "/review", label: "Review Queue", icon: CheckCircle },
      { href: "/query", label: "Query", icon: Search },
      { href: "/topology", label: "Topology", icon: Network },
    ],
  },
  {
    label: "Pipeline",
    items: [
      { href: "/pipeline", label: "Ingest & Generate", icon: GitBranch },
      { href: "/documents", label: "Documents", icon: FileText },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/mcp", label: "MCP Endpoints", icon: Cpu },
      { href: "/templates", label: "Prompt Templates", icon: SlidersHorizontal },
      { href: "/subscriptions", label: "Subscriptions", icon: Users },
      { href: "/pull-requests", label: "Pull Requests", icon: GitPullRequest },
      { href: "/integrations", label: "Integrations", icon: Webhook },
    ],
  },
];

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { data: projectsData } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = normalizeProjects(projectsData);
  const { projectId, setProjectId } = useCurrentProject();

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="w-60 flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="h-14 flex items-center px-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <GitBranch className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <span className="font-bold tracking-tight text-foreground">{LAYOUT_BRAND_NAME}</span>
              <div className="text-[10px] text-muted-foreground leading-none">{LAYOUT_TAGLINE}</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="px-3 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {section.label}
                </span>
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active =
                    location === item.href || (item.href !== "/" && location.startsWith(item.href));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors group ${
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      }`}
                    >
                      <item.icon
                        className={`h-3.5 w-3.5 ${active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}
                      />
                      <span>{item.label}</span>
                      {active && <ChevronRight className="h-3 w-3 ml-auto text-primary/60" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-border">
          <div className="px-3 py-2 rounded-md bg-muted/40 text-xs text-muted-foreground">
            <div className="font-medium text-foreground mb-0.5">{LAYOUT_VERSION_LABEL}</div>
            <div>{LAYOUT_FOOTER_TEXT}</div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-12 border-b border-border flex items-center px-4 gap-3 flex-shrink-0 bg-card/50 justify-end">
          <Select
            value={projectId ? String(projectId) : ""}
            onValueChange={(v) => setProjectId(v ? parseInt(v, 10) : null)}
          >
            <SelectTrigger className="h-7 w-44 text-xs">
              <SelectValue placeholder={LAYOUT_PROJECT_PLACEHOLDER} />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={String(p.id)} className="text-xs">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <NotificationBell projectId={projectId ?? 0} />
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
