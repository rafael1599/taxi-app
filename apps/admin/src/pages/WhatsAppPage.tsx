import { useEffect, useState, useRef } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';

interface SessionInfo {
  companyId: string;
  companyName?: string;
  status: string;
  qrCode: string | null;
  lastError?: string | null;
}

export default function WhatsAppPage() {
  const { getEffectiveCompanyId } = useAuthStore();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const companyId = getEffectiveCompanyId();

  async function fetchStatus() {
    if (!companyId) return;
    try {
      const { data } = await api.get(`/whatsapp/sessions/${companyId}`);
      setSession(data);
    } catch {
      setSession({ companyId: companyId!, status: 'disconnected', qrCode: null });
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchStatus();
    // Poll for QR updates while connecting
    pollRef.current = setInterval(fetchStatus, 5000);
    return () => clearInterval(pollRef.current);
  }, [companyId]);

  async function handleStart() {
    if (!companyId) return;
    setStarting(true);
    try {
      await api.post('/whatsapp/sessions', { companyId });
      await fetchStatus();
    } catch {
      /* ignore */
    }
    setStarting(false);
  }

  async function handleStop() {
    if (!companyId) return;
    await api.delete(`/whatsapp/sessions/${companyId}`);
    await fetchStatus();
  }

  async function handleLogout() {
    if (!companyId) return;
    await api.post(`/whatsapp/sessions/${companyId}/logout`);
    await fetchStatus();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: Record<string, any> = {
    card: {
      background: '#fff',
      borderRadius: 12,
      padding: 24,
      boxShadow: '0 1px 8px rgba(0,0,0,.06)',
      maxWidth: 520,
    },
    qrContainer: {
      display: 'flex',
      justifyContent: 'center',
      padding: 20,
      background: '#fff',
      borderRadius: 12,
      border: '1px solid #e2e8f0',
      marginBottom: 16,
    },
    statusBadge: (connected: boolean): React.CSSProperties => ({
      display: 'inline-block',
      padding: '4px 14px',
      borderRadius: 99,
      fontSize: 13,
      fontWeight: 600,
      background: connected ? '#dcfce7' : '#fef3c7',
      color: connected ? '#16a34a' : '#d97706',
    }),
    btn: (primary: boolean): React.CSSProperties => ({
      padding: '10px 24px',
      borderRadius: 8,
      border: 'none',
      cursor: 'pointer',
      fontWeight: 600,
      fontSize: 14,
      background: primary ? '#16a34a' : '#f1f5f9',
      color: primary ? '#fff' : '#374151',
    }),
    btnDanger: {
      padding: '10px 24px',
      borderRadius: 8,
      border: 'none',
      cursor: 'pointer',
      fontWeight: 600,
      fontSize: 14,
      background: '#fee2e2',
      color: '#dc2626',
    },
    info: { fontSize: 13, color: '#64748b', lineHeight: 1.6, marginBottom: 16 },
    step: { fontSize: 13, color: '#374151', padding: '8px 0', borderBottom: '1px solid #f1f5f9' },
  };

  if (!companyId) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>WhatsApp</h1>
        <p style={{ color: '#64748b' }}>Please select a company first.</p>
      </div>
    );
  }

  const isConnected = session?.status === 'connected';
  const hasQr = session?.qrCode && session.status !== 'connected';

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>WhatsApp Integration</h1>

      <div style={s.card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Session Status</h2>
          {!loading && session && (
            <span style={s.statusBadge(isConnected)}>
              {isConnected
                ? 'Connected'
                : session.status === 'connecting'
                  ? 'Connecting...'
                  : 'Disconnected'}
            </span>
          )}
        </div>

        {loading && <p style={{ color: '#64748b' }}>Loading...</p>}

        {!loading && !isConnected && !hasQr && (
          <div>
            <div style={s.info}>
              <strong>Setup Instructions:</strong>
              <div style={s.step}>1. Click "Start Session" to begin pairing</div>
              <div style={s.step}>2. A QR code will appear below</div>
              <div style={s.step}>
                3. Open WhatsApp on your phone &rarr; Settings &rarr; Linked Devices
              </div>
              <div style={s.step}>4. Tap "Link a Device" and scan the QR code</div>
            </div>
            <button style={s.btn(true)} onClick={handleStart} disabled={starting}>
              {starting ? 'Starting...' : 'Start Session'}
            </button>
          </div>
        )}

        {hasQr && (
          <div>
            <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 12, color: '#374151' }}>
              Scan this QR code with WhatsApp on your phone:
            </p>
            <div style={s.qrContainer}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(session!.qrCode!)}`}
                alt="WhatsApp QR Code"
                style={{ width: 256, height: 256 }}
              />
            </div>
            <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
              QR code refreshes automatically. If expired, stop and restart the session.
            </p>
            <div style={{ marginTop: 12 }}>
              <button style={s.btnDanger} onClick={handleStop}>
                Stop Session
              </button>
            </div>
          </div>
        )}

        {isConnected && (
          <div>
            <p style={{ fontSize: 14, color: '#16a34a', marginBottom: 16 }}>
              WhatsApp is connected and receiving messages. The bot will automatically handle
              incoming booking requests.
            </p>
            {session?.lastError && (
              <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>
                Last error: {session.lastError}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={s.btnDanger} onClick={handleStop}>
                Disconnect
              </button>
              <button
                style={{ ...s.btnDanger, background: '#fef3c7', color: '#d97706' }}
                onClick={handleLogout}
              >
                Logout &amp; Reset
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
