import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface AnalyticsData {
  period: { from: string; to: string };
  rides: { total: number; completed: number; cancelled: number; completionRate: number };
  revenue: { total: string; avgFare: string };
  ratings: { avgDriverRating: string; totalRatings: number };
  dailyRides: { date: string; total: number; completed: number }[];
  topDrivers: {
    driverId: string;
    driverName: string;
    completedRides: number;
    avgRating: string;
  }[];
}

type DateRange = '7d' | '30d' | '90d';

function KPICard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div style={styles.kpiCard}>
      <div style={{ ...styles.kpiDot, background: color }} />
      <div style={styles.kpiValue}>{value}</div>
      <div style={styles.kpiLabel}>{label}</div>
      {sub && <div style={styles.kpiSub}>{sub}</div>}
    </div>
  );
}

function MiniBarChart({ data }: { data: { date: string; total: number; completed: number }[] }) {
  if (data.length === 0) return <div style={styles.emptyChart}>No ride data yet</div>;

  const maxVal = Math.max(...data.map((d) => d.total), 1);

  return (
    <div style={styles.chartContainer}>
      <div style={styles.chartBars}>
        {data.map((d) => (
          <div key={d.date} style={styles.chartColumn}>
            <div style={styles.barGroup}>
              <div
                style={{
                  ...styles.bar,
                  height: `${(d.total / maxVal) * 100}%`,
                  background: '#e2e8f0',
                }}
                title={`Total: ${d.total}`}
              />
              <div
                style={{
                  ...styles.bar,
                  height: `${(d.completed / maxVal) * 100}%`,
                  background: '#2563eb',
                  position: 'absolute',
                  bottom: 0,
                }}
                title={`Completed: ${d.completed}`}
              />
            </div>
            <div style={styles.chartDate}>
              {new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
          </div>
        ))}
      </div>
      <div style={styles.chartLegend}>
        <span>
          <span style={{ ...styles.legendDot, background: '#2563eb' }} /> Completed
        </span>
        <span>
          <span style={{ ...styles.legendDot, background: '#e2e8f0' }} /> Total
        </span>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [range, setRange] = useState<DateRange>('30d');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const from = new Date(Date.now() - days * 86400_000).toISOString();
    const to = new Date().toISOString();

    api
      .get('/admin/analytics', { params: { from, to } })
      .then((r) => {
        setData(r.data);
        setError('');
      })
      .catch(() => setError('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [range]);

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Analytics</h1>
        <div style={styles.rangeSelector}>
          {(['7d', '30d', '90d'] as DateRange[]).map((r) => (
            <button
              key={r}
              style={{
                ...styles.rangeBtn,
                ...(range === r ? styles.rangeBtnActive : {}),
              }}
              onClick={() => setRange(r)}
            >
              {r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : '90 Days'}
            </button>
          ))}
        </div>
      </div>

      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      {loading && !data && <p style={{ color: '#64748b' }}>Loading...</p>}

      {data && (
        <>
          {/* KPI Cards */}
          <div style={styles.kpiGrid}>
            <KPICard label="Total Rides" value={data.rides.total} color="#2563eb" />
            <KPICard
              label="Completion Rate"
              value={`${data.rides.completionRate}%`}
              sub={`${data.rides.completed} completed / ${data.rides.cancelled} cancelled`}
              color="#16a34a"
            />
            <KPICard
              label="Revenue"
              value={`$${data.revenue.total}`}
              sub={`Avg fare: $${data.revenue.avgFare}`}
              color="#7c3aed"
            />
            <KPICard
              label="Avg Driver Rating"
              value={data.ratings.avgDriverRating}
              sub={`${data.ratings.totalRatings} ratings`}
              color="#f59e0b"
            />
          </div>

          {/* Daily Rides Chart */}
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Daily Rides</h2>
            <MiniBarChart data={data.dailyRides} />
          </div>

          {/* Top Drivers */}
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Top Drivers</h2>
            {data.topDrivers.length > 0 ? (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>#</th>
                    <th style={styles.th}>Driver</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Completed Rides</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topDrivers.map((d, i) => (
                    <tr key={d.driverId}>
                      <td style={styles.td}>{i + 1}</td>
                      <td style={styles.td}>{d.driverName}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{d.completedRides}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>
                        {parseFloat(d.avgRating) > 0 ? `${d.avgRating} / 5` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: '#94a3b8', fontSize: 14 }}>No driver data for this period</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: { fontSize: 22, fontWeight: 700, margin: 0 },
  rangeSelector: { display: 'flex', gap: 4, background: '#f1f5f9', borderRadius: 8, padding: 4 },
  rangeBtn: {
    padding: '6px 14px',
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: '#64748b',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  rangeBtnActive: {
    background: '#fff',
    color: '#0f172a',
    boxShadow: '0 1px 3px rgba(0,0,0,.1)',
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 16,
    marginBottom: 32,
  },
  kpiCard: {
    background: '#fff',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 1px 8px rgba(0,0,0,.06)',
    position: 'relative' as const,
  },
  kpiDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 12 },
  kpiValue: { fontSize: 28, fontWeight: 700, color: '#0f172a' },
  kpiLabel: { fontSize: 13, color: '#64748b', marginTop: 4 },
  kpiSub: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  section: {
    background: '#fff',
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
    boxShadow: '0 1px 8px rgba(0,0,0,.06)',
  },
  sectionTitle: { fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 16 },
  chartContainer: {},
  chartBars: { display: 'flex', gap: 2, alignItems: 'flex-end', height: 160 },
  chartColumn: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center' },
  barGroup: { width: '100%', height: 140, position: 'relative' as const },
  bar: {
    width: '80%',
    margin: '0 auto',
    borderRadius: '3px 3px 0 0',
    position: 'absolute' as const,
    bottom: 0,
    left: '10%',
    minHeight: 2,
  },
  chartDate: { fontSize: 10, color: '#94a3b8', marginTop: 4, whiteSpace: 'nowrap' as const },
  chartLegend: {
    display: 'flex',
    gap: 16,
    justifyContent: 'center',
    marginTop: 12,
    fontSize: 12,
    color: '#64748b',
  },
  legendDot: {
    display: 'inline-block',
    width: 10,
    height: 10,
    borderRadius: 3,
    marginRight: 4,
    verticalAlign: 'middle',
  },
  emptyChart: { textAlign: 'center' as const, color: '#94a3b8', padding: 40 },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: {
    textAlign: 'left' as const,
    padding: '10px 12px',
    fontSize: 12,
    fontWeight: 600,
    color: '#64748b',
    borderBottom: '1px solid #e2e8f0',
  },
  td: {
    padding: '10px 12px',
    fontSize: 14,
    borderBottom: '1px solid #f1f5f9',
    color: '#0f172a',
  },
};
