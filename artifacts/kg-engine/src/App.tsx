import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/Toaster";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { Layout } from "@/components/Layout";

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
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/projects" component={Projects} />
        <Route path="/projects/:id" component={ProjectDetail} />
        <Route path="/l1-tags" component={L1Tags} />
        <Route path="/review" component={Review} />
        <Route path="/query" component={Query} />
        <Route path="/topology" component={Topology} />
        <Route path="/pipeline" component={Pipeline} />
        <Route path="/documents" component={Documents} />
        <Route path="/mcp" component={McpPage} />
        <Route path="/templates" component={Templates} />
        <Route path="/subscriptions" component={Subscriptions} />
        <Route path="/pull-requests" component={PullRequests} />
        <Route path="/integrations" component={Integrations} />
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
