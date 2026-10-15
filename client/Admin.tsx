import { useState } from 'react'
import type { AdminUser } from '../shared/types'
import { ago, api, fmtBytes } from './api'
import { ErrorBox, Link, useAsync, useSession } from './ui'

const MB = 1024 * 1024

/** The next step up: 100 MB from the default, then double. */
const nextQuota = (q: number | null) => (q === null || q < 100 * MB ? 100 * MB : q * 2)

/** For admins: everyone, with their storage; those who asked for more come first. */
export function Admin() {
  const { me } = useSession()
  const users = useAsync(() => (me?.isAdmin ? api.adminUsers() : Promise.resolve([] as AdminUser[])), [me?.id])
  if (!me?.isAdmin) return <div className="wrap page-head"><h1>Nothing here</h1><p className="muted">This page is for admins.</p></div>
  const asking = users.data?.filter((u) => u.requestedAt).length ?? 0
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>People</h1>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          {users.data ? `${users.data.length} people` : 'Loading…'}
          {asking ? ` · ${asking} asked for more storage` : ''}
        </p>
      </div>
      {users.error && <ErrorBox error={users.error} />}
      {users.data && (
        <div className="table-wrap" style={{ maxHeight: 'none' }}>
          <table className="data">
            <thead>
              <tr><th>Person</th><th>Joined</th><th>Last sign-in</th><th>Storage</th><th>Asked</th><th /></tr>
            </thead>
            <tbody>
              {users.data.map((u) => <Row key={u.id} u={u} reload={users.reload} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Row({ u, reload }: { u: AdminUser; reload: () => void }) {
  const { toast } = useSession()
  const [mb, setMb] = useState('')
  const [busy, setBusy] = useState(false)
  const set = async (quota: number | null) => {
    setBusy(true)
    try {
      await api.setQuota(u.id, quota)
      toast(quota === null ? `${u.handle ? `@${u.handle}` : u.email} is back to the default` : `${u.handle ? `@${u.handle}` : u.email} can keep ${fmtBytes(quota)}`)
      setMb('')
      reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const pct = u.quota ? Math.min(100, (u.usage / u.quota) * 100) : 0
  const custom = Math.round(Number(mb) * MB)
  return (
    <tr>
      <td>
        {u.handle ? <Link to={`/@${u.handle}`}>@{u.handle}</Link> : <span className="muted">no handle</span>}
        <div className="tiny muted">{u.email}</div>
      </td>
      <td className="tiny">{ago(u.createdAt)}</td>
      <td className="tiny">{u.lastLoginAt ? ago(u.lastLoginAt) : '—'}</td>
      <td style={{ minWidth: 180 }}>
        {u.quota !== null && <div className="usage"><div style={{ width: `${pct}%` }} /></div>}
        <div className="tiny muted" style={{ marginTop: 4 }}>
          {fmtBytes(u.usage)} of {u.quota === null ? 'no limit' : fmtBytes(u.quota)}
          {u.customQuota !== null && ' (set)'}
        </div>
      </td>
      <td className="tiny">{u.requestedAt ? <strong>{ago(u.requestedAt)}</strong> : '—'}</td>
      <td>
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          {u.quota !== null && (
            <button className={`btn sm ${u.requestedAt ? 'primary' : ''}`} disabled={busy} onClick={() => set(nextQuota(u.quota))}>
              Give {fmtBytes(nextQuota(u.quota))}
            </button>
          )}
          <input className="field" style={{ width: 80, padding: '4px 8px' }} inputMode="numeric" placeholder="MB" value={mb} onChange={(e) => setMb(e.target.value.replace(/[^\d.]/g, ''))} />
          <button className="btn sm" disabled={busy || !(custom > 0)} onClick={() => set(custom)}>Set</button>
          {u.customQuota !== null && <button className="btn sm ghost" disabled={busy} onClick={() => set(null)}>Default</button>}
        </div>
      </td>
    </tr>
  )
}
