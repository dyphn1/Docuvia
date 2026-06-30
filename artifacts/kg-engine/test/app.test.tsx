// @vitest-environment happy-dom
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/App';
import Dashboard from '../src/pages/dashboard';
import Projects from '../src/pages/projects/index';
import ProjectDetail from '../src/pages/projects/[id]';
import L1Tags from '../src/pages/l1-tags';
import Review from '../src/pages/review';
import Query from '../src/pages/query';
import Pipeline from '../src/pages/pipeline';
import Documents from '../src/pages/documents';
import McpPage from '../src/pages/mcp';
import Templates from '../src/pages/templates';
import Subscriptions from '../src/pages/subscriptions';
import PullRequests from '../src/pages/pull-requests';
import Integrations from '../src/pages/integrations';
import NotFound from '../src/pages/not-found';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } }
});

const Wrapper = ({ children }: any) => (
  <QueryClientProvider client={queryClient}>
    {children}
  </QueryClientProvider>
);

describe('App Coverage', () => {
  it('renders App', () => {
    const { container } = render(<App />);
    expect(container).toBeTruthy();
  });

  const pages = [
    { name: 'Dashboard', Component: Dashboard },
    { name: 'Projects', Component: Projects },
    { name: 'ProjectDetail', Component: ProjectDetail },
    { name: 'L1Tags', Component: L1Tags },
    { name: 'Review', Component: Review },
    { name: 'Query', Component: Query },
    { name: 'Pipeline', Component: Pipeline },
    { name: 'Documents', Component: Documents },
    { name: 'McpPage', Component: McpPage },
    { name: 'Templates', Component: Templates },
    { name: 'Subscriptions', Component: Subscriptions },
    { name: 'PullRequests', Component: PullRequests },
    { name: 'Integrations', Component: Integrations },
    { name: 'NotFound', Component: NotFound }
  ];

  pages.forEach(({ name, Component }) => {
    it(`renders ${name}`, () => {
      const { container } = render(<Component params={{ id: "1" }} />, { wrapper: Wrapper });
      expect(container).toBeTruthy();
    });
  });
});
