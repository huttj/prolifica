import { useState } from 'react'
import { api, who } from './api'
import { DataPanel } from './DataPages'
import { DataTree } from './DataTree'
import { Board } from './Library'
import { Linkified } from './Markdown'
import { navigate } from './navigate'
import { ErrorBox, IsleCard, Link, useAsync, useSession } from './ui'

export function Profile({ handle, tab }: { handle: string; tab: string | null }) {
  const { me } = useSession()
  const person = useAsync(() => api.person(handle), [handle, me?.id])
  const which = tab === 'data' || tab === 'stars' ? tab : 'isles'
  const isles = useAsync(() => (which === 'isles' ? api.isles({ handle, limit: 100 }) : Promise.resolve([])), [handle, which, me?.id])
  const data = useAsync(() => (which === 'data' ? api.data({ handle }) : Promise.resolve([])), [handle, which, me?.id])
  const stars = useAsync(() => (which === 'stars' ? api.library(handle) : Promise.resolve([])), [handle, which, me?.id])
  // the dataset open in the side panel, as on My data
  const [openId, setOpenId] = useState<string | null>(null)

  if (person.error) return <div className="wrap" style={{ paddingTop: 30 }}><ErrorBox error={person.error} /></div>
  if (!person.data) return <div className="wrap muted" style={{ paddingTop: 30 }}>Loading…</div>
  const p = person.data
  const setTab = (t: string) => navigate(`/@${handle}${t === 'isles' ? '' : `?tab=${t}`}`, { replace: true })

  return (
    <div className="wrap">
      <div className="page-head row" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <h1>{p.person.name ?? who(p.person)}</h1>
          <div className="muted">{who(p.person)}</div>
          {p.person.bio && <p style={{ margin: '8px 0 0', maxWidth: 600, whiteSpace: 'pre-line' }}><Linkified text={p.person.bio} /></p>}
        </div>
        {me && !p.isMe && (
          <button
            className={`btn ${p.following ? 'on' : 'primary'}`}
            onClick={async () => {
              await api.follow(handle, !p.following)
              person.reload()
            }}
          >
            {p.following ? 'Following' : 'Follow'}
          </button>
        )}
        {p.isMe && <Link to="/settings" className="btn">Edit profile</Link>}
      </div>
      <div className="toolbar">
        <div className="seg">
          <button className={which === 'isles' ? 'on' : ''} onClick={() => setTab('isles')}>Isles</button>
          <button className={which === 'data' ? 'on' : ''} onClick={() => setTab('data')}>Data</button>
          <button className={which === 'stars' ? 'on' : ''} onClick={() => setTab('stars')}>Stars</button>
        </div>
        {p.following && <span className="small muted">Their comments show in your Following layer.</span>}
      </div>
      {which === 'isles' && (isles.data?.length === 0 ? <div className="empty">No isles yet.</div> : <div className="grid">{isles.data?.map((i) => <IsleCard key={i.id} isle={i} />)}</div>)}
      {which === 'data' && data.data && (
        <DataTree datasets={data.data} storageKey={`profile:${handle}`} onOpen={(d) => setOpenId(d.id)} selected={openId} empty={p.isMe ? 'No data yet.' : 'No public data.'} />
      )}
      {which === 'data' && openId && <DataPanel id={openId} onClose={() => setOpenId(null)} onChanged={data.reload} />}
      {which === 'stars' && (stars.data?.length === 0 ? <div className="empty">Nothing starred yet.</div> : stars.data && <Board items={stars.data} />)}
      <div style={{ height: 60 }} />
    </div>
  )
}
