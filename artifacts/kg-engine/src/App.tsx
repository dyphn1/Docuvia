import type { ComponentType } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/Toaster";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { Layout } from "@/components/Layout";
import { QUERY_CLIENT_DEFAULT_RETRY, QUERY_CLIENT_REFETCH_ON_WINDOW_FOCUS } from "@/constants/app";

import Dashboard from "@/pages/Dashboard";
import Projects from "@/pages/projects/Index";
import ProjectDetail from "@/pages/projects/ProjectDetail";
import L1Tags from "@/pages/L1Tags";
import Review from "@/pages/Review";
import Query from "@/pages/Query";
import Topology from "@/pages/Topology";
import Pipeline from "@/pages/Pipeline";
import Documents from "@/pages/Documents";
import McpPage from "@/pages/Mcp";
import Templates from "@/pages/Templates";
import Subscriptions from "@/pages/Subscriptions";
import PullRequests from "@/pages/PullRequests";
import Integrations from "@/pages/Integrations";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: QUERY_CLIENT_DEFAULT_RETRY,
      refetchOnWindowFocus: QUERY_CLIENT_REFETCH_ON_WINDOW_FOCUS,
    },
  },
});

const ROUTES: { path: string; component: ComponentType }[] = [
  { path: "/", component: Dashboard },
  { path: "/projects", component: Projects },
  { path: "/projects/:id", component: ProjectDetail },
  { path: "/l1-tags", component: L1Tags },
  { path: "/review", component: Review },
  { path: "/query", component: Query },
  { path: "/topology", component: Topology },
  { path: "/pipeline", component: Pipeline },
  { path: "/documents", component: Documents },
  { path: "/mcp", component: McpPage },
  { path: "/templates", component: Templates },
  { path: "/subscriptions", component: Subscriptions },
  { path: "/pull-requests", component: PullRequests },
  { path: "/integrations", component: Integrations },
];

function Router() {
  return (
    <Layout>
      <Switch>
        {ROUTES.map(({ path, component }) => (
          <Route key={path} path={path} component={component} />
        ))}
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
