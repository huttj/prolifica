import { useEffect, useMemo, useRef, useState } from 'react'
import type { DataDelta, Evolution, EvolutionIsle, PageDelta } from '../shared/types'
import { ago, api, who } from './api'
import { ErrorBox, Icon, Link, RelationChip, Thumb, useAsync } from './ui'

/**
 * How a family evolved: the original, every remix of it and every version of each, oldest first. Each
 * step says what changed (the publisher's note, how much of the page, which data), and any step can be
 * compared with the one before it, down to the lines of the page.
 */

type Pick = { isle: string; version: number }

export function EvolutionPage({ id }: { id: string }) {
  const evo = useAsync(() => api.evolution(id), [id])
  const [pick, setPick] = useState<Pick | null>(null)
  const compareRef = useRef<HTMLDivElement>(null)

  // start on the isle you came from: what it changed from its parent, or its latest change
  useEffect(() => {
    if (!evo.data || pick) return
    const e = evo.data.isles.find((x) => x.isle.id === evo.data!.focusId) ?? evo.data.isles[0]
    if (!e) return
    const last = e.versions[e.versions.length - 1]!
    setPick({ isle: e.isle.id, version: e.parentId ? e.versions[0]!.version : last.version })
  }, [evo.data, pick])

  const choose = (p: Pick) => {
    setPick(p)
    if (matchMedia('(max-width: 900px)').matches) setTimeout(() => compareRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  if (evo.error) return <div className="wrap page-head"><ErrorBox error={evo.error} /></div>
  if (!evo.data) return <div className="wrap page-head"><p className="muted">Loading the family…</p></div>
  const data = evo.data
  const root = data.isles.find((e) => e.isle.id === data.rootId) ?? data.isles[0]!
  const focus = data.isles.find((e) => e.isle.id === data.focusId)
  const remixes = data.isles.length - 1
  const versions = data.isles.reduce((n, e) => n + e.versions.length, 0)

  return (
    <div className="wrap evo">
      <div className="page-head">
        <Link to={`/i/${data.focusId}`} className="small">← {focus?.isle.title ?? "Back"}</Link>
        <h1 style={{ marginTop: 6 }}>How “{root.isle.title}” evolved</h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          {remixes ? `${remixes} remix${remixes === 1 ? '' : 'es'} and ` : ''}{versions} version{versions === 1 ? '' : 's'}, oldest first. Each step says what changed from the one before it; pick one to compare them.
          {data.truncated && ' (The family is bigger than this; showing the first part.)'}
        </p>
      </div>
      <div className="evo-grid">
        <ol className="evo-line">
          {data.isles.map((e) => <EvoCard key={e.isle.id} e={e} evo={data} pick={pick} onPick={choose} />)}
        </ol>
        <div className="evo-compare" ref={compareRef}>
          {pick ? <Compare evo={data} pick={pick} /> : <div className="card pad muted small">Pick a step to compare it with the one before.</div>}
        </div>
      </div>
    </div>
  )
}

const pct = (p: PageDelta) => Math.max(1, Math.round((1 - p.similarity) * 100))

function PageChip({ page }: { page: PageDelta | null }) {
  if (!page) return null
  if (page.similarity >= 1) return <span className="evo-chip">same page</span>
  return <span className="evo-chip" title={`About ${page.added} lines added and ${page.removed} removed`}>page {pct(page)}% changed <span className="add">+{page.added}</span> <span className="del">−{page.removed}</span></span>
}

function DataChips({ data, max = 3 }: { data: DataDelta[]; max?: number }) {
  if (!data.length) return null
  const shown = data.slice(0, max)
  return (
    <>
      {shown.map((d) => (
        <span key={d.slot} className="evo-chip data" title={`${d.slot}: ${d.from ?? 'nothing'} → ${d.to ?? 'nothing'}`}>
          <code>{d.slot}</code> {d.to ? (d.from ? 'new data' : 'added') : 'removed'}
        </span>
      ))}
      {data.length > max && <span className="evo-chip data">+{data.length - max} more slots</span>}
    </>
  )
}

function EvoCard({ e, evo, pick, onPick }: { e: EvolutionIsle; evo: Evolution; pick: Pick | null; onPick: (p: Pick) => void }) {
  const first = e.versions[0]!
  const parent = e.parentId ? evo.isles.find((x) => x.isle.id === e.parentId) : null
  const on = (v: number) => pick?.isle === e.isle.id && pick.version === v
  const [open, setOpen] = useState(e.isle.id === evo.focusId || e.versions.length <= 3)
  const later = e.versions.slice(1)
  return (
    <li className={`evo-item ${e.isle.id === evo.focusId ? 'focus' : ''}`} style={{ '--depth': Math.min(e.depth, 6) } as React.CSSProperties}>
      <div className={`evo-card card ${on(first.version) ? 'on' : ''}`} data-pid={`evo-${e.isle.id}`}>
        <button className="evo-thumb" onClick={() => onPick({ isle: e.isle.id, version: first.version })} aria-label={`Compare ${e.isle.title} with ${parent ? 'what it came from' : 'nothing'}`}>
          <Thumb src={e.isle.shotUrl} title={e.isle.title} />
        </button>
        <div className="evo-body">
          <div className="row" style={{ gap: 6 }}>
            <Link to={`/i/${e.isle.id}`} className="evo-title">{e.isle.title}</Link>
            {e.parentId ? <RelationChip relation={e.isle.relation} /> : <span className="chip">original</span>}
          </div>
          <div className="tiny muted">{who(e.isle.owner)} · {ago(first.createdAt)}{parent ? <> · from {parent.isle.title}{e.parentVersion ? ` v${e.parentVersion}` : ''}</> : null}</div>
          <p className={`evo-note ${first.note ? '' : 'muted'} ${!first.note && !e.parentId ? 'desc' : ''}`} title={!first.note && !e.parentId ? (e.isle.description ?? undefined) : undefined}>
            {first.note ?? (e.parentId ? 'No description of what changed.' : (e.isle.description ?? 'The original.'))}
          </p>
          {e.parentId && (
            <div className="evo-chips">
              <PageChip page={first.page} />
              <DataChips data={first.data} />
            </div>
          )}
          <div className="row" style={{ marginTop: 6, gap: 6 }}>
            {e.parentId && <button className={`btn sm ${on(first.version) ? 'on' : ''}`} onClick={() => onPick({ isle: e.isle.id, version: first.version })}>Compare with {parent?.isle.title ? 'its parent' : 'parent'}</button>}
            {later.length > 0 && <button className="btn ghost sm" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'} {later.length} later version{later.length === 1 ? '' : 's'}</button>}
          </div>
          {open && later.length > 0 && (
            <ol className="evo-versions">
              {later.map((v) => (
                <li key={v.version} className={on(v.version) ? 'on' : ''}>
                  <button onClick={() => onPick({ isle: e.isle.id, version: v.version })}>
                    <span className="chip">v{v.version}</span>
                    <span className="grow">
                      <span className={v.note ? '' : 'muted'}>{v.note ?? 'No note'}</span>
                      <span className="evo-chips"><PageChip page={v.page} /><DataChips data={v.data} max={2} /></span>
                    </span>
                    <span className="tiny muted">{ago(v.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </li>
  )
}

function before(evo: Evolution, pick: Pick): { e: EvolutionIsle; version: number } | null {
  const e = evo.isles.find((x) => x.isle.id === pick.isle)
  if (!e) return null
  const n = e.versions.findIndex((v) => v.version === pick.version)
  if (n > 0) return { e, version: e.versions[n - 1]!.version }
  const p = e.parentId ? evo.isles.find((x) => x.isle.id === e.parentId) : null
  return p ? { e: p, version: e.parentVersion ?? p.versions[p.versions.length - 1]!.version } : null
}

function versionUrl(frameUrl: string, v: number, current: number) {
  if (v === current) return frameUrl
  const u = new URL(frameUrl, location.origin)
  u.searchParams.set('v', String(v))
  return u.toString()
}

function Compare({ evo, pick }: { evo: Evolution; pick: Pick }) {
  const e = evo.isles.find((x) => x.isle.id === pick.isle)!
  const step = e.versions.find((v) => v.version === pick.version)!
  const prev = before(evo, pick)
  const label = (x: EvolutionIsle, v: number) => (x === e ? `v${v}` : `${x.isle.title} v${v}`)
  return (
    <div className="card pad" data-pid="evo-compare">
      <div className="tiny muted" style={{ fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>Compare</div>
      <h2 style={{ margin: '4px 0 2px', fontSize: 18 }}>{e.isle.title} <span className="muted">v{step.version}</span></h2>
      <div className="small muted">{prev ? <>compared with {label(prev.e, prev.version)}{prev.e !== e ? ', the version it was made from' : ''}</> : 'the first version: nothing before it'} · {ago(step.createdAt)}</div>
      {step.note && <p className="evo-note" style={{ marginTop: 10 }}>{step.note}</p>}
      {prev && (
        <>
          <div className="evo-chips" style={{ marginTop: 8 }}><PageChip page={step.page} /></div>
          {step.data.length > 0 ? (
            <table className="evo-data">
              <thead><tr><th>Slot</th><th>Before</th><th>After</th></tr></thead>
              <tbody>
                {step.data.map((d) => <tr key={d.slot}><td><code>{d.slot}</code></td><td>{d.from ?? <span className="muted">—</span>}</td><td>{d.to ?? <span className="muted">—</span>}</td></tr>)}
              </tbody>
            </table>
          ) : (
            <p className="small muted" style={{ margin: '8px 0 0' }}>Same data as before.</p>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <a className="btn sm" href={versionUrl(prev.e.isle.frameUrl, prev.version, prev.e.isle.version)} target="_blank" rel="noreferrer"><Icon name="open" /> Open before</a>
            <a className="btn sm" href={versionUrl(e.isle.frameUrl, step.version, e.isle.version)} target="_blank" rel="noreferrer"><Icon name="open" /> Open after</a>
          </div>
          {step.page && step.page.similarity < 1 ? <PageDiff a={{ id: prev.e.isle.id, v: prev.version }} b={{ id: e.isle.id, v: step.version }} /> : null}
        </>
      )}
    </div>
  )
}

// ---- the page, line by line ----

type Op = { t: ' ' | '+' | '-'; s: string }

/** Lines of a page, split further at tags and CSS rules when the page is written on few long lines. */
function linesOf(text: string): string[] {
  const raw = text.split('\n')
  return raw.length < 40 && text.length > 4000 ? text.split(/\n|(?<=>)|(?<=;)|(?<=\})/) : raw
}

/** Myers' diff on lines; gives up (null) when the pages differ too much to show line by line. */
function diffLines(a: string[], b: string[], maxD = 2500): Op[] | null {
  // trim the common ends first: most changes are small and in the middle
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let ea = a.length, eb = b.length
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb-- }
  const A = a.slice(s, ea), B = b.slice(s, eb)
  const N = A.length, M = B.length, max = N + M
  const V = new Int32Array(2 * max + 2)
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= Math.min(max, maxD); d++) {
    trace.push(V.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && V[max + k - 1]! < V[max + k + 1]!) ? V[max + k + 1]! : V[max + k - 1]! + 1
      let y = x - k
      while (x < N && y < M && A[x] === B[y]) { x++; y++ }
      V[max + k] = x
      if (x >= N && y >= M) { found = d; break }
    }
    if (found >= 0) break
  }
  if (found < 0) return null
  const ops: Op[] = []
  let x = N, y = M
  for (let d = found; d > 0; d--) {
    const Vd = trace[d]!, k = x - y
    const prevK = k === -d || (k !== d && Vd[max + k - 1]! < Vd[max + k + 1]!) ? k + 1 : k - 1
    const px = Vd[max + prevK]!, py = px - prevK
    while (x > px && y > py) { ops.push({ t: ' ', s: A[--x]! }); y-- }
    if (x === px) ops.push({ t: '+', s: B[--y]! })
    else ops.push({ t: '-', s: A[--x]! })
  }
  while (x > 0 && y > 0) { ops.push({ t: ' ', s: A[--x]! }); y-- }
  ops.reverse()
  return [...a.slice(0, s).map((l) => ({ t: ' ' as const, s: l })), ...ops, ...a.slice(ea).map((l) => ({ t: ' ' as const, s: l }))]
}

/** Changed lines with a few around them; long unchanged stretches fold away. */
function hunks(ops: Op[], ctx = 3): (Op | { fold: number })[] {
  const keep = new Uint8Array(ops.length)
  ops.forEach((o, i) => { if (o.t !== ' ') for (let j = Math.max(0, i - ctx); j <= Math.min(ops.length - 1, i + ctx); j++) keep[j] = 1 })
  const out: (Op | { fold: number })[] = []
  let skipped = 0
  ops.forEach((o, i) => {
    if (keep[i]) { if (skipped) { out.push({ fold: skipped }); skipped = 0 } out.push(o) }
    else skipped++
  })
  if (skipped) out.push({ fold: skipped })
  return out
}

function PageDiff({ a, b }: { a: { id: string; v: number }; b: { id: string; v: number } }) {
  const [show, setShow] = useState(false)
  const texts = useAsync(() => (show ? Promise.all([api.isleSource(a.id, a.v), api.isleSource(b.id, b.v)]) : Promise.resolve(null)), [show, a.id, a.v, b.id, b.v])
  const result = useMemo(() => {
    if (!texts.data) return null
    const ops = diffLines(linesOf(texts.data[0]), linesOf(texts.data[1]))
    return ops ? hunks(ops) : 'too-different'
  }, [texts.data])
  const LIMIT = 600
  return (
    <div style={{ marginTop: 14 }}>
      <div className="row">
        <b className="small grow">Page changes</b>
        <button className="btn sm" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'} the lines that changed</button>
      </div>
      {show && texts.loading && <p className="tiny muted">Reading both pages…</p>}
      {show && texts.error && <ErrorBox error={texts.error} />}
      {show && result === 'too-different' && <p className="small muted">These pages are too different to show line by line: it's a new page more than an edit of the old one.</p>}
      {show && Array.isArray(result) && (
        <div className="evo-diff" role="region" aria-label="Lines that changed">
          {result.slice(0, LIMIT).map((o, i) =>
            'fold' in o ? (
              <div key={i} className="fold">⋯ {o.fold} unchanged line{o.fold === 1 ? '' : 's'}</div>
            ) : (
              <div key={i} className={o.t === '+' ? 'add' : o.t === '-' ? 'del' : ''}><span className="sign">{o.t}</span>{o.s}</div>
            ),
          )}
          {result.length > LIMIT && <div className="fold">… and {result.length - LIMIT} more lines</div>}
        </div>
      )}
    </div>
  )
}

