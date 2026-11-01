import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  Boxes,
  Building2,
  ChevronLeft,
  ClipboardCheck,
  ClipboardList,
  Cog,
  FileWarning,
  GitBranch,
  LayoutDashboard,
  Menu,
  Package,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useApi } from '../lib/useApi'
import { cx } from './ui'
import { SearchPalette } from './SearchPalette'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  badgeKey?: 'open_capas' | 'severe_exceptions'
}

const GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Operate',
    items: [
      { to: '/', label: 'Overview', icon: <LayoutDashboard size={17} /> },
      { to: '/products', label: 'Products & BOM', icon: <Package size={17} /> },
      { to: '/suppliers', label: 'Suppliers', icon: <Building2 size={17} /> },
      { to: '/lots', label: 'Material Lots', icon: <Boxes size={17} /> },
      { to: '/orders', label: 'Production Orders', icon: <ClipboardList size={17} /> },
      { to: '/machines', label: 'Machines & Processes', icon: <Cog size={17} /> },
    ],
  },
  {
    label: 'Quality',
    items: [
      { to: '/inspections', label: 'Inspections', icon: <ClipboardCheck size={17} /> },
      { to: '/defects', label: 'Defect Management', icon: <FileWarning size={17} /> },
      { to: '/explorer', label: 'Traceability Explorer', icon: <GitBranch size={17} /> },
      { to: '/capa', label: 'Corrective Actions', icon: <ShieldCheck size={17} />, badgeKey: 'open_capas' },
    ],
  },
  {
    label: 'Insight',
    items: [
      { to: '/analytics', label: 'Analytics & Reports', icon: <BarChart3 size={17} /> },
      { to: '/quality', label: 'Data Quality', icon: <ShieldAlert size={17} />, badgeKey: 'severe_exceptions' },
    ],
  },
  {
    label: 'System',
    items: [{ to: '/settings', label: 'Settings', icon: <Settings size={17} /> }],
  },
]

const TITLES: Record<string, string> = {
  products: 'Products & BOM',
  suppliers: 'Suppliers',
  lots: 'Material Lots',
  orders: 'Production Orders',
  machines: 'Machines & Processes',
  inspections: 'Inspections',
  defects: 'Defect Management',
  explorer: 'Traceability Explorer',
  capa: 'Corrective Actions',
  analytics: 'Analytics & Reports',
  quality: 'Data Quality & Exceptions',
  settings: 'Settings',
}

function useOutside<T extends HTMLElement>(onOutside: () => void, active: boolean) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!active) return
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onOutside, active])
  return ref
}

export function Shell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { data: pulse } = useApi<Record<string, number>>('/api/pulse')
  const { data: meta } = useApi<Record<string, any>>('/api/meta')
  const { data: settings } = useApi<Record<string, any>>('/api/settings')
  const preferences = settings?.preferences ?? {}
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('traceiq.sidebar') === 'collapsed')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const bellRef = useOutside<HTMLDivElement>(() => setBellOpen(false), bellOpen)
  const profileRef = useOutside<HTMLDivElement>(() => setProfileOpen(false), profileOpen)

  useEffect(() => {
    localStorage.setItem('traceiq.sidebar', collapsed ? 'collapsed' : 'expanded')
  }, [collapsed])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!mobileOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', handler)
    }
  }, [mobileOpen])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const segments = location.pathname.split('/').filter(Boolean)
  const crumbs = useMemo(() => {
    const list: Array<{ label: string; to: string }> = [{ label: 'TraceIQ', to: '/' }]
    if (segments.length === 0) return [...list, { label: 'Overview', to: '/' }]
    list.push({ label: TITLES[segments[0]] ?? segments[0], to: `/${segments[0]}` })
    if (segments[1]) list.push({ label: decodeURIComponent(segments[1]), to: location.pathname })
    return list
  }, [segments, location.pathname])

  const alerts = useMemo(() => {
    if (!pulse) return []
    const items: Array<{ title: string; detail: string; href: string; tone: string }> = []
    const showCritical = preferences.notify_critical !== false
    const showOverdue = preferences.notify_overdue !== false
    if (pulse.gate_violations && showCritical)
      items.push({
        title: `${pulse.gate_violations} CAPA closures bypass verification`,
        detail: 'Closure gate failed — reopen and verify effectiveness.',
        href: '/quality',
        tone: 'danger',
      })
    if (pulse.overdue_capas && showOverdue)
      items.push({
        title: `${pulse.overdue_capas} corrective actions overdue`,
        detail: 'Past the committed due date and still open.',
        href: '/capa?overdue=1',
        tone: 'warning',
      })
    if (pulse.severe_exceptions && showCritical)
      items.push({
        title: `${pulse.severe_exceptions} high-severity data exceptions`,
        detail: 'Broken trace links or inconsistent records.',
        href: '/quality',
        tone: 'warning',
      })
    if (pulse.drift_machines)
      items.push({
        title: `${pulse.drift_machines} machines in suspected drift`,
        detail: 'Weekly scrap rate is at least 2× the machine baseline.',
        href: '/machines?drift=1',
        tone: 'info',
      })
    if (pulse.pending_verification)
      items.push({
        title: `${pulse.pending_verification} CAPAs awaiting verification`,
        detail: 'Effectiveness inspection required before closure.',
        href: '/capa?status=pending_verification',
        tone: 'info',
      })
    return items
  }, [pulse, preferences.notify_critical, preferences.notify_overdue])

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[80] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-[13px] focus:shadow-pop"
      >
        Skip to content
      </a>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col bg-sidebar text-slate-300 transition-[width,transform] duration-200 lg:w-[248px]',
          collapsed && 'lg:w-[72px]',
          mobileOpen
            ? 'visible translate-x-0'
            : 'invisible -translate-x-full lg:visible lg:translate-x-0',
        )}
        id="primary-nav"
        aria-label="Primary navigation"
      >
        <div className="flex h-14 items-center gap-2.5 px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2.5" aria-label="TraceIQ home">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
              <svg width="18" height="18" viewBox="0 0 32 32" fill="none" aria-hidden>
                <path d="M9 10h14M16 10v13" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" />
                <circle cx="23" cy="22" r="2.4" fill="#5b8def" />
              </svg>
            </span>
            <span className={cx('min-w-0', collapsed && 'lg:hidden')}>
              <span className="block text-[14px] font-semibold tracking-tight text-white">TraceIQ</span>
              <span className="block truncate text-[10.5px] text-slate-400">Quality &amp; Traceability</span>
            </span>
          </Link>
          <button
            className="ml-auto hidden h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-white lg:flex"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft size={15} className={cx('transition-transform', collapsed && 'rotate-180')} />
          </button>
          <button
            className="ml-auto flex h-10 w-10 items-center justify-center rounded-md text-slate-300 hover:bg-white/5 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={16} />
          </button>
        </div>

        <div className={cx('mx-3 mb-3 flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.04] px-2.5 py-1.5', collapsed && 'lg:justify-center lg:px-0')}>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className={cx('text-[11px] font-medium text-slate-300', collapsed && 'lg:hidden')}>Production</span>
          <span className={cx('ml-auto rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400', collapsed && 'lg:hidden')}>
            {meta?.profile ?? '—'}
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-3">
          {GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              <p className={cx('px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-500', collapsed && 'lg:hidden')}>
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const badge = item.badgeKey ? pulse?.[item.badgeKey] : undefined
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        onClick={() => setMobileOpen(false)}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cx(
                            'group relative flex items-center gap-2.5 rounded-lg px-2 py-3 text-[13.5px] font-medium transition-colors lg:py-[7px] lg:text-[12.5px]',
                            isActive
                              ? 'bg-white/[0.08] text-white'
                              : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100',
                            collapsed && 'lg:justify-center lg:px-0',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <span
                              className={cx(
                                'absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r bg-accent transition-opacity',
                                isActive ? 'opacity-100' : 'opacity-0',
                              )}
                            />
                            <span className={cx('shrink-0', isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-300')}>
                              {item.icon}
                            </span>
                            <span className={cx('truncate', collapsed && 'lg:hidden')}>{item.label}</span>
                            {badge ? (
                              <span className={cx('ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-200 tabular', collapsed && 'lg:hidden')}>
                                {badge}
                              </span>
                            ) : null}
                          </>
                        )}
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className={cx('border-t border-white/5 px-3 py-3', collapsed && 'lg:px-2')}>
          <div className={cx('rounded-lg bg-white/[0.04] p-2.5', collapsed && 'lg:hidden')}>
              <p className="text-[10.5px] font-medium uppercase tracking-wide text-slate-500">Dataset</p>
              <p className="mt-0.5 truncate text-[11.5px] text-slate-300">
                seed {meta?.seed ?? '—'} · v{meta?.dataset_version ?? '—'}
              </p>
              <p className="mt-0.5 text-[10.5px] text-slate-500">
                {meta?.row_counts?.production_order?.toLocaleString() ?? '—'} orders ·{' '}
                {meta?.row_counts?.inspection_result?.toLocaleString() ?? '—'} inspections
              </p>
            </div>
          {collapsed && (
            <div className="hidden justify-center py-1 text-[10px] text-slate-500 lg:flex" title="Dataset status">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </div>
          )}
        </div>
      </aside>

      <div className={cx('flex min-h-screen flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-[72px]' : 'lg:pl-[248px]')}>
        <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
            <button
              className="focus-ring -ml-1 mr-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-slate-100 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              aria-controls="primary-nav"
              aria-expanded={mobileOpen}
            >
              <Menu size={18} />
            </button>
            <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-[12.5px] sm:flex">
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1
                return (
                  <span key={`${crumb.to}-${index}`} className="flex min-w-0 items-center gap-1.5">
                    {index > 0 && <span className="text-slate-300">/</span>}
                    {last ? (
                      <span className="truncate font-medium text-ink" aria-current="page">
                        {crumb.label}
                      </span>
                    ) : (
                      <Link to={crumb.to} className="truncate text-muted hover:text-ink">
                        {crumb.label}
                      </Link>
                    )}
                  </span>
                )
              })}
            </nav>

            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => setSearchOpen(true)}
                className="focus-ring hidden h-8 w-[220px] items-center gap-2 rounded-lg border border-line bg-slate-50/70 px-2.5 text-[12.5px] text-muted transition-colors hover:border-slate-300 hover:bg-white md:flex xl:w-[280px]"
                aria-label="Open global search"
              >
                <Search size={14} className="text-faint" />
                <span>Search anything…</span>
                <span className="ml-auto rounded border border-line bg-white px-1.5 py-0.5 text-[10px] text-faint">
                  ⌘K
                </span>
              </button>
              <button
                onClick={() => setSearchOpen(true)}
                className="focus-ring flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-slate-100 md:hidden"
                aria-label="Search"
              >
                <Search size={16} />
              </button>

              <div className="mx-1 hidden h-5 w-px bg-line sm:block" />
              <span className="hidden items-center gap-1.5 rounded-md border border-line bg-white px-2 py-1 text-[11px] font-medium text-muted sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                API live
              </span>

              <div className="relative" ref={bellRef}>
                <button
                  onClick={() => setBellOpen((value) => !value)}
                  className="focus-ring relative flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-slate-100"
                  aria-label={`Notifications (${alerts.length})`}
                  aria-expanded={bellOpen}
                >
                  <Bell size={16} />
                  {alerts.length > 0 && (
                    <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger ring-2 ring-white" />
                  )}
                </button>
                {bellOpen && (
                  <div className="absolute right-0 top-10 z-40 w-[min(92vw,330px)] animate-slide-up overflow-hidden rounded-xl border border-line bg-white shadow-pop">
                    <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                      <p className="text-[12.5px] font-semibold text-ink">Notifications</p>
                      <span className="text-[11px] text-muted">{alerts.length} active</span>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto">
                      {alerts.length === 0 && (
                        <p className="px-4 py-6 text-center text-[12.5px] text-muted">
                          No active quality alerts.
                        </p>
                      )}
                      {alerts.map((alert) => (
                        <Link
                          key={alert.title}
                          to={alert.href}
                          onClick={() => setBellOpen(false)}
                          className="flex gap-2.5 border-b border-line/60 px-4 py-2.5 last:border-0 hover:bg-slate-50"
                        >
                          <span
                            className={cx(
                              'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                              alert.tone === 'danger' && 'bg-danger',
                              alert.tone === 'warning' && 'bg-warning',
                              alert.tone === 'info' && 'bg-accent',
                            )}
                          />
                          <span className="min-w-0">
                            <span className="block text-[12.5px] font-medium text-ink">{alert.title}</span>
                            <span className="mt-0.5 block text-[11.5px] leading-4 text-muted">{alert.detail}</span>
                          </span>
                        </Link>
                      ))}
                    </div>
                    <Link
                      to="/quality"
                      onClick={() => setBellOpen(false)}
                      className="block border-t border-line bg-slate-50/60 px-4 py-2 text-center text-[12px] font-medium text-accent"
                    >
                      Review exception queue
                    </Link>
                  </div>
                )}
              </div>

              <div className="relative" ref={profileRef}>
                <button
                  onClick={() => setProfileOpen((value) => !value)}
                  className="focus-ring flex h-10 items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 hover:bg-slate-100"
                  aria-label="Account menu"
                  aria-expanded={profileOpen}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sidebar text-[11px] font-semibold text-white">
                    QM
                  </span>
                  <span className="hidden text-left lg:block">
                    <span className="block text-[12px] font-medium leading-4 text-ink">Quality Manager</span>
                    <span className="block text-[10.5px] leading-3 text-muted">Plant operations</span>
                  </span>
                </button>
                {profileOpen && (
                  <div className="absolute right-0 top-10 z-40 w-[240px] animate-slide-up overflow-hidden rounded-xl border border-line bg-white shadow-pop">
                    <div className="border-b border-line px-4 py-3">
                      <p className="text-[12.5px] font-medium text-ink">Quality Manager</p>
                      <p className="text-[11.5px] text-muted">Local workspace · no sign-out</p>
                    </div>
                    <Link
                      to="/settings"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-[12.5px] text-ink hover:bg-slate-50"
                    >
                      <Settings size={14} className="text-muted" /> Workspace settings
                    </Link>
                    <Link
                      to="/quality"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2 border-t border-line/60 px-4 py-2.5 text-[12.5px] text-ink hover:bg-slate-50"
                    >
                      <ShieldAlert size={14} className="text-muted" /> Data quality report
                    </Link>
                    <div className="border-t border-line bg-slate-50/60 px-4 py-2 text-[10.5px] text-faint">
                      TraceIQ 2.0 · API {meta?.api_version ?? '—'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-3 py-4 sm:px-5 sm:py-6">
          {children}
        </main>

        <footer className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-2 px-3 pb-5 pt-1 text-[11px] text-faint sm:px-5">
          <span>
            TraceIQ · synthetic manufacturing dataset · seed {meta?.seed ?? '—'}
          </span>
          <span>
            Read-only evidence layer · actions recorded in an append-only audit log
          </span>
        </footer>
      </div>

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
