import { useEffect, useState } from 'react';
import { api } from '../api/client';

// ── Types ────────────────────────────────────────────────────────────────────
interface LegacyStats {
  drivers: { total: number; active: number; online: number };
  trips: { total: number; completed: number; cancelled: number; revenue: number };
  employees: { total: number; active: number };
  timeEntries: { total: number; totalHours: number };
  priceOverrides: { total: number; active: number };
}

interface LegacyDriver {
  id: string;
  name: string;
  phone: string;
  plate: string | null;
  vehicle: string | null;
  isActive: boolean;
  isOnline: boolean;
  companyName: string | null;
}

interface LegacyTrip {
  id: string;
  clientPhone: string;
  clientName: string | null;
  pickupAddress: string;
  dropoffAddress: string | null;
  price: number | null;
  status: string;
  driverName: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface LegacyPriceOverride {
  id: string;
  originLabel: string;
  destLabel: string;
  price: number;
  radiusMiles: number;
  isActive: boolean;
  note: string | null;
}

interface LegacyEmployee {
  id: string;
  employeeCode: string | null;
  fullName: string;
  hourlyRate: number | null;
  isActive: boolean;
  email: string | null;
  role: string;
}

interface LegacyTimeEntry {
  id: string;
  startTime: string;
  endTime: string | null;
  employeeName: string;
  employeeCode: string | null;
  hourlyRate: number | null;
  hoursWorked: number | null;
}

interface TimeSummary {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  hourlyRate: number | null;
  totalEntries: number;
  totalHours: number;
  totalPay: number;
}

type Tab = 'overview' | 'drivers' | 'trips' | 'prices' | 'employees' | 'hours';

// ── Styles ───────────────────────────────────────────────────────────────────
const badge = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 600,
  background: color === 'green' ? '#dcfce7' : color === 'red' ? '#fef2f2' : '#f1f5f9',
  color: color === 'green' ? '#166534' : color === 'red' ? '#dc2626' : '#475569',
});
const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1200 },
  title: { fontSize: 24, fontWeight: 700, marginBottom: 4 },
  subtitle: { color: '#64748b', fontSize: 14, marginBottom: 24 },
  tabs: { display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' },
  tab: {
    padding: '8px 16px',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    color: '#475569',
  },
  tabActive: {
    background: '#1e293b',
    color: '#fff',
    border: '1px solid #1e293b',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 16,
    marginBottom: 24,
  },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: 20,
    border: '1px solid #e2e8f0',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  },
  cardLabel: {
    fontSize: 12,
    color: '#64748b',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  cardValue: { fontSize: 28, fontWeight: 700, marginTop: 4 },
  cardSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: {
    textAlign: 'left' as const,
    padding: '10px 12px',
    borderBottom: '2px solid #e2e8f0',
    color: '#475569',
    fontWeight: 600,
    fontSize: 12,
    textTransform: 'uppercase' as const,
  },
  td: { padding: '10px 12px', borderBottom: '1px solid #f1f5f9' },
  loading: { textAlign: 'center' as const, padding: 40, color: '#94a3b8' },
  error: { textAlign: 'center' as const, padding: 40, color: '#dc2626' },
  filterRow: {
    display: 'flex',
    gap: 12,
    marginBottom: 16,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
  },
  input: {
    padding: '6px 12px',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    fontSize: 13,
    outline: 'none',
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function usd(n: number | null) {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function LegacyPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<LegacyStats | null>(null);
  const [drivers, setDrivers] = useState<LegacyDriver[]>([]);
  const [trips, setTrips] = useState<LegacyTrip[]>([]);
  const [tripsTotal, setTripsTotal] = useState(0);
  const [prices, setPrices] = useState<LegacyPriceOverride[]>([]);
  const [employees, setEmployees] = useState<LegacyEmployee[]>([]);
  const [timeEntries, setTimeEntries] = useState<LegacyTimeEntry[]>([]);
  const [timeTotal, setTimeTotal] = useState(0);
  const [timeSummary, setTimeSummary] = useState<TimeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');

  async function load(t: Tab) {
    setLoading(true);
    setError('');
    try {
      switch (t) {
        case 'overview': {
          const r = await api.get('/legacy/stats');
          setStats(r.data);
          break;
        }
        case 'drivers': {
          const r = await api.get('/legacy/drivers');
          setDrivers(r.data);
          break;
        }
        case 'trips': {
          const r = await api.get('/legacy/trips?limit=100');
          setTrips(r.data.trips);
          setTripsTotal(r.data.total);
          break;
        }
        case 'prices': {
          const r = await api.get('/legacy/price-overrides');
          setPrices(r.data);
          break;
        }
        case 'employees': {
          const r = await api.get('/legacy/employees');
          setEmployees(r.data);
          break;
        }
        case 'hours': {
          const [entries, summary] = await Promise.all([
            api.get(
              `/legacy/time-entries?limit=100${employeeFilter ? `&employeeId=${employeeFilter}` : ''}`,
            ),
            api.get('/legacy/time-entries/summary'),
          ]);
          setTimeEntries(entries.data.entries);
          setTimeTotal(entries.data.total);
          setTimeSummary(summary.data);
          break;
        }
      }
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e.message ?? 'Error loading data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(tab);
  }, [tab]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'drivers', label: 'Drivers' },
    { key: 'trips', label: 'Trips' },
    { key: 'prices', label: 'Price Overrides' },
    { key: 'employees', label: 'Employees' },
    { key: 'hours', label: 'Hours Worked' },
  ];

  return (
    <div style={s.page}>
      <div style={s.title}>Legacy Data</div>
      <div style={s.subtitle}>Read-only data from Control de Horas (Supabase)</div>

      {/* Tabs */}
      <div style={s.tabs}>
        {tabs.map((t) => (
          <button
            key={t.key}
            style={{ ...s.tab, ...(tab === t.key ? s.tabActive : {}) }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div style={s.loading}>Loading...</div>}
      {error && <div style={s.error}>{error}</div>}

      {!loading && !error && (
        <>
          {/* ── Overview ────────────────────────────────────────────── */}
          {tab === 'overview' && stats && (
            <div style={s.grid}>
              <div style={s.card}>
                <div style={s.cardLabel}>Drivers</div>
                <div style={s.cardValue}>{stats.drivers.total}</div>
                <div style={s.cardSub}>
                  {stats.drivers.active} active · {stats.drivers.online} online
                </div>
              </div>
              <div style={s.card}>
                <div style={s.cardLabel}>Trips</div>
                <div style={s.cardValue}>{stats.trips.total}</div>
                <div style={s.cardSub}>
                  {stats.trips.completed} completed · {stats.trips.cancelled} cancelled
                </div>
              </div>
              <div style={s.card}>
                <div style={s.cardLabel}>Revenue</div>
                <div style={s.cardValue}>{usd(stats.trips.revenue)}</div>
                <div style={s.cardSub}>From completed trips</div>
              </div>
              <div style={s.card}>
                <div style={s.cardLabel}>Employees</div>
                <div style={s.cardValue}>{stats.employees.total}</div>
                <div style={s.cardSub}>{stats.employees.active} active</div>
              </div>
              <div style={s.card}>
                <div style={s.cardLabel}>Hours Logged</div>
                <div style={s.cardValue}>{stats.timeEntries.totalHours.toFixed(1)}h</div>
                <div style={s.cardSub}>{stats.timeEntries.total} time entries</div>
              </div>
              <div style={s.card}>
                <div style={s.cardLabel}>Fixed Routes</div>
                <div style={s.cardValue}>{stats.priceOverrides.total}</div>
                <div style={s.cardSub}>{stats.priceOverrides.active} active</div>
              </div>
            </div>
          )}

          {/* ── Drivers ─────────────────────────────────────────────── */}
          {tab === 'drivers' && (
            <div style={s.card}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Name</th>
                    <th style={s.th}>Phone</th>
                    <th style={s.th}>Vehicle</th>
                    <th style={s.th}>Plate</th>
                    <th style={s.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d) => (
                    <tr key={d.id}>
                      <td style={s.td}>{d.name}</td>
                      <td style={s.td}>{d.phone}</td>
                      <td style={s.td}>{d.vehicle ?? '—'}</td>
                      <td style={s.td}>{d.plate ?? '—'}</td>
                      <td style={s.td}>
                        <span style={badge(d.isActive ? 'green' : 'red')}>
                          {d.isActive ? 'Active' : 'Inactive'}
                        </span>
                        {d.isOnline && (
                          <span style={{ ...badge('green'), marginLeft: 4 }}>Online</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {drivers.length === 0 && (
                    <tr>
                      <td style={{ ...s.td, textAlign: 'center', color: '#94a3b8' }} colSpan={5}>
                        No drivers found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Trips ───────────────────────────────────────────────── */}
          {tab === 'trips' && (
            <div style={s.card}>
              <div style={{ marginBottom: 12, fontSize: 13, color: '#64748b' }}>
                Showing {trips.length} of {tripsTotal} trips
              </div>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Date</th>
                    <th style={s.th}>Client</th>
                    <th style={s.th}>Pickup</th>
                    <th style={s.th}>Dropoff</th>
                    <th style={s.th}>Driver</th>
                    <th style={s.th}>Price</th>
                    <th style={s.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((t) => (
                    <tr key={t.id}>
                      <td style={s.td}>{fmt(t.createdAt)}</td>
                      <td style={s.td}>{t.clientName ?? t.clientPhone}</td>
                      <td
                        style={{
                          ...s.td,
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t.pickupAddress}
                      </td>
                      <td
                        style={{
                          ...s.td,
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t.dropoffAddress ?? '—'}
                      </td>
                      <td style={s.td}>{t.driverName ?? '—'}</td>
                      <td style={s.td}>{usd(t.price)}</td>
                      <td style={s.td}>
                        <span
                          style={badge(
                            t.status === 'completed'
                              ? 'green'
                              : t.status === 'cancelled'
                                ? 'red'
                                : 'gray',
                          )}
                        >
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {trips.length === 0 && (
                    <tr>
                      <td style={{ ...s.td, textAlign: 'center', color: '#94a3b8' }} colSpan={7}>
                        No trips found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Price Overrides ──────────────────────────────────────── */}
          {tab === 'prices' && (
            <div style={s.card}>
              <div style={{ marginBottom: 12, fontSize: 13, color: '#64748b' }}>
                {prices.length} fixed routes
              </div>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Origin</th>
                    <th style={s.th}>Destination</th>
                    <th style={s.th}>Price</th>
                    <th style={s.th}>Radius (mi)</th>
                    <th style={s.th}>Status</th>
                    <th style={s.th}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {prices.map((p) => (
                    <tr key={p.id}>
                      <td style={s.td}>{p.originLabel}</td>
                      <td style={s.td}>{p.destLabel}</td>
                      <td style={s.td}>{usd(p.price)}</td>
                      <td style={s.td}>{p.radiusMiles}</td>
                      <td style={s.td}>
                        <span style={badge(p.isActive ? 'green' : 'red')}>
                          {p.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td
                        style={{
                          ...s.td,
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.note ?? '—'}
                      </td>
                    </tr>
                  ))}
                  {prices.length === 0 && (
                    <tr>
                      <td style={{ ...s.td, textAlign: 'center', color: '#94a3b8' }} colSpan={6}>
                        No price overrides found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Employees ───────────────────────────────────────────── */}
          {tab === 'employees' && (
            <div style={s.card}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Code</th>
                    <th style={s.th}>Name</th>
                    <th style={s.th}>Email</th>
                    <th style={s.th}>Rate/hr</th>
                    <th style={s.th}>Role</th>
                    <th style={s.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((e) => (
                    <tr key={e.id}>
                      <td style={s.td}>{e.employeeCode ?? '—'}</td>
                      <td style={s.td}>{e.fullName}</td>
                      <td style={s.td}>{e.email ?? '—'}</td>
                      <td style={s.td}>{e.hourlyRate ? usd(e.hourlyRate) : '—'}</td>
                      <td style={s.td}>{e.role}</td>
                      <td style={s.td}>
                        <span style={badge(e.isActive ? 'green' : 'red')}>
                          {e.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {employees.length === 0 && (
                    <tr>
                      <td style={{ ...s.td, textAlign: 'center', color: '#94a3b8' }} colSpan={6}>
                        No employees found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Hours Worked ────────────────────────────────────────── */}
          {tab === 'hours' && (
            <>
              {/* Summary cards */}
              {timeSummary.length > 0 && (
                <>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
                    Summary by Employee
                  </div>
                  <div style={{ ...s.grid, marginBottom: 24 }}>
                    {timeSummary.map((ts) => (
                      <div
                        key={ts.employeeId}
                        style={{
                          ...s.card,
                          cursor: 'pointer',
                          border:
                            employeeFilter === ts.employeeId
                              ? '2px solid #3b82f6'
                              : '1px solid #e2e8f0',
                        }}
                        onClick={() => {
                          setEmployeeFilter(employeeFilter === ts.employeeId ? '' : ts.employeeId);
                          setTimeout(() => load('hours'), 100);
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{ts.employeeName}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{ts.employeeCode}</div>
                        <div style={{ marginTop: 8, fontSize: 22, fontWeight: 700 }}>
                          {ts.totalHours}h
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>
                          {ts.totalEntries} entries · {usd(ts.totalPay)} total
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Entries table */}
              <div style={s.card}>
                <div style={{ marginBottom: 12, fontSize: 13, color: '#64748b' }}>
                  Showing {timeEntries.length} of {timeTotal} entries
                  {employeeFilter && (
                    <button
                      style={{
                        marginLeft: 8,
                        background: 'none',
                        border: 'none',
                        color: '#3b82f6',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                      onClick={() => {
                        setEmployeeFilter('');
                        setTimeout(() => load('hours'), 100);
                      }}
                    >
                      Clear filter
                    </button>
                  )}
                </div>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Employee</th>
                      <th style={s.th}>Code</th>
                      <th style={s.th}>Start</th>
                      <th style={s.th}>End</th>
                      <th style={s.th}>Hours</th>
                      <th style={s.th}>Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeEntries.map((te) => (
                      <tr key={te.id}>
                        <td style={s.td}>{te.employeeName}</td>
                        <td style={s.td}>{te.employeeCode ?? '—'}</td>
                        <td style={s.td}>{fmt(te.startTime)}</td>
                        <td style={s.td}>{fmt(te.endTime)}</td>
                        <td style={s.td}>
                          {te.hoursWorked != null ? te.hoursWorked.toFixed(2) : '—'}
                        </td>
                        <td style={s.td}>
                          {te.hoursWorked != null && te.hourlyRate != null
                            ? usd(te.hoursWorked * te.hourlyRate)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                    {timeEntries.length === 0 && (
                      <tr>
                        <td style={{ ...s.td, textAlign: 'center', color: '#94a3b8' }} colSpan={6}>
                          No time entries found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
