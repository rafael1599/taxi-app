import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface PricingRules {
  id?: string;
  baseRatePerMile: string;
  minimumFare: string;
  perMinuteRate: string;
  currency: string;
}

interface ZoneMinimum {
  id: string;
  zoneName: string;
  minimumFare: string;
  boundaryPolygon: string | null;
}

interface FixedRoute {
  id: string;
  name: string | null;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  radiusMeters: number;
  fixedPrice: string;
}

const defaultRules: PricingRules = {
  baseRatePerMile: '3.00',
  minimumFare: '7.00',
  perMinuteRate: '0.20',
  currency: 'USD',
};

export default function PricingPage() {
  const [rules, setRules] = useState<PricingRules>(defaultRules);
  const [zones, setZones] = useState<ZoneMinimum[]>([]);
  const [routes, setRoutes] = useState<FixedRoute[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'rules' | 'zones' | 'routes'>('rules');

  // Zone form
  const [zoneForm, setZoneForm] = useState({ zoneName: '', minimumFare: '' });
  const [editingZone, setEditingZone] = useState<string | null>(null);

  // Route form
  const [routeForm, setRouteForm] = useState({
    name: '',
    originLat: '',
    originLng: '',
    destLat: '',
    destLng: '',
    radiusMeters: '500',
    fixedPrice: '',
  });
  const [editingRoute, setEditingRoute] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/pricing/rules')
      .then((r) => {
        if (r.data && r.data.id) setRules(r.data);
      })
      .catch(() => {});
    api
      .get('/pricing/zones')
      .then((r) => setZones(r.data))
      .catch(() => {});
    api
      .get('/pricing/fixed-routes')
      .then((r) => setRoutes(r.data))
      .catch(() => {});
  }, []);

  async function saveRules() {
    setSaving(true);
    setMsg('');
    try {
      const { data } = await api.put('/pricing/rules', {
        baseRatePerMile: rules.baseRatePerMile,
        minimumFare: rules.minimumFare,
        perMinuteRate: rules.perMinuteRate,
        currency: rules.currency,
      });
      setRules(data);
      setMsg('Pricing rules saved');
    } catch {
      setMsg('Failed to save rules');
    }
    setSaving(false);
  }

  async function saveZone() {
    try {
      if (editingZone) {
        const { data } = await api.patch(`/pricing/zones/${editingZone}`, zoneForm);
        setZones((prev) => prev.map((z) => (z.id === editingZone ? data : z)));
        setEditingZone(null);
      } else {
        const { data } = await api.post('/pricing/zones', zoneForm);
        setZones((prev) => [...prev, data]);
      }
      setZoneForm({ zoneName: '', minimumFare: '' });
    } catch {
      setMsg('Failed to save zone');
    }
  }

  async function deleteZone(id: string) {
    await api.delete(`/pricing/zones/${id}`);
    setZones((prev) => prev.filter((z) => z.id !== id));
  }

  async function saveRoute() {
    const payload = {
      name: routeForm.name || undefined,
      originLat: Number(routeForm.originLat),
      originLng: Number(routeForm.originLng),
      destLat: Number(routeForm.destLat),
      destLng: Number(routeForm.destLng),
      radiusMeters: Number(routeForm.radiusMeters),
      fixedPrice: routeForm.fixedPrice,
    };
    try {
      if (editingRoute) {
        const { data } = await api.patch(`/pricing/fixed-routes/${editingRoute}`, payload);
        setRoutes((prev) => prev.map((r) => (r.id === editingRoute ? data : r)));
        setEditingRoute(null);
      } else {
        const { data } = await api.post('/pricing/fixed-routes', payload);
        setRoutes((prev) => [...prev, data]);
      }
      setRouteForm({
        name: '',
        originLat: '',
        originLng: '',
        destLat: '',
        destLng: '',
        radiusMeters: '500',
        fixedPrice: '',
      });
    } catch {
      setMsg('Failed to save route');
    }
  }

  async function deleteRoute(id: string) {
    await api.delete(`/pricing/fixed-routes/${id}`);
    setRoutes((prev) => prev.filter((r) => r.id !== id));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const st: Record<string, any> = {
    card: {
      background: '#fff',
      borderRadius: 12,
      padding: 24,
      boxShadow: '0 1px 8px rgba(0,0,0,.06)',
      marginBottom: 20,
    },
    tabs: { display: 'flex', gap: 4, marginBottom: 20 },
    tab: (active: boolean): React.CSSProperties => ({
      padding: '8px 20px',
      borderRadius: 8,
      border: 'none',
      cursor: 'pointer',
      fontSize: 14,
      fontWeight: 600,
      background: active ? '#2563eb' : '#f1f5f9',
      color: active ? '#fff' : '#374151',
    }),
    label: { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: '#374151' },
    input: {
      width: '100%',
      padding: '8px 12px',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      fontSize: 14,
      marginBottom: 12,
    },
    inputSm: {
      padding: '8px 12px',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      fontSize: 14,
      width: 120,
    },
    btn: (primary: boolean): React.CSSProperties => ({
      padding: '8px 20px',
      borderRadius: 8,
      border: 'none',
      cursor: 'pointer',
      fontWeight: 600,
      fontSize: 14,
      background: primary ? '#2563eb' : '#f1f5f9',
      color: primary ? '#fff' : '#374151',
    }),
    btnDanger: {
      padding: '4px 10px',
      borderRadius: 6,
      border: 'none',
      cursor: 'pointer',
      fontSize: 12,
      background: '#fee2e2',
      color: '#dc2626',
    },
    btnEdit: {
      padding: '4px 10px',
      borderRadius: 6,
      border: 'none',
      cursor: 'pointer',
      fontSize: 12,
      background: '#dbeafe',
      color: '#2563eb',
      marginRight: 4,
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse' as const,
      background: '#fff',
      borderRadius: 12,
      overflow: 'hidden',
    },
    th: {
      textAlign: 'left' as const,
      padding: '10px 12px',
      fontSize: 12,
      fontWeight: 600,
      color: '#64748b',
      background: '#f8fafc',
      borderBottom: '1px solid #e2e8f0',
    },
    td: { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #f1f5f9' },
    row: { display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' as const },
    msg: {
      padding: '8px 16px',
      background: '#dcfce7',
      color: '#16a34a',
      borderRadius: 8,
      fontSize: 13,
      marginBottom: 12,
    },
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Pricing Management</h1>

      <div style={st.tabs}>
        <button style={st.tab(tab === 'rules')} onClick={() => setTab('rules')}>
          Base Rates
        </button>
        <button style={st.tab(tab === 'zones')} onClick={() => setTab('zones')}>
          Zone Minimums
        </button>
        <button style={st.tab(tab === 'routes')} onClick={() => setTab('routes')}>
          Fixed Routes
        </button>
      </div>

      {msg && <div style={st.msg}>{msg}</div>}

      {/* Base Rates Tab */}
      {tab === 'rules' && (
        <div style={st.card}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Base Pricing Rules</h2>
          <div style={st.row}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={st.label}>Base Rate per Mile ($)</label>
              <input
                style={st.input}
                value={rules.baseRatePerMile}
                onChange={(e) => setRules({ ...rules, baseRatePerMile: e.target.value })}
              />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={st.label}>Minimum Fare ($)</label>
              <input
                style={st.input}
                value={rules.minimumFare}
                onChange={(e) => setRules({ ...rules, minimumFare: e.target.value })}
              />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={st.label}>Per Minute Rate ($)</label>
              <input
                style={st.input}
                value={rules.perMinuteRate}
                onChange={(e) => setRules({ ...rules, perMinuteRate: e.target.value })}
              />
            </div>
          </div>
          <button style={st.btn(true)} onClick={saveRules} disabled={saving}>
            {saving ? 'Saving...' : 'Save Rules'}
          </button>
        </div>
      )}

      {/* Zone Minimums Tab */}
      {tab === 'zones' && (
        <div style={st.card}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Zone Minimums</h2>
          <div style={{ ...st.row, alignItems: 'flex-end' }}>
            <div>
              <label style={st.label}>Zone Name</label>
              <input
                style={st.inputSm}
                value={zoneForm.zoneName}
                onChange={(e) => setZoneForm({ ...zoneForm, zoneName: e.target.value })}
                placeholder="e.g. Downtown"
              />
            </div>
            <div>
              <label style={st.label}>Minimum Fare ($)</label>
              <input
                style={st.inputSm}
                value={zoneForm.minimumFare}
                onChange={(e) => setZoneForm({ ...zoneForm, minimumFare: e.target.value })}
                placeholder="10.00"
              />
            </div>
            <button
              style={st.btn(true)}
              onClick={saveZone}
              disabled={!zoneForm.zoneName || !zoneForm.minimumFare}
            >
              {editingZone ? 'Update Zone' : 'Add Zone'}
            </button>
            {editingZone && (
              <button
                style={st.btn(false)}
                onClick={() => {
                  setEditingZone(null);
                  setZoneForm({ zoneName: '', minimumFare: '' });
                }}
              >
                Cancel
              </button>
            )}
          </div>
          {zones.length > 0 && (
            <table style={{ ...st.table, marginTop: 16 }}>
              <thead>
                <tr>
                  <th style={st.th}>Zone Name</th>
                  <th style={st.th}>Min Fare</th>
                  <th style={st.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.id}>
                    <td style={st.td}>{z.zoneName}</td>
                    <td style={st.td}>${z.minimumFare}</td>
                    <td style={st.td}>
                      <button
                        style={st.btnEdit}
                        onClick={() => {
                          setEditingZone(z.id);
                          setZoneForm({ zoneName: z.zoneName, minimumFare: z.minimumFare });
                        }}
                      >
                        Edit
                      </button>
                      <button style={st.btnDanger} onClick={() => deleteZone(z.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {zones.length === 0 && (
            <p style={{ color: '#94a3b8', marginTop: 12, fontSize: 13 }}>
              No zone minimums configured
            </p>
          )}
        </div>
      )}

      {/* Fixed Routes Tab */}
      {tab === 'routes' && (
        <div style={st.card}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Fixed Routes</h2>
          <div style={st.row}>
            <div style={{ flex: 2, minWidth: 180 }}>
              <label style={st.label}>Route Name</label>
              <input
                style={st.input}
                value={routeForm.name}
                onChange={(e) => setRouteForm({ ...routeForm, name: e.target.value })}
                placeholder="e.g. Airport to Downtown"
              />
            </div>
            <div style={{ flex: 1, minWidth: 100 }}>
              <label style={st.label}>Fixed Price ($)</label>
              <input
                style={st.input}
                value={routeForm.fixedPrice}
                onChange={(e) => setRouteForm({ ...routeForm, fixedPrice: e.target.value })}
                placeholder="25.00"
              />
            </div>
            <div style={{ flex: 1, minWidth: 100 }}>
              <label style={st.label}>Radius (m)</label>
              <input
                style={st.input}
                value={routeForm.radiusMeters}
                onChange={(e) => setRouteForm({ ...routeForm, radiusMeters: e.target.value })}
              />
            </div>
          </div>
          <div style={st.row}>
            <div style={{ flex: 1, minWidth: 100 }}>
              <label style={st.label}>Origin Lat</label>
              <input
                style={st.input}
                value={routeForm.originLat}
                onChange={(e) => setRouteForm({ ...routeForm, originLat: e.target.value })}
                placeholder="41.15"
              />
            </div>
            <div style={{ flex: 1, minWidth: 100 }}>
              <label style={st.label}>Origin Lng</label>
              <input
                style={st.input}
                value={routeForm.originLng}
                onChange={(e) => setRouteForm({ ...routeForm, originLng: e.target.value })}
                placeholder="-74.01"
              />
            </div>
            <div style={{ flex: 1, minWidth: 100 }}>
              <label style={st.label}>Dest Lat</label>
              <input
                style={st.input}
                value={routeForm.destLat}
                onChange={(e) => setRouteForm({ ...routeForm, destLat: e.target.value })}
                placeholder="41.10"
              />
            </div>
            <div style={{ flex: 1, minWidth: 100 }}>
              <label style={st.label}>Dest Lng</label>
              <input
                style={st.input}
                value={routeForm.destLng}
                onChange={(e) => setRouteForm({ ...routeForm, destLng: e.target.value })}
                placeholder="-74.05"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              style={st.btn(true)}
              onClick={saveRoute}
              disabled={!routeForm.fixedPrice || !routeForm.originLat || !routeForm.destLat}
            >
              {editingRoute ? 'Update Route' : 'Add Route'}
            </button>
            {editingRoute && (
              <button
                style={st.btn(false)}
                onClick={() => {
                  setEditingRoute(null);
                  setRouteForm({
                    name: '',
                    originLat: '',
                    originLng: '',
                    destLat: '',
                    destLng: '',
                    radiusMeters: '500',
                    fixedPrice: '',
                  });
                }}
              >
                Cancel
              </button>
            )}
          </div>

          {routes.length > 0 && (
            <table style={{ ...st.table, marginTop: 16 }}>
              <thead>
                <tr>
                  <th style={st.th}>Name</th>
                  <th style={st.th}>Origin</th>
                  <th style={st.th}>Destination</th>
                  <th style={st.th}>Price</th>
                  <th style={st.th}>Radius</th>
                  <th style={st.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.id}>
                    <td style={st.td}>{r.name || '\u2014'}</td>
                    <td style={st.td}>
                      {r.originLat.toFixed(4)}, {r.originLng.toFixed(4)}
                    </td>
                    <td style={st.td}>
                      {r.destLat.toFixed(4)}, {r.destLng.toFixed(4)}
                    </td>
                    <td style={st.td}>${r.fixedPrice}</td>
                    <td style={st.td}>{r.radiusMeters}m</td>
                    <td style={st.td}>
                      <button
                        style={st.btnEdit}
                        onClick={() => {
                          setEditingRoute(r.id);
                          setRouteForm({
                            name: r.name || '',
                            originLat: String(r.originLat),
                            originLng: String(r.originLng),
                            destLat: String(r.destLat),
                            destLng: String(r.destLng),
                            radiusMeters: String(r.radiusMeters),
                            fixedPrice: r.fixedPrice,
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button style={st.btnDanger} onClick={() => deleteRoute(r.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {routes.length === 0 && (
            <p style={{ color: '#94a3b8', marginTop: 12, fontSize: 13 }}>
              No fixed routes configured
            </p>
          )}
        </div>
      )}
    </div>
  );
}
