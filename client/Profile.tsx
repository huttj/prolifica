import { api, fmtBytes, who } from './api'
import { Board } from './Library'
import { navigate } from './navigate'
import { ErrorBox, IsleCard, Link, useAsync, useSession } from './ui'

export function Profile({ handle, tab }: { handle: string; tab: string | null }) {
  const { me } = useSession()
  const person = useAsync(() => api.person(handle), [handle, me?.id])
  const which = tab === 'data' || tab === 'stars' ? tab : 'isles'
  const isles = useAsync(() => (which === 'isles' ? api.isles({ handle, limit: 100 }) : Promise.resolve([])), [handle, which, me?.id])
  const data = useAsync(() => (which === 'data' ? api.data({ handle }) : Promise.resolve([])), [handle, which, me?.id])
  const stars = useAsync(() => (which === 'stars' ? api.library(handle) : Promise.resolve([])), [handle, which, me?.id])

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
          {p.person.bio && <p style={{ margin: '8px 0 0', maxWidth: 600 }}>{p.person.bio}</p>}
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
      {which === 'data' &&
        (data.data?.length === 0 ? (
          <div className="empty">No public data.</div>
        ) : (
          <div className="card files">
            {data.data?.map((d) => (
              <Link key={d.id} to={`/d/${d.id}`} className="file">
                <span className="kind">{d.kind}</span>
                <span className="grow ellipsis">{d.path}</span>
                <span className="tiny muted">{fmtBytes(d.size)}</span>
              </Link>
            ))}
          </div>
        ))}
      {which === 'stars' && (stars.data?.length === 0 ? <div className="empty">Nothing starred yet.</div> : stars.data && <Board items={stars.data} />)}
      <div style={{ height: 60 }} />
    </div>
  )
}
