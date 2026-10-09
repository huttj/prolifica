import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Anchor, Isle } from '../shared/types'
import { ConnectSteps } from './Settings'
import { Link, Modal, useSession } from './ui'

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

// ---- change requests: notes that go to the AI and are then forgotten ----

export interface ChangeNote {
  id: string
  anchor: Anchor | null
  text: string
}

/** Kept for this tab only (a reload shouldn't lose a half-made list), never sent to the server. */
export function useChangeNotes(isleId: string): [ChangeNote[], (next: ChangeNote[]) => void] {
  const key = `pf:changes:${isleId}`
  const read = () => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? '[]') as ChangeNote[]
    } catch {
      return []
    }
  }
  const [notes, setNotes] = useState<ChangeNote[]>(read)
  useEffect(() => setNotes(read()), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback(
    (next: ChangeNote[]) => {
      setNotes(next)
      try {
        if (next.length) sessionStorage.setItem(key, JSON.stringify(next))
        else sessionStorage.removeItem(key)
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  )
  return [notes, set]
}

const where = (a: Anchor | null) => (a ? `the ${a.label ? `"${a.label}"` : 'element'} (${a.selector})` : 'the whole isle')

export function changesPrompt(isle: Isle, notes: ChangeNote[], mine: boolean, origin: string): string {
  const head = `Using the Prolifica connector, read isle ${isle.id} ("${isle.title}", ${origin}/i/${isle.id}) with get_isle, including its HTML.`
  const how = mine
    ? `Then make the changes. If they improve this isle, update it in place with publish_isle (id: "${isle.id}") and a short note saying what changed. If they ask for something new made from it (another place, subject or dataset), leave this one as it is and publish a new isle with parent: "${isle.id}". If it's unclear which I mean, ask me.`
    : `It isn't mine, so make my own version: publish_isle with parent: "${isle.id}" (keep its data bindings unless a change needs different data).`
  const list = notes.map((n, i) => `${i + 1}. On ${where(n.anchor)}: ${n.text.trim()}`).join('\n')
  const ask = notes.length === 1 ? `Make this change:\n${list}` : `Make these ${notes.length} changes:\n${list}`
  return `${head} ${how}\n\n${ask}\n\nKeep every data-pid attribute stable so comments and stars stay attached. Tell me the new version or link when it's done.`
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
}) {
  const { title, blurb, placeholder, label, prompt, onClose, children, optional, suggestions } = props
  const [want, setWant] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
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
  }, [onClose])
  return (
    <div className="popover card" ref={ref} role="dialog">
      <b>{title}</b>
      {blurb && <p className="tiny muted" style={{ margin: '2px 0 8px' }}>{blurb}</p>}
      {suggestions && suggestions.length > 0 && (
        <div className="ask-suggest">
          {suggestions.map((x) => (
            <button key={x} className={want === x ? 'on' : ''} onClick={() => setWant(x)}>{x}</button>
          ))}
        </div>
      )}
      <textarea autoFocus className="field" rows={3} placeholder={placeholder} value={want} onChange={(e) => setWant(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <AskAiButton label={label} prompt={prompt(want.trim())} disabled={!optional && !want.trim()} onAsk={onClose} />
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
  return (
    <span className="pop-anchor">
      <button className={`${className} ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="ask-mark"><AiMark ai={ai} /></span>
        {button}
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

/** What the header's Ask button knows about the page you're on. */
export interface AskTopic {
  /** "this isle", "your data" */
  about: string
  /** what the AI should read first, as the prompt's opening */
  context: string
  suggestions?: string[]
}

type TopicSlot = { topic: AskTopic | null; set: (t: AskTopic | null) => void }
export const AskTopicContext = createContext<TopicSlot>({ topic: null, set: () => {} })

/** A page says what it's about while it's shown; the header's Ask button builds on it. */
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
      blurb="It opens beside this page with your ask typed in, and works through the Prolifica connector."
      placeholder={topic ? `What do you want to know or change about ${topic.about}?` : 'e.g. make an isle from my running log, or find isles about city budgets'}
      label="Ask"
      suggestions={topic?.suggestions}
      prompt={(want) => `${topic?.context ?? general}\n\n${want}`}
    />
  )
}

export function AskTopicProvider({ children }: { children: ReactNode }) {
  const [topic, set] = useState<AskTopic | null>(null)
  return <AskTopicContext.Provider value={{ topic, set }}>{children}</AskTopicContext.Provider>
}

