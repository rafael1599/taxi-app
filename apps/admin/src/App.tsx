import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import LoginPage from './pages/LoginPage';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import DriversPage from './pages/DriversPage';
import RidesPage from './pages/RidesPage';
import MapPage from './pages/MapPage';
import PricingPage from './pages/PricingPage';
import CompanySettingsPage from './pages/CompanySettingsPage';
import WhatsAppPage from './pages/WhatsAppPage';
import BillingPage from './pages/BillingPage';
import AnalyticsPage from './pages/AnalyticsPage';
import LegacyPage from './pages/LegacyPage';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

// Role-based access: which roles can access which routes
const ROLE_ACCESS: Record<string, string[]> = {
  platform_admin: [
    'dashboard',
    'analytics',
    'drivers',
    'rides',
    'map',
    'pricing',
    'settings',
    'whatsapp',
    'billing',
    'legacy',
  ],
  super_admin: [
    'dashboard',
    'analytics',
    'drivers',
    'rides',
    'map',
    'pricing',
    'settings',
    'whatsapp',
    'billing',
    'legacy',
  ],
  dispatcher: ['dashboard', 'analytics', 'rides', 'map'],
  viewer: ['dashboard', 'analytics'],
};

function RoleRoute({ page, children }: { page: string; children: React.ReactNode }) {
  const adminRole = useAuthStore((s) => s.user?.adminRole);
  const allowed = ROLE_ACCESS[adminRole ?? ''] ?? [];
  if (!allowed.includes(page)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route
          path="analytics"
          element={
            <RoleRoute page="analytics">
              <AnalyticsPage />
            </RoleRoute>
          }
        />
        <Route
          path="drivers"
          element={
            <RoleRoute page="drivers">
              <DriversPage />
            </RoleRoute>
          }
        />
        <Route
          path="rides"
          element={
            <RoleRoute page="rides">
              <RidesPage />
            </RoleRoute>
          }
        />
        <Route
          path="map"
          element={
            <RoleRoute page="map">
              <MapPage />
            </RoleRoute>
          }
        />
        <Route
          path="pricing"
          element={
            <RoleRoute page="pricing">
              <PricingPage />
            </RoleRoute>
          }
        />
        <Route
          path="settings"
          element={
            <RoleRoute page="settings">
              <CompanySettingsPage />
            </RoleRoute>
          }
        />
        <Route
          path="whatsapp"
          element={
            <RoleRoute page="whatsapp">
              <WhatsAppPage />
            </RoleRoute>
          }
        />
        <Route
          path="billing"
          element={
            <RoleRoute page="billing">
              <BillingPage />
            </RoleRoute>
          }
        />
        <Route
          path="legacy"
          element={
            <RoleRoute page="legacy">
              <LegacyPage />
            </RoleRoute>
          }
        />
      </Route>
    </Routes>
  );
}
