import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/map', label: 'Live Map' },
  { to: '/drivers', label: 'Drivers' },
  { to: '/rides', label: 'Rides' },
];

const s: Record<string, React.CSSProperties> = {
  shell: { display: 'flex', minHeight: '100vh' },
  sidebar: { width: 220, background: '#1e293b', color: '#f8fafc', display: 'flex', flexDirection: 'column', padding: '24px 0' },
  logo: { fontSize: 18, fontWeight: 700, padding: '0 20px 24px', borderBottom: '1px solid #334155' },
  nav: { flex: 1, padding: '16px 0' },
  link: { display: 'block', padding: '10px 20px', color: '#94a3b8', textDecoration: 'none', fontSize: 14 },
  activeLink: { color: '#f8fafc', background: '#334155', borderRadius: 6 },
  footer: { padding: '16px 20px', borderTop: '1px solid #334155', fontSize: 13, color: '#64748b' },
  logoutBtn: { background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0, fontSize: 13, marginTop: 6 },
  main: { flex: 1, padding: 32, overflowY: 'auto' as const },
};

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div style={s.shell}>
      <aside style={s.sidebar}>
        <div style={s.logo}>Rockland Taxi</div>
        <nav style={s.nav}>
          {navItems.map((item) => (
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
          <div style={{ color: '#475569', textTransform: 'capitalize' }}>{user?.adminRole?.replace('_', ' ')}</div>
          <button style={s.logoutBtn} onClick={handleLogout}>Logout</button>
        </div>
      </aside>
      <main style={s.main}>
        <Outlet />
      </main>
    </div>
  );
}
