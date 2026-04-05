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

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  return user ? <>{children}</> : <Navigate to="/login" replace />;
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
        <Route path="drivers" element={<DriversPage />} />
        <Route path="rides" element={<RidesPage />} />
        <Route path="map" element={<MapPage />} />
        <Route path="pricing" element={<PricingPage />} />
        <Route path="settings" element={<CompanySettingsPage />} />
        <Route path="whatsapp" element={<WhatsAppPage />} />
      </Route>
    </Routes>
  );
}
