import { useEffect, useRef, useState } from 'react'
import { COLLECTION_METHODS, type DatasetRef, type Isle, type IsleSource } from '../shared/types'
import { ago, api, who } from './api'
import { Icon, Link, useAsync, useSession } from './ui'

/**
 * Where an isle's data came from, for someone about to run their own through it: each original source,
 * how it was collected, and what they'll need to do to get theirs. Collected in a browser (a bookmarklet,
 * an extension, a userscript) means they have to do it themselves, so the collector is offered right
 * here, with a plain warning: it runs on that site as them.
 */

/** Sources collected the same way from the same site, shown as one: you only need the collector once. */
interface SourceGroup {
  /** the one whose notes and collector are shown: the latest that has a collector */
  lead: IsleSource
  datasets: DatasetRef[]
  slots: string[]
}

function groupSources(sources: IsleSource[]): SourceGroup[] {
  const groups = new Map<string, IsleSource[]>()
  for (const s of sources) {
    const key = s.site && s.method ? `${s.method}|${s.site}` : `d|${s.dataset.id}`
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  return [...groups.values()].map((list) => {
    const byRecent = [...list].sort((a, b) => Number(!!b.code) - Number(!!a.code) || (b.collectedAt ?? 0) - (a.collectedAt ?? 0))
    return { lead: byRecent[0]!, datasets: list.map((s) => s.dataset), slots: [...new Set(list.flatMap((s) => s.slots))] }
  })
}

export function DataSources({ isle, compact = false }: { isle: Isle; compact?: boolean }) {
  const src = useAsync(() => api.isleSources(isle.id), [isle.id, isle.version])
  if (src.error || !src.data || !src.data.sources.length) return null
  const { sources, sites } = src.data
  const self = sources.filter((s) => s.selfServe)
  return (
    <div className="sources" data-pid="data-sources">
      <div className="row" style={{ marginBottom: 6 }}>
        <b className="small grow">Where this data came from</b>
        {self.length > 0 && <span className="src-flag">you collect it yourself</span>}
      </div>
      {groupSources(sources).map((g) => <SourceCard key={g.lead.dataset.id} g={g} site={sites.find((x) => x.site === g.lead.site) ?? null} compact={compact} />)}
    </div>
  )
}

function SourceCard({ g, site, compact }: { g: SourceGroup; site: { site: string; datasets: number; collectors: number; people: number } | null; compact: boolean }) {
  const s = g.lead
  const [open, setOpen] = useState(false)
  const owners = [...new Map(g.datasets.map((d) => [d.owner.id, d.owner])).values()]
  const how = s.method ? COLLECTION_METHODS[s.method] : 'Unknown method'
  return (
    <div className={`src-card ${s.selfServe ? 'self' : ''}`}>
      <div className="row" style={{ gap: 6 }}>
        <span className="kind">{how}</span>
        <span className="small grow ellipsis">
          {s.site ? <>from <b>{s.site}</b></> : <Link to={`/d/${s.dataset.id}`}>{s.dataset.path}</Link>}
        </span>
        {s.collectedAt && <span className="tiny muted">{ago(s.collectedAt)}</span>}
      </div>
      <div className="tiny muted" style={{ marginTop: 2 }}>
        feeds {g.slots.map((x, i) => <span key={x}>{i ? ', ' : ''}<code>{x}</code></span>)} · collected by {owners.map((o, i) => <span key={o.id}>{i ? ', ' : ''}{who(o)}</span>)} ·{' '}
        {g.datasets.length === 1 ? (
          <Link to={`/d/${s.dataset.id}`}>the original data</Link>
        ) : (
          <>the originals: {g.datasets.map((d, i) => <span key={d.id}>{i ? ', ' : ''}<Link to={`/d/${d.id}`}>{d.path.split('/').slice(-2).join('/')}</Link></span>)}</>
        )}
      </div>
      {s.selfServe ? (
        <p className="small" style={{ margin: '6px 0 0' }}>
          You'll collect yours in your own browser{s.site ? <>, signed in to <b>{s.site}</b></> : null}: an AI can't do this part for you. {s.code ? 'Get the collector below, run it on the page you want, then drop the file it saves into this dialog.' : 'No collector was saved with it; the notes may say how.'}
        </p>
      ) : (
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          {s.method === 'upload' || s.method === 'manual'
            ? 'It was added by hand: bring your own file, or ask your AI to find something like it.'
            : `Your AI can collect more${s.code ? ' with the same collector' : ''}: say what to fetch below.`}
        </p>
      )}
      {!compact && s.notes && (
        <details className="src-notes">
          <summary className="tiny">Notes on how it was collected</summary>
          <p className="tiny">{s.notes}</p>
        </details>
      )}
      <div className="row" style={{ marginTop: 6, gap: 6 }}>
        {s.code && (
          <button className={`btn sm ${s.selfServe ? 'primary' : ''}`} onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : s.selfServe ? `Get the ${s.method === 'bookmarklet' || /bookmarklet/i.test(s.code.language ?? '') ? 'bookmarklet' : s.method ?? 'collector'}` : 'See the collector'}
          </button>
        )}
        {site && (
          <Link to={`/s/${site.site}`} className="tiny">
            More from {site.site}: {site.datasets} dataset{site.datasets === 1 ? '' : 's'}, {site.collectors} collector{site.collectors === 1 ? '' : 's'} →
          </Link>
        )}
      </div>
      {open && s.code && <Collector s={s} />}
    </div>
  )
}

/** The collector itself: a bookmarklet you can drag to the bookmarks bar, or code to copy and read. */
function Collector({ s }: { s: IsleSource }) {
  const { toast } = useSession()
  const code = useAsync(() => api.collector(s.code!.hash), [s.code!.hash])
  const [showCode, setShowCode] = useState(false)
  const link = useRef<HTMLAnchorElement>(null)
  const text = code.data ?? ''
  const isBookmarklet = /^\s*javascript:/i.test(text)
  // React won't render a javascript: href, so it's set on the element directly (only for a bookmarklet)
  useEffect(() => {
    if (link.current && isBookmarklet) link.current.setAttribute('href', text.trim())
  }, [isBookmarklet, text])
  if (code.error) return <p className="tiny err">Couldn't load the collector.</p>
  if (!code.data) return <p className="tiny muted">Loading the collector…</p>
  return (
    <div className="src-collector">
      <p className="tiny" style={{ margin: 0 }}>
        <b>This runs code{s.site ? ` on ${s.site}` : ''} as you.</b> It was saved by {who(s.dataset.owner)}; only use it if you trust them, and look it over first.
      </p>
      {isBookmarklet ? (
        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <a ref={link} className="bookmarklet" onClick={(e) => { e.preventDefault(); toast('Drag it to your bookmarks bar, then click it on the page you want') }} draggable>
            <Icon name="data" /> {s.site ? `Collect from ${s.site}` : 'Collector'}
          </a>
          <span className="tiny muted">Drag this to your bookmarks bar, then open the page{ s.site ? ` on ${s.site}` : ''} and click it.</span>
        </div>
      ) : (
        <p className="tiny muted" style={{ margin: '8px 0 0' }}>
          {s.method === 'userscript' ? 'Install it with a userscript manager (Tampermonkey, Violentmonkey).' : s.method === 'extension' ? 'Load it as an unpacked browser extension.' : 'Run it the way its notes describe.'}
        </p>
      )}
      <div className="row" style={{ marginTop: 8, gap: 6 }}>
        <button className="btn sm" onClick={() => setShowCode((v) => !v)}>{showCode ? 'Hide' : 'Look at'} the code</button>
        <button className="btn sm" onClick={() => navigator.clipboard.writeText(text).then(() => toast('Copied'), () => toast("Couldn't copy"))}>Copy</button>
        <span className="tiny muted">{s.code!.language ?? 'code'} · {Math.round(s.code!.size / 1024)} KB</span>
      </div>
      {showCode && <pre className="src-code">{isBookmarklet ? safeDecode(text) : text}</pre>}
    </div>
  )
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/^\s*javascript:/i, ''))
  } catch {
    return s
  }
}
