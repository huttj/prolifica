import { useState } from 'react'
import { COLLECTION_METHODS, type CollectionMethod, type SiteCollector } from '../shared/types'
import { ago, api, fmtBytes, who } from './api'
import { AskPopoverButton } from './ask'
import { FoldedMarkdown } from './Markdown'
import { navigate } from './navigate'
import { CopyBlock, ErrorBox, Icon, IsleCard, Link, useAsync, useSession } from './ui'

export function SitesIndex() {
  const sites = useAsync(() => api.sites(), [])
  const [q, setQ] = useState('')
  const go = (e: React.FormEvent) => {
    e.preventDefault()
    if (q.trim()) navigate(`/s/${encodeURIComponent(q.trim())}`)
  }
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Sites</h1>
        <p className="muted" style={{ margin: '4px 0 0', maxWidth: 640 }}>
          Where people's data comes from, and how they got it. Before you collect from a site, look it up: someone may already have a bookmarklet or
          scraper that works there, or the data you want.
        </p>
      </div>
      <form className="toolbar" onSubmit={go}>
        <input className="field" style={{ maxWidth: 420 }} placeholder="A site or any link on it: x.com, https://news.ycombinator.com/item?id=…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn">Look up</button>
      </form>
      {sites.error && <ErrorBox error={sites.error} />}
      {sites.data && !sites.data.length && <div className="empty">No data says where it came from yet.</div>}
      {sites.data && sites.data.length > 0 && (
        <div className="card files">
          {sites.data.map((s) => (
            <Link key={s.site} to={`/s/${s.site}`} className="file">
              <img className="favicon" src={`https://icons.duckduckgo.com/ip3/${s.site}.ico`} alt="" loading="lazy" />
              <b className="grow ellipsis">{s.site}</b>
              <span className="small muted">{s.datasets} dataset{s.datasets === 1 ? '' : 's'}</span>
              <span className="small muted hide-sm">{s.collectors} collector{s.collectors === 1 ? '' : 's'}</span>
              <span className="tiny muted hide-sm" style={{ width: 80, textAlign: 'right' }}>{ago(s.lastUsed)}</span>
            </Link>
          ))}
        </div>
      )}
      <div style={{ height: 60 }} />
    </div>
  )
}

/** Where a collector runs decides who can use it: a bookmarklet runs in your browser, not in your AI. */
const RUNS_IN_BROWSER = new Set<CollectionMethod>(['bookmarklet', 'userscript', 'extension'])

const HOW_TO_RUN: Partial<Record<CollectionMethod, string>> = {
  bookmarklet: 'Runs in your own browser. Make a new bookmark, paste the code as its URL, then click the bookmark while you are on the page.',
  userscript: 'Runs in your own browser through a userscript manager such as Tampermonkey or Violentmonkey: add it there as a new script.',
  extension: 'A browser extension: save the code and load it unpacked in your browser.',
  agent: 'Your AI ran this. Ask it to collect from here and it can reuse the code.',
  script: 'A script to run yourself, or ask your AI to run it.',
  api: "Calls the site's API. You or your AI can run it.",
}

/** Bookmarklets are stored URL-encoded; show them readable. */
function readable(code: string) {
  if (!/^javascript:/i.test(code.trim())) return code
  try {
    return decodeURIComponent(code.trim())
  } catch {
    return code
  }
}

function Collector({ c, rank }: { c: SiteCollector; rank: number }) {
  const [open, setOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const code = useAsync(() => (open ? api.collector(c.hash) : Promise.resolve(null)), [open, c.hash])
  const method = c.methods[0]
  const name = c.methods.map((m) => COLLECTION_METHODS[m]).join(', ') || 'Collector'
  const showLang = c.language && !c.methods.some((m) => m === c.language!.toLowerCase())
  const how = method && HOW_TO_RUN[method]
  return (
    <div className="card pad" style={{ padding: 14 }}>
      <div className="row">
        <b>{name}</b>
        {showLang && <span className="kind">{c.language}</span>}
        {rank === 0 && c.uses > 1 && <span className="chip accent">most used</span>}
        <span className="grow" />
        <span className="small muted">
          gathered {c.uses} dataset{c.uses === 1 ? '' : 's'} · {c.people} {c.people === 1 ? 'person' : 'people'} · {ago(c.lastUsed)}
        </span>
      </div>
      {how && <p className="small" style={{ margin: '6px 0 0' }}>{how}</p>}
      <div className="row small" style={{ marginTop: 8 }}>
        <span className="muted">e.g.</span> <Link to={`/d/${c.example.id}`}>{c.example.path}</Link> <span className="muted">by {who(c.example.owner)}</span>
        <span className="grow" />
        {c.notes.length > 0 && (
          <button className={`btn sm ghost ${notesOpen ? 'on' : ''}`} onClick={() => setNotesOpen((o) => !o)}>
            {notesOpen ? 'Hide' : 'Show'} notes ({c.notes.length})
          </button>
        )}
        <button className={`btn sm ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)}>
          <Icon name="code" /> {open ? 'Hide' : 'Show'} code · {fmtBytes(c.size)}
        </button>
      </div>
      {notesOpen && (
        <div className="collector-notes">
          {c.notes.map((n, k) => (
            <FoldedMarkdown key={k} text={n} lines={4} />
          ))}
        </div>
      )}
      {open && code.data && (
        <div style={{ marginTop: 8 }}>
          {method === 'bookmarklet' && <p className="tiny muted" style={{ margin: '0 0 4px' }}>Copy gives you the bookmark URL as saved; shown here decoded so you can read it.</p>}
          <CopyBlock text={code.data} shown={readable(code.data)} code />
        </div>
      )}
    </div>
  )
}

export function SitePage({ site }: { site: string }) {
  const { me } = useSession()
  const info = useAsync(() => api.site(site), [site, me?.id])
  if (info.error) return <div className="wrap" style={{ paddingTop: 30 }}><ErrorBox error={info.error} /></div>
  if (!info.data) return <div className="wrap muted" style={{ paddingTop: 30 }}>Loading…</div>
  const s = info.data
  const methods = Object.entries(s.methods) as [keyof typeof COLLECTION_METHODS, number][]
  const runnable = s.collectors.some((c) => c.methods.some((m) => !RUNS_IN_BROWSER.has(m)))
  const browserOnly = s.collectors.length > 0 && !runnable
  const prompt = (want: string) => {
    const save = `Save what you collect to my Prolifica data with its source: the URL, the method, and the full code you used, so the next person can reuse it.`
    if (runnable) return `Using the Prolifica connector, call site for ${s.site} to see how people have collected from it, then collect this from ${s.site}, reusing (or adapting) a collector that has worked there:\n\n${want}\n\n${save}`
    if (browserOnly)
      return `Using the Prolifica connector, call site for ${s.site}. The collectors people have used there run in a browser (bookmarklets and the like), so you can't run them, but read their code: it shows which pages and endpoints work. Then collect this from ${s.site} in a way you can run, or tell me if it needs my logged-in browser and I'll use the bookmarklet instead:\n\n${want}\n\n${save}`
    return `Using the Prolifica connector, collect this from ${s.site}:\n\n${want}\n\n${save}`
  }
  return (
    <div className="wrap">
      <div className="page-head">
        <div className="row">
          <img className="favicon lg" src={`https://icons.duckduckgo.com/ip3/${s.site}.ico`} alt="" />
          <h1 className="grow ellipsis">{s.site}</h1>
          <a className="btn sm" href={`https://${s.site}`} target="_blank" rel="noreferrer noopener"><Icon name="open" /> Visit</a>
        </div>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          {s.datasets.length} dataset{s.datasets.length === 1 ? '' : 's'} came from here
          {methods.length > 0 && <> · collected by {methods.map(([m, n]) => `${COLLECTION_METHODS[m].toLowerCase()} (${n})`).join(', ')}</>}
        </p>
      </div>

      <div className="section" style={{ marginTop: 10 }}>
        <h2>How to collect from here</h2>
        {s.collectors.length === 0 ? (
          <p className="muted small">No one has shared the code they used here yet.</p>
        ) : (
          <div className="stack">{s.collectors.map((c, k) => <Collector key={c.hash} c={c} rank={k} />)}</div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <AskPopoverButton
            align="left"
            button="Collect with your AI"
            title={`Collect from ${s.site}`}
            blurb={browserOnly ? "Your AI can't run a bookmarklet, but it can read one to learn how the site works, then collect its own way." : 'Your AI looks the site up here, reuses what works, and saves what it collects with its source.'}
            placeholder="Describe what you want to collect, e.g. every reply in this thread: https://…"
            label="Collect with"
            prompt={prompt}
          />
          <span className="small muted">{browserOnly ? 'Or run a collector above yourself.' : 'Describe what you want; your AI does the rest.'}</span>
        </div>
      </div>

      <div className="section">
        <h2>Data from here</h2>
        {s.datasets.length === 0 ? (
          <p className="muted small">Nothing you can see yet.</p>
        ) : (
          <div className="card files">
            {s.datasets.map((d) => (
              <Link key={d.id} to={`/d/${d.id}`} className="file">
                <span className="kind">{d.kind}</span>
                <span className="grow ellipsis">
                  {d.path}
                  {d.description && <span className="tiny muted" style={{ display: 'block' }}>{d.description}</span>}
                </span>
                {d.method && <span className="chip hide-sm">{COLLECTION_METHODS[d.method]}</span>}
                <span className="small muted">{who(d.owner)}</span>
                <span className="tiny muted" style={{ width: 64, textAlign: 'right' }}>{fmtBytes(d.size)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {s.isles.length > 0 && (
        <div className="section">
          <h2>Isles built on it</h2>
          <div className="grid">{s.isles.map((i) => <IsleCard key={i.id} isle={i} />)}</div>
        </div>
      )}
      <div style={{ height: 60 }} />
    </div>
  )
}
