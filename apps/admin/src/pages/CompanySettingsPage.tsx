import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';

interface Company {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  whatsappJid: string | null;
  isActive: boolean;
  settings: Record<string, unknown>;
}

export default function CompanySettingsPage() {
  const { isPlatformAdmin, getEffectiveCompanyId } = useAuthStore();
  const [company, setCompany] = useState<Company | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', logo: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const companyId = getEffectiveCompanyId();

  useEffect(() => {
    if (!companyId) return;
    api
      .get(`/companies/${companyId}`)
      .then((r) => {
        setCompany(r.data);
        setForm({ name: r.data.name, slug: r.data.slug, logo: r.data.logo || '' });
      })
      .catch(() => {});
  }, [companyId]);

  async function handleSave() {
    if (!companyId) return;
    setSaving(true);
    setMsg('');
    try {
      const payload: Record<string, unknown> = { name: form.name, slug: form.slug };
      if (form.logo) payload.logo = form.logo;
      else payload.logo = null;
      const { data } = await api.patch(`/companies/${companyId}`, payload);
      setCompany(data);
      setMsg('Settings saved');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setMsg(e?.response?.data?.error ?? 'Failed to save');
    }
    setSaving(false);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: Record<string, any> = {
    card: {
      background: '#fff',
      borderRadius: 12,
      padding: 24,
      boxShadow: '0 1px 8px rgba(0,0,0,.06)',
      maxWidth: 600,
    },
    label: { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: '#374151' },
    input: {
      width: '100%',
      padding: '10px 12px',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      fontSize: 14,
      marginBottom: 16,
    },
    btn: {
      padding: '10px 24px',
      background: '#2563eb',
      color: '#fff',
      border: 'none',
      borderRadius: 8,
      fontWeight: 600,
      cursor: 'pointer',
      fontSize: 14,
    },
    msg: {
      padding: '8px 16px',
      background: '#dcfce7',
      color: '#16a34a',
      borderRadius: 8,
      fontSize: 13,
      marginBottom: 16,
    },
    badge: (active: boolean): React.CSSProperties => ({
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 600,
      background: active ? '#dcfce7' : '#fee2e2',
      color: active ? '#16a34a' : '#dc2626',
    }),
    info: { fontSize: 13, color: '#64748b', marginBottom: 16 },
  };

  if (!companyId) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Company Settings</h1>
        <p style={{ color: '#64748b' }}>Please select a company first.</p>
      </div>
    );
  }

  if (!company) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Company Settings</h1>
        <p style={{ color: '#64748b' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Company Settings</h1>

      {msg && <div style={s.msg}>{msg}</div>}

      <div style={s.card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>General</h2>
          <span style={s.badge(company.isActive)}>{company.isActive ? 'Active' : 'Inactive'}</span>
        </div>

        <label style={s.label}>Company Name</label>
        <input
          style={s.input}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />

        <label style={s.label}>Slug (URL-friendly)</label>
        <input
          style={s.input}
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })}
        />

        <label style={s.label}>Logo URL</label>
        <input
          style={s.input}
          value={form.logo}
          onChange={(e) => setForm({ ...form, logo: e.target.value })}
          placeholder="https://..."
        />

        {form.logo && (
          <div style={{ marginBottom: 16 }}>
            <img
              src={form.logo}
              alt="Logo preview"
              style={{ maxHeight: 60, borderRadius: 8, border: '1px solid #e2e8f0' }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}

        <div style={s.info}>
          <strong>Company ID:</strong> {company.id}
          <br />
          <strong>WhatsApp JID:</strong> {company.whatsappJid || 'Not configured'}
        </div>

        {isPlatformAdmin() && (
          <button style={s.btn} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        )}
      </div>
    </div>
  );
}
