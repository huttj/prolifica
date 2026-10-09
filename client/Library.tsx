import { useState } from 'react'
import type { LibraryItem } from '../shared/types'
import { ago, api, who } from './api'
import { navigate } from './navigate'
import { CopyBlock, ErrorBox, Icon, Link, Thumb, useAsync, useSession } from './ui'

interface ShotRects {
  width: number
  height: number
  rects: Record<string, [number, number, number, number]>
}

const rectsCache = new Map<string, Promise<ShotRects | null>>()
const rectsFor = (shotUrl: string) => {
  if (!rectsCache.has(shotUrl)) rectsCache.set(shotUrl, fetch(`${shotUrl}&rects=1`).then((r) => (r.ok ? (r.json() as Promise<ShotRects | null>) : null)).catch(() => null))
  return rectsCache.get(shotUrl)!
}

/** A starred isle shows its picture; a starred piece shows just that piece, cut from the same picture. */
function Shot({ item }: { item: LibraryItem }) {
  const sel = item.mark.anchor?.selector
  const meta = useAsync(() => (sel ? rectsFor(item.isle.shotUrl) : Promise.resolve(null)), [sel, item.isle.shotUrl])
  const rect = sel && meta.data ? meta.data.rects[sel] : undefined
  if (!sel || !meta.data || !rect) {
    if (sel && meta.loading) return <div className="thumb" />
    return <Thumb src={item.isle.shotUrl} title={item.isle.title} />
  }
  return <Crop src={item.isle.shotUrl} rect={rect} width={meta.data.width} height={meta.data.height} />
}

/** Show one rectangle of a picture, with a little room around it, scaled to the card's width. */
function Crop({ src, rect, width, height }: { src: string; rect: [number, number, number, number]; width: number; height: number }) {
  const [x, y, w, h] = rect
  const pad = Math.max(12, Math.min(w, h) * 0.08)
  let cw = Math.min(width, w + pad * 2)
  let ch = Math.min(height, h + pad * 2)
  // keep cards between wide and tall, growing the box around the piece's centre
  if (cw / ch > 3.2) ch = Math.min(height, cw / 3.2)
  if (cw / ch < 0.7) cw = Math.min(width, ch * 0.7)
  const cx = Math.max(0, Math.min(width - cw, x + w / 2 - cw / 2))
  const cy = Math.max(0, Math.min(height - ch, y + h / 2 - ch / 2))
  return (
    <div className="crop" style={{ aspectRatio: `${cw} / ${ch}` }}>
      <img src={src} alt="" loading="lazy" style={{ width: `${(width / cw) * 100}%`, left: `${(-cx / cw) * 100}%`, marginTop: `${(-cy / cw) * 100}%` }} />
    </div>
  )
}

export function Board({ items }: { items: LibraryItem[] }) {
  return (
    <div className="board">
      {items.map((it) => {
        const to = `/i/${it.isle.id}${it.mark.kind === 'comment' ? `#c-${it.mark.id}` : ''}`
        return (
          <Link key={it.mark.id} to={to} className="card pin-card">
            {it.mark.kind === 'star' && <Shot item={it} />}
            <div className="meta">
              <div className="row small">
                {it.mark.kind === 'star' ? <span className="stars"><Icon name="star" filled /></span> : <span>💬</span>}
                <b className="grow ellipsis">{it.mark.anchor?.label ?? it.isle.title}</b>
              </div>
              {it.mark.body && <p style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>{it.mark.body}</p>}
              <div className="tiny muted ellipsis">
                {it.mark.anchor ? `in ${it.isle.title} · ` : ''}
                {who(it.isle.owner)} · {ago(it.mark.createdAt)}
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

export function Library() {
  const { me, loading } = useSession()
  const lib = useAsync(() => (me ? api.library() : Promise.resolve([])), [me?.id])
  const [filter, setFilter] = useState<'all' | 'pieces' | 'isles' | 'notes'>('all')
  if (!me && !loading) {
    navigate('/login?next=/library', { replace: true })
    return null
  }
  const items = (lib.data ?? []).filter((it) =>
    filter === 'all' ? true : filter === 'pieces' ? it.mark.kind === 'star' && it.mark.anchor : filter === 'isles' ? it.mark.kind === 'star' && !it.mark.anchor : it.mark.kind === 'comment',
  )
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Your library</h1>
        <p className="muted" style={{ margin: '4px 0 0', maxWidth: 640 }}>
          Everything you've starred, whole isles and single pieces, and what you've said. Your agent sees this too, and leans on it when it makes
          something new for you.
        </p>
      </div>
      <div className="toolbar">
        <div className="seg">
          {(['all', 'pieces', 'isles', 'notes'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f[0]!.toUpperCase() + f.slice(1)}</button>
          ))}
        </div>
      </div>
      {lib.error && <ErrorBox error={lib.error} />}
      {lib.data && !lib.data.length && (
        <div className="empty">
          Nothing here yet. Open any isle and press the star, or use its comment button to star one chart, control or card.
        </div>
      )}
      {items.length > 0 && <Board items={items} />}
      {lib.data && lib.data.length > 0 && (
        <div className="section">
          <h2>Ask your agent with it</h2>
          <CopyBlock text="Look at my Prolifica library and make me a new isle for <data> in the style of the pieces I've starred." />
        </div>
      )}
      <div style={{ height: 60 }} />
    </div>
  )
}
