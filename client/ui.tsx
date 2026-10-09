import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { RELATION_LABEL, type Relation } from '../shared/relation'
import type { IsleSummary, Me } from '../shared/types'
import { who } from './api'
import { onLinkClick } from './navigate'

// ---- session context ----

export interface Session {
  me: Me | null
  loading: boolean
  refresh: () => Promise<void>
  toast: (message: string) => void
}

export const SessionContext = createContext<Session>({ me: null, loading: true, refresh: async () => {}, toast: () => {} })
export const useSession = () => useContext(SessionContext)

// ---- data loading ----

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: Error | null; loading: boolean; reload: () => void; set: (v: T) => void } {
  const [state, setState] = useState<{ data: T | undefined; error: Error | null; loading: boolean }>({ data: undefined, error: null, loading: true })
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, loading: true, error: null }))
    fn().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error: Error) => live && setState({ data: undefined, error, loading: false }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  const reload = useCallback(() => setN((x) => x + 1), [])
  const set = useCallback((data: T) => setState({ data, error: null, loading: false }), [])
  return { ...state, reload, set }
}

// ---- bits ----

export function Link({ to, children, className, title, ref }: { to: string; children: ReactNode; className?: string; title?: string; ref?: React.Ref<HTMLAnchorElement> }) {
  return (
    <a ref={ref} href={to} onClick={onLinkClick} className={className} title={title}>
      {children}
    </a>
  )
}

export function PersonLink({ person }: { person: { handle: string | null; name: string | null } }) {
  if (!person.handle) return <span>{person.name ?? 'someone'}</span>
  return <Link to={`/@${person.handle}`}>{who(person as never)}</Link>
}

export function RelationChip({ relation }: { relation: Relation | null }) {
  if (!relation) return null
  return <span className={`chip ${relation}`}>{RELATION_LABEL[relation]}</span>
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="11" cy="18" r="7" fill="currentColor" opacity=".9" />
      <circle cx="22" cy="11" r="5" fill="currentColor" opacity=".6" />
      <circle cx="24" cy="23" r="3.5" fill="currentColor" opacity=".4" />
    </svg>
  )
}

const ICONS: Record<string, string> = {
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  comment: 'M4 5h16v11H9l-5 4z',
  pick: 'M4 4l6 16 2.5-6.5L19 11z',
  remix: 'M6 3v8a4 4 0 004 4h8M15 11l4 4-4 4M6 21v-2',
  tree: 'M12 4v6M12 10l-6 6M12 10l6 6M4 18h4M16 18h4M10 2h4v4h-4z',
  data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  close: 'M6 6l12 12M18 6L6 18',
  smile: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 018 0v4',
  panel: 'M4 4h16v16H4zM15 4v16',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  folders: 'M3 7.5A1.5 1.5 0 014.5 6H9l2 2h8.5A1.5 1.5 0 0121 9.5v8a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5zM8 13h8M12 11l-2 2 2 2',
}

export function Icon({ name, filled, className }: { name: keyof typeof ICONS | string; filled?: boolean; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ''} />
    </svg>
  )
}

/** A live, shrunken isle. Loads only when scrolled near. */
/**
 * An <iframe> that gets its src only once it has a size. A cached isle can otherwise start running
 * while its frame is still 0×0, and anything it measured at load (chart widths) comes out empty.
 */
export function SizedFrame(props: React.IframeHTMLAttributes<HTMLIFrameElement> & { src: string; frameRef?: React.RefObject<HTMLIFrameElement | null> }) {
  const { src, frameRef, ...rest } = props
  const own = useRef<HTMLIFrameElement>(null)
  const ref = frameRef ?? own
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const go = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        if (el.getAttribute('src') !== src) el.setAttribute('src', src)
      } else raf = requestAnimationFrame(go)
    }
    go()
    return () => cancelAnimationFrame(raf)
  }, [src, ref])
  return <iframe ref={ref} {...rest} />
}

/**
 * A picture of an isle (a screenshot taken after each publish), showing the top of the page. The
 * first ask for a missing one gets it taken, so it tries once more a little later.
 */
export function Thumb({ src, title }: { src: string; title?: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading')
  const [attempt, setAttempt] = useState(0)
  // a new picture starts over (during render: a cached image can load before an effect would run)
  const [forSrc, setForSrc] = useState(src)
  if (forSrc !== src) {
    setForSrc(src)
    setState('loading')
    setAttempt(0)
  }
  useEffect(() => {
    if (state !== 'missing' || attempt > 0) return
    const t = setTimeout(() => {
      setAttempt(1)
      setState('loading')
    }, 12_000)
    return () => clearTimeout(t)
  }, [state, attempt])
  const url = attempt ? `${src}${src.includes('?') ? '&' : '?'}try=${attempt}` : src
  return (
    <div className="thumb">
      {state !== 'missing' && <img src={url} alt="" loading="lazy" decoding="async" onLoad={() => setState('ok')} onError={() => setState('missing')} />}
      {state !== 'ok' && <div className="ph">{state === 'missing' ? <span className="ellipsis">{title ?? 'No picture yet'}</span> : ''}</div>}
    </div>
  )
}

export function IsleCard({ isle }: { isle: IsleSummary }) {
  return (
    <Link to={`/i/${isle.id}`} className="card isle-card">
      <Thumb src={isle.shotUrl} title={isle.title} />
      <div className="meta">
        <div className="title ellipsis">{isle.title}</div>
        <div className="by">
          <span className="ellipsis">{who(isle.owner)}</span>
          <RelationChip relation={isle.relation} />
          {isle.visibility !== 'public' && <span className="chip">{isle.visibility}</span>}
          <span className="grow" />
          {isle.starCount > 0 && (
            <span className="stars">
              <Icon name="star" filled /> {isle.starCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

export function Modal({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card pad modal" style={wide ? { maxWidth: 820 } : undefined} role="dialog">
        {children}
      </div>
    </div>
  )
}

/** Text with a copy button; `shown` displays something friendlier than what gets copied. */
export function CopyBlock({ text, shown, code }: { text: string; shown?: string; code?: boolean }) {
  const { toast } = useSession()
  return (
    <div style={{ position: 'relative' }}>
      <pre className={code ? 'copy code' : 'copy'}>{shown ?? text}</pre>
      <button
        className="btn sm"
        style={{ position: 'absolute', top: 6, right: 6 }}
        onClick={() => navigator.clipboard.writeText(text).then(() => toast('Copied'))}
      >
        <Icon name="copy" /> Copy
      </button>
    </div>
  )
}

export const QUICK_EMOJI = ['❤️', '🔥', '👀', '🤯', '🎯', '😂', '🙌', '🤔']
const MORE_EMOJI = ['👍', '👏', '✨', '💡', '🌊', '🏝️', '📈', '📉', '🧠', '🎨', '💎', '🚀', '😍', '😮', '🙏', '💯', '🌱', '🐙', '🧭', '⚡', '🫶', '🥲', '😬', '❓']

export function EmojiPicker({ onPick, onClose, style }: { onPick: (e: string) => void; onClose: () => void; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const on = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose()
    setTimeout(() => document.addEventListener('mousedown', on))
    return () => document.removeEventListener('mousedown', on)
  }, [onClose])
  return (
    <div className="emoji-pop" ref={ref} style={style}>
      {[...QUICK_EMOJI, ...MORE_EMOJI].map((e) => (
        <button key={e} onClick={() => onPick(e)}>
          {e}
        </button>
      ))}
    </div>
  )
}

export function ErrorBox({ error }: { error: Error }) {
  return <div className="empty err">{error.message}</div>
}
