import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Me } from '../shared/types'
import { api, ApiError } from './api'
import { Archipelago } from './Archipelago'
import { DataPage, MyData } from './DataPages'
import { Home } from './Home'
import { IslePage } from './IslePage'
import { Library } from './Library'
import { Login } from './Login'
import { usePath } from './navigate'
import { Profile } from './Profile'
import { SitePage, SitesIndex } from './Sites'
import { Connect, HandlePrompt, Settings } from './Settings'
import { Link, Logo, SessionContext, type Session } from './ui'

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
        <p><a href="/">Back to the archipelago</a></p>
      </div>
    )
  }
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
  else if ((m = /^\/@([a-z0-9_-]+)\/?$/i.exec(path))) page = <Profile handle={m[1]!.toLowerCase()} tab={query.get('tab')} />
  else if (path === '/data') page = <MyData />
  else if (path === '/library') page = <Library />
  else if (path === '/tree') page = <Archipelago />
  else if (path === '/sites') page = <SitesIndex />
  else if ((m = /^\/s\/([^/]+)\/?$/.exec(path))) page = <SitePage site={decodeURIComponent(m[1]!)} />
  else if (path === '/settings') page = <Settings key={me?.id ?? 'anon'} />
  else if (path === '/connect') page = <Connect />
  else if (path === '/login') page = <Login next={query.get('next')} />
  else page = <div className="wrap page-head"><h1>Nothing here</h1><p className="muted">That page drifted off. <Link to="/">Back to the archipelago</Link>.</p></div>

  const nav = (to: string, label: string, cls = '') => (
    <Link to={to} className={`link ${cls} ${path === to || (to !== '/' && path.startsWith(to)) ? 'on' : ''}`}>
      {label}
    </Link>
  )

  return (
    <SessionContext.Provider value={session}>
      <header className="nav">
        <div className="wrap">
          <Link to="/" className="brand">
            <Logo /> <span>Prolifica</span>
          </Link>
          {nav('/', 'Explore')}
          {nav('/tree', 'Archipelago', 'hide-sm')}
          {nav('/sites', 'Sites', 'hide-sm')}
          {me && nav('/library', 'Library')}
          {me && nav('/data', 'My data', 'hide-sm')}
          <div className="spacer" />
          {nav('/connect', 'Connect', 'hide-sm')}
          {me ? (
            <>
              {me.handle && nav(`/@${me.handle}`, `@${me.handle}`, 'hide-sm')}
              {nav('/settings', 'Settings')}
            </>
          ) : (
            !loading && (
              <Link to={`/login?next=${encodeURIComponent(path)}`} className="btn primary sm">
                Sign in
              </Link>
            )
          )}
        </div>
      </header>
      {me && !me.handle && path !== '/settings' && <HandlePrompt />}
      <PageBoundary path={path}>{page}</PageBoundary>
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </SessionContext.Provider>
  )
}
