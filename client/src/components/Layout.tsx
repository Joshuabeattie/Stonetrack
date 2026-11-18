// The office layout: navigation rail on the left (a top bar on small screens) and the page.
import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { ROLE_LABELS, type Role } from '../../../shared/catalog'
import { useAuth } from '../auth'
import { Icon } from './Icon'

const STAFF: Role[] = ['admin', 'manager']

const NAV: { to: string; label: string; roles: Role[]; match?: (path: string) => boolean }[] = [
  { to: '/dashboard', label: 'Dashboard', roles: STAFF },
  { to: '/jobs', label: 'Jobs', roles: STAFF, match: (p) => p === '/jobs' || (/^\/jobs\/\d+/.test(p)) },
  { to: '/jobs/new', label: 'New job', roles: STAFF },
  { to: '/capacity', label: 'Capacity', roles: STAFF },
  { to: '/slabs', label: 'Slabs and stock', roles: STAFF },
  { to: '/kiosk', label: 'Kiosk', roles: ['admin', 'manager', 'kiosk'] },
  { to: '/integrations', label: 'Integrations', roles: ['admin'] },
  { to: '/users', label: 'Users', roles: ['admin'] },
]

export function Layout() {
  const { user, logout, meta } = useAuth()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  if (!user) return null

  return (
    <div className={`shell ${menuOpen ? 'menu-open' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="rail">
        <div className="rail-top">
          <NavLink to="/dashboard" className="brand" onClick={() => setMenuOpen(false)}>
            <span className="brand-mark" aria-hidden="true" />
            StoneTrack
          </NavLink>
          <button
            type="button"
            className="icon-button rail-menu"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? 'close' : 'menu'} />
            <span className="visually-hidden">Menu</span>
          </button>
        </div>
        <nav id="main-nav" className="rail-nav" aria-label="Main">
          {NAV.filter((item) => item.roles.includes(user.role)).map((item) => {
            const active = item.match ? item.match(pathname) : pathname === item.to
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`rail-link ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </NavLink>
            )
          })}
        </nav>
        <div className="rail-foot">
          <p className="rail-user">
            {user.displayName}
            <span>{ROLE_LABELS[user.role]}</span>
          </p>
          <button type="button" className="rail-signout" onClick={() => void logout()}>
            Sign out
          </button>
          {meta?.demoMode && <p className="rail-note">Demo with fictional data. {meta.factoryName}.</p>}
        </div>
      </header>
      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}

/** Page heading row: title on the left, actions on the right. */
export function PageHeader({ title, children, sub }: { title: string; children?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  )
}
