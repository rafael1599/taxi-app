import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Driver {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  licenseNumber: string;
  tlcLicense: string | null;
  isActive: boolean;
  isAvailable: boolean;
  status: string;
  currentLat: number | null;
  currentLng: number | null;
  locationAt: string | null;
  createdAt: string;
}

const DRIVER_STATUS_COLORS: Record<string, string> = {
  offline: '#94a3b8',
  idle: '#16a34a',
  incoming: '#d97706',
  accepted: '#2563eb',
  en_route: '#7c3aed',
  arrived: '#0891b2',
  picked_up: '#0891b2',
  completed: '#16a34a',
};

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function fetchDrivers() {
    try {
      const { data } = await api.get('/admin/drivers');
      setDrivers(data);
      setError('');
    } catch {
      setError('Failed to load drivers. Please try again.');
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchDrivers();
  }, []);

  async function toggleStatus(id: string, isActive: boolean) {
    try {
      await api.patch(`/admin/drivers/${id}`, { isActive });
      setDrivers((prev) => prev.map((d) => (d.id === id ? { ...d, isActive } : d)));
    } catch {
      setError('Failed to update driver status.');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: Record<string, any> = {
    table: {
      width: '100%',
      borderCollapse: 'collapse' as const,
      background: '#fff',
      borderRadius: 12,
      overflow: 'hidden',
      boxShadow: '0 1px 8px rgba(0,0,0,.06)',
    },
    th: {
      textAlign: 'left' as const,
      padding: '12px 16px',
      fontSize: 12,
      fontWeight: 600,
      color: '#64748b',
      background: '#f8fafc',
      borderBottom: '1px solid #e2e8f0',
    },
    td: { padding: '12px 16px', fontSize: 14, borderBottom: '1px solid #f1f5f9' },
    badge: (active: boolean): React.CSSProperties => ({
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 600,
      background: active ? '#dcfce7' : '#fee2e2',
      color: active ? '#16a34a' : '#dc2626',
    }),
    statusBadge: (status: string): React.CSSProperties => ({
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '2px 10px',
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 600,
      background: `${DRIVER_STATUS_COLORS[status] ?? '#94a3b8'}18`,
      color: DRIVER_STATUS_COLORS[status] ?? '#94a3b8',
    }),
    dot: (color: string): React.CSSProperties => ({
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: color,
      display: 'inline-block',
    }),
    btn: (active: boolean): React.CSSProperties => ({
      padding: '4px 12px',
      border: 'none',
      borderRadius: 6,
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 600,
      background: active ? '#fee2e2' : '#dcfce7',
      color: active ? '#dc2626' : '#16a34a',
    }),
    summary: { display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' as const },
    statCard: (color: string): React.CSSProperties => ({
      background: '#fff',
      borderRadius: 10,
      padding: '12px 20px',
      borderLeft: `4px solid ${color}`,
      boxShadow: '0 1px 4px rgba(0,0,0,.04)',
      fontSize: 13,
    }),
    statVal: { fontSize: 22, fontWeight: 700, marginBottom: 2 },
  };

  const online = drivers.filter((d) => d.isAvailable && d.isActive);
  const onTrip = drivers.filter(
    (d) => !['offline', 'idle'].includes(d.status) && d.status !== 'completed',
  );

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Drivers</h1>
      {error && <p style={{ color: '#ef4444', marginBottom: 12 }}>{error}</p>}

      <div style={s.summary}>
        <div style={s.statCard('#2563eb')}>
          <div style={s.statVal}>{drivers.length}</div>
          <div style={{ color: '#64748b' }}>Total</div>
        </div>
        <div style={s.statCard('#16a34a')}>
          <div style={s.statVal}>{online.length}</div>
          <div style={{ color: '#64748b' }}>Online</div>
        </div>
        <div style={s.statCard('#7c3aed')}>
          <div style={s.statVal}>{onTrip.length}</div>
          <div style={{ color: '#64748b' }}>On Trip</div>
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#64748b' }}>Loading\u2026</p>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              {['Name', 'Phone', 'License', 'Account', 'Status', 'Location', 'Action'].map((h) => (
                <th key={h} style={s.th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => (
              <tr key={d.id}>
                <td style={s.td}>
                  <div style={{ fontWeight: 500 }}>{d.fullName}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{d.email}</div>
                </td>
                <td style={s.td}>{d.phone}</td>
                <td style={s.td}>
                  <div>{d.licenseNumber}</div>
                  {d.tlcLicense && (
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>TLC: {d.tlcLicense}</div>
                  )}
                </td>
                <td style={s.td}>
                  <span style={s.badge(d.isActive)}>{d.isActive ? 'Active' : 'Suspended'}</span>
                </td>
                <td style={s.td}>
                  <span style={s.statusBadge(d.status)}>
                    <span style={s.dot(DRIVER_STATUS_COLORS[d.status] ?? '#94a3b8')} />
                    {d.status.replace('_', ' ')}
                  </span>
                </td>
                <td style={s.td}>
                  {d.currentLat ? (
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      {d.currentLat.toFixed(4)}, {d.currentLng?.toFixed(4)}
                      {d.locationAt && (
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>
                          {new Date(d.locationAt).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>No location</span>
                  )}
                </td>
                <td style={s.td}>
                  <button style={s.btn(d.isActive)} onClick={() => toggleStatus(d.id, !d.isActive)}>
                    {d.isActive ? 'Suspend' : 'Approve'}
                  </button>
                </td>
              </tr>
            ))}
            {drivers.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...s.td, textAlign: 'center', color: '#94a3b8' }}>
                  No drivers found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
