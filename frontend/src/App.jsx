import { lazy } from 'react';
import { Navigate, Routes, Route } from 'react-router-dom';
// PERF-1: pages are loaded on demand (code splitting); Login and Layout stay in the main bundle.
import { useAuth } from './hooks/useAuth.js';

import Layout from './components/layout/Layout.jsx';
import Login from './pages/Login.jsx';
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Agents = lazy(() => import('./pages/Agents.jsx'));
const Queues = lazy(() => import('./pages/Queues.jsx'));
const LiveCalls = lazy(() => import('./pages/LiveCalls.jsx'));
const QueueStats = lazy(() => import('./pages/QueueStats.jsx'));
const LiveAgents = lazy(() => import('./pages/LiveAgents.jsx'));
const LiveOperations = lazy(() => import('./pages/LiveOperations.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const AgentPerformanceDashboard = lazy(() => import('./pages/AgentPerformanceDashboard.jsx'));
const UserManagement = lazy(() => import('./pages/UserManagement.jsx'));
const BreakCodes = lazy(() => import('./pages/BreakCodes.jsx'));
const BreakHistoryReport = lazy(() => import('./pages/reports/BreakHistoryReport.jsx'));
const CallHistoryReport = lazy(() => import('./pages/reports/CallHistoryReport.jsx'));

function ProtectedRoute({ children }) {
  const { isAuth } = useAuth();
  return isAuth ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const { user, isAuth } = useAuth();
  if (!isAuth) return <Navigate to="/login" replace />;
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function ReportsRoute({ children }) {
  const { user, isAuth } = useAuth();
  if (!isAuth) return <Navigate to="/login" replace />;
  const canView =
    user?.role === 'admin' ||
    (Array.isArray(user?.permissions) && user.permissions.includes('view_reports'));
  if (!canView) return <Navigate to="/" replace />;
  return children;
}

function BreakCodesRoute({ children }) {
  const { user, isAuth } = useAuth();
  if (!isAuth) return <Navigate to="/login" replace />;
  const canManage =
    user?.role === 'admin' ||
    (Array.isArray(user?.permissions) && user.permissions.includes('manage_break_codes'));
  if (!canManage) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        {/* Primary supervisor real-time workspace. /live-calls and /live-agents
            are retained below as secondary detail views (deep links preserved). */}
        <Route path="live-operations" element={<LiveOperations />} />
        <Route path="live-calls" element={<LiveCalls />} />
        <Route path="live-agents" element={<LiveAgents />} />
        <Route path="agents" element={<Agents />} />
        <Route path="queues" element={<Queues />} />
        <Route path="queue-stats" element={<QueueStats />} />
        <Route
          path="reports"
          element={
            <ReportsRoute>
              <Reports />
            </ReportsRoute>
          }
        />
        <Route
          path="agent-performance"
          element={
            <ReportsRoute>
              <AgentPerformanceDashboard />
            </ReportsRoute>
          }
        />
        <Route
          path="reports/break-history"
          element={
            <ReportsRoute>
              <BreakHistoryReport />
            </ReportsRoute>
          }
        />
        <Route
          path="reports/call-history"
          element={
            <ReportsRoute>
              <CallHistoryReport />
            </ReportsRoute>
          }
        />
        <Route
          path="break-codes"
          element={
            <BreakCodesRoute>
              <BreakCodes />
            </BreakCodesRoute>
          }
        />
        <Route
          path="users"
          element={
            <AdminRoute>
              <UserManagement />
            </AdminRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}