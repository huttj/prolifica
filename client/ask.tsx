import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Anchor } from '../shared/types'
import { ConnectSteps } from './Settings'
import { Icon, Link, Modal, useSession } from './ui'

/**
 * Handing work to the person's own AI (the Causal Tools pattern): claude.ai and chatgpt.com can't be
 * framed (they refuse to load in an iframe), so the AI opens in a popup beside the app with the prompt
 * already typed. The MCP connector does the rest. Which AI is remembered per browser. Until the
 * person's AI has reached Prolifica once, handing off first shows how to connect it.
 */

export type AiId = 'claude' | 'chatgpt'
export const AI_LABEL: Record<AiId, string> = { claude: 'Claude', chatgpt: 'ChatGPT' }
const LAST_AI_KEY = 'pf:lastAI'

export function aiUrl(ai: AiId, prompt: string) {
  return ai === 'claude' ? `https://claude.ai/new?q=${encodeURIComponent(prompt)}` : `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`
}

export function popupAI(url: string) {
  const w = 520
  const h = Math.min(860, (window.screen?.availHeight ?? 900) - 80)
  const left = window.screenX + window.outerWidth - w - 24
  const top = window.screenY + 64
  const win = window.open(url, 'prolifica-ai', `width=${w},height=${h},left=${left},top=${top}`)
  if (!win) window.open(url, '_blank')
}

export function useLastAi(): [AiId, (ai: AiId) => void] {
  const [ai, setAi] = useState<AiId>(() => {
    try {
      return localStorage.getItem(LAST_AI_KEY) === 'chatgpt' ? 'chatgpt' : 'claude'
    } catch {
      return 'claude'
    }
  })
  const choose = useCallback((next: AiId) => {
    setAi(next)
    try {
      localStorage.setItem(LAST_AI_KEY, next)
    } catch {
      /* storage unavailable */
    }
  }, [])
  return [ai, choose]
}

export function AiMark({ ai, size = 13 }: { ai: AiId; size?: number }) {
  return ai === 'claude' ? (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="#D97757" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 2v3.2M8 10.8V14M2.8 5l2.8 1.6M10.4 9.4l2.8 1.6M2.8 11l2.8-1.6M10.4 6.6l2.8-1.6" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="#10A37F" strokeWidth="2" aria-hidden="true">
      <circle cx="8" cy="8" r="5.2" />
      <path d="M8 4.6v6.8M4.6 8h6.8" strokeLinecap="round" />
    </svg>
  )
}

const SKIP_CONNECT_KEY = 'pf:connectedSaid'
const saidConnected = () => {
  try {
    return localStorage.getItem(SKIP_CONNECT_KEY) === '1'
  } catch {
    return false
  }
}

/** Shown instead of the hand-off while Prolifica hasn't been connected to the person's AI. */
function ConnectFirst({ ai, onGo, onClose }: { ai: AiId; onGo: () => void; onClose: () => void }) {
  const { me } = useSession()
  return (
    <Modal onClose={onClose} wide>
      <h2>Connect Prolifica to {AI_LABEL[ai]} first</h2>
      <p className="small muted" style={{ marginTop: 4 }}>
        Your AI does this through the Prolifica connector, and it doesn't look connected yet. Add it once (a minute), then come back and ask again.
        {!me && <> You'll also need an account: <Link to={`/login?next=${encodeURIComponent(location.pathname)}`}>sign in</Link>.</>}
      </p>
      <ConnectSteps />
      <div className="row" style={{ marginTop: 14 }}>
        <button
          className="btn ghost sm"
          onClick={() => {
            try {
              localStorage.setItem(SKIP_CONNECT_KEY, '1')
            } catch {
              /* storage unavailable */
            }
            onGo()
          }}
        >
          It's connected already
        </button>
        <span className="grow" />
        <button className="btn" onClick={onClose}>Not now</button>
        <button className="btn primary" onClick={onGo}>
          <span className="ask-mark"><AiMark ai={ai} /></span> Open {AI_LABEL[ai]} anyway
        </button>
      </div>
    </Modal>
  )
}

/** "Ask Claude" with a caret to switch AI. */
export function AskAiButton({ prompt, disabled, onAsk, label = 'Ask' }: { prompt: string; disabled?: boolean; onAsk?: () => void; label?: string }) {
  const [ai, choose] = useLastAi()
  const { me } = useSession()
  const [gate, setGate] = useState(false)
  const go = () => {
    popupAI(aiUrl(ai, prompt))
    onAsk?.()
  }
  const [menu, setMenu] = useState<{ right: number; top: number; up: boolean } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => {
      const t = e.target as Node
      if (!root.current?.contains(t) && !menuRef.current?.contains(t)) setMenu(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])
  const other: AiId = ai === 'claude' ? 'chatgpt' : 'claude'
  return (
    <div ref={root} className="ask">
      <a
        href={aiUrl(ai, prompt)}
        className={`btn primary ask-main ${disabled ? 'disabled' : ''}`}
        aria-disabled={disabled}
        onClick={(e) => {
          e.preventDefault()
          if (disabled) return
          if (!me?.connected && !saidConnected()) return setGate(true)
          go()
        }}
      >
        <span className="ask-mark"><AiMark ai={ai} /></span>
        {label} {AI_LABEL[ai]}
      </a>
      <button
        className="btn primary ask-caret"
        title="Use a different AI"
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          if (menu) return setMenu(null)
          const r = root.current!.getBoundingClientRect()
          const up = window.innerHeight - r.bottom < 100
          setMenu({ right: Math.max(4, window.innerWidth - r.right), top: up ? r.top - 4 : r.bottom + 4, up })
        }}
      >
        ▾
      </button>
      {menu &&
        createPortal(
          <div ref={menuRef} className="ask-menu card" style={{ right: menu.right, top: menu.top, transform: menu.up ? 'translateY(-100%)' : undefined }}>
            <button
              onClick={() => {
                choose(other)
                setMenu(null)
              }}
            >
              <AiMark ai={other} /> {label} {AI_LABEL[other]} instead
            </button>
          </div>,
          document.body,
        )}
      {gate &&
        createPortal(
          <ConnectFirst
            ai={ai}
            onClose={() => setGate(false)}
            onGo={() => {
              setGate(false)
              go()
            }}
          />,
          document.body,
        )}
    </div>
  )
}

// ---- asking with a description first ----

/**
 * A popover that asks what you want before handing it to your AI: the description goes into the
 * prompt. Closes on Escape or a click elsewhere (the AI switcher's menu counts as inside).
 */
export function AskPopover(props: {
  title: ReactNode
  blurb?: ReactNode
  placeholder: string
  label: string
  prompt: (want: string) => string
  onClose: () => void
  children?: ReactNode
  /** the AI can be asked without anything typed */
  optional?: boolean
  /** ready-made asks, one click to fill the box */
  suggestions?: string[]
  /** pieces of the page the ask is about (an isle's elements) */
  pieces?: AskPieces
}) {
  const { title, blurb, placeholder, label, prompt, onClose, children, optional, suggestions, pieces } = props
  const picking = !!pieces?.picking
  const [want, setWant] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // while a piece is being picked the popover hides but stays, so nothing typed is lost
    if (picking) return
    const away = (e: PointerEvent) => {
      const t = e.target as Element
      if (!ref.current?.contains(t) && !t.closest?.('.ask-menu, .pop-anchor, .scrim')) onClose()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose, picking])
  return (
    <div className="popover card" ref={ref} role="dialog" style={picking ? { display: 'none' } : undefined}>
      <b>{title}</b>
      {blurb && <p className="tiny muted" style={{ margin: '2px 0 8px' }}>{blurb}</p>}
      {pieces && (
        <div className="ask-pieces">
          {pieces.list.map((a, k) => (
            <span key={a.selector} className="anchor-chip ask-piece">
              <button className="link-btn ellipsis" onClick={() => pieces.focus(a)} title={a.selector}>✎ {k + 1}. {a.label || a.selector}</button>
              <button className="link-btn" onClick={() => pieces.remove(a.selector)} aria-label="Leave this piece out"><Icon name="close" /></button>
            </span>
          ))}
          <button className="btn sm" onClick={pieces.start} title="Point at a part of the page this is about">
            <Icon name="pick" /> {pieces.list.length ? 'Pick another' : 'Pick a piece'}
          </button>
        </div>
      )}
      {suggestions && suggestions.length > 0 && (
        <div className="ask-suggest">
          {suggestions.map((x) => (
            <button key={x} className={want === x ? 'on' : ''} onClick={() => setWant(x)}>{x}</button>
          ))}
        </div>
      )}
      <textarea autoFocus className="field" rows={3} placeholder={placeholder} value={want} onChange={(e) => setWant(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <AskAiButton
          label={label}
          prompt={prompt(want.trim())}
          disabled={!optional && !want.trim()}
          onAsk={() => {
            pieces?.clear()
            onClose()
          }}
        />
      </div>
      {children}
    </div>
  )
}

/** A button that opens an AskPopover under it. */
export function AskPopoverButton(props: Omit<Parameters<typeof AskPopover>[0], 'onClose'> & { button: ReactNode; align?: 'left' | 'right'; className?: string }) {
  const { button, align = 'right', className = 'btn primary', ...rest } = props
  const [open, setOpen] = useState(false)
  const [ai] = useLastAi()
  const picking = !!rest.pieces?.picking
  return (
    <span className="pop-anchor">
      <button
        className={`${className} ${open ? 'on' : ''}`}
        onClick={() => (picking ? rest.pieces!.cancel() : setOpen((o) => !o))}
        aria-expanded={open}
        title={picking ? 'Stop picking' : undefined}
      >
        <span className="ask-mark"><AiMark ai={ai} /></span>
        {picking ? 'Picking… (Esc)' : button}
      </button>
      {open && (
        <div className={`pop-${align}`}>
          <AskPopover {...rest} onClose={() => setOpen(false)} />
        </div>
      )}
    </span>
  )
}

// ---- asking about whatever page you're on ----

/** Pieces of an isle picked for an ask: the isle page owns them, the header's Ask shows them. */
export interface AskPieces {
  list: Anchor[]
  picking: boolean
  start: () => void
  cancel: () => void
  remove: (selector: string) => void
  clear: () => void
  /** ring it in the isle */
  focus: (a: Anchor) => void
}

/** What the header's Ask button knows about the page you're on. */
export interface AskTopic {
  /** "this isle", "your data" */
  about: string
  /** what the AI should read first, as the prompt's opening */
  context: string
  suggestions?: string[]
  pieces?: AskPieces
}

type TopicSlot = { topic: AskTopic | null; set: (t: AskTopic | null) => void }
export const AskTopicContext = createContext<TopicSlot>({ topic: null, set: () => {} })

/**
 * A page says what it's about while it's shown; the header's Ask button builds on it. It's re-sent when
 * its data changes (functions don't count, so pass stable ones).
 */
export function useAskTopic(topic: AskTopic | null) {
  const { set } = useContext(AskTopicContext)
  const key = topic ? JSON.stringify(topic) : ''
  useEffect(() => {
    set(topic)
    return () => set(null)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** The header's Ask: one steady way to hand anything on the site to your AI. */
export function HeaderAsk() {
  const { topic } = useContext(AskTopicContext)
  const general = `Using the Prolifica connector (${location.origin}/mcp), act for me on Prolifica: my data, my isles and the public archipelago. Read the guide tool first if you haven't.`
  return (
    <AskPopoverButton
      className="btn sm header-ask"
      align="right"
      button={<span className="hide-sm">Ask</span>}
      title={topic ? `Ask your AI about ${topic.about}` : 'Ask your AI'}
      placeholder={topic ? `What do you want to know or change about ${topic.about}?` : 'e.g. make an isle from my running log, or find isles about city budgets'}
      label="Ask"
      suggestions={topic?.suggestions}
      pieces={topic?.pieces}
      prompt={(want) => `${topic?.context ?? general}${piecesText(topic?.pieces?.list ?? [])}\n\n${want}`}
    />
  )
}

const piecesText = (list: Anchor[]) =>
  list.length
    ? `\n\nThis is about ${list.length === 1 ? 'one piece' : 'these pieces'} of the page:\n${list.map((a, k) => `${k + 1}. ${a.label ? `"${a.label}" ` : ''}(${a.selector})`).join('\n')}`
    : ''

export function AskTopicProvider({ children }: { children: ReactNode }) {
  const [topic, set] = useState<AskTopic | null>(null)
  return <AskTopicContext.Provider value={{ topic, set }}>{children}</AskTopicContext.Provider>
}

