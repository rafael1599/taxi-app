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
  distanceKm: number | null;
  durationMin: number | null;
  createdAt: string;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  droppedOffAt: string | null;
}

interface Driver {
  id: string;
  fullName: string;
}

const STATUS_COLORS: Record<string, string> = {
  requested: '#ea580c',
  searching_driver: '#d97706',
  driver_assigned: '#2563eb',
  accepted: '#2563eb',
  en_route: '#7c3aed',
  arrived: '#0891b2',
  in_progress: '#0891b2',
  picked_up: '#0891b2',
  completed: '#16a34a',
  cancelled: '#94a3b8',
};

const ALL_STATUSES = [
  'requested',
  'searching_driver',
  'driver_assigned',
  'accepted',
  'en_route',
  'arrived',
  'in_progress',
  'picked_up',
  'completed',
  'cancelled',
];

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
    api
      .get('/admin/drivers')
      .then((r) => setDrivers(r.data.filter((d: { isActive: boolean }) => d.isActive)));
  }, [statusFilter]);

  async function handleDispatch() {
    if (!dispatchRide || !selectedDriver) return;
    await api.post(`/admin/rides/${dispatchRide}/dispatch`, { driverId: selectedDriver });
    setDispatchRide(null);
    setSelectedDriver('');
    fetchRides(statusFilter);
  }

  async function handleCancel(rideId: string) {
    try {
      await api.post(`/rides/${rideId}/cancel`);
      fetchRides(statusFilter);
    } catch {
      /* ignore */
    }
  }

  const driverMap = new Map(drivers.map((d) => [d.id, d.fullName]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: Record<string, any> = {
    toolbar: { display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' },
    select: { padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14 },
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
    td: { padding: '12px 16px', fontSize: 13, borderBottom: '1px solid #f1f5f9' },
    badge: (status: string): React.CSSProperties => ({
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 600,
      background: `${STATUS_COLORS[status] ?? '#94a3b8'}18`,
      color: STATUS_COLORS[status] ?? '#94a3b8',
    }),
    dispatchBtn: {
      padding: '4px 10px',
      background: '#2563eb',
      color: '#fff',
      border: 'none',
      borderRadius: 6,
      cursor: 'pointer',
      fontSize: 12,
      marginRight: 4,
    },
    cancelBtn: {
      padding: '4px 10px',
      background: '#fee2e2',
      color: '#dc2626',
      border: 'none',
      borderRadius: 6,
      cursor: 'pointer',
      fontSize: 12,
    },
    modal: {
      position: 'fixed' as const,
      inset: 0,
      background: 'rgba(0,0,0,.4)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
    },
    modalCard: { background: '#fff', borderRadius: 12, padding: 28, minWidth: 340 },
    modalTitle: { fontSize: 17, fontWeight: 700, marginBottom: 16 },
    modalBtn: (primary: boolean): React.CSSProperties => ({
      padding: '8px 20px',
      borderRadius: 8,
      border: 'none',
      cursor: 'pointer',
      fontWeight: 600,
      background: primary ? '#2563eb' : '#f1f5f9',
      color: primary ? '#fff' : '#374151',
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

  const active = rides.filter((r) => !['completed', 'cancelled'].includes(r.status));
  const completedCount = rides.filter((r) => r.status === 'completed').length;

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Rides</h1>

      <div style={s.summary}>
        <div style={s.statCard('#2563eb')}>
          <div style={s.statVal}>{rides.length}</div>
          <div style={{ color: '#64748b' }}>Showing</div>
        </div>
        <div style={s.statCard('#ea580c')}>
          <div style={s.statVal}>{active.length}</div>
          <div style={{ color: '#64748b' }}>Active</div>
        </div>
        <div style={s.statCard('#16a34a')}>
          <div style={s.statVal}>{completedCount}</div>
          <div style={{ color: '#64748b' }}>Completed</div>
        </div>
      </div>

      <div style={s.toolbar}>
        <select
          style={s.select}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {ALL_STATUSES.map((st) => (
            <option key={st} value={st}>
              {st.replace('_', ' ')}
            </option>
          ))}
        </select>
        <button
          style={{
            ...s.select,
            cursor: 'pointer',
            background: '#f1f5f9',
            border: '1px solid #e2e8f0',
          }}
          onClick={() => fetchRides(statusFilter)}
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p style={{ color: '#64748b' }}>Loading\u2026</p>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              {['ID', 'Status', 'Pickup', 'Dropoff', 'Driver', 'Fare', 'Date', 'Actions'].map(
                (h) => (
                  <th key={h} style={s.th}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rides.map((r) => (
              <tr key={r.id}>
                <td style={s.td}>{r.id.slice(0, 8)}\u2026</td>
                <td style={s.td}>
                  <span style={s.badge(r.status)}>{r.status.replace('_', ' ')}</span>
                </td>
                <td style={s.td}>{r.pickupAddress}</td>
                <td style={s.td}>{r.dropoffAddress}</td>
                <td style={s.td}>
                  {r.driverId ? (
                    <span style={{ fontSize: 12 }}>
                      {driverMap.get(r.driverId) ?? r.driverId.slice(0, 8)}
                    </span>
                  ) : (
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>Unassigned</span>
                  )}
                </td>
                <td style={s.td}>
                  <div>${r.fareFinal ?? r.fareEstimate ?? '\u2014'}</div>
                  {r.distanceKm && (
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      {r.distanceKm.toFixed(1)}km
                    </div>
                  )}
                </td>
                <td style={s.td}>
                  <div>{new Date(r.createdAt).toLocaleDateString()}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    {new Date(r.createdAt).toLocaleTimeString()}
                  </div>
                </td>
                <td style={s.td}>
                  {['requested', 'searching_driver'].includes(r.status) && (
                    <button style={s.dispatchBtn} onClick={() => setDispatchRide(r.id)}>
                      Dispatch
                    </button>
                  )}
                  {!['completed', 'cancelled'].includes(r.status) && (
                    <button style={s.cancelBtn} onClick={() => handleCancel(r.id)}>
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rides.length === 0 && (
              <tr>
                <td colSpan={8} style={{ ...s.td, textAlign: 'center', color: '#94a3b8' }}>
                  No rides found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {dispatchRide && (
        <div style={s.modal}>
          <div style={s.modalCard}>
            <div style={s.modalTitle}>Dispatch Driver</div>
            <select
              style={{ ...s.select, width: '100%', marginBottom: 20 }}
              value={selectedDriver}
              onChange={(e) => setSelectedDriver(e.target.value)}
            >
              <option value="">Select a driver\u2026</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button style={s.modalBtn(false)} onClick={() => setDispatchRide(null)}>
                Cancel
              </button>
              <button style={s.modalBtn(true)} onClick={handleDispatch} disabled={!selectedDriver}>
                Dispatch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
