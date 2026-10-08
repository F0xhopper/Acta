import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import './index.css';
import { ApiError } from './api';
import { AgentGuardProvider } from './components/agent-guard';
import { Layout } from './components/shell/layout';
import { ToastProvider } from './components/ui/toast';
import { ActivityPage } from './routes/activity';
import { BusinessPage } from './routes/business';
import { BuildTab } from './routes/business/build';
import { DeliverTab } from './routes/business/deliver';
import { OverviewTab } from './routes/business/overview';
import { ReviewTab } from './routes/business/review';
import { InboxPage } from './routes/inbox';
import { LeadsPage } from './routes/leads';
import { NotFound } from './routes/not-found';
import { PipelinePage } from './routes/pipeline';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && (e.unreachable || e.status === 404)) && n < 2,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
      staleTime: 1_000,
    },
  },
});

const router = createBrowserRouter([
  {
    // Providers sit inside the router so toast links and guarded actions can navigate.
    element: <ToastProvider><AgentGuardProvider><Layout /></AgentGuardProvider></ToastProvider>,
    children: [
      { index: true, element: <InboxPage /> },
      { path: 'pipeline', element: <PipelinePage /> },
      { path: 'leads', element: <LeadsPage /> },
      { path: 'activity', element: <ActivityPage /> },
      { path: 'activity/:jobId', element: <ActivityPage /> },
      {
        path: 'b/:slug',
        element: <BusinessPage />,
        children: [
          { path: 'overview', element: <OverviewTab /> },
          { path: 'build', element: <BuildTab /> },
          { path: 'review', element: <ReviewTab /> },
          { path: 'send', element: <DeliverTab /> },
          // Older addresses, kept so links and bookmarks still land in the right place.
          { path: 'progress', element: <Navigate to="../build" replace /> },
          { path: 'photos', element: <Navigate to="../build?view=photos" replace /> },
          { path: 'concepts', element: <Navigate to="../build?view=concepts" replace /> },
          { path: 'compare', element: <Navigate to="../review?mode=compare" replace /> },
          { path: 'deliver', element: <Navigate to="../send" replace /> },
          { path: '*', element: <Navigate to="../overview" replace /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
