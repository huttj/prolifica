import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Me } from '../shared/types'
import { Admin } from './Admin'
import { api, ApiError } from './api'
import { Archipelago } from './Archipelago'
import { AskTopicProvider, HeaderAsk } from './ask'
import { DataPage, MyData } from './DataPages'
import { Home } from './Home'
import { IslePage } from './IslePage'
import { Library } from './Library'
import { Login } from './Login'
import { navigate, usePath } from './navigate'
import { Profile } from './Profile'
import { SitePage, SitesIndex } from './Sites'
import { Connect, HandlePrompt, Settings } from './Settings'
import { Icon, Link, Logo, SessionContext, type Session } from './ui'

/** One broken page shouldn't blank the whole app. */
class PageBoundary extends Component<{ path: string; children: ReactNode }, { error: Error | null; path: string }> {
  state = { error: null as Error | null, path: this.props.path }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  static getDerivedStateFromProps(props: { path: string }, state: { error: Error | null; path: string }) {
    return props.path !== state.path ? { error: null, path: props.path } : null
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="wrap page-head">
        <h1>This page broke</h1>
        <p className="muted">{this.state.error.message}</p>
        <p><a href="/">Back to Explore</a></p>
      </div>
    )
  }
}

/** The signed-in person's name in the header, opening their pages: profile, library, data, settings. */
function UserMenu({ me, path }: { me: Me; path: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => setOpen(false), [path])
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key) }
  }, [open])
  const items: [string, string][] = [
    ...(me.handle ? [[`/@${me.handle}`, 'Profile'] as [string, string]] : []),
    ['/library', 'Library'],
    ['/data', 'My data'],
    ['/settings', 'Settings'],
    ...(me.isAdmin ? [['/admin', 'People'] as [string, string]] : []),
  ]
  const here = items.some(([to]) => path === to || path.startsWith(`${to}/`))
  return (
    <div className="user-menu" ref={box}>
      <button className={`link ${here || open ? 'on' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-pid="user-menu">
        <span className="ellipsis">{me.handle ? `@${me.handle}` : (me.name ?? me.email)}</span>
        <Icon name="chevron" />
      </button>
      {open && (
        <div className="card user-menu-list">
          {items.map(([to, label]) => (
            <Link key={to} to={to} className={path === to || path.startsWith(`${to}/`) ? 'on' : ''}>{label}</Link>
          ))}
        </div>
      )}
    </div>
  )
}

export function App() {
  const { path, query } = usePath()
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me())
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) console.error(e)
      setMe(null)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])
  // the map was at /tree; old links still open it
  useEffect(() => {
    if (path === '/tree') navigate(`/map${location.search}${location.hash}`, { replace: true })
  }, [path])

  const toast = useCallback((m: string) => {
    setToastMsg(m)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToastMsg(null), 2600)
  }, [])

  const session: Session = useMemo(() => ({ me, loading, refresh, toast }), [me, loading, refresh, toast])

  let page: React.ReactNode
  let m: RegExpExecArray | null
  if (path === '/') page = <Home />
  else if ((m = /^\/i\/([a-z0-9]+)\/?$/.exec(path))) page = <IslePage id={m[1]!} />
  else if ((m = /^\/i\/([a-z0-9]+)\/family\/?$/.exec(path))) page = <IslePage id={m[1]!} family />
  else if ((m = /^\/d\/([a-z0-9]+)\/?$/.exec(path))) page = <DataPage id={m[1]!} />
  else if ((m = /^\/(?:@|%40)([a-z0-9_-]+)\/?$/i.exec(path))) page = <Profile handle={m[1]!.toLowerCase()} tab={query.get('tab')} />
  else if (path === '/data') page = <MyData />
  else if (path === '/library') page = <Library />
  else if (path === '/map' || path === '/tree') page = <Archipelago />
  else if (path === '/sites') page = <SitesIndex />
  else if ((m = /^\/s\/([^/]+)\/?$/.exec(path))) page = <SitePage site={decodeURIComponent(m[1]!)} />
  else if (path === '/settings') page = <Settings key={me?.id ?? 'anon'} />
  else if (path === '/connect') page = <Connect />
  else if (path === '/admin') page = <Admin />
  else if (path === '/login') page = <Login next={query.get('next')} />
  else page = <div className="wrap page-head"><h1>Nothing here</h1><p className="muted">That page drifted off. <Link to="/">Back to the archipelago</Link>.</p></div>

  const nav = (to: string, label: string, cls = '') => (
    <Link to={to} className={`link ${cls} ${path === to || (to !== '/' && path.startsWith(to)) ? 'on' : ''}`}>
      {label}
    </Link>
  )

  return (
    <SessionContext.Provider value={session}>
      <AskTopicProvider>
      <header className="nav">
        <div className="wrap">
          <Link to="/" className="brand">
            <Logo /> <span>Prolifica</span>
          </Link>
          {nav('/map', 'Map')}
          <div className="spacer" />
          {me ? (
            <UserMenu me={me} path={path} />
          ) : (
            !loading && (
              <Link to={`/login?next=${encodeURIComponent(path)}`} className="btn primary sm">
                Sign in
              </Link>
            )
          )}
          <HeaderAsk />
        </div>
      </header>
      {me && !me.handle && path !== '/settings' && <HandlePrompt />}
      <PageBoundary path={path}>{page}</PageBoundary>
      {toastMsg && <div className="toast">{toastMsg}</div>}
      </AskTopicProvider>
    </SessionContext.Provider>
  )
}
