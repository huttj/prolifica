import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Anchor, Isle, IsleVersion, Mark, TreeNode, Visibility } from '../shared/types'
import { ago, api, type Layer, type Marks, who } from './api'
import { navigate } from './navigate'
import { AskPopover, useAskTopic } from './ask'
import { DataModal } from './DataPages'
import { FoldedMarkdown } from './Markdown'
import { ThreadView } from './Tree'
import { UseMyDataModal } from './UseMyData'
import { EvolutionModal } from './Evolution'
import { DataSources } from './Sources'
import {
  EmojiPicker, ErrorBox, Icon, Link, PersonLink, SizedFrame, useAsync, useSession,
} from './ui'

type Tab = 'notes' | 'family' | 'data' | 'history' | 'settings'
type Picked = { anchor: Anchor; snippet: string | null }

const LAYERS: { id: Layer; label: string }[] = [
  { id: 'mine', label: 'Mine' },
  { id: 'author', label: 'Author' },
  { id: 'following', label: 'Following' },
  { id: 'everyone', label: 'Everyone' },
]

const PANEL_KEY = 'pf:panelWidth'
const readPanelWidth = () => { try { const n = Number(localStorage.getItem(PANEL_KEY)); return n >= 280 ? n : 360 } catch { return 360 } }

export function IslePage({ id, family = false }: { id: string; family?: boolean }) {
  const { me, toast } = useSession()
  const isle = useAsync(() => api.isle(id), [id, me?.id])
  const [layer, setLayer] = useState<Layer>('following')
  const [marks, setMarks] = useState<Marks | null>(null)
  const [tab, setTab] = useState<Tab | null>(() => (window.innerWidth > 860 ? 'notes' : null))
  const [picking, setPicking] = useState(false)
  // what the next picked piece is for: a mark (star, comment) or the header's Ask
  const [pickFor, setPickFor] = useState<'mark' | 'ask'>('mark')
  // pieces picked for the header's Ask; forgotten once it's handed over or you leave
  const [askPieces, setAskPieces] = useState<Anchor[]>([])
  const [active, setActive] = useState<Picked | null>(null)
  // the comment whose piece is ringed in the isle right now
  const [focusedComment, setFocusedComment] = useState<string | null>(null)
  const [remixOpen, setRemixOpen] = useState(false)
  const [useDataOpen, setUseDataOpen] = useState(false)
  // the side panel's width, dragged by its edge and remembered per browser
  const [panelW, setPanelW] = useState(readPanelWidth)
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const move = (ev: PointerEvent) => setPanelW(Math.round(Math.min(Math.max(280, window.innerWidth - ev.clientX), window.innerWidth * 0.7)))
    const up = () => {
      document.body.classList.remove('resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setPanelW((w) => { try { localStorage.setItem(PANEL_KEY, String(w)) } catch { /* storage unavailable */ } return w })
    }
    document.body.classList.add('resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // an older version shown in the frame instead of the latest
  const [viewing, setViewing] = useState<IsleVersion | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)

  const frameSrc = useMemo(() => {
    if (!isle.data) return ''
    if (!viewing || viewing.current) return isle.data.frameUrl
    const u = new URL(isle.data.frameUrl)
    u.searchParams.set('v', String(viewing.version))
    return u.toString()
  }, [isle.data, viewing])
  // the frame keeps showing the page it had until the new one has loaded: hide it in between, so a new
  // header never sits over the last isle's page
  const [painted, setPainted] = useState(false)
  useEffect(() => {
    setReady(false)
    setPainted(false)
    const t = window.setTimeout(() => setPainted(true), 6000)
    return () => clearTimeout(t)
  }, [frameSrc])
  useEffect(() => {
    setViewing(null)
    setAskPieces([])
  }, [id])

  // the author wants to hear everything said about their isle; everyone else starts in the quieter layer
  const ownerId = isle.data?.owner.id
  useEffect(() => {
    if (ownerId && me?.id === ownerId) setLayer('everyone')
  }, [ownerId, me?.id])

  const loadMarks = useCallback(() => api.marks(id, layer).then(setMarks, () => {}), [id, layer])
  useEffect(() => {
    loadMarks()
  }, [loadMarks, me?.id])

  const frameOrigin = useMemo(() => (isle.data ? new URL(isle.data.frameUrl).origin : null), [isle.data])
  const post = useCallback(
    (msg: Record<string, unknown>) => frameOrigin && frame.current?.contentWindow?.postMessage({ prolifica: 1, ...msg }, frameOrigin),
    [frameOrigin],
  )

  const ring = useCallback((a: Anchor) => post({ t: 'focus', selector: a.selector, state: a.state, mode: 'ring' }), [post])
  const startAskPick = useCallback(() => {
    setPickFor('ask')
    setPicking(true)
  }, [])
  const stopPicking = useCallback(() => setPicking(false), [])
  const unpickPiece = useCallback((sel: string) => setAskPieces((l) => l.filter((a) => a.selector !== sel)), [])
  const clearPieces = useCallback(() => setAskPieces([]), [])
  const openUseData = useCallback(() => setUseDataOpen(true), [])
  const ownIt = !!isle.data && me?.id === isle.data.owner.id
  useAskTopic(
    isle.data
      ? {
          about: 'this isle',
          context: `Using the Prolifica connector (${location.origin}/mcp), read isle ${isle.data.id} ("${isle.data.title}", ${location.origin}/i/${isle.data.id}) with get_isle.${
            ownIt
              ? ' It is mine: if I ask for changes, update it in place (publish_isle with its id and a short note); if I ask for something new made from it, publish a new isle with it as parent.'
              : " It isn't mine: if I ask for changes, make my own version with publish_isle and parent (keep its data bindings unless a change needs different data)."
          } Keep every data-pid attribute stable so comments and stars stay attached, and tell me the link when it's done.`,
          suggestions: ownIt ? ['Explain how this page works', 'Make it work well on phones', 'Tighten up the description'] : ['Explain how this page works', 'What could be better here?'],
          pieces: { list: askPieces, picking: picking && pickFor === 'ask', start: startAskPick, cancel: stopPicking, remove: unpickPiece, clear: clearPieces, focus: ring },
          useData: openUseData,
        }
      : null,
  )

  // what the isle tells us
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== frameOrigin || e.source !== frame.current?.contentWindow) return
      const m = e.data as { prolifica?: number; t?: string; anchor?: Anchor; snippet?: string; key?: string }
      if (!m?.prolifica) return
      if (m.t === 'ready') {
        setReady(true)
        setPainted(true)
      }
      if (m.t === 'picked' && m.anchor) {
        setPicking(false)
        if (pickFor === 'ask') {
          const a = m.anchor
          setAskPieces((l) => (l.some((x) => x.selector === a.selector) ? l : [...l, a]))
        } else {
          setActive({ anchor: m.anchor, snippet: m.snippet ?? null })
          setTab('notes')
        }
      }
      if (m.t === 'pickCancel') setPicking(false)
      if (m.t === 'unfocused') setFocusedComment(null)
      if (m.t === 'open' && m.key) {
        const t = marks?.tallies.find((x) => x.anchorKey === m.key)
        setActive({ anchor: t?.anchor ?? { selector: m.key }, snippet: null })
        setTab('notes')
      }
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [frameOrigin, marks, pickFor])

  // pins on the elements that have marks
  useEffect(() => {
    if (!ready || !marks) return
    // pieces picked for the Ask show as ✎ pins, numbered like the list in the Ask
    const askPins = new Set(askPieces.map((a) => a.selector))
    post({
      t: 'pins',
      items: [
        ...askPieces.map((a, k) => ({ selector: a.selector, text: `✎ ${k + 1}`, title: 'In your ask', mine: true })),
        ...marks.tallies
        .filter((t) => t.anchorKey && !askPins.has(t.anchorKey))
        .map((t) => {
          const bits = [t.stars ? `★${t.stars}` : '', t.comments ? `💬${t.comments}` : '']
          return { selector: t.anchorKey, text: bits.filter(Boolean).join(' '), title: t.anchor?.label ?? '', mine: t.starredByMe }
        }),
      ],
    })
  }, [ready, marks, post, askPieces])

  useEffect(() => {
    if (ready) post({ t: 'pick', on: picking })
    if (!picking) return
    // Escape stops picking from out here too (the isle catches it when it has focus)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPicking(false)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [picking, ready, post])

  // #c-<id> deep links
  useEffect(() => {
    const m = /^#c-(\w+)/.exec(location.hash)
    if (!m || !marks) return
    const el = document.getElementById(`c-${m[1]}`)
    if (el) {
      el.scrollIntoView({ block: 'center' })
      el.classList.add('flash')
    }
    const c = marks.comments.find((x) => x.id === m[1])
    const root = c?.parentId ? marks.comments.find((x) => x.id === c.parentId) : c
    if (ready && root?.anchor) {
      post({ t: 'focus', selector: root.anchor.selector, state: root.anchor.state, mode: 'ring' })
      setFocusedComment(root.id)
    }
  }, [marks, ready, post])

  if (isle.error) return <div className="wrap" style={{ paddingTop: 30 }}><ErrorBox error={isle.error} /></div>
  if (!isle.data) return <div className="wrap muted" style={{ paddingTop: 30 }}>Loading…</div>
  const i = isle.data
  // just navigated to another isle: this one's still showing while the new one loads
  const stale = i.id !== id
  const page = marks?.tallies.find((t) => t.anchorKey === '')
  const mine = me?.id === i.owner.id

  const requireMe = () => {
    if (!me) {
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`)
      return false
    }
    return true
  }
  const starPage = async () => {
    if (!requireMe()) return
    await api.star(i.id, { on: !page?.starredByMe })
    loadMarks()
  }
  /** Show a marked piece: the isle restores the view it was marked in, then scrolls to it and rings it. */
  const focusEl = (anchor: Anchor | null) => post({ t: 'focus', selector: anchor?.selector ?? null, state: anchor?.state, mode: 'ring' })
  return (
    <div className={`isle-page ${stale ? 'stale' : ''}`}>
      <div className="isle-bar">
        <div className="grow isle-head">
          {i.viewName && <div className="isle-kind">{i.viewName}</div>}
          <div className="isle-titleline">
            <h1 className="ellipsis" title={i.title}>{withoutKind(i.title, i.viewName)}</h1>
            <span className="isle-meta">
              by <PersonLink person={i.owner} />
              {' · '}
              <button className="link-btn" onClick={() => setTab('history')} title="Version history">v{i.version}</button>
              {i.parent && <> · from <Link to={`/i/${i.parent.id}`}>{i.parent.title}</Link></>}
              {i.visibility !== 'public' && (
                <button className="link-btn isle-lock" title={VISIBILITY_LABEL[i.visibility]} onClick={() => mine && setTab('settings')} disabled={!mine}><Icon name="lock" /></button>
              )}
            </span>
          </div>
        </div>
        <a className="btn ghost icon-btn" href={frameSrc || i.frameUrl} target="_blank" rel="noreferrer" title="Open alone, in a new tab" aria-label="Open alone">
          <Icon name="open" />
        </a>
        <button className={`btn ${page?.starredByMe ? 'on' : ''}`} onClick={starPage} title="Star this isle">
          <span style={{ color: 'var(--star)', display: 'inline-flex' }}><Icon name="star" filled={!!page?.starredByMe} /></span>
          {page?.stars || i.starCount || ''}
        </button>
        <button
          className={`btn icon-btn ${picking && pickFor === 'mark' ? 'on' : ''}`}
          onClick={() => {
            if (!requireMe()) return
            setPickFor('mark')
            setPicking((p) => !(p && pickFor === 'mark'))
          }}
          title={picking && pickFor === 'mark' ? 'Picking: click a piece of the page (Esc to stop)' : 'Comment on or star one piece of the page'}
          aria-label="Comment on a piece"
        >
          <Icon name="comment" />
        </button>
        <span className="pop-anchor">
          <button
            className={`btn primary ${remixOpen ? 'on' : ''}`}
            onClick={() => setRemixOpen((o) => !o)}
            aria-expanded={remixOpen}
          >
            <Icon name="remix" /> Remix
          </button>
          {remixOpen && (
            <RemixPopover
              isle={i}
              onClose={() => setRemixOpen(false)}
              onUseData={() => { setRemixOpen(false); setUseDataOpen(true) }}
            />
          )}
        </span>
        <button className={`btn ghost ${tab ? 'on' : ''}`} onClick={() => setTab((t) => (t ? null : 'notes'))} title="Notes, family, data, history">
          <Icon name="panel" />
          {marks && marks.layers.everyone > 0 ? <span className="tiny">{marks.layers.everyone}</span> : null}
        </button>
      </div>

      <div className="isle-body">
        <div className={`isle-frame ${painted && !stale ? '' : 'loading'}`}>
          {viewing && !viewing.current && (
            <div className="version-banner">
              <span className="grow ellipsis">
                <b>Version {viewing.version}</b> of {i.version} · {ago(viewing.createdAt)}
                {viewing.note ? ` · ${viewing.note}` : ''}
              </span>
              {mine && (
                <button
                  className="btn sm"
                  onClick={async () => {
                    if (!confirm(`Make version ${viewing.version} the latest again? Later versions stay in the history.`)) return
                    try {
                      await api.restore(i.id, viewing.version)
                      toast(`Restored version ${viewing.version}`)
                      setViewing(null)
                      isle.reload()
                    } catch (e) {
                      toast((e as Error).message)
                    }
                  }}
                >
                  Restore this version
                </button>
              )}
              <button className="btn sm primary" onClick={() => setViewing(null)}>Back to latest</button>
            </div>
          )}
          <SizedFrame
            frameRef={frame}
            src={frameSrc}
            onLoad={() => setPainted(true)}
            title={i.title}
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads"
            allow="clipboard-write; fullscreen"
          />
        </div>
        {tab && (
          <aside className="panel" style={{ '--panel-w': `${panelW}px` } as React.CSSProperties}>
            <div className="panel-grip" onPointerDown={startResize} onDoubleClick={() => { setPanelW(360); try { localStorage.removeItem(PANEL_KEY) } catch { /* storage unavailable */ } }} role="separator" aria-orientation="vertical" aria-label="Drag to resize the panel; double-click to reset" title="Drag to resize · double-click to reset" />
            <div className="tabs">
              <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>Notes</button>
              <button className={tab === 'family' ? 'on' : ''} onClick={() => setTab('family')}>Family</button>
              <button className={tab === 'data' ? 'on' : ''} onClick={() => setTab('data')}>Data</button>
              <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History</button>
              {mine && <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>Settings</button>}
              <div className="grow" />
              <button onClick={() => setTab(null)} title="Close"><Icon name="close" /></button>
            </div>
            <div className="scroll">
              {tab === 'notes' && (
                <Notes
                  isle={i}
                  marks={marks}
                  layer={layer}
                  setLayer={setLayer}
                  active={active}
                  setActive={setActive}
                  reload={loadMarks}
                  focusEl={focusEl}
                  focused={focusedComment}
                  setFocused={setFocusedComment}
                  requireMe={requireMe}
                  toast={toast}
                />
              )}
              {tab === 'family' && <Family isle={i} />}
              {tab === 'data' && <DataTab isle={i} onUseData={() => setUseDataOpen(true)} />}
              {tab === 'history' && <History isle={i} viewing={viewing} setViewing={setViewing} />}
              {tab === 'settings' && mine && <IsleSettings key={i.id} isle={i} onChanged={isle.reload} />}
            </div>
          </aside>
        )}
      </div>
      {useDataOpen && <UseMyDataModal isle={i} onClose={() => setUseDataOpen(false)} />}
      {family && <EvolutionModal id={i.id} onClose={() => navigate(`/i/${i.id}`, { replace: true })} />}
    </div>
  )
}

/** The title without its kind repeated in front of it ("Discourse map: Bike assault" under "Discourse map"). */
function withoutKind(title: string, kind: string | null): string {
  if (!kind) return title
  const k = kind.trim().toLowerCase()
  return title.toLowerCase().startsWith(k) && /^[\s:—–\-|·]+/.test(title.slice(k.length)) ? title.slice(k.length).replace(/^[\s:—–\-|·]+/, '') || title : title
}

const VISIBILITY_LABEL: Record<Visibility, string> = { public: 'Public', unlisted: 'Unlisted', private: 'Private' }

/** Emoji reactions live on comments only. */
function CommentReactions({ reactions, onReact }: { reactions: Record<string, { count: number; mine: boolean }>; onReact: (e: string) => void }) {
  const [open, setOpen] = useState(false)
  const entries = Object.entries(reactions).sort((a, b) => b[1].count - a[1].count)
  return (
    <span className="reactbar" style={{ position: 'relative' }}>
      {entries.map(([e, x]) => (
        <button key={e} className={`react ${x.mine ? 'mine' : ''}`} onClick={() => onReact(e)}>
          {e} <span className="n">{x.count}</span>
        </button>
      ))}
      <button className="btn ghost sm" onClick={() => setOpen((o) => !o)} title="React">
        <Icon name="smile" />
      </button>
      {open && <EmojiPicker style={{ top: 30, left: 0 }} onClose={() => setOpen(false)} onPick={(e) => { setOpen(false); onReact(e) }} />}
    </span>
  )
}

function Notes(props: {
  isle: Isle
  marks: Marks | null
  layer: Layer
  setLayer: (l: Layer) => void
  active: Picked | null
  setActive: (p: Picked | null) => void
  reload: () => void
  focusEl: (anchor: Anchor | null) => void
  focused: string | null
  setFocused: (id: string | null) => void
  requireMe: () => boolean
  toast: (m: string) => void
}) {
  const { isle, marks, layer, setLayer, active, setActive, reload, focusEl, focused, setFocused, requireMe, toast } = props
  // clicking a comment (anywhere but its buttons and links) brings its piece up in the isle
  const pick = (root: Mark) => (e: React.MouseEvent) => {
    if ((e.target as Element).closest('button, a, textarea, input, .emoji-pop')) return
    if (!root.anchor) return
    if (focused === root.id) {
      setFocused(null)
      focusEl(null)
      return
    }
    setFocused(root.id)
    focusEl(root.anchor)
  }
  const { me } = useSession()
  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState<Mark | null>(null)
  const [busy, setBusy] = useState(false)
  const key = active?.anchor.selector ?? ''
  const tally = marks?.tallies.find((t) => t.anchorKey === key)

  const send = async () => {
    if (!requireMe() || !body.trim()) return
    setBusy(true)
    try {
      await api.comment(isle.id, body, { anchor: replyTo ? null : active?.anchor ?? null, replyTo: replyTo?.id, snippet: active?.snippet ?? undefined })
      setBody('')
      setReplyTo(null)
      if (layer === 'mine' || layer === 'author' || layer === 'following' || layer === 'everyone') reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const starPiece = async () => {
    if (!requireMe() || !active) return
    await api.star(isle.id, { anchor: active.anchor, on: !tally?.starredByMe, snippet: active.snippet ?? undefined })
    toast(tally?.starredByMe ? 'Removed from your library' : 'Starred: in your library now')
    reload()
  }

  const threads = useMemo(() => {
    const roots = (marks?.comments ?? []).filter((c) => !c.parentId && (!active || c.anchorKey === key))
    const replies = new Map<string, Mark[]>()
    for (const c of marks?.comments ?? []) if (c.parentId) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c])
    return roots.map((r) => ({ root: r, replies: replies.get(r.id) ?? [] })).reverse()
  }, [marks, active, key])

  const pieces = (marks?.tallies ?? []).filter((t) => t.anchorKey)
  const hidden = marks ? marks.layers.everyone - marks.layers[layer] : 0

  return (
    <div>
      <div className="compose">
        <div className="row compose-head" style={{ marginBottom: 8 }}>
          {active ? (
            <>
              <button className="anchor-chip ellipsis" onClick={() => focusEl(active.anchor)} title={active.anchor.selector}>
                ◎ {active.anchor.label || active.anchor.selector}
              </button>
              <span className="grow" />
              <button className="btn ghost sm compose-x" onClick={() => setActive(null)} title="Back to the whole isle" aria-label="Back to the whole isle"><Icon name="close" /></button>
            </>
          ) : (
            <span className="small muted">On the whole isle · or use <Icon name="comment" className="inline-icon" /> above to point at one part</span>
          )}
        </div>
        {active && (
          <div className="row" style={{ marginBottom: 8 }}>
            <button className={`btn sm ${tally?.starredByMe ? 'on' : ''}`} onClick={starPiece}>
              <span style={{ color: 'var(--star)', display: 'inline-flex' }}><Icon name="star" filled={!!tally?.starredByMe} /></span>
              {tally?.starredByMe ? 'In your library' : 'Star this piece'}
            </button>
          </div>
        )}
        {replyTo && (
          <div className="small muted" style={{ marginBottom: 4 }}>
            Replying to {who(replyTo.user)} <button className="btn ghost sm" onClick={() => setReplyTo(null)}>cancel</button>
          </div>
        )}
        <textarea
          className="field"
          placeholder={me ? (active ? 'Say something about this piece' : 'Say something about this isle') : 'Sign in to comment'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onFocus={() => requireMe()}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && send()}
          rows={3}
        />
        <div className="row" style={{ marginTop: 6, justifyContent: 'flex-end' }}>
          <button className="btn primary sm" disabled={busy || !body.trim()} onClick={send}>Comment</button>
        </div>
      </div>

      <div className="seg layers" style={{ marginBottom: 6, display: 'flex' }}>
        {LAYERS.map((l) => (
          <button key={l.id} className={layer === l.id ? 'on' : ''} onClick={() => setLayer(l.id)} title={marks ? `${marks.layers[l.id]} comment${marks.layers[l.id] === 1 ? '' : 's'}` : undefined}>
            {l.label}{marks && marks.layers[l.id] > 0 ? <span className="n">{marks.layers[l.id]}</span> : null}
          </button>
        ))}
      </div>
      {hidden > 0 && (
        <p className="tiny muted" style={{ margin: '4px 0 10px' }}>
          {hidden} more comment{hidden === 1 ? '' : 's'} in{' '}
          <button className="btn ghost sm" style={{ padding: '0 4px' }} onClick={() => setLayer('everyone')}>Everyone</button>
        </p>
      )}

      {!active && pieces.length > 0 && (
        <div style={{ margin: '12px 0' }}>
          <div className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>Marked pieces</div>
          {pieces.map((t) => (
            <div
              key={t.anchorKey}
              className="piece"
              onClick={() => {
                focusEl(t.anchor ?? { selector: t.anchorKey })
                setActive({ anchor: t.anchor ?? { selector: t.anchorKey }, snippet: null })
              }}
            >
              <span className="grow ellipsis small" style={{ fontWeight: 600 }}>◎ {t.anchor?.label || t.anchorKey}</span>
              {t.stars > 0 && <span className="stars small"><Icon name="star" filled />{t.stars}</span>}
              {t.comments > 0 && <span className="small muted">💬{t.comments}</span>}
            </div>
          ))}
        </div>
      )}

      {threads.length === 0 ? (
        <p className="small muted" style={{ textAlign: 'center', padding: 16 }}>
          {active ? 'Nothing said about this piece yet.' : `No comments in this layer${hidden ? '' : ' yet'}.`}
        </p>
      ) : (
        threads.map(({ root, replies }) => (
          <div
            key={root.id}
            className={`comment ${root.anchor ? 'anchored' : ''} ${focused === root.id ? 'focused' : ''}`}
            id={`c-${root.id}`}
            onClick={pick(root)}
            title={root.anchor ? `Show ${root.anchor.label || 'the piece'} in the isle` : undefined}
          >
            <CommentLine c={root} isle={isle} onReply={() => setReplyTo(root)} reload={reload} showAnchor={!active} />
            {replies.length > 0 && (
              <div className="replies">
                {replies.map((r) => (
                  <div key={r.id} id={`c-${r.id}`}>
                    <CommentLine c={r} isle={isle} onReply={() => setReplyTo(root)} reload={reload} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

function CommentLine({ c, isle, onReply, reload, showAnchor }: { c: Mark; isle: Isle; onReply: () => void; reload: () => void; showAnchor?: boolean }) {
  const { me } = useSession()
  const canDelete = me && (me.id === c.user.id || me.id === isle.owner.id)
  return (
    <div>
      <div className="head">
        <b><PersonLink person={c.user} /></b>
        {c.user.id === isle.owner.id && <span className="chip">author</span>}
        <span className="tiny muted">{ago(c.createdAt)}</span>
      </div>
      {showAnchor && c.anchor && (
        <span className="anchor-chip ellipsis" style={{ margin: '4px 0' }}>
          ◎ {c.anchor.label || c.anchor.selector}
        </span>
      )}
      <div className="body">{c.body}</div>
      <div className="row">
        <CommentReactions
          reactions={c.reactions ?? {}}
          onReact={async (e) => {
            if (!me) return navigate(`/login?next=${encodeURIComponent(location.pathname)}`)
            await api.react(isle.id, c.id, e)
            reload()
          }}
        />
        {me && <button className="btn ghost sm" onClick={onReply}>Reply</button>}
        {canDelete && (
          <button className="btn ghost sm danger" onClick={async () => { if (confirm('Delete this comment?')) { await api.deleteMark(c.id); reload() } }}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

function chain(ancestors: TreeNode[], subject: TreeNode): TreeNode[] {
  if (!ancestors.length) return [subject]
  const nodes = ancestors.map((a) => ({ ...a, children: [] as TreeNode[] }))
  for (let k = 0; k < nodes.length - 1; k++) nodes[k]!.children = [nodes[k + 1]!]
  nodes[nodes.length - 1]!.children = [subject]
  return [nodes[0]!]
}

function Family({ isle }: { isle: Isle }) {
  const lineage = useAsync(() => api.isleLineage(isle.id), [isle.id, isle.version])
  if (lineage.error) return <ErrorBox error={lineage.error} />
  if (!lineage.data) return <p className="muted small">Loading…</p>
  const { ancestors, tree } = lineage.data
  const remixes = (n: TreeNode): number => n.children.reduce((t, c) => t + 1 + remixes(c), 0)
  const below = remixes(tree)
  // cousins: same data, but not already in the line above
  const inLine = new Set<string>()
  const walk = (n: TreeNode) => { inLine.add(n.id); n.children.forEach(walk) }
  ancestors.forEach((a) => inLine.add(a.id))
  walk(tree)
  const cousins = (isle.sameData ?? []).filter((x) => !inLine.has(x.id))
  return (
    <div className="stack">
      <div className="row" style={{ gap: 6 }}>
        <span className="small muted grow">
          {ancestors.length ? `Made from ${ancestors.length === 1 ? 'one isle' : `a line of ${ancestors.length}`}` : 'An original'}
          {below ? ` · ${below} remix${below === 1 ? '' : 'es'} grew from it` : ' · no remixes yet'}
        </span>
        {isle.visibility === 'public' && <Link to={`/tree?isle=${isle.id}`} className="btn ghost sm" title="Where it sits on the map"><Icon name="map" /> Map</Link>}
      </div>
      <Link to={`/i/${isle.id}/family`} className="btn sm self-start" title="Every remix and version as a graph: what changed at each step, which features each one has, and a side-by-side compare">
        <Icon name="tree" /> See how it evolved
      </Link>
      <ThreadView roots={chain(ancestors, tree)} current={isle.id} />
      <div>
        <div className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>{isle.samePage.length ? 'Same page as' : 'Its page'}</div>
        {isle.samePage.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>Its own</p>
        ) : (
          <>
            {isle.samePage.map((x) => (
              <Link key={x.id} to={`/i/${x.id}`} className="piece">
                <span className="grow ellipsis small">{x.title}</span>
                <span className="tiny muted">{who(x.owner)}</span>
              </Link>
            ))}
          </>
        )}
      </div>
      {cousins.length > 0 && (
        <div>
          <div className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>Same data as</div>
          {cousins.map((x) => (
            <Link key={x.id} to={`/i/${x.id}`} className="piece">
              <span className="grow ellipsis small">{x.title}</span>
              <span className="tiny muted">{who(x.owner)}</span>
            </Link>
          ))}
        </div>
      )}
      {isle.uses.length > 0 && (
        <div>
          <div className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>Borrows from</div>
          {isle.uses.map((u) => (
            <Link key={u.isle.id + (u.selector ?? '')} to={`/i/${u.isle.id}`} className="piece">
              <span className="grow ellipsis small">{u.label ?? u.isle.title}</span>
              <span className="tiny muted">{u.isle.title}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function DataTab({ isle, onUseData }: { isle: Isle; onUseData: () => void }) {
  const [shown, setShown] = useState<string | null>(null)
  // each dataset once, however many slots read it
  const data = [...new Map(Object.values(isle.bindings).filter((d): d is NonNullable<typeof d> => !!d).map((d) => [d.id, d])).values()]
  return (
    <div className="stack">
      {isle.description && (
        <div className="isle-desc">
          <FoldedMarkdown text={isle.description} lines={6} />
        </div>
      )}
      <div>
        <div className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>Data it shows</div>
        {data.length === 0 && <p className="small muted" style={{ margin: 0 }}>This isle reads no data.</p>}
        {data.map((d) => (
          <button key={d.id} className="piece data-piece" onClick={() => setShown(d.id)} title="Look at it">
            <span className="kind">{d.kind}</span>
            <span className="grow ellipsis small" style={{ textAlign: 'left' }}>{d.path}</span>
            <span className="tiny muted">{who(d.owner)}</span>
          </button>
        ))}
      </div>
      {data.length > 0 && (
        <div className="piece" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <b className="small">See it with your data</b>
          <span className="tiny muted">Pick or drop your data (any shape) or say what to fetch; your AI fits it to this isle, publishes your version and tests it.</span>
          <div><button className="btn primary sm" onClick={onUseData}><Icon name="data" /> Use my data…</button></div>
        </div>
      )}
      <DataSources isle={isle} />
      <div className="row">
        <a className="btn sm" href={`/api/isles/${isle.id}/source`} target="_blank" rel="noreferrer"><Icon name="code" /> Page source</a>
      </div>
      {shown && <DataModal id={shown} onClose={() => setShown(null)} />}
    </div>
  )
}

/** The owner's settings for an isle, in the side panel: who sees it, its names on the map, its description. */
function IsleSettings({ isle, onChanged }: { isle: Isle; onChanged: () => void }) {
  const { toast } = useSession()
  const [title, setTitle] = useState(isle.title)
  const [shortTitle, setShortTitle] = useState(isle.shortTitle ?? '')
  const [viewName, setViewName] = useState(isle.viewName ?? '')
  const [description, setDescription] = useState(isle.description ?? '')
  const [visibility, setVisibility] = useState<Visibility>(isle.visibility)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await api.updateIsle(isle.id, { title, description, visibility, shortTitle: shortTitle.trim() || null, viewName: viewName.trim() || null })
      toast(visibility === isle.visibility ? 'Saved' : `Now ${VISIBILITY_LABEL[visibility].toLowerCase()}`)
      onChanged()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const options: { v: Visibility; label: string; hint: string }[] = [
    { v: 'public', label: 'Public', hint: 'On the map and Explore. Anyone can see and remix it.' },
    { v: 'unlisted', label: 'Unlisted', hint: 'Anyone with the link can see and remix it; not on the map.' },
    { v: 'private', label: 'Private', hint: 'Only you.' },
  ]
  return (
    <div className="isle-settings">
      <label className="lbl" style={{ marginTop: 0 }}>Who can see it</label>
      <div className="stack" style={{ gap: 6 }}>
        {options.map((o) => (
          <label key={o.v} className={`choice ${visibility === o.v ? 'on' : ''}`}>
            <input type="radio" name="visibility" checked={visibility === o.v} onChange={() => setVisibility(o.v)} />
            <span>
              <b>{o.label}</b>
              <span className="small muted" style={{ display: 'block' }}>{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {visibility !== 'private' && isle.visibility === 'private' && (
        <p className="small muted">Any of your private data this isle shows becomes public with it.</p>
      )}
      <label className="lbl">Title</label>
      <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="lbl">Short title on the map</label>
      <input className="field" value={shortTitle} maxLength={40} placeholder="e.g. Matchmaker rejection" onChange={(e) => setShortTitle(e.target.value)} />
      <label className="lbl">Kind of page</label>
      <input className="field" value={viewName} maxLength={40} placeholder="e.g. Discourse map" onChange={(e) => setViewName(e.target.value)} />
      <label className="lbl">Description</label>
      <textarea className="field" value={description} onChange={(e) => setDescription(e.target.value)} rows={6} />
      <div className="row" style={{ marginTop: 14 }}>
        <button
          className="btn sm danger"
          onClick={async () => {
            if (!confirm(`Delete "${isle.title}"? Remixes of it stay.`)) return
            await api.deleteIsle(isle.id)
            toast('Deleted')
            navigate('/')
          }}
        >
          <Icon name="trash" /> Delete isle
        </button>
        <span className="grow" />
        <button className="btn primary" disabled={busy} onClick={save}>Save</button>
      </div>
    </div>
  )
}

function History({ isle, viewing, setViewing }: { isle: Isle; viewing: IsleVersion | null; setViewing: (v: IsleVersion | null) => void }) {
  const versions = useAsync(() => api.versions(isle.id), [isle.id, isle.version])
  if (versions.error) return <ErrorBox error={versions.error} />
  if (!versions.data) return <p className="muted small">Loading…</p>
  const shown = viewing?.version ?? isle.version
  return (
    <div>
      <p className="small muted" style={{ marginTop: 0 }}>Every update keeps the version before it. Click one to look at it.</p>
      {versions.data.map((v) => (
        <div key={v.version} className={`piece ${shown === v.version ? 'on' : ''}`} style={{ alignItems: 'flex-start' }} onClick={() => setViewing(v.current ? null : v)}>
          <span className="chip" style={{ flex: 'none' }}>v{v.version}</span>
          <span className="grow small">
            {v.note ?? <span className="muted">{v.version === 1 ? 'First version' : 'No note'}</span>}
            <span className="tiny muted" style={{ display: 'block' }}>{v.current ? 'latest · ' : ''}{ago(v.createdAt)}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

/** Remix starts with what you want different; the AI makes a new isle with a line back to this one. */
function RemixPopover({ isle, onClose, onUseData }: { isle: Isle; onClose: () => void; onUseData: () => void }) {
  const url = `${location.origin}/i/${isle.id}`
  return (
    <AskPopover
      title={<>Remix “{isle.title}”</>}
      blurb="Your AI makes a new isle from this one. This one stays as it is, and yours keeps a line back to it."
      placeholder="What do you want different? e.g. the same thing for Kennewick, or a darker look"
      label="Remix with"
      prompt={(want) =>
        `Using the Prolifica connector, read isle ${isle.id} ("${isle.title}", ${url}) with get_isle, including its HTML, and remix it into a new isle: publish_isle with parent: "${isle.id}". Keep its data bindings unless what I want needs different data; if it does, find or collect that data first and save it to my Prolifica data with its source.\n\nWhat I want different: ${want}\n\nTell me the link when it's done.`
      }
      onClose={onClose}
    >
      <div className="pop-alt">
        <button className="btn ghost sm" onClick={onUseData}><Icon name="data" /> Same look, my data</button>
      </div>
    </AskPopover>
  )
}
