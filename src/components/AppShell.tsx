import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthProvider';
import { useClub, useCurrentClub } from '../club/ClubProvider';
import { publicLogoUrl } from '../lib/supabase';
import { LanguagePicker } from './LanguagePicker';
import { SyncStatus } from '../offline/SyncStatus';

const NAV = [
  { to: '/', key: 'home', icon: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { to: '/matches', key: 'matches', icon: 'M4 5h16v14H4zM12 5v14M4 12h16' },
  { to: '/stats', key: 'stats', icon: 'M4 20V11M10 20V5M16 20v-8M21 20H3' },
  { to: '/teams', key: 'teams', icon: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5M14 15c3 0 8 1 8 5' },
  { to: '/players', key: 'players', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9c0-4 3-6 7-6s7 2 7 6' },
  { to: '/members', key: 'members', icon: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z' },
  { to: '/settings', key: 'settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1V5h-4v2L9 8 7 7 5 11l2 1v2l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4-2-1z' },
] as const;
const ADMIN_ICON = 'M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.4l-4.8 2.5.9-5.4L4.2 7.7l5.4-.8z M5 21h14';

export function AppShell() {
  const { t } = useTranslation();
  const club = useCurrentClub();
  const { role, memberships, selectClub, isSuperadmin, virtual } = useClub();
  const { user, signOut, pendingBeforeSignOut } = useAuth();
  const logo = publicLogoUrl(club.logo_path);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="club-head">
          {logo ? (
            <img src={logo} alt="" className="club-logo-sm" />
          ) : (
            <span className="club-initial">{(club.short_name ?? club.name).charAt(0)}</span>
          )}
          <div className="club-head-text">
            <strong>{club.short_name ?? club.name}</strong>
            {role && <small>{virtual ? t('roles.superadmin') : t(`roles.${role}`)}</small>}
          </div>
        </div>

        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d={n.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              <span>{t(`nav.${n.key}`)}</span>
            </NavLink>
          ))}
          {isSuperadmin && (
            <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d={ADMIN_ICON} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              <span>{t('nav.admin')}</span>
            </NavLink>
          )}
        </nav>

        <div className="sidebar-foot">
          <LanguagePicker />
          {memberships.length > 1 && (
            <button className="btn-link light" onClick={() => selectClub(null)}>
              {t('nav.switchClub')}
            </button>
          )}
          <div className="user-line" title={user?.email ?? ''}>
            {user?.email}
          </div>
          <button
            className="btn-link light"
            onClick={async () => {
              // Les dades del dispositiu s'esborren: avisa si hi ha canvis sense enviar
              const pending = await pendingBeforeSignOut();
              if (pending > 0 && !window.confirm(t('auth.signOutPending', { count: pending }))) return;
              await signOut();
            }}
          >
            {t('auth.signOut')}
          </button>
        </div>
      </aside>
      <main className="main">
        <SyncStatus />
        <Outlet />
      </main>
    </div>
  );
}
