import { useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../api/client';

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/map', label: 'Live Map' },
  { to: '/drivers', label: 'Drivers' },
  { to: '/rides', label: 'Rides' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/settings', label: 'Company' },
  { to: '/whatsapp', label: 'WhatsApp' },
];

const s: Record<string, React.CSSProperties> = {
  shell: { display: 'flex', minHeight: '100vh' },
  sidebar: {
    width: 220,
    background: '#1e293b',
    color: '#f8fafc',
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 0',
  },
  logo: {
    fontSize: 18,
    fontWeight: 700,
    padding: '0 20px 24px',
    borderBottom: '1px solid #334155',
  },
  nav: { flex: 1, padding: '16px 0' },
  link: {
    display: 'block',
    padding: '10px 20px',
    color: '#94a3b8',
    textDecoration: 'none',
    fontSize: 14,
  },
  activeLink: { color: '#f8fafc', background: '#334155', borderRadius: 6 },
  footer: { padding: '16px 20px', borderTop: '1px solid #334155', fontSize: 13, color: '#64748b' },
  logoutBtn: {
    background: 'none',
    border: 'none',
    color: '#ef4444',
    cursor: 'pointer',
    padding: 0,
    fontSize: 13,
    marginTop: 6,
  },
  main: { flex: 1, padding: 32, overflowY: 'auto' as const },
  companySelector: {
    margin: '0 12px 16px',
    padding: '8px 10px',
    border: '1px solid #475569',
    borderRadius: 8,
    background: '#334155',
    color: '#f8fafc',
    fontSize: 13,
    width: 'calc(100% - 24px)',
  },
  sectionLabel: {
    padding: '8px 20px 4px',
    fontSize: 11,
    fontWeight: 600,
    color: '#475569',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
};

export default function Layout() {
  const {
    user,
    logout,
    companies,
    selectedCompanyId,
    setCompanies,
    setSelectedCompanyId,
    isPlatformAdmin,
  } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (isPlatformAdmin()) {
      api
        .get('/companies')
        .then((r) => {
          setCompanies(r.data);
          if (!selectedCompanyId && r.data.length > 0) {
            setSelectedCompanyId(r.data[0].id);
          }
        })
        .catch(() => {
          /* ignore if not platform admin */
        });
    }
  }, []);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const companyName = isPlatformAdmin()
    ? (companies.find((c) => c.id === selectedCompanyId)?.name ?? 'Select Company')
    : 'Company Admin';

  return (
    <div style={s.shell}>
      <aside style={s.sidebar}>
        <div style={s.logo}>Taxi Dispatch</div>

        {isPlatformAdmin() && companies.length > 0 && (
          <select
            style={s.companySelector}
            value={selectedCompanyId ?? ''}
            onChange={(e) => {
              setSelectedCompanyId(e.target.value);
              window.location.reload();
            }}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        <nav style={s.nav}>
          <div style={s.sectionLabel}>Operations</div>
          {navItems.slice(0, 4).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({ ...s.link, ...(isActive ? s.activeLink : {}) })}
            >
              {item.label}
            </NavLink>
          ))}

          <div style={{ ...s.sectionLabel, marginTop: 12 }}>Configuration</div>
          {navItems.slice(4).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({ ...s.link, ...(isActive ? s.activeLink : {}) })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div style={s.footer}>
          <div>{user?.fullName}</div>
          <div style={{ color: '#475569', textTransform: 'capitalize' }}>
            {user?.adminRole?.replace('_', ' ')}
          </div>
          {isPlatformAdmin() && (
            <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>{companyName}</div>
          )}
          <button style={s.logoutBtn} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </aside>
      <main style={s.main}>
        <Outlet />
      </main>
    </div>
  );
}
