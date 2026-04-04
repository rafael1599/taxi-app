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
  createdAt: string;
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchDrivers() {
    const { data } = await api.get('/admin/drivers');
    setDrivers(data);
    setLoading(false);
  }

  useEffect(() => { fetchDrivers(); }, []);

  async function toggleStatus(id: string, isActive: boolean) {
    await api.patch(`/admin/drivers/${id}`, { isActive });
    setDrivers((prev) => prev.map((d) => (d.id === id ? { ...d, isActive } : d)));
  }

  const s: Record<string, React.CSSProperties> = {
    table: { width: '100%', borderCollapse: 'collapse' as const, background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,.06)' },
    th: { textAlign: 'left' as const, padding: '12px 16px', fontSize: 12, fontWeight: 600, color: '#64748b', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
    td: { padding: '12px 16px', fontSize: 14, borderBottom: '1px solid #f1f5f9' },
    badge: (active: boolean): React.CSSProperties => ({
      display: 'inline-block', padding: '2px 10px', borderRadius: 99,
      fontSize: 12, fontWeight: 600,
      background: active ? '#dcfce7' : '#fee2e2',
      color: active ? '#16a34a' : '#dc2626',
    }),
    btn: (active: boolean): React.CSSProperties => ({
      padding: '4px 12px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
      background: active ? '#fee2e2' : '#dcfce7',
      color: active ? '#dc2626' : '#16a34a',
    }),
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Drivers</h1>
      {loading ? <p style={{ color: '#64748b' }}>Loading\u2026</p> : (
        <table style={s.table}>
          <thead>
            <tr>
              {['Name', 'Email', 'Phone', 'License', 'TLC', 'Status', 'Online', 'Action'].map((h) => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => (
              <tr key={d.id}>
                <td style={s.td}>{d.fullName}</td>
                <td style={s.td}>{d.email}</td>
                <td style={s.td}>{d.phone}</td>
                <td style={s.td}>{d.licenseNumber}</td>
                <td style={s.td}>{d.tlcLicense ?? '\u2014'}</td>
                <td style={s.td}><span style={s.badge(d.isActive)}>{d.isActive ? 'Active' : 'Suspended'}</span></td>
                <td style={s.td}><span style={s.badge(d.isAvailable)}>{d.isAvailable ? 'Online' : 'Offline'}</span></td>
                <td style={s.td}>
                  <button style={s.btn(d.isActive)} onClick={() => toggleStatus(d.id, !d.isActive)}>
                    {d.isActive ? 'Suspend' : 'Approve'}
                  </button>
                </td>
              </tr>
            ))}
            {drivers.length === 0 && (
              <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', color: '#94a3b8' }}>No drivers found</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
