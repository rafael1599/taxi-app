import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Stats {
  totalDrivers: number;
  activeDrivers: number;
  totalRiders: number;
  totalRides: number;
  pendingRides: number;
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const s: Record<string, React.CSSProperties> = {
    card: { background: '#fff', borderRadius: 12, padding: 24, flex: 1, borderTop: `4px solid ${color}`, boxShadow: '0 1px 8px rgba(0,0,0,.06)' },
    val: { fontSize: 36, fontWeight: 700, color },
    lbl: { fontSize: 13, color: '#64748b', marginTop: 4 },
  };
  return (
    <div style={s.card}>
      <div style={s.val}>{value}</div>
      <div style={s.lbl}>{label}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.get('/admin/dashboard').then((r) => setStats(r.data));
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Dashboard</h1>
      {stats ? (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <StatCard label="Total Drivers" value={stats.totalDrivers} color="#2563eb" />
          <StatCard label="Active Drivers" value={stats.activeDrivers} color="#16a34a" />
          <StatCard label="Total Riders" value={stats.totalRiders} color="#7c3aed" />
          <StatCard label="Total Rides" value={stats.totalRides} color="#0891b2" />
          <StatCard label="Pending Rides" value={stats.pendingRides} color="#ea580c" />
        </div>
      ) : (
        <p style={{ color: '#64748b' }}>Loading\u2026</p>
      )}
    </div>
  );
}
