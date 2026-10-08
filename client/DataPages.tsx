import { useMemo, useState } from 'react'
import { parseCsvRows } from '../shared/csv'
import { siteOf } from '../shared/site'
import { COLLECTION_METHODS, type CollectionMethod, type Dataset, type TreeNode } from '../shared/types'
import { ago, api, fmtBytes, type SourcePatch, who } from './api'
import { JsonView } from './JsonView'
import { FoldedMarkdown, Markdown } from './Markdown'
import { navigate } from './navigate'
import { Legend, ThreadView } from './Tree'
import { ErrorBox, Icon, Link, Modal, PersonLink, useAsync, useSession } from './ui'

export function UsageBar() {
  const { me } = useSession()
  if (!me) return null
  if (me.quota === null) return <div className="tiny muted">{fmtBytes(me.usage)} used · no limit</div>
  const pct = Math.min(100, (me.usage / me.quota) * 100)
  return (
    <div style={{ minWidth: 200 }}>
      <div className="usage"><div style={{ width: `${pct}%` }} /></div>
      <div className="tiny muted" style={{ marginTop: 4 }}>{fmtBytes(me.usage)} of {fmtBytes(me.quota)} used</div>
    </div>
  )
}

export function MyData() {
  const { me, loading, refresh, toast } = useSession()
  const list = useAsync(() => (me ? api.data() : Promise.resolve([] as Dataset[])), [me?.id])
  const [over, setOver] = useState(false)
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)

  if (!me && !loading) {
    navigate('/login?next=/data', { replace: true })
    return null
  }

  const upload = async (files: FileList | File[]) => {
    setBusy(true)
    try {
      for (const f of Array.from(files)) {
        const path = (folder.trim() ? folder.trim().replace(/\/+$/, '') + '/' : '') + f.name
        await api.upload(path, f)
      }
      toast(files.length === 1 ? 'Saved' : `Saved ${files.length} files`)
      list.reload()
      refresh()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const groups = new Map<string, Dataset[]>()
  for (const d of list.data ?? []) {
    const f = d.path.includes('/') ? d.path.slice(0, d.path.lastIndexOf('/')) : ''
    groups.set(f, [...(groups.get(f) ?? []), d])
  }

  return (
    <div className="wrap">
      <div className="page-head row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>My data</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Files your isles read. Private until a public isle shows them.</p>
        </div>
        <UsageBar />
      </div>

      <div
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files) }}
      >
        <div className="row" style={{ justifyContent: 'center' }}>
          <Icon name="upload" />
          <span>Drop CSV, JSON, markdown, text or images here, or</span>
          <label className="btn sm">
            choose files
            <input type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
          </label>
        </div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
          <span className="small">into folder</span>
          <input className="field" style={{ maxWidth: 200, padding: '5px 9px' }} placeholder="(top level)" value={folder} onChange={(e) => setFolder(e.target.value)} />
          {busy && <span className="small">Uploading…</span>}
        </div>
        <p className="tiny" style={{ margin: '10px 0 0' }}>Or have your agent write data with <code>write_data</code>; transformations keep a line back to what they came from.</p>
      </div>

      <div className="card" style={{ marginTop: 16, overflow: 'hidden' }}>
        {list.error && <ErrorBox error={list.error} />}
        {list.data && !list.data.length && <div className="empty" style={{ border: 0 }}>No data yet.</div>}
        {[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([f, items]) => (
          <div key={f}>
            {f && <div className="folder">▸ {f}/</div>}
            <div className="files">
              {items.map((d) => (
                <Link key={d.id} to={`/d/${d.id}`} className="file">
                  <span className="kind">{d.kind}</span>
                  <span className="grow ellipsis">{f ? d.path.slice(f.length + 1) : d.path}</span>
                  {d.derivedFrom.length > 0 && <span className="chip accent">derived</span>}
                  {d.source?.method && d.source.method !== 'upload' && <span className="chip">{COLLECTION_METHODS[d.source.method]}</span>}
                  {d.public && <span className="chip">public</span>}
                  <span className="tiny muted" style={{ width: 70, textAlign: 'right' }}>{fmtBytes(d.size)}</span>
                  <span className="tiny muted hide-sm" style={{ width: 80, textAlign: 'right' }}>{ago(d.updatedAt)}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ height: 60 }} />
    </div>
  )
}

function Preview({ dataset }: { dataset: Dataset }) {
  const textual = dataset.kind !== 'image' && dataset.kind !== 'binary'
  const text = useAsync(() => (textual ? api.dataText(dataset.id) : Promise.resolve('')), [dataset.id, dataset.updatedAt])
  const rows = useMemo(() => (dataset.kind === 'csv' && text.data ? parseCsvRows(text.data.slice(0, 400_000)) : null), [dataset.kind, text.data])

  if (dataset.kind === 'image') return <img src={`/api/data/${dataset.id}/raw?v=${dataset.updatedAt}`} alt={dataset.path} style={{ maxWidth: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />
  if (dataset.kind === 'binary') return <div className="empty">Binary file: no preview.</div>
  if (text.error) return <ErrorBox error={text.error} />
  if (text.data === undefined) return <p className="muted">Loading…</p>
  if (rows && rows.length) {
    const [head, ...body] = rows
    return (
      <div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr>{head!.map((h, k) => <th key={k}>{h}</th>)}</tr></thead>
            <tbody>{body.slice(0, 200).map((r, k) => <tr key={k}>{head!.map((_, j) => <td key={j} title={r[j]}>{r[j]}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p className="tiny muted">{body.length.toLocaleString()} rows · {head!.length} columns{body.length > 200 ? ' · showing the first 200' : ''}</p>
      </div>
    )
  }
  if (dataset.kind === 'json') return <JsonView text={text.data} />
  if (dataset.kind === 'markdown') return <div className="preview"><Markdown text={text.data.slice(0, 200_000)} /></div>
  const shown = text.data
  return <pre className="preview">{shown.length > 60_000 ? shown.slice(0, 60_000) + '\n…' : shown}</pre>
}

function chainData(ancestors: TreeNode[], subject: TreeNode): TreeNode[] {
  if (!ancestors.length) return [subject]
  const nodes = ancestors.map((a) => ({ ...a, children: [] as TreeNode[] }))
  for (let k = 0; k < nodes.length - 1; k++) nodes[k]!.children = [nodes[k + 1]!]
  nodes[nodes.length - 1]!.children = [subject]
  return [nodes[0]!]
}

export function DataPage({ id }: { id: string }) {
  const { me, toast, refresh } = useSession()
  const ds = useAsync(() => api.dataset(id), [id, me?.id])
  const lineage = useAsync(() => api.dataLineage(id), [id, me?.id])
  if (ds.error) return <div className="wrap" style={{ paddingTop: 30 }}><ErrorBox error={ds.error} /></div>
  if (!ds.data) return <div className="wrap muted" style={{ paddingTop: 30 }}>Loading…</div>
  const d = ds.data
  const mine = me?.id === d.owner.id
  const hasFamily = lineage.data && (lineage.data.ancestors.length > 0 || lineage.data.tree.children.length > 0)

  return (
    <div className="wrap">
      <div className="page-head">
        <div className="row">
          <span className="kind">{d.kind}</span>
          <h1 className="grow ellipsis" style={{ fontSize: 24 }}>{d.path}</h1>
        </div>
        <div className="row small muted" style={{ marginTop: 6 }}>
          <span>by <PersonLink person={d.owner} /></span>
          <span>· {fmtBytes(d.size)}</span>
          <span>· updated {ago(d.updatedAt)}</span>
          {d.public ? <span className="chip">public</span> : <span className="chip"><Icon name="lock" /> private</span>}
        </div>
        {d.description && <p style={{ margin: '10px 0 0' }}>{d.description}</p>}
        {d.derivedFrom.length > 0 && (
          <p className="small" style={{ margin: '8px 0 0' }}>
            Derived from {d.derivedFrom.map((p, k) => <span key={p.id}>{k ? ', ' : ''}<Link to={`/d/${p.id}`}>{p.path}</Link></span>)}
            {d.transform && <span className="muted"> — “{d.transform}”</span>}
          </p>
        )}
      </div>

      {mine && (
        <div className="row" style={{ marginBottom: 14 }}>
          <button className="btn sm" onClick={async () => { await api.updateData(d.id, { public: !d.public }); ds.reload() }}>
            Make {d.public ? 'private' : 'public'}
          </button>
          <label className="btn sm">
            <Icon name="upload" /> Replace contents
            <input
              type="file"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                try {
                  await api.upload(d.path, f)
                  toast('Replaced')
                  ds.reload()
                  refresh()
                } catch (err) {
                  toast((err as Error).message)
                }
              }}
            />
          </label>
          <button
            className="btn sm danger"
            onClick={async () => {
              if (!confirm(`Delete ${d.path}?`)) return
              try {
                await api.deleteData(d.id)
                toast('Deleted')
                refresh()
                navigate('/data')
              } catch (err) {
                toast((err as Error).message)
              }
            }}
          >
            <Icon name="trash" /> Delete
          </button>
        </div>
      )}

      <Provenance dataset={d} mine={mine} onChanged={ds.reload} />

      <Preview dataset={d} />

      <div className="section">
        <h2>Isles that show this data</h2>
        {lineage.data && !lineage.data.related.length && <p className="muted small">None yet. Ask your agent to make one, or run it through an existing isle with “Use my data”.</p>}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {lineage.data?.related.map((n) => (
            <Link key={n.id} to={`/i/${n.id}`} className="card pad" >
              <div style={{ fontWeight: 650 }} className="ellipsis">{n.title}</div>
              <div className="small muted">{who(n.owner)} {n.starCount ? `· ★ ${n.starCount}` : ''}</div>
            </Link>
          ))}
        </div>
      </div>

      {hasFamily && (
        <div className="section">
          <h2>Data family</h2>
          <Legend data />
          <ThreadView roots={chainData(lineage.data!.ancestors, lineage.data!.tree)} current={d.id} />
        </div>
      )}
      <div style={{ height: 60 }} />
    </div>
  )
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10)
const host = (u: string) => {
  try {
    return new URL(u).host.replace(/^www\./, '')
  } catch {
    return u
  }
}

/** Where the data came from, how it was gathered, and the code that gathered it. */
function Provenance({ dataset, mine, onChanged }: { dataset: Dataset; mine: boolean; onChanged: () => void }) {
  const src = dataset.source
  const [showCode, setShowCode] = useState(false)
  const [editing, setEditing] = useState(false)
  const code = useAsync(() => (showCode && src?.code ? api.collectorCode(dataset.id) : Promise.resolve(null)), [showCode, dataset.id, src?.code?.hash])
  const siblings = useAsync(() => (src?.code ? api.sameCollector(dataset.id) : Promise.resolve([])), [dataset.id, src?.code?.hash])
  const { toast } = useSession()

  if (!src && !dataset.derivedFrom.length && !mine) return null
  return (
    <div className="card pad provenance">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ fontSize: 16 }} className="grow">Where it came from</h2>
        {mine && <button className="btn sm" onClick={() => setEditing(true)}><Icon name="edit" /> {src ? 'Edit' : 'Add'}</button>}
      </div>
      {!src && !dataset.derivedFrom.length && (
        <p className="small muted" style={{ margin: 0 }}>
          Not recorded yet. Say where this came from and how you got it, and add the bookmarklet or script if there was one, so anyone can collect more the same way.
        </p>
      )}
      {src && (
        <div className="kv">
          {src.method && <><span className="muted">Method</span><span>{COLLECTION_METHODS[src.method]}</span></>}
          {src.url && (
            <>
              <span className="muted">From</span>
              <span className="ellipsis">
                {siteOf(src.url) ? <Link to={`/s/${siteOf(src.url)}`}>{siteOf(src.url)}</Link> : host(src.url)}{' '}
                <a className="tiny muted" href={src.url} target="_blank" rel="noreferrer noopener">{src.url}</a>
              </span>
            </>
          )}
          {src.collectedAt && <><span className="muted">Collected</span><span>{day(src.collectedAt)}</span></>}
          {src.notes && <><span className="muted">Notes</span><FoldedMarkdown text={src.notes} /></>}
          {src.code && (
            <>
              <span className="muted">Collector</span>
              <span>
                <button className="btn sm" onClick={() => setShowCode((v) => !v)}>
                  <Icon name="code" /> {showCode ? 'Hide' : 'Show'} code{src.code.language ? ` · ${src.code.language}` : ''} · {fmtBytes(src.code.size)}
                </button>
              </span>
            </>
          )}
        </div>
      )}
      {showCode && code.data && (
        <div style={{ position: 'relative', marginTop: 10 }}>
          <pre className="preview code">{code.data}</pre>
          <button className="btn sm" style={{ position: 'absolute', top: 6, right: 6 }} onClick={() => navigator.clipboard.writeText(code.data!).then(() => toast('Code copied'))}>
            <Icon name="copy" /> Copy
          </button>
        </div>
      )}
      {(siblings.data?.length ?? 0) > 0 && (
        <p className="small" style={{ margin: '10px 0 0' }}>
          Same collector also gathered{' '}
          {siblings.data!.map((x, k) => <span key={x.id}>{k ? ', ' : ''}<Link to={`/d/${x.id}`}>{x.path}</Link> <span className="muted">({who(x.owner)})</span></span>)}
        </p>
      )}
      {editing && <ProvenanceEditor dataset={dataset} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged() }} />}
    </div>
  )
}

function ProvenanceEditor({ dataset, onClose, onSaved }: { dataset: Dataset; onClose: () => void; onSaved: () => void }) {
  const src = dataset.source
  const { toast } = useSession()
  const [method, setMethod] = useState<CollectionMethod | ''>(src?.method ?? '')
  const [url, setUrl] = useState(src?.url ?? '')
  const [collected, setCollected] = useState(src?.collectedAt ? day(src.collectedAt) : '')
  const [notes, setNotes] = useState(src?.notes ?? '')
  const [lang, setLang] = useState(src?.code?.language ?? '')
  const existing = useAsync(() => (src?.code ? api.collectorCode(dataset.id) : Promise.resolve('')), [dataset.id])
  const [code, setCode] = useState<string | null>(null)
  const shownCode = code ?? existing.data ?? ''
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    const patch: SourcePatch = {
      method: method || null,
      url: url.trim() || null,
      collectedAt: collected ? Date.parse(collected) : null,
      notes: notes.trim() || null,
      codeLanguage: lang.trim() || null,
    }
    if (code !== null) patch.code = code.trim() ? code : null
    try {
      await api.updateData(dataset.id, { source: patch })
      toast('Saved')
      onSaved()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} wide>
      <h2>How you got {dataset.path}</h2>
      <div className="form-grid">
        <div>
          <label className="lbl">Method</label>
          <select className="field" value={method} onChange={(e) => setMethod(e.target.value as CollectionMethod | '')}>
            <option value="">(not said)</option>
            {Object.entries(COLLECTION_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="lbl">Collected on</label>
          <input className="field" type="date" value={collected} onChange={(e) => setCollected(e.target.value)} />
        </div>
      </div>
      <label className="lbl">From where</label>
      <input className="field" placeholder="https://x.com/someone/status/…" value={url} onChange={(e) => setUrl(e.target.value)} />
      <label className="lbl">Notes</label>
      <textarea className="field" rows={2} placeholder="What's in it, what was left out, anything odd" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="form-grid" style={{ gridTemplateColumns: '1fr 160px' }}>
        <label className="lbl">The code that collected it</label>
        <input className="field" style={{ marginTop: 6 }} placeholder="language" value={lang} onChange={(e) => setLang(e.target.value)} />
      </div>
      <textarea
        className="field code"
        rows={10}
        spellCheck={false}
        placeholder="Paste the bookmarklet, userscript, scraper or script"
        value={shownCode}
        onChange={(e) => setCode(e.target.value)}
      />
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={save}>Save</button>
      </div>
    </Modal>
  )
}
