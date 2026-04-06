import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setUser } = useAuthStore();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/admin/login', { email, password });
      setUser({ ...data, companyId: data.companyId });
      navigate('/dashboard');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  const s: Record<string, React.CSSProperties> = {
    page: {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f1f5f9',
    },
    card: {
      background: '#fff',
      borderRadius: 12,
      padding: 40,
      width: 360,
      boxShadow: '0 4px 24px rgba(0,0,0,.08)',
    },
    title: { fontSize: 24, fontWeight: 700, marginBottom: 8 },
    sub: { color: '#64748b', fontSize: 14, marginBottom: 28 },
    label: { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 },
    input: {
      width: '100%',
      padding: '10px 12px',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      fontSize: 14,
      marginBottom: 16,
    },
    btn: {
      width: '100%',
      padding: '12px',
      background: '#2563eb',
      color: '#fff',
      border: 'none',
      borderRadius: 8,
      fontSize: 15,
      fontWeight: 600,
      cursor: 'pointer',
    },
    err: { color: '#ef4444', fontSize: 13, marginBottom: 12 },
  };

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.title}>Admin Login</div>
        <div style={s.sub}>Drivly Platform</div>
        {error && <div style={s.err}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={s.label}>Email</label>
          <input
            style={s.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <label style={s.label}>Password</label>
          <input
            style={s.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button style={s.btn} disabled={loading}>
            {loading ? 'Signing in\u2026' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
