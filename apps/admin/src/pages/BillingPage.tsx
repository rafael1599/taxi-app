import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface StripeStatus {
  connected: boolean;
  accountId?: string;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
}

interface RevenueReport {
  totalFares: string;
  totalCommission: string;
  totalDriverPay: string;
  rideCount: number;
}

interface DriverBreakdown {
  driverId: string;
  driverName: string;
  totalFares: string;
  totalEarnings: string;
  totalCommission: string;
  rideCount: number;
}

interface Commission {
  id: string;
  rideId: string;
  driverId: string;
  fareAmount: string;
  commissionPercent: string;
  commissionAmount: string;
  driverEarnings: string;
  status: string;
  stripeTransferId: string | null;
  createdAt: string;
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1000 },
  tabs: { display: 'flex', gap: 8, marginBottom: 24 },
  tab: {
    padding: '8px 16px',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    background: '#f8fafc',
    cursor: 'pointer',
    fontSize: 14,
  },
  tabActive: {
    background: '#1e293b',
    color: '#f8fafc',
    border: '1px solid #1e293b',
  },
  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 20,
    marginBottom: 16,
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 },
  stat: {
    background: '#f1f5f9',
    borderRadius: 8,
    padding: 16,
    textAlign: 'center' as const,
  },
  statValue: { fontSize: 28, fontWeight: 700, color: '#1e293b' },
  statLabel: { fontSize: 12, color: '#64748b', marginTop: 4 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 14 },
  th: {
    textAlign: 'left' as const,
    padding: '10px 12px',
    borderBottom: '2px solid #e2e8f0',
    fontWeight: 600,
    color: '#475569',
    fontSize: 12,
    textTransform: 'uppercase' as const,
  },
  td: { padding: '10px 12px', borderBottom: '1px solid #f1f5f9' },
  btn: {
    padding: '8px 16px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
  },
  btnPrimary: { background: '#2563eb', color: '#fff' },
  btnSuccess: { background: '#16a34a', color: '#fff' },
  btnDanger: { background: '#dc2626', color: '#fff' },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
  },
  input: {
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 14,
    width: 120,
  },
  row: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 },
};

function fmt(amount: string | number) {
  return `$${parseFloat(String(amount)).toFixed(2)}`;
}

function statusBadge(status: string) {
  const colors: Record<string, { bg: string; color: string }> = {
    active: { bg: '#dcfce7', color: '#16a34a' },
    trialing: { bg: '#e0f2fe', color: '#0284c7' },
    past_due: { bg: '#fef3c7', color: '#d97706' },
    canceled: { bg: '#fee2e2', color: '#dc2626' },
    unpaid: { bg: '#fee2e2', color: '#dc2626' },
    pending: { bg: '#fef3c7', color: '#d97706' },
    transferred: { bg: '#dcfce7', color: '#16a34a' },
    failed: { bg: '#fee2e2', color: '#dc2626' },
  };
  const c = colors[status] || { bg: '#f1f5f9', color: '#475569' };
  return (
    <span style={{ ...s.badge, background: c.bg, color: c.color }}>{status.replace('_', ' ')}</span>
  );
}

export default function BillingPage() {
  const [tab, setTab] = useState<'overview' | 'commissions' | 'reports'>('overview');
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null);
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [driverBreakdown, setDriverBreakdown] = useState<DriverBreakdown[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  // Date range for reports (default: current month)
  const now = new Date();
  const [fromDate, setFromDate] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
  );
  const [toDate, setToDate] = useState(now.toISOString().slice(0, 10));

  // Commission percent edit
  const [commPct, setCommPct] = useState('');
  const [savingPct, setSavingPct] = useState(false);

  useEffect(() => {
    loadStripeStatus();
    loadCommissions();
  }, []);

  useEffect(() => {
    if (tab === 'reports') loadReports();
  }, [tab, fromDate, toDate]);

  async function loadStripeStatus() {
    try {
      const r = await api.get('/billing/company/status');
      setStripeStatus(r.data);
    } catch {
      setStripeStatus({ connected: false });
    }
  }

  async function loadCommissions() {
    try {
      const r = await api.get('/billing/commissions?limit=50');
      setCommissions(r.data);
    } catch {
      /* ignore */
    }
  }

  async function loadReports() {
    setLoading(true);
    try {
      const [revRes, driverRes] = await Promise.all([
        api.get(`/billing/reports/revenue?from=${fromDate}&to=${toDate}`),
        api.get(`/billing/reports/drivers?from=${fromDate}&to=${toDate}`),
      ]);
      setRevenue(revRes.data);
      setDriverBreakdown(driverRes.data);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }

  async function setupStripeConnect() {
    setLoading(true);
    try {
      await api.post('/billing/company/connect');
      const r = await api.post('/billing/company/onboarding-link', {
        returnUrl: window.location.href,
      });
      window.open(r.data.url, '_blank');
      await loadStripeStatus();
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : 'Failed to setup Stripe');
    }
    setLoading(false);
  }

  async function saveCommissionPct() {
    setSavingPct(true);
    try {
      await api.patch('/billing/company/commission', {
        commissionPercent: parseFloat(commPct),
      });
      setMsg('Commission updated');
      setTimeout(() => setMsg(''), 3000);
    } catch {
      setMsg('Failed to update commission');
    }
    setSavingPct(false);
  }

  return (
    <div style={s.page}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Billing & Revenue</h1>

      {msg && (
        <div
          style={{
            padding: '8px 16px',
            background: '#e0f2fe',
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          {msg}
        </div>
      )}

      <div style={s.tabs}>
        {(['overview', 'commissions', 'reports'] as const).map((t) => (
          <button
            key={t}
            style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ──────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <>
          <div style={s.card}>
            <h3 style={{ marginBottom: 12 }}>Stripe Connect</h3>
            {stripeStatus?.connected ? (
              <div>
                <div style={s.row}>
                  <span>Account: {stripeStatus.accountId}</span>
                  {statusBadge(stripeStatus.chargesEnabled ? 'active' : 'pending')}
                </div>
                <div style={s.row}>
                  <span>Charges: {stripeStatus.chargesEnabled ? 'Enabled' : 'Disabled'}</span>
                  <span>Payouts: {stripeStatus.payoutsEnabled ? 'Enabled' : 'Disabled'}</span>
                </div>
                {!stripeStatus.detailsSubmitted && (
                  <button
                    style={{ ...s.btn, ...s.btnPrimary }}
                    onClick={setupStripeConnect}
                    disabled={loading}
                  >
                    Complete Onboarding
                  </button>
                )}
              </div>
            ) : (
              <div>
                <p style={{ color: '#64748b', marginBottom: 12 }}>
                  Connect your Stripe account to accept payments and pay drivers.
                </p>
                <button
                  style={{ ...s.btn, ...s.btnPrimary }}
                  onClick={setupStripeConnect}
                  disabled={loading}
                >
                  {loading ? 'Setting up...' : 'Setup Stripe Connect'}
                </button>
              </div>
            )}
          </div>

          <div style={s.card}>
            <h3 style={{ marginBottom: 12 }}>Commission Rate</h3>
            <div style={s.row}>
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                style={s.input}
                value={commPct}
                onChange={(e) => setCommPct(e.target.value)}
                placeholder="e.g. 10"
              />
              <span>%</span>
              <button
                style={{ ...s.btn, ...s.btnPrimary }}
                onClick={saveCommissionPct}
                disabled={savingPct || !commPct}
              >
                {savingPct ? 'Saving...' : 'Update'}
              </button>
            </div>
            <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
              Percentage of each ride fare retained as platform commission.
            </p>
          </div>
        </>
      )}

      {/* ── Commissions Tab ───────────────────────────────────────────── */}
      {tab === 'commissions' && (
        <div style={s.card}>
          <h3 style={{ marginBottom: 16 }}>Recent Commissions</h3>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Date</th>
                <th style={s.th}>Fare</th>
                <th style={s.th}>Commission</th>
                <th style={s.th}>Driver Pay</th>
                <th style={s.th}>Rate</th>
                <th style={s.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {commissions.length === 0 ? (
                <tr>
                  <td style={s.td} colSpan={6}>
                    No commissions yet
                  </td>
                </tr>
              ) : (
                commissions.map((c) => (
                  <tr key={c.id}>
                    <td style={s.td}>{new Date(c.createdAt).toLocaleDateString()}</td>
                    <td style={s.td}>{fmt(c.fareAmount)}</td>
                    <td style={s.td}>{fmt(c.commissionAmount)}</td>
                    <td style={s.td}>{fmt(c.driverEarnings)}</td>
                    <td style={s.td}>{c.commissionPercent}%</td>
                    <td style={s.td}>{statusBadge(c.status)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Reports Tab ───────────────────────────────────────────────── */}
      {tab === 'reports' && (
        <>
          <div style={s.card}>
            <div style={s.row}>
              <label>
                From:{' '}
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  style={s.input}
                />
              </label>
              <label>
                To:{' '}
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  style={s.input}
                />
              </label>
              <button
                style={{ ...s.btn, ...s.btnPrimary }}
                onClick={loadReports}
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>

          {revenue && (
            <div style={{ ...s.card, ...s.grid }}>
              <div style={s.stat}>
                <div style={s.statValue}>{fmt(revenue.totalFares)}</div>
                <div style={s.statLabel}>Total Fares</div>
              </div>
              <div style={s.stat}>
                <div style={s.statValue}>{fmt(revenue.totalCommission)}</div>
                <div style={s.statLabel}>Platform Revenue</div>
              </div>
              <div style={s.stat}>
                <div style={s.statValue}>{fmt(revenue.totalDriverPay)}</div>
                <div style={s.statLabel}>Driver Payouts</div>
              </div>
              <div style={s.stat}>
                <div style={s.statValue}>{revenue.rideCount}</div>
                <div style={s.statLabel}>Rides</div>
              </div>
            </div>
          )}

          <div style={s.card}>
            <h3 style={{ marginBottom: 16 }}>Driver Breakdown</h3>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Driver</th>
                  <th style={s.th}>Rides</th>
                  <th style={s.th}>Total Fares</th>
                  <th style={s.th}>Commission</th>
                  <th style={s.th}>Earnings</th>
                </tr>
              </thead>
              <tbody>
                {driverBreakdown.length === 0 ? (
                  <tr>
                    <td style={s.td} colSpan={5}>
                      No data for this period
                    </td>
                  </tr>
                ) : (
                  driverBreakdown.map((d) => (
                    <tr key={d.driverId}>
                      <td style={s.td}>{d.driverName}</td>
                      <td style={s.td}>{d.rideCount}</td>
                      <td style={s.td}>{fmt(d.totalFares)}</td>
                      <td style={s.td}>{fmt(d.totalCommission)}</td>
                      <td style={s.td}>{fmt(d.totalEarnings)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
