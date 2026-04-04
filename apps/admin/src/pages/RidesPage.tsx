import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Ride {
  id: string;
  riderId: string;
  driverId: string | null;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  fareEstimate: string | null;
  fareFinal: string | null;
  createdAt: string;
}

interface Driver {
  id: string;
  fullName: string;
}

const STATUS_COLORS: Record<string, string> = {
  requested: '#ea580c', accepted: '#2563eb', arrived: '#7c3aed',
  in_progress: '#0891b2', completed: '#16a34a', cancelled: '#94a3b8',
};

export default function RidesPage() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [dispatchRide, setDispatchRide] = useState<string | null>(null);
  const [selectedDriver, setSelectedDriver] = useState('');

  async function fetchRides(status: string) {
    setLoading(true);
    const params = status ? { status } : {};
    const { data } = await api.get('/admin/rides', { params });
    setRides(data);
    setLoading(false);
  }

  useEffect(() => {
    fetchRides(statusFilter);
    api.get('/admin/drivers').then((r) => setDrivers(r.data.filter((d: { isActive: boolean }) => d.isActive)));
  }, [statusFilter]);

  async function handleDispatch() {
    if (!dispatchRide || !selectedDriver) return;
    await api.post(`/admin/rides/${dispatchRide}/dispatch`, { driverId: selectedDriver });
    setDispatchRide(null);
    setSelectedDriver('');
    fetchRides(statusFilter);
  }

  const s: Record<string, React.CSSProperties> = {
    toolbar: { display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' },
    select: { padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14 },
    table: { width: '100%', borderCollapse: 'collapse' as const, background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,.06)' },
    th: { textAlign: 'left' as const, padding: '12px 16px', fontSize: 12, fontWeight: 600, color: '#64748b', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
    td: { padding: '12px 16px', fontSize: 13, borderBottom: '1px solid #f1f5f9' },
    badge: (status: string): React.CSSProperties => ({
      display: 'inline-block', padding: '2px 10px', borderRadius: 99,
      fontSize: 12, fontWeight: 600,
      background: `${STATUS_COLORS[status] ?? '#94a3b8'}18`,
      color: STATUS_COLORS[status] ?? '#94a3b8',
    }),
    dispatchBtn: { padding: '4px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
    modal: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
    modalCard: { background: '#fff', borderRadius: 12, padding: 28, minWidth: 340 },
    modalTitle: { fontSize: 17, fontWeight: 700, marginBottom: 16 },
    modalBtn: (primary: boolean): React.CSSProperties => ({
      padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600,
      background: primary ? '#2563eb' : '#f1f5f9', color: primary ? '#fff' : '#374151',
    }),
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Rides</h1>
      <div style={s.toolbar}>
        <select style={s.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {['requested', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled'].map((st) => (
            <option key={st} value={st}>{st}</option>
          ))}
        </select>
      </div>
      {loading ? <p style={{ color: '#64748b' }}>Loading\u2026</p> : (
        <table style={s.table}>
          <thead>
            <tr>
              {['ID', 'Status', 'Pickup', 'Dropoff', 'Fare', 'Date', 'Action'].map((h) => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rides.map((r) => (
              <tr key={r.id}>
                <td style={s.td}>{r.id.slice(0, 8)}\u2026</td>
                <td style={s.td}><span style={s.badge(r.status)}>{r.status}</span></td>
                <td style={s.td}>{r.pickupAddress}</td>
                <td style={s.td}>{r.dropoffAddress}</td>
                <td style={s.td}>${r.fareFinal ?? r.fareEstimate ?? '\u2014'}</td>
                <td style={s.td}>{new Date(r.createdAt).toLocaleDateString()}</td>
                <td style={s.td}>
                  {['requested', 'accepted'].includes(r.status) && (
                    <button style={s.dispatchBtn} onClick={() => setDispatchRide(r.id)}>Dispatch</button>
                  )}
                </td>
              </tr>
            ))}
            {rides.length === 0 && (
              <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: '#94a3b8' }}>No rides found</td></tr>
            )}
          </tbody>
        </table>
      )}

      {dispatchRide && (
        <div style={s.modal}>
          <div style={s.modalCard}>
            <div style={s.modalTitle}>Dispatch Driver</div>
            <select style={{ ...s.select, width: '100%', marginBottom: 20 }} value={selectedDriver} onChange={(e) => setSelectedDriver(e.target.value)}>
              <option value="">Select a driver\u2026</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button style={s.modalBtn(false)} onClick={() => setDispatchRide(null)}>Cancel</button>
              <button style={s.modalBtn(true)} onClick={handleDispatch} disabled={!selectedDriver}>Dispatch</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
