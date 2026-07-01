// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/App";
import Dashboard from "../src/pages/Dashboard";
import Projects from "../src/pages/projects/Index";
import ProjectDetail from "../src/pages/projects/ProjectDetail";
import L1Tags from "../src/pages/L1Tags";
import Review from "../src/pages/Review";
import Query from "../src/pages/Query";
import Pipeline from "../src/pages/Pipeline";
import Documents from "../src/pages/Documents";
import McpPage from "../src/pages/Mcp";
import Templates from "../src/pages/Templates";
import Subscriptions from "../src/pages/Subscriptions";
import PullRequests from "../src/pages/PullRequests";
import Integrations from "../src/pages/Integrations";
import NotFound from "../src/pages/NotFound";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const Wrapper = ({ children }: any) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe("App Coverage", () => {
  it("renders App", () => {
    const { container } = render(<App />);
    expect(container.querySelector("main")).toBeInTheDocument();
  });

  const pages = [
    { name: "Dashboard", Component: Dashboard },
    { name: "Projects", Component: Projects },
    { name: "ProjectDetail", Component: ProjectDetail },
    { name: "L1Tags", Component: L1Tags },
    { name: "Review", Component: Review },
    { name: "Query", Component: Query },
    { name: "Pipeline", Component: Pipeline },
    { name: "Documents", Component: Documents },
    { name: "McpPage", Component: McpPage },
    { name: "Templates", Component: Templates },
    { name: "Subscriptions", Component: Subscriptions },
    { name: "PullRequests", Component: PullRequests },
    { name: "Integrations", Component: Integrations },
    { name: "NotFound", Component: NotFound },
  ];

  pages.forEach(({ name, Component }) => {
    it(`renders ${name}`, () => {
      const { container } = render(<Component params={{ id: "1" }} />, { wrapper: Wrapper });
      expect(container).not.toBeEmptyDOMElement();
    });
  });
});
