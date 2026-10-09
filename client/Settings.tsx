import { useState } from 'react'
import type { ApiToken } from '../shared/types'
import { ago, api } from './api'
import { AI_LABEL, AiMark, type AiId } from './ask'
import { UsageBar } from './DataPages'
import { navigate } from './navigate'
import { CopyBlock, Link, Modal, useAsync, useSession } from './ui'

const mcpUrl = () => `${location.origin}/mcp`

export function HandlePrompt() {
  const { refresh, toast } = useSession()
  const [handle, setHandle] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.updateMe({ handle })
      await refresh()
      toast(`Welcome, @${handle.toLowerCase()}`)
    } catch (x) {
      setErr((x as Error).message)
    }
  }
  return (
    <Modal onClose={() => {}}>
      <form onSubmit={save}>
        <h2>Pick a handle</h2>
        <p className="muted">It's how people find your isles: prolifica.app/@handle.</p>
        <input className="field" autoFocus placeholder="handle" value={handle} onChange={(e) => setHandle(e.target.value.replace(/^@/, ''))} />
        {err && <p className="err small">{err}</p>}
        <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
          <button className="btn primary" disabled={handle.length < 2}>Continue</button>
        </div>
      </form>
    </Modal>
  )
}

function OpenConnector({ ai, url }: { ai: AiId; url: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="btn sm"
      onClick={async () => {
        await navigator.clipboard.writeText(mcpUrl())
        setDone(true)
        window.open(url, '_blank', 'noopener')
      }}
    >
      <AiMark ai={ai} /> {done ? 'Copied: paste it there' : `Copy + open ${AI_LABEL[ai]} connectors`}
    </button>
  )
}

export function ConnectSteps({ token }: { token?: string }) {
  return (
    <div className="stack">
      <div>
        <h3 style={{ fontSize: 16 }}>Claude or ChatGPT</h3>
        <p className="small muted" style={{ margin: '4px 0' }}>
          Add a custom connector with this URL; it will ask you to sign in here. The buttons copy it and open the right screen: just paste.
        </p>
        <CopyBlock text={mcpUrl()} />
        <div className="row">
          <OpenConnector ai="claude" url="https://claude.ai/new?modal=add-custom-connector#settings/customize-connectors" />
          <OpenConnector ai="chatgpt" url="https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins" />
        </div>
      </div>
      <div>
        <h3 style={{ fontSize: 16 }}>Claude Code</h3>
        <p className="small muted" style={{ margin: '4px 0' }}>Run this, then <code>/mcp</code> in Claude Code to sign in:</p>
        <CopyBlock text={`claude mcp add --transport http prolifica ${mcpUrl()}`} />
        {token && (
          <>
            <p className="small muted" style={{ margin: '8px 0 4px' }}>Or skip the sign-in with your new key:</p>
            <CopyBlock text={`claude mcp add --transport http prolifica ${mcpUrl()} --header "Authorization: Bearer ${token}"`} />
          </>
        )}
      </div>
      <div>
        <h3 style={{ fontSize: 16 }}>Anything else that speaks MCP</h3>
        <p className="small muted" style={{ margin: '4px 0' }}>
          Cursor and friends: the same URL with OAuth, or a personal key as a bearer header{token ? '' : ' (make one in Settings)'}.
          {token ? ' Clients that only take a URL can use:' : ''}
        </p>
        {token && <CopyBlock text={`${mcpUrl()}?key=${token}`} />}
      </div>
    </div>
  )
}

export function Connect() {
  const { me } = useSession()
  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <h1>Connect your agent</h1>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          Prolifica is built to be driven by an agent. Connect one and ask it to save data, make an isle from it, or remix someone else's. Whatever you
          can do here, it can do too.
        </p>
      </div>
      <div className="card pad">
        <ConnectSteps />
      </div>
      <div className="section">
        <h2>Then try</h2>
        <CopyBlock text="Read the Prolifica guide, then save this CSV to my Prolifica data and make an isle that charts it." />
        <CopyBlock text="Browse the most-starred Prolifica isles and run my tweets/2024.csv through the best one." />
        <CopyBlock text="Look at my Prolifica library and make me a dashboard for my running log in the style of what I've starred." />
      </div>
      {!me && (
        <p className="muted">
          You'll need an account: <Link to="/login?next=/connect">sign in or sign up</Link>.
        </p>
      )}
      <div style={{ height: 60 }} />
    </div>
  )
}

export function Settings() {
  const { me, loading, refresh, toast } = useSession()
  const [handle, setHandle] = useState(me?.handle ?? '')
  const [name, setName] = useState(me?.name ?? '')
  const [bio, setBio] = useState(me?.bio ?? '')
  const tokens = useAsync(() => (me ? api.tokens() : Promise.resolve([] as ApiToken[])), [me?.id])
  const [fresh, setFresh] = useState<string | null>(null)
  const [label, setLabel] = useState('')

  if (!me && !loading) {
    navigate('/login?next=/settings', { replace: true })
    return null
  }
  if (!me) return null

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.updateMe({ handle, name, bio })
      await refresh()
      toast('Saved')
    } catch (x) {
      toast((x as Error).message)
    }
  }

  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <h1>Settings</h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>{me.email}</p>
      </div>

      <form className="card pad" onSubmit={save}>
        <label className="lbl">Handle</label>
        <input className="field" value={handle} onChange={(e) => setHandle(e.target.value.replace(/^@/, ''))} />
        <label className="lbl">Name</label>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="lbl">Bio</label>
        <textarea className="field" value={bio} onChange={(e) => setBio(e.target.value)} rows={2} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary">Save</button>
        </div>
      </form>

      <div className="section">
        <h2>Storage</h2>
        <UsageBar />
      </div>

      <div className="section">
        <h2>Connect an agent</h2>
        <div className="card pad">
          <ConnectSteps token={fresh ?? undefined} />
        </div>
      </div>

      <div className="section">
        <h2>Personal keys</h2>
        <p className="small muted">A key acts as you over MCP, for clients that can't sign in. Keep it secret; revoke it if it leaks.</p>
        {fresh && (
          <div className="card pad" style={{ borderColor: 'var(--accent-2)', marginBottom: 10 }}>
            <b>Your new key. It won't be shown again.</b>
            <CopyBlock text={fresh} />
          </div>
        )}
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              const r = await api.createToken(label || 'Key')
              setFresh(r.token)
              setLabel('')
              tokens.reload()
            } catch (x) {
              toast((x as Error).message)
            }
          }}
        >
          <input className="field" style={{ maxWidth: 260 }} placeholder="What it's for, e.g. Claude Code" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button className="btn">Make a key</button>
        </form>
        <div className="card files" style={{ marginTop: 10 }}>
          {tokens.data?.length === 0 && <div className="file muted small">No keys.</div>}
          {tokens.data?.map((t) => (
            <div key={t.id} className="file">
              <code>{t.prefix}…</code>
              <span className="grow ellipsis">{t.label}</span>
              <span className="tiny muted">{t.lastUsedAt ? `used ${ago(t.lastUsedAt)}` : 'never used'}</span>
              <button
                className="btn sm danger"
                onClick={async () => {
                  if (!confirm(`Revoke "${t.label}"?`)) return
                  await api.revokeToken(t.id)
                  tokens.reload()
                }}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <button
          className="btn"
          onClick={async () => {
            await api.logout()
            await refresh()
            navigate('/')
          }}
        >
          Sign out
        </button>
      </div>
      <div style={{ height: 60 }} />
    </div>
  )
}
