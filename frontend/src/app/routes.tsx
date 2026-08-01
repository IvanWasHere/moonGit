import { createHashRouter, Navigate } from 'react-router-dom';
import { DashboardPage } from '@/pages/DashboardPage';
import { MainPage } from '@/pages/MainPage';
import { ReviewPage } from '@/pages/ReviewPage';

/**
 * Hash router, not browser router: Wails serves the frontend from an embedded
 * FS with no server-side routing, so path-based URLs 404 on reload.
 *
 * Two top-level destinations (PLAN.md §1.4): the dashboard when no repository
 * is open, and the workspace once one is.
 */
export const router = createHashRouter([
  { path: '/', element: <DashboardPage /> },
  { path: '/repo/:repoId/main', element: <MainPage /> },
  { path: '/repo/:repoId/review', element: <ReviewPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);
