import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import WorkspaceShell from '@/components/workspace-shell';
import { Loading } from '@/components/page-state';
const Login = lazy(() => import('@/features/auth/login-page'));
const Overview = lazy(() => import('@/features/overview/overview-page'));
const Intelligence = lazy(
  () => import('@/features/intelligence/intelligence-page'),
);
const Research = lazy(() => import('@/features/research/research-page'));
const Briefs = lazy(() => import('@/features/intelligence/briefs-page'));
const Schedules = lazy(() => import('@/features/research/schedules-page'));
const Candidates = lazy(() => import('@/features/candidates/candidates-page'));
const Outreach = lazy(() => import('@/features/outreach/outreach-page'));
const Tasks = lazy(() => import('@/features/tasks/tasks-page'));
const Members = lazy(() => import('@/features/members/members-page'));
const Products = lazy(() => import('@/features/products/products-page'));
const Competitors = lazy(
  () => import('@/features/competitors/competitor-research-page'),
);
const Dramas = lazy(() => import('@/features/dramas/dramas-page'));
const Settings = lazy(() => import('@/features/settings/settings-page'));
const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    element: <WorkspaceShell />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'intelligence', element: <Intelligence /> },
      { path: 'briefs', element: <Briefs /> },
      { path: 'research', element: <Research /> },
      { path: 'schedules', element: <Schedules /> },
      { path: 'candidates', element: <Candidates /> },
      { path: 'competitors', element: <Competitors /> },
      { path: 'dramas', element: <Dramas /> },
      { path: 'tasks', element: <Tasks /> },
      { path: 'outreach', element: <Outreach /> },
      { path: 'products', element: <Products /> },
      { path: 'members', element: <Members /> },
      { path: 'settings', element: <Settings /> },
      {
        path: '*',
        element: (
          <div className="py-20 text-center">
            <h1 className="text-xl font-semibold">页面不存在</h1>
            <a href="/" className="mt-4 inline-block text-sm underline">
              返回工作台
            </a>
          </div>
        ),
      },
    ],
  },
]);
export function AppRouter() {
  return (
    <Suspense fallback={<Loading />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
