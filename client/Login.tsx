import { useState } from 'react'
import { api } from './api'
import { navigate } from './navigate'
import { useSession } from './ui'

export function Login({ next }: { next: string | null }) {
  const { refresh } = useSession()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState<null | { dev: boolean }>(null)
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const target = next && next.startsWith('/') && !next.startsWith('//') && next !== '/login' ? next : '/'

  const ask = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const r = await api.requestLink(email.trim(), target)
      setSent({ dev: !!r.dev })
    } catch (err) {
      setMsg({ text: (err as Error).message, err: true })
    } finally {
      setBusy(false)
    }
  }
  const check = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.redeemCode(email.trim(), code)
      await refresh()
      navigate(target, { replace: true })
    } catch (err) {
      setMsg({ text: (err as Error).message, err: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wrap" style={{ maxWidth: 440, paddingTop: 48 }}>
      <div className="card pad">
        <h1 style={{ fontSize: 22 }}>{sent ? 'Check your email' : 'Sign in or sign up'}</h1>
        {!sent ? (
          <form onSubmit={ask}>
            <p className="muted">We'll email you a link and a code. New here? This makes your account, with 5 MB for your data.</p>
            <input className="field" type="email" required autoFocus autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Email me'}</button>
            </div>
          </form>
        ) : (
          <form onSubmit={check}>
            <p className="muted">
              {sent.dev ? 'Local dev: the link and code are printed in the terminal.' : <>We sent a link and a code to <b>{email}</b>. Click the link, or type the code here.</>}
            </p>
            <input className="field" inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} maxLength={7} />
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={busy || code.replace(/\D/g, '').length < 6}>Sign in</button>
              <button type="button" className="btn ghost" onClick={() => { setSent(null); setCode('') }}>Use another email</button>
            </div>
          </form>
        )}
        {msg && <p className={msg.err ? 'err small' : 'small muted'}>{msg.text}</p>}
      </div>
    </div>
  )
}
