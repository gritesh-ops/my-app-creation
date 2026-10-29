import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { Button } from './ui.js';

export default function Layout() {
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  const name = profile?.full_name || user?.email || 'Student';

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand__mark">TP</span>
          TeamPilot AI
        </NavLink>
        <div className="topbar__spacer" />
        <span className="topbar__user" title={user?.email ?? ''}>
          {name}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await signOut();
            navigate('/login', { replace: true });
          }}
        >
          Sign out
        </Button>
      </header>

      <div className="layout">
        <nav className="sidebar" aria-label="Main navigation">
          <span className="sidebar__label">Workspace</span>
          <NavLink to="/" end className={({ isActive }) => `navlink ${isActive ? 'navlink--active' : ''}`}>
            📁 My projects
          </NavLink>
          <NavLink to="/projects/new" className={({ isActive }) => `navlink ${isActive ? 'navlink--active' : ''}`}>
            ✨ New project
          </NavLink>
          <span className="sidebar__label">How it works</span>
          <p className="small muted" style={{ padding: '2px 11px' }}>
            Every project is private to its accepted members. AI only proposes a plan — nothing is saved until you
            approve it.
          </p>
        </nav>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
