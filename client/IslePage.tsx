import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Anchor, Dataset, Isle, IsleVersion, Mark, TreeNode, Visibility } from '../shared/types'
import { ago, api, type Layer, type Marks, who } from './api'
import { navigate } from './navigate'
import { AskAiButton, AskPopover, changesPrompt, type ChangeNote, useChangeNotes } from './ask'
import { Legend, ThreadView } from './Tree'
import { UseMyDataModal } from './UseMyData'
import {
  EmojiPicker, ErrorBox, Icon, Link, Modal, PersonLink, RelationChip, SizedFrame, useAsync, useSession,
} from './ui'

type Tab = 'notes' | 'changes' | 'family' | 'data' | 'history'
type Picked = { anchor: Anchor; snippet: string | null }

const LAYERS: { id: Layer; label: string }[] = [
  { id: 'mine', label: 'Mine' },
  { id: 'author', label: 'Author' },
  { id: 'following', label: 'Following' },
  { id: 'everyone', label: 'Everyone' },
]

export function IslePage({ id }: { id: string }) {
  const { me, toast } = useSession()
  const isle = useAsync(() => api.isle(id), [id, me?.id])
  const [layer, setLayer] = useState<Layer>('following')
  const [marks, setMarks] = useState<Marks | null>(null)
  const [tab, setTab] = useState<Tab | null>(() => (window.innerWidth > 860 ? 'notes' : null))
  const [picking, setPicking] = useState(false)
  // what the next picked piece is for: a mark (star, comment) or a change to ask the AI for
  const [pickFor, setPickFor] = useState<'mark' | 'change'>('mark')
  const [changes, setChanges] = useChangeNotes(id)
  const [changeDraft, setChangeDraft] = useState<{ anchor: Anchor | null } | null>(null)
  const [active, setActive] = useState<Picked | null>(null)
  // the comment whose piece is ringed in the isle right now
  const [focusedComment, setFocusedComment] = useState<string | null>(null)
  const [remixOpen, setRemixOpen] = useState(false)
  const [useDataOpen, setUseDataOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
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
  useEffect(() => setReady(false), [frameSrc])
  useEffect(() => setViewing(null), [id])

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

  // what the isle tells us
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== frameOrigin || e.source !== frame.current?.contentWindow) return
      const m = e.data as { prolifica?: number; t?: string; anchor?: Anchor; snippet?: string; key?: string }
      if (!m?.prolifica) return
      if (m.t === 'ready') setReady(true)
      if (m.t === 'picked' && m.anchor) {
        setPicking(false)
        if (pickFor === 'change') {
          setChangeDraft({ anchor: m.anchor })
          setTab('changes')
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
    // pending change requests show as ✎ pins (numbered like the list)
    const changePins = new Map<string, number[]>()
    changes.forEach((c, k) => c.anchor && changePins.set(c.anchor.selector, [...(changePins.get(c.anchor.selector) ?? []), k + 1]))
    post({
      t: 'pins',
      items: [
        ...[...changePins].map(([selector, nums]) => ({ selector, text: `✎ ${nums.join(', ')}`, title: 'Change you will ask for', mine: true })),
        ...marks.tallies
        .filter((t) => t.anchorKey && !changePins.has(t.anchorKey))
        .map((t) => {
          const bits = [t.stars ? `★${t.stars}` : '', t.comments ? `💬${t.comments}` : '']
          return { selector: t.anchorKey, text: bits.filter(Boolean).join(' '), title: t.anchor?.label ?? '', mine: t.starredByMe }
        }),
      ],
    })
  }, [ready, marks, post, changes])

  useEffect(() => {
    if (ready) post({ t: 'pick', on: picking })
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
    <div className="isle-page">
      <div className="isle-bar">
        <div className="grow" style={{ minWidth: 200 }}>
          <h1 className="ellipsis">{i.title}</h1>
          <div className="sub">
            <span>by <PersonLink person={i.owner} /></span>
            <button className="chip" style={{ cursor: 'pointer' }} onClick={() => setTab('history')} title="Version history">
              v{i.version}
            </button>
            {i.parent && (
              <>
                <RelationChip relation={i.relation} />
                <span>from <Link to={`/i/${i.parent.id}`}>{i.parent.title}</Link> by {who(i.parent.owner)}</span>
              </>
            )}
            {!mine && i.visibility !== 'public' && <span className="chip"><Icon name="lock" /> {i.visibility}</span>}
            {i.childCount > 0 && (
              <button className="chip" style={{ cursor: 'pointer' }} onClick={() => setTab('family')}>
                {i.childCount} remix{i.childCount === 1 ? '' : 'es'}
              </button>
            )}
          </div>
        </div>
        {mine && (
          <button className={`btn ${i.visibility === 'private' ? 'primary' : ''}`} onClick={() => setSettingsOpen(true)} title="Title, description and who can see it">
            <Icon name={i.visibility === 'private' ? 'lock' : 'open'} />
            {i.visibility === 'private' ? 'Publish' : `${VISIBILITY_LABEL[i.visibility]} · Edit`}
          </button>
        )}
        <button className={`btn ${page?.starredByMe ? 'on' : ''}`} onClick={starPage} title="Star this isle">
          <span style={{ color: 'var(--star)', display: 'inline-flex' }}><Icon name="star" filled={!!page?.starredByMe} /></span>
          {page?.stars || i.starCount || ''}
        </button>
        <button
          className={`btn ${picking && pickFor === 'mark' ? 'on' : ''}`}
          onClick={() => {
            if (!requireMe()) return
            setPickFor('mark')
            setPicking((p) => !(p && pickFor === 'mark'))
          }}
          title="Star or comment on one piece"
        >
          <Icon name="pick" /> {picking && pickFor === 'mark' ? 'Picking…' : 'Mark a piece'}
        </button>
        <button
          className={`btn ${tab === 'changes' ? 'on' : ''}`}
          onClick={() => {
            setTab('changes')
            setPickFor('change')
            setPicking(true)
          }}
          title="Point at pieces, say what should change, and hand the list to your AI"
        >
          <Icon name="edit" /> Ask for changes{changes.length ? ` (${changes.length})` : ''}
        </button>
        <span className="pop-anchor">
          <button className={`btn primary ${remixOpen ? 'on' : ''}`} onClick={() => setRemixOpen((o) => !o)} aria-expanded={remixOpen}>
            <Icon name="remix" /> Remix
          </button>
          {remixOpen && (
            <RemixPopover
              isle={i}
              onClose={() => setRemixOpen(false)}
              onUseData={() => { setRemixOpen(false); setUseDataOpen(true) }}
              onAskChanges={() => { setRemixOpen(false); setTab('changes'); setPickFor('change'); setPicking(true) }}
            />
          )}
        </span>
        <button className={`btn ghost ${tab ? 'on' : ''}`} onClick={() => setTab((t) => (t ? null : 'notes'))} title="Notes, family, data, history">
          <Icon name="panel" />
          {marks && marks.layers.everyone > 0 ? <span className="tiny">{marks.layers.everyone}</span> : null}
        </button>
      </div>

      <div className="isle-body">
        <div className="isle-frame">
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
            title={i.title}
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads"
            allow="clipboard-write; fullscreen"
          />
        </div>
        {tab && (
          <aside className="panel">
            <div className="tabs">
              <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>Notes</button>
              <button className={tab === 'changes' ? 'on' : ''} onClick={() => setTab('changes')}>Changes{changes.length ? ` ${changes.length}` : ''}</button>
              <button className={tab === 'family' ? 'on' : ''} onClick={() => setTab('family')}>Family</button>
              <button className={tab === 'data' ? 'on' : ''} onClick={() => setTab('data')}>Data</button>
              <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History</button>
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
              {tab === 'changes' && (
                <Changes
                  isle={i}
                  mine={mine}
                  notes={changes}
                  setNotes={setChanges}
                  draft={changeDraft}
                  setDraft={setChangeDraft}
                  picking={picking && pickFor === 'change'}
                  startPicking={() => {
                    setPickFor('change')
                    setPicking(true)
                  }}
                  stopPicking={() => setPicking(false)}
                  focusEl={focusEl}
                  toast={toast}
                />
              )}
              {tab === 'family' && <Family isle={i} />}
              {tab === 'data' && <DataTab isle={i} onUseData={() => setUseDataOpen(true)} />}
              {tab === 'history' && <History isle={i} viewing={viewing} setViewing={setViewing} />}
            </div>
          </aside>
        )}
      </div>
      {settingsOpen && <IsleSettings isle={i} onClose={() => setSettingsOpen(false)} onChanged={isle.reload} />}
      {useDataOpen && <UseMyDataModal isle={i} onClose={() => setUseDataOpen(false)} />}
    </div>
  )
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

function Changes(props: {
  isle: Isle
  mine: boolean
  notes: ChangeNote[]
  setNotes: (n: ChangeNote[]) => void
  draft: { anchor: Anchor | null } | null
  setDraft: (d: { anchor: Anchor | null } | null) => void
  picking: boolean
  startPicking: () => void
  stopPicking: () => void
  focusEl: (anchor: Anchor | null) => void
  toast: (m: string) => void
}) {
  const { isle, mine, notes, setNotes, draft, setDraft, picking, startPicking, stopPicking, focusEl, toast } = props
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (draft) box.current?.focus()
  }, [draft])
  const anchor = draft?.anchor ?? null
  const add = () => {
    if (!text.trim()) return
    setNotes([...notes, { id: Math.random().toString(36).slice(2), anchor, text: text.trim() }])
    setText('')
    setDraft(null)
  }
  const prompt = changesPrompt(isle, notes, mine, location.origin)
  return (
    <div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Point at pieces and say what should change. The list goes to your AI as one prompt, then it's forgotten: nothing here is saved or shown to anyone.
      </p>
      <div className="compose">
        <div className="row compose-head" style={{ marginBottom: 8 }}>
          {anchor ? (
            <>
              <button className="anchor-chip ellipsis" onClick={() => focusEl(anchor)} title={anchor.selector}>✎ {anchor.label || anchor.selector}</button>
              <span className="grow" />
              <button className="btn ghost sm compose-x" onClick={() => setDraft(null)} title="About the whole isle instead" aria-label="About the whole isle instead"><Icon name="close" /></button>
            </>
          ) : (
            <span className="small muted">About the whole isle</span>
          )}
          {!anchor && <span className="grow" />}
          {!anchor && (
            <button className={`btn sm ${picking ? 'on' : ''}`} onClick={() => (picking ? stopPicking() : startPicking())}>
              <Icon name="pick" /> {picking ? 'Click a piece…' : 'Pick a piece'}
            </button>
          )}
        </div>
        <textarea
          ref={box}
          className="field"
          rows={3}
          placeholder={anchor ? 'What should change about this piece?' : 'What should change?'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && add()}
        />
        <div className="row" style={{ marginTop: 6, justifyContent: 'flex-end' }}>
          <button className="btn sm" disabled={!text.trim()} onClick={add}>Add to list</button>
        </div>
      </div>

      {notes.length === 0 ? (
        <p className="small muted" style={{ textAlign: 'center', padding: 12 }}>No changes yet.</p>
      ) : (
        <>
          <ol className="change-list">
            {notes.map((n) => (
              <li key={n.id}>
                <div className="grow">
                  {n.anchor ? (
                    <button className="anchor-chip ellipsis" onClick={() => focusEl(n.anchor)}>✎ {n.anchor.label || n.anchor.selector}</button>
                  ) : (
                    <span className="tiny muted">Whole isle</span>
                  )}
                  <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{n.text}</div>
                </div>
                <button className="btn ghost sm" title="Remove" onClick={() => setNotes(notes.filter((x) => x.id !== n.id))}><Icon name="close" /></button>
              </li>
            ))}
          </ol>
          <div className="row" style={{ marginTop: 10 }}>
            <AskAiButton
              prompt={prompt}
              onAsk={() => {
                setNotes([])
                toast(mine ? 'Handed over; your AI will update the isle' : 'Handed over; your AI will make your version')
              }}
            />
            <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(prompt).then(() => toast('Prompt copied'))}>
              <Icon name="copy" /> Copy prompt
            </button>
            <span className="grow" />
            <button className="btn ghost sm" onClick={() => setNotes([])}>Clear</button>
          </div>
          <p className="tiny muted">{mine ? 'Your AI updates this isle (a new version).' : "It's not yours, so your AI makes your own remix."} Needs Prolifica connected to your AI (<Link to="/connect">how</Link>).</p>
        </>
      )}
    </div>
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
            <span className="small muted">On the whole isle · or <b>Mark a piece</b> to point at one part</span>
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

      <div className="seg" style={{ marginBottom: 6, display: 'flex' }}>
        {LAYERS.map((l) => (
          <button key={l.id} className={layer === l.id ? 'on' : ''} style={{ flex: 1 }} onClick={() => setLayer(l.id)}>
            {l.label} {marks ? <span className="tiny">{marks.layers[l.id]}</span> : null}
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
  const { ancestors, tree, related } = lineage.data
  return (
    <div className="stack">
      <div>
        <div className="row">
          <div className="small muted grow" style={{ fontWeight: 600 }}>Where it came from, and what grew from it</div>
          {isle.visibility === 'public' && <Link to={`/tree?isle=${isle.id}`} className="tiny">Show on the map</Link>}
        </div>
        <Link to={`/i/${isle.id}/family`} className="btn sm" title="Every remix and version, what changed at each step, and a side-by-side compare">
          <Icon name="open" /> See how it evolved
        </Link>
        <Legend />
        <ThreadView roots={chain(ancestors, tree)} current={isle.id} />
      </div>
      {related.length > 0 && (
        <div>
          <div className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>Data it shows</div>
          {related.map((d) => (
            <Link key={d.id} to={`/d/${d.id}`} className="piece" >
              <span className="kind">data</span>
              <span className="grow ellipsis small">{d.title}</span>
              <span className="tiny muted">{who(d.owner)}</span>
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
  const { me, toast } = useSession()
  const myData = useAsync(() => (me ? api.data() : Promise.resolve([] as Dataset[])), [me?.id])
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const slots = Object.keys({ ...isle.slots, ...isle.bindings })

  const rebind = async () => {
    setBusy(true)
    try {
      const bindings = Object.fromEntries(slots.map((s) => [s, choice[s] || isle.bindings[s]?.id || '']).filter(([, v]) => v))
      const child = await api.rebind(isle.id, bindings)
      toast('Your version is up')
      navigate(`/i/${child.id}`)
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      {isle.description && <p style={{ margin: 0 }}>{isle.description}</p>}
      {slots.length > 0 && (
        <div className="piece" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <b className="small">See it with your data</b>
          <span className="tiny muted">Pick or drop your data (any shape) or say what to fetch; your AI fits it to this isle, publishes your version and tests it.</span>
          <div><button className="btn primary sm" onClick={onUseData}><Icon name="data" /> Use my data…</button></div>
        </div>
      )}
      <div>
        <div className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>Slots</div>
        {slots.length === 0 && <p className="small muted">This isle reads no data.</p>}
        {slots.map((s) => {
          const d = isle.bindings[s]
          const spec = isle.slots[s]
          return (
            <div key={s} className="piece" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row">
                <code style={{ fontWeight: 700 }}>{s}</code>
                {spec?.kind && <span className="kind">{spec.kind}</span>}
                <span className="grow" />
                {d ? <Link to={`/d/${d.id}`} className="small ellipsis">{d.path}</Link> : <span className="small err">unbound</span>}
              </div>
              {spec?.description && <div className="tiny muted">{spec.description}</div>}
              {me && (myData.data?.length ?? 0) > 0 && (
                <select className="field" style={{ marginTop: 6 }} value={choice[s] ?? ''} onChange={(e) => setChoice((c) => ({ ...c, [s]: e.target.value }))}>
                  <option value="">Keep {d ? d.path : '(none)'}</option>
                  {myData.data!
                    .filter((x) => !spec?.kind || spec.kind === 'any' || x.kind === spec.kind)
                    .map((x) => (
                      <option key={x.id} value={x.id}>{x.path}</option>
                    ))}
                </select>
              )}
            </div>
          )
        })}
        {me && slots.length > 0 && (
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn primary sm" disabled={busy || !Object.values(choice).some(Boolean)} onClick={rebind}>
              <Icon name="remix" /> Bind these as they are
            </button>
            <span className="tiny muted">Only when your data already fits each slot exactly.</span>
          </div>
        )}
      </div>
      <div className="row">
        <a className="btn sm" href={`/api/isles/${isle.id}/source`} target="_blank" rel="noreferrer"><Icon name="open" /> Source</a>
        <a className="btn sm" href={isle.frameUrl} target="_blank" rel="noreferrer"><Icon name="open" /> Open alone</a>
      </div>
    </div>
  )
}

function IsleSettings({ isle, onClose, onChanged }: { isle: Isle; onClose: () => void; onChanged: () => void }) {
  const { toast } = useSession()
  const [title, setTitle] = useState(isle.title)
  const [description, setDescription] = useState(isle.description ?? '')
  const [visibility, setVisibility] = useState<Visibility>(isle.visibility)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await api.updateIsle(isle.id, { title, description, visibility })
      toast(visibility === isle.visibility ? 'Saved' : `Now ${VISIBILITY_LABEL[visibility].toLowerCase()}`)
      onChanged()
      onClose()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const options: { v: Visibility; label: string; hint: string }[] = [
    { v: 'public', label: 'Public', hint: 'Listed on Explore. Anyone can see and remix it.' },
    { v: 'unlisted', label: 'Unlisted', hint: 'Anyone with the link can see and remix it; not listed.' },
    { v: 'private', label: 'Private', hint: 'Only you.' },
  ]
  return (
    <Modal onClose={onClose}>
      <h2>Publish</h2>
      <label className="lbl">Who can see it</label>
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
      <label className="lbl">Description</label>
      <textarea className="field" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
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
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={save}>Save</button>
      </div>
    </Modal>
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
function RemixPopover({ isle, onClose, onUseData, onAskChanges }: { isle: Isle; onClose: () => void; onUseData: () => void; onAskChanges: () => void }) {
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
        <button className="btn ghost sm" onClick={onAskChanges}><Icon name="pick" /> Point at pieces</button>
      </div>
      <p className="tiny muted" style={{ margin: '6px 0 0' }}>Not connected yet? <Link to="/connect">Connect your AI</Link>.</p>
    </AskPopover>
  )
}
