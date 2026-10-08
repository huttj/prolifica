import { useEffect, useMemo, useRef, useState } from 'react'
import type { DataDelta, Evolution, EvolutionIsle, EvolutionStep, PageDelta } from '../shared/types'
import { ago, api, who } from './api'
import { ErrorBox, Icon, Link, RelationChip, Thumb, useAsync } from './ui'

/**
 * How a family evolved: the original, every remix of it and every version of each, oldest first. Each
 * step says what changed (the publisher's note, how much of the page, which data), and any step can be
 * compared with the one before it, down to the lines of the page.
 */

type Pick = { isle: string; version: number }

/** The family's history in a large overlay over the isle page; Escape or the backdrop closes it. */
export function EvolutionModal({ id, onClose }: { id: string; onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', on); document.body.style.overflow = prev }
  }, [onClose])
  return (
    <div className="scrim evo-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card evo-modal" role="dialog" aria-label="How this family evolved">
        <button className="btn ghost sm evo-close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        <EvolutionView id={id} />
      </div>
    </div>
  )
}

export function EvolutionView({ id }: { id: string }) {
  const evo = useAsync(() => api.evolution(id), [id])
  const [pick, setPick] = useState<Pick | null>(null)
  const [mode, setMode] = useState<'graph' | 'list'>('graph')
  const [part, setPart] = useState<string | null>(null)
  const compareRef = useRef<HTMLDivElement>(null)

  // start on the isle you came from: what it changed from its parent, or its latest change
  useEffect(() => {
    if (!evo.data || pick) return
    const e = evo.data.isles.find((x) => x.isle.id === evo.data!.focusId) ?? evo.data.isles[0]
    if (!e) return
    const last = e.versions[e.versions.length - 1]!
    setPick({ isle: e.isle.id, version: e.parentId && e.versions.length === 1 ? e.versions[0]!.version : last.version })
  }, [evo.data, pick])

  const choose = (p: Pick) => {
    setPick(p)
    setTimeout(() => compareRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
  }

  if (evo.error) return <ErrorBox error={evo.error} />
  if (!evo.data) return <p className="muted">Loading the family…</p>
  const data = evo.data
  const root = data.isles.find((e) => e.isle.id === data.rootId) ?? data.isles[0]!
  const remixes = data.isles.length - 1
  const versions = data.isles.reduce((n, e) => n + e.versions.length, 0)
  const parts = partsOf(data)

  return (
    <div className="evo">
      <h2 className="evo-h">How “{root.isle.title}” evolved</h2>
      <p className="small muted" style={{ margin: '2px 0 10px' }}>
        {remixes ? `${remixes} remix${remixes === 1 ? '' : 'es'}, ` : ''}{versions} version{versions === 1 ? '' : 's'}. Click a step to compare it with the one before.
        {data.truncated && ' (The family is bigger than this; showing the first part.)'}
      </p>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        <div className="seg">
          <button className={mode === 'graph' ? 'on' : ''} onClick={() => setMode('graph')}>Graph</button>
          <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>List</button>
        </div>
        {parts.length > 0 && mode === 'graph' && (
          <div className="evo-parts" role="group" aria-label="Follow one component">
            <span className="tiny muted">Follow a part:</span>
            {parts.map((p) => <button key={p} className={`evo-part ${part === p ? 'on' : ''}`} onClick={() => setPart((x) => (x === p ? null : p))}>{p}</button>)}
          </div>
        )}
      </div>
      {mode === 'graph' ? (
        <EvoGraph evo={data} pick={pick} onPick={choose} part={part} />
      ) : (
        <ol className="evo-line">
          {data.isles.map((e) => <EvoCard key={e.isle.id} e={e} evo={data} pick={pick} onPick={choose} />)}
        </ol>
      )}
      <div ref={compareRef} style={{ marginTop: 14 }}>
        {pick ? <Compare evo={data} pick={pick} /> : null}
      </div>
    </div>
  )
}

/** Every component named in the family's changes, most often changed first. */
function partsOf(evo: Evolution): string[] {
  const n = new Map<string, number>()
  for (const e of evo.isles) for (const v of e.versions) {
    for (const c of v.changes ?? []) n.set(c.part, (n.get(c.part) ?? 0) + 1)
    for (const d of v.draws ?? []) for (const p of d.parts) n.set(p, (n.get(p) ?? 0) + 1)
  }
  return [...n].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 16)
}
const touches = (v: EvolutionStep, part: string) => (v.changes ?? []).some((c) => c.part === part) || (v.draws ?? []).some((d) => d.parts.includes(part))

// ---- the graph: one lane per isle, its versions along it in time, remixes branching off, draws converging ----

const LANE = 60
const STEP = 58
const PAD = 26

/** What a step changed, in a few words, for an edge's label. */
function edgeLabel(v: EvolutionStep, relation: string | null): string {
  const bits: string[] = []
  if (v.data.length) bits.push(v.data.length === 1 ? `${v.data[0]!.slot} data` : `${v.data.length} slots new data`)
  if (v.page && v.page.similarity < 1) bits.push(`page ${pct(v.page)}%`)
  if (!bits.length) bits.push(relation === 'rebind' ? 'new data' : v.page?.similarity === 1 ? 'same page' : 'changed')
  return bits.join(' · ')
}

function EvoGraph({ evo, pick, onPick, part }: { evo: Evolution; pick: Pick | null; onPick: (p: Pick) => void; part: string | null }) {
  const scroller = useRef<HTMLDivElement>(null)
  const lane = new Map(evo.isles.map((e, i) => [e.isle.id, i]))
  // columns: every version in time order, so a remix always sits right of what it came from
  const all = evo.isles.flatMap((e) => e.versions.map((v) => ({ e, v })))
  all.sort((a, b) => a.v.createdAt - b.v.createdAt)
  const col = new Map(all.map((n, i) => [`${n.e.isle.id}:${n.v.version}`, i]))
  const X = (isle: string, v: number) => PAD + (col.get(`${isle}:${v}`) ?? 0) * STEP
  const Y = (isle: string) => PAD - 6 + (lane.get(isle) ?? 0) * LANE
  const W = PAD * 2 + Math.max(0, all.length - 1) * STEP + 120
  const H = PAD + (evo.isles.length - 1) * LANE + PAD
  useEffect(() => { const s = scroller.current; if (s) s.scrollLeft = s.scrollWidth }, [evo])
  const dim = (on: boolean) => (part && !on ? 0.25 : 1)

  const edges: React.ReactNode[] = []
  const labels: React.ReactNode[] = []
  for (const e of evo.isles) {
    const y = Y(e.isle.id)
    e.versions.forEach((v, n) => {
      const x = X(e.isle.id, v.version)
      const on = !part || touches(v, part)
      if (n > 0) {
        const p = e.versions[n - 1]!, px = X(e.isle.id, p.version)
        edges.push(<line key={`v${e.isle.id}${v.version}`} className="evo-g-ver" x1={px} y1={y} x2={x} y2={y} opacity={dim(on)}><title>{`v${v.version}: ${v.note ?? 'no note'}`}</title></line>)
        if (v.page && v.page.similarity < 1 && x - px > 40) labels.push(<text key={`l${e.isle.id}${v.version}`} className="evo-g-lbl" x={(px + x) / 2} y={y - 8} textAnchor="middle" opacity={dim(on)}>{pct(v.page)}%</text>)
      } else if (e.parentId && lane.has(e.parentId)) {
        const pv = e.parentVersion ?? evo.isles.find((o) => o.isle.id === e.parentId)!.versions.at(-1)!.version
        const px = X(e.parentId, pv), py = Y(e.parentId)
        const mid = Math.max(px + STEP * 0.45, x - STEP * 0.55)
        edges.push(<path key={`r${e.isle.id}`} className={`evo-g-remix ${e.isle.relation ?? ''}`} d={`M${px},${py} C${mid},${py} ${mid},${y} ${x - 10},${y}`} opacity={dim(on)}><title>{`${e.isle.title}: ${v.note ?? edgeLabel(v, e.isle.relation)}`}</title></path>)
        labels.push(<text key={`rl${e.isle.id}`} className="evo-g-lbl remix" x={x - 14} y={y - 9} textAnchor="end" opacity={dim(on)}>{edgeLabel(v, e.isle.relation)}</text>)
      }
      for (const d of v.draws ?? []) {
        if (!d.inFamily || !lane.has(d.isle)) continue
        const sx = X(d.isle, d.version), sy = Y(d.isle)
        const hot = !part || d.parts.includes(part)
        const c1 = sx + (x - sx) * 0.5
        edges.push(<path key={`d${e.isle.id}${v.version}${d.isle}`} className="evo-g-draw" d={`M${sx},${sy} C${c1},${sy} ${c1},${y} ${x},${y}`} opacity={dim(hot)}><title>{`drew from ${d.title} v${d.version}${d.parts.length ? ` (${d.parts.join(', ')})` : ''}${d.note ? `: ${d.note}` : ''}`}</title></path>)
      }
    })
  }
  return (
    <div className="evo-graph">
      <div className="evo-lanes" style={{ paddingTop: PAD - 6 - LANE / 2 }}>
        {evo.isles.map((e) => (
          <button key={e.isle.id} className={`evo-lane ${e.isle.id === evo.focusId ? 'focus' : ''}`} style={{ height: LANE, paddingLeft: 8 + Math.min(e.depth, 5) * 10 }} onClick={() => onPick({ isle: e.isle.id, version: e.versions.at(-1)!.version })} title={e.isle.title}>
            <span className="ellipsis evo-lane-t">{e.isle.title}</span>
            <span className="tiny muted ellipsis">{e.parentId ? (e.isle.relation === 'rebind' ? 'new data' : e.isle.relation === 'restyle' ? 'new look' : 'remixed') : 'original'} · {who(e.isle.owner)}</span>
          </button>
        ))}
      </div>
      <div className="evo-canvas" ref={scroller}>
        <svg width={W} height={H} role="img" aria-label="Family graph">
          {evo.isles.map((e) => <line key={`lane${e.isle.id}`} className="evo-g-lane" x1={0} x2={W} y1={Y(e.isle.id)} y2={Y(e.isle.id)} />)}
          {edges}
          {labels}
          {evo.isles.flatMap((e) =>
            e.versions.map((v, n) => {
              const x = X(e.isle.id, v.version), y = Y(e.isle.id)
              const on = pick?.isle === e.isle.id && pick.version === v.version
              const hit = part ? touches(v, part) : false
              const last = n === e.versions.length - 1
              return (
                <g key={`n${e.isle.id}${v.version}`} className={`evo-g-node ${on ? 'on' : ''} ${hit ? 'hit' : ''} ${last ? 'last' : ''}`} transform={`translate(${x},${y})`} opacity={part && !hit ? 0.35 : 1}
                  onClick={() => onPick({ isle: e.isle.id, version: v.version })} tabIndex={0} role="button" aria-label={`${e.isle.title} version ${v.version}`}
                  onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && onPick({ isle: e.isle.id, version: v.version })}>
                  <title>{`${e.isle.title} v${v.version} · ${ago(v.createdAt)}${v.note ? `\n${v.note}` : ''}${(v.changes ?? []).map((c) => `\n• ${c.part}: ${c.what}`).join('')}`}</title>
                  <circle r={on ? 10 : 8} />
                  <text y={22} textAnchor="middle">v{v.version}</text>
                </g>
              )
            }),
          )}
        </svg>
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
      {(step.changes?.length ?? 0) > 0 && (
        <ul className="evo-changes">
          {step.changes!.map((c, i) => <li key={i}><code>{c.part}</code> {c.what}</li>)}
        </ul>
      )}
      {(step.draws?.length ?? 0) > 0 && (
        <div className="evo-draws small">
          {step.draws!.map((d, i) => (
            <div key={i}>↳ drew from <Link to={`/i/${d.isle}`}>{d.title}</Link> v{d.version}{d.parts.length ? <> ({d.parts.map((p) => <code key={p}>{p}</code>)})</> : null}{d.note ? `: ${d.note}` : ''}</div>
          ))}
        </div>
      )}
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

