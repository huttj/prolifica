import { useEffect, useState } from 'react'
import { api } from './api'
import { ErrorBox, IsleCard, Link, useAsync, useSession } from './ui'

function HeroMap() {
  // a few isles and the lines between them: decoration, but the honest kind (it is what the place is)
  const isles: [number, number, number][] = [
    [90, 120, 46], [210, 80, 28], [250, 190, 38], [140, 230, 22], [330, 110, 20], [340, 240, 26], [60, 260, 14], [400, 180, 12],
  ]
  const links: [number, number][] = [[0, 1], [0, 2], [2, 3], [1, 4], [2, 5], [3, 6], [5, 7], [4, 7]]
  return (
    <div className="map">
      <svg viewBox="0 0 460 320" width="100%" height="100%" aria-hidden="true">
        {links.map(([a, b], i) => (
          <line key={i} x1={isles[a]![0]} y1={isles[a]![1]} x2={isles[b]![0]} y2={isles[b]![1]} stroke="var(--accent-2)" strokeOpacity=".35" strokeWidth="1.5" strokeDasharray="4 5" />
        ))}
        {isles.map(([x, y, r], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={r + 7} fill="var(--sea)" />
            <circle cx={x} cy={y} r={r} fill="var(--card)" stroke="var(--line-2)" />
            <circle cx={x - r / 4} cy={y - r / 5} r={r / 3} fill="var(--accent-2)" opacity={0.18 + (i % 3) * 0.12} />
          </g>
        ))}
      </svg>
    </div>
  )
}

export function Home() {
  const { me, loading } = useSession()
  const [sort, setSort] = useState<'recent' | 'stars'>('recent')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250)
    return () => clearTimeout(t)
  }, [q])
  const isles = useAsync(() => api.isles({ sort, q: debounced, limit: 60 }), [sort, debounced])

  return (
    <div className="wrap">
      {!me && !loading && (
        <section className="hero">
          <div>
            <h1>A living archipelago of tools for your data.</h1>
            <p className="lede">
              Each isle is a small lab for one task: a chart, a search, a map of your notes. Your agent builds them from your data; anyone can remix
              them with theirs. Same data, new look. Same look, new data.
            </p>
            <div className="row">
              <Link to="/login" className="btn primary">Start with 5 MB, free</Link>
              <Link to="/connect" className="btn">Connect Claude</Link>
            </div>
          </div>
          <HeroMap />
        </section>
      )}

      <div className="toolbar">
        <h2 style={{ fontSize: 20, marginRight: 8 }}>{me ? 'Explore' : 'Isles'}</h2>
        <div className="seg">
          <button className={sort === 'recent' ? 'on' : ''} onClick={() => setSort('recent')}>New</button>
          <button className={sort === 'stars' ? 'on' : ''} onClick={() => setSort('stars')}>Most starred</button>
        </div>
        <div className="grow" />
        <input className="field" style={{ maxWidth: 280 }} placeholder="Search isles" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {isles.error ? (
        <ErrorBox error={isles.error} />
      ) : isles.data && !isles.data.length ? (
        <div className="empty">
          {debounced ? 'No isles match that.' : (
            <>
              No isles yet. <Link to="/connect">Connect your agent</Link> and ask it to make the first one.
            </>
          )}
        </div>
      ) : (
        <div className="grid">{isles.data?.map((i) => <IsleCard key={i.id} isle={i} />)}</div>
      )}
      <div style={{ height: 60 }} />
    </div>
  )
}
