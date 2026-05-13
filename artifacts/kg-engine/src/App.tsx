import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";

import Dashboard from "@/pages/dashboard";
import Projects from "@/pages/projects/index";
import ProjectDetail from "@/pages/projects/[id]";
import L1Tags from "@/pages/l1-tags";
import Review from "@/pages/review";
import Query from "@/pages/query";
import Pipeline from "@/pages/pipeline";
import Documents from "@/pages/documents";
import McpPage from "@/pages/mcp";
import Templates from "@/pages/templates";
import Subscriptions from "@/pages/subscriptions";
import PullRequests from "@/pages/pull-requests";
import Integrations from "@/pages/integrations";
import NotFound from "@/pages/not-found";

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
