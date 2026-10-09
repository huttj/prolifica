import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { DataDelta, Evolution, EvolutionIsle, EvolutionStep, PageDelta } from '../shared/types'
import { ago, api, who } from './api'
import { AskAiButton } from './ask'
import { ErrorBox, Icon, Link, RelationChip, Thumb, useAsync, useSession } from './ui'

/**
 * How a family evolved: the original, every remix of it and every version of each, oldest first. Each
 * step says what changed (the publisher's note, how much of the page, which data, which features), and
 * any step can be compared with the one before it, down to the lines of the page. Features are the parts
 * publishes name in `changes` (and take with `draws_from`): each line of the family carries the ones it
 * has picked up, so the isle you came from can see what its relatives have that it hasn't, and hand them
 * to your AI to bring in.
 */

type Pick = { isle: string; version: number }

/** The family's history in a large overlay over the isle page; Escape or the backdrop closes it. */
export function EvolutionModal({ id, onClose }: { id: string; onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as Element).closest?.('.evo-combo') && onClose()
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
  // steps ringed in the graph while the missing-features panel is hovered
  const [ring, setRing] = useState<Set<string> | null>(null)
  const compareRef = useRef<HTMLDivElement>(null)
  const feats = useMemo(() => (evo.data ? featuresOf(evo.data) : null), [evo.data])

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
  if (!evo.data || !feats) return <p className="muted">Loading the family…</p>
  const data = evo.data
  const root = data.isles.find((e) => e.isle.id === data.rootId) ?? data.isles[0]!
  const focus = data.isles.find((e) => e.isle.id === data.focusId) ?? null
  const remixes = data.isles.length - 1
  const versions = data.isles.reduce((n, e) => n + e.versions.length, 0)
  const parts = [...feats.family].map(([p, touches]) => ({ part: p, n: touches.length })).sort((a, b) => b.n - a.n || a.part.localeCompare(b.part))

  return (
    <div className="evo">
      <h2 className="evo-h">How “{root.isle.title}” evolved</h2>
      <p className="small muted" style={{ margin: '2px 0 10px' }}>
        {remixes ? `${remixes} remix${remixes === 1 ? '' : 'es'}, ` : ''}{versions} version{versions === 1 ? '' : 's'}.{' '}
        {mode === 'graph'
          ? 'Each row is one isle and each dot one of its versions, oldest on the left. Hover a line for what changed, a dot for its features; click a dot to compare it with the step before.'
          : 'Click a step to compare it with the one before.'}
        {data.truncated && ' (The family is bigger than this; showing the first part.)'}
      </p>
      <div className="row evo-tools">
        <div className="seg">
          <button className={mode === 'graph' ? 'on' : ''} onClick={() => setMode('graph')}>Graph</button>
          <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>List</button>
        </div>
        {parts.length > 0 && <PartPicker parts={parts} value={part} onChange={setPart} />}
      </div>
      {part && <PartTrail evo={data} feats={feats} part={part} onPick={choose} />}
      {mode === 'graph' ? (
        <>
          <EvoGraph evo={data} feats={feats} pick={pick} onPick={choose} part={part} ring={ring} />
          <GraphLegend />
        </>
      ) : (
        <ol className="evo-line">
          {data.isles.map((e) => <EvoCard key={e.isle.id} e={e} evo={data} pick={pick} onPick={choose} />)}
        </ol>
      )}
      <div className="evo-below">
        {focus && <MissingPanel evo={data} feats={feats} focus={focus} onRing={setRing} />}
        <div ref={compareRef}>{pick ? <Compare evo={data} pick={pick} /> : null}</div>
      </div>
    </div>
  )
}

// ---- features: the parts each line of the family has picked up ----

type StepKey = string
const keyOf = (isle: string, version: number): StepKey => `${isle}:${version}`

interface Feature {
  part: string
  what: string
  isle: string
  version: number
  at: number
}

interface Features {
  /** the features a step's line has, once that step is made */
  at: Map<StepKey, Map<string, Feature>>
  /** what each step did to its line's features: new to the line, or changed */
  delta: Map<StepKey, { added: Feature[]; changed: Feature[] }>
  /** every feature anywhere in the family, with each step that touched it, oldest first */
  family: Map<string, Feature[]>
}

/** What a step says it changed, plus the parts it took from other isles. */
function stepParts(v: EvolutionStep): { part: string; what: string }[] {
  const out = [...(v.changes ?? [])]
  for (const d of v.draws ?? []) for (const p of d.parts) if (!out.some((o) => o.part === p)) out.push({ part: p, what: d.note ? `from ${d.title}: ${d.note}` : `taken from ${d.title}` })
  return out
}

function featuresOf(evo: Evolution): Features {
  const byId = new Map(evo.isles.map((e) => [e.isle.id, e]))
  const at = new Map<StepKey, Map<string, Feature>>()
  const delta = new Map<StepKey, { added: Feature[]; changed: Feature[] }>()
  const family = new Map<string, Feature[]>()
  // isles come depth-first from the root, so a parent's line is known before its remixes'
  for (const e of evo.isles) {
    const p = e.parentId ? byId.get(e.parentId) : null
    let line = new Map<string, Feature>()
    if (p) {
      const pv = e.parentVersion ?? p.versions.at(-1)!.version
      const base = [...p.versions].reverse().find((v) => v.version <= pv) ?? p.versions[0]!
      line = new Map(at.get(keyOf(p.isle.id, base.version)) ?? [])
    }
    for (const v of e.versions) {
      const added: Feature[] = []
      const changed: Feature[] = []
      for (const c of stepParts(v)) {
        const f: Feature = { part: c.part, what: c.what, isle: e.isle.id, version: v.version, at: v.createdAt }
        ;(line.has(c.part) ? changed : added).push(f)
        line.set(c.part, f)
        family.set(c.part, [...(family.get(c.part) ?? []), f])
      }
      at.set(keyOf(e.isle.id, v.version), new Map(line))
      delta.set(keyOf(e.isle.id, v.version), { added, changed })
    }
  }
  for (const list of family.values()) list.sort((a, b) => a.at - b.at)
  return { at, delta, family }
}

/** Features elsewhere in the family that a step's line doesn't have, each with the latest step that has it. */
function missingAt(feats: Features, step: StepKey): Feature[] {
  const have = feats.at.get(step) ?? new Map()
  const out: Feature[] = []
  for (const [part, touches] of feats.family) if (!have.has(part)) out.push(touches[touches.length - 1]!)
  return out.sort((a, b) => a.part.localeCompare(b.part))
}

const touches = (v: EvolutionStep, part: string) => stepParts(v).some((c) => c.part === part)

// ---- following one part across the family ----

/** A search box over every part, with the matches in a list under it. */
function PartPicker({ parts, value, onChange }: { parts: { part: string; n: number }[]; value: string | null; onChange: (p: string | null) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? parts.filter((p) => p.part.toLowerCase().includes(needle)).sort((a, b) => Number(!b.part.toLowerCase().startsWith(needle)) - Number(!a.part.toLowerCase().startsWith(needle)))
    : parts
  useEffect(() => setAt(0), [needle])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [at])
  const choose = (p: string | null) => {
    onChange(p)
    setOpen(false)
    setQ('')
    input.current?.blur()
  }
  return (
    <div className="evo-combo">
      <span className="tiny muted">Follow a feature</span>
      <div className={`evo-combo-box ${value ? 'set' : ''}`}>
        <input
          ref={input}
          className="field"
          role="combobox"
          aria-expanded={open}
          aria-controls="evo-parts-list"
          aria-activedescendant={open && shown[at] ? `evo-part-${at}` : undefined}
          aria-autocomplete="list"
          placeholder={`Search ${parts.length} feature${parts.length === 1 ? '' : 's'}`}
          value={open ? q : (value ?? '')}
          onFocus={() => { setOpen(true); setQ('') }}
          onBlur={() => setOpen(false)}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setAt((a) => Math.min(shown.length - 1, a + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((a) => Math.max(0, a - 1)) }
            else if (e.key === 'Enter') { e.preventDefault(); if (shown[at]) choose(shown[at]!.part) }
            else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); input.current?.blur() }
          }}
        />
        {value && (
          <button className="evo-combo-x" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(null)} aria-label="Stop following" title="Stop following">
            <Icon name="close" />
          </button>
        )}
        {open && (
          <ul className="evo-combo-list card" id="evo-parts-list" role="listbox" ref={list}>
            {!shown.length && <li className="tiny muted evo-combo-none">No feature matches.</li>}
            {shown.map((p, i) => (
              <li
                key={p.part}
                id={`evo-part-${i}`}
                data-i={i}
                role="option"
                aria-selected={i === at}
                className={`${i === at ? 'at' : ''} ${p.part === value ? 'on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setAt(i)}
                onClick={() => choose(p.part)}
              >
                <code className="grow ellipsis">{p.part}</code>
                <span className="tiny muted">{p.n} change{p.n === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** One feature's history: every step that touched it, and the isles that don't have it. */
function PartTrail({ evo, feats, part, onPick }: { evo: Evolution; feats: Features; part: string; onPick: (p: Pick) => void }) {
  const steps = feats.family.get(part) ?? []
  const title = (id: string) => evo.isles.find((e) => e.isle.id === id)?.isle.title ?? id
  const lacking = evo.isles.filter((e) => !feats.at.get(keyOf(e.isle.id, e.versions.at(-1)!.version))?.has(part))
  return (
    <div className="evo-trail">
      <div className="small"><code>{part}</code> <span className="muted">changed {steps.length} time{steps.length === 1 ? '' : 's'}:</span></div>
      <ol>
        {steps.map((f) => (
          <li key={keyOf(f.isle, f.version)}>
            <button className="link-btn" onClick={() => onPick({ isle: f.isle, version: f.version })}>{title(f.isle)} v{f.version}</button>
            <span className="small"> {f.what}</span>
            <span className="tiny muted"> · {ago(f.at)}</span>
          </li>
        ))}
      </ol>
      {lacking.length > 0 && <div className="tiny muted">Not in: {lacking.map((e) => e.isle.title).join(', ')}</div>}
    </div>
  )
}

// ---- hover cards ----

type Hover = { x: number; y: number; body: ReactNode }

/** A card that follows the pointer, kept inside the window. */
function HoverCard({ h }: { h: Hover }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: h.x + 14, top: h.y + 14 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    let left = h.x + 14
    let top = h.y + 14
    if (left + width > window.innerWidth - 8) left = Math.max(8, h.x - width - 14)
    if (top + height > window.innerHeight - 8) top = Math.max(8, h.y - height - 14)
    setPos({ left, top })
  }, [h.x, h.y, h.body])
  return createPortal(<div ref={ref} className="evo-hover card" style={pos} role="tooltip">{h.body}</div>, document.body)
}

const RELATION_WORDS: Record<string, string> = { rebind: 'new data, same page', restyle: 'new look, same data', remix: 'remixed' }
const relationWords = (e: EvolutionIsle) => (e.parentId ? (RELATION_WORDS[e.isle.relation ?? 'remix'] ?? 'remixed') : 'the original')

/** What one step changed: shown on the line leading into it. */
function StepCard({ evo, feats, e, v, draw }: { evo: Evolution; feats: Features; e: EvolutionIsle; v: EvolutionStep; draw?: NonNullable<EvolutionStep['draws']>[number] }) {
  const n = e.versions.indexOf(v)
  const parent = e.parentId ? evo.isles.find((x) => x.isle.id === e.parentId) : null
  const d = feats.delta.get(keyOf(e.isle.id, v.version))
  const head = draw
    ? <>{e.isle.title} v{v.version} took from {draw.title} v{draw.version}</>
    : n > 0
      ? <>{e.isle.title}: v{e.versions[n - 1]!.version} → v{v.version}</>
      : <>{e.isle.title}, {relationWords(e)}{parent ? <> from {parent.isle.title}{e.parentVersion ? ` v${e.parentVersion}` : ''}</> : null}</>
  const changes = draw
    ? (d ? [...d.added, ...d.changed].filter((f) => draw.parts.includes(f.part)) : [])
    : [...(d?.added ?? []), ...(d?.changed ?? [])]
  const added = new Set(d?.added.map((f) => f.part))
  return (
    <div className="evo-hc">
      <b className="evo-hc-h">{head}</b>
      <div className="tiny muted">{ago(v.createdAt)} · by {who(e.isle.owner)}</div>
      {(draw ? draw.note : v.note) && <p className="evo-hc-note">{draw ? draw.note : v.note}</p>}
      {changes.length > 0 && (
        <ul className="evo-feats">
          {changes.map((f) => <FeatureRow key={f.part} sign={added.has(f.part) ? '+' : '~'} f={f} />)}
        </ul>
      )}
      {!draw && (
        <div className="evo-chips">
          <PageChip page={v.page} />
          <DataChips data={v.data} max={3} />
          {!v.page && !v.data.length && !changes.length && !v.note && <span className="evo-chip">nothing recorded</span>}
        </div>
      )}
      {!draw && (v.draws?.length ?? 0) > 0 && (
        <div className="tiny muted" style={{ marginTop: 4 }}>Also took from {v.draws!.map((x) => `${x.title} v${x.version}`).join(', ')}</div>
      )}
    </div>
  )
}

function FeatureRow({ sign, f, muted }: { sign: '+' | '~' | '·' | '−'; f: Feature; muted?: boolean }) {
  const cls = sign === '+' ? 'add' : sign === '~' ? 'chg' : sign === '−' ? 'del' : ''
  return (
    <li className={muted ? 'muted' : ''}>
      <span className={`evo-sign ${cls}`} aria-hidden="true">{sign}</span>
      <span className="grow"><code>{f.part}</code> <span className="evo-what">{f.what}</span></span>
    </li>
  )
}

/** A version: its note, and its features (new, changed, kept, and the ones its relatives have). */
function NodeCard({ feats, e, v }: { feats: Features; e: EvolutionIsle; v: EvolutionStep }) {
  const k = keyOf(e.isle.id, v.version)
  const d = feats.delta.get(k)
  const have = [...(feats.at.get(k)?.values() ?? [])]
  const touched = new Set([...(d?.added ?? []), ...(d?.changed ?? [])].map((f) => f.part))
  const kept = have.filter((f) => !touched.has(f.part))
  const missing = missingAt(feats, k)
  const MAX_KEPT = 8
  const MAX_MISSING = 6
  return (
    <div className="evo-hc">
      <b className="evo-hc-h">{e.isle.title} <span className="muted">v{v.version}</span></b>
      <div className="tiny muted">{ago(v.createdAt)} · {v.version === e.versions.at(-1)!.version ? 'latest · ' : ''}{relationWords(e)}</div>
      {v.note && <p className="evo-hc-note">{v.note}</p>}
      {have.length + missing.length > 0 ? (
        <ul className="evo-feats">
          {d?.added.map((f) => <FeatureRow key={f.part} sign="+" f={f} />)}
          {d?.changed.map((f) => <FeatureRow key={f.part} sign="~" f={f} />)}
          {kept.slice(0, MAX_KEPT).map((f) => <FeatureRow key={f.part} sign="·" f={f} muted />)}
          {kept.length > MAX_KEPT && <li className="tiny muted">and {kept.length - MAX_KEPT} more it already had</li>}
          {missing.slice(0, MAX_MISSING).map((f) => <FeatureRow key={f.part} sign="−" f={f} muted />)}
          {missing.length > MAX_MISSING && <li className="tiny muted">and {missing.length - MAX_MISSING} more it doesn't have</li>}
        </ul>
      ) : (
        <p className="tiny muted" style={{ margin: '6px 0 0' }}>No features recorded.</p>
      )}
      {have.length + missing.length > 0 && (
        <div className="evo-hc-key tiny muted"><span className="evo-sign add">+</span> new <span className="evo-sign chg">~</span> changed <span className="evo-sign">·</span> kept <span className="evo-sign del">−</span> elsewhere in the family, not here</div>
      )}
    </div>
  )
}

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

function EvoGraph({ evo, feats, pick, onPick, part, ring }: { evo: Evolution; feats: Features; pick: Pick | null; onPick: (p: Pick) => void; part: string | null; ring: Set<string> | null }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<Hover | null>(null)
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
  const show = (body: () => ReactNode) => (ev: React.MouseEvent) => setHover({ x: ev.clientX, y: ev.clientY, body: body() })
  const showAt = (body: () => ReactNode) => (ev: React.FocusEvent<Element>) => {
    const r = ev.currentTarget.getBoundingClientRect()
    setHover({ x: r.right, y: r.bottom, body: body() })
  }
  const hide = () => setHover(null)

  /** A line with a wide invisible twin, so it's easy to hover. */
  const edge = (key: string, d: string, cls: string, opacity: number, body: () => ReactNode) => (
    <g key={key} className="evo-g-edge" opacity={opacity} onMouseEnter={show(body)} onMouseMove={show(body)} onMouseLeave={hide}>
      <path className={cls} d={d} />
      <path className="evo-g-hit" d={d} />
    </g>
  )

  const edges: ReactNode[] = []
  const labels: ReactNode[] = []
  for (const e of evo.isles) {
    const y = Y(e.isle.id)
    e.versions.forEach((v, n) => {
      const x = X(e.isle.id, v.version)
      const on = !part || touches(v, part)
      const card = () => <StepCard evo={evo} feats={feats} e={e} v={v} />
      if (n > 0) {
        const p = e.versions[n - 1]!, px = X(e.isle.id, p.version)
        edges.push(edge(`v${e.isle.id}${v.version}`, `M${px},${y} L${x},${y}`, 'evo-g-ver', dim(on), card))
        if (v.page && v.page.similarity < 1 && x - px > 40) labels.push(<text key={`l${e.isle.id}${v.version}`} className="evo-g-lbl" x={(px + x) / 2} y={y - 8} textAnchor="middle" opacity={dim(on)}>{pct(v.page)}%</text>)
      } else if (e.parentId && lane.has(e.parentId)) {
        const pv = e.parentVersion ?? evo.isles.find((o) => o.isle.id === e.parentId)!.versions.at(-1)!.version
        const px = X(e.parentId, pv), py = Y(e.parentId)
        const mid = Math.max(px + STEP * 0.45, x - STEP * 0.55)
        edges.push(edge(`r${e.isle.id}`, `M${px},${py} C${mid},${py} ${mid},${y} ${x - 10},${y}`, `evo-g-remix ${e.isle.relation ?? ''}`, dim(on), card))
        labels.push(<text key={`rl${e.isle.id}`} className="evo-g-lbl remix" x={x - 14} y={y - 9} textAnchor="end" opacity={dim(on)}>{edgeLabel(v, e.isle.relation)}</text>)
      }
      for (const d of v.draws ?? []) {
        if (!d.inFamily || !lane.has(d.isle)) continue
        const sx = X(d.isle, d.version), sy = Y(d.isle)
        const hot = !part || d.parts.includes(part)
        const c1 = sx + (x - sx) * 0.5
        edges.push(edge(`d${e.isle.id}${v.version}${d.isle}`, `M${sx},${sy} C${c1},${sy} ${c1},${y} ${x},${y}`, 'evo-g-draw', dim(hot), () => <StepCard evo={evo} feats={feats} e={e} v={v} draw={d} />))
      }
    })
  }
  const focusLane = lane.get(evo.focusId)
  return (
    <div className="evo-graph">
      <div className="evo-lanes" style={{ paddingTop: PAD - 6 - LANE / 2 }}>
        {evo.isles.map((e) => (
          <button key={e.isle.id} className={`evo-lane ${e.isle.id === evo.focusId ? 'focus' : ''}`} style={{ height: LANE, paddingLeft: 8 + Math.min(e.depth, 5) * 10 }} onClick={() => onPick({ isle: e.isle.id, version: e.versions.at(-1)!.version })} title={e.isle.title}>
            <span className="ellipsis evo-lane-t">{e.isle.title}</span>
            <span className="tiny muted ellipsis">{e.isle.id === evo.focusId ? <b className="evo-here">you're here</b> : null}{relationWords(e)} · {who(e.isle.owner)}</span>
          </button>
        ))}
      </div>
      <div className="evo-canvas" ref={scroller}>
        <svg width={W} height={H} role="img" aria-label="Family graph">
          {focusLane !== undefined && <rect className="evo-g-band" x={0} y={Y(evo.focusId) - LANE / 2} width={W} height={LANE} />}
          {evo.isles.map((e) => <line key={`lane${e.isle.id}`} className="evo-g-lane" x1={0} x2={W} y1={Y(e.isle.id)} y2={Y(e.isle.id)} />)}
          {edges}
          {labels}
          {evo.isles.flatMap((e) =>
            e.versions.map((v, n) => {
              const x = X(e.isle.id, v.version), y = Y(e.isle.id)
              const on = pick?.isle === e.isle.id && pick.version === v.version
              const hit = part ? touches(v, part) : false
              const last = n === e.versions.length - 1
              const ringed = ring?.has(keyOf(e.isle.id, v.version)) ?? false
              const card = () => <NodeCard feats={feats} e={e} v={v} />
              return (
                <g key={`n${e.isle.id}${v.version}`} className={`evo-g-node ${on ? 'on' : ''} ${hit ? 'hit' : ''} ${last ? 'last' : ''} ${ringed ? 'want' : ''}`} transform={`translate(${x},${y})`} opacity={(part && !hit) || (ring && !ringed) ? 0.35 : 1}
                  onClick={() => onPick({ isle: e.isle.id, version: v.version })} tabIndex={0} role="button" aria-label={`${e.isle.title} version ${v.version}`}
                  onMouseEnter={show(card)} onMouseMove={show(card)} onMouseLeave={hide} onFocus={showAt(card)} onBlur={hide}
                  onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && onPick({ isle: e.isle.id, version: v.version })}>
                  <circle className="evo-g-pad" r={16} />
                  {ringed && <circle className="evo-g-ring" r={14} />}
                  <circle r={on ? 10 : 8} />
                  <text y={22} textAnchor="middle">v{v.version}</text>
                </g>
              )
            }),
          )}
        </svg>
      </div>
      {hover && <HoverCard h={hover} />}
    </div>
  )
}

function GraphLegend() {
  return (
    <div className="evo-legend tiny muted" aria-label="Legend">
      <span><svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" className="evo-g-ver" /></svg> a new version</span>
      <span><svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" className="evo-g-remix" /></svg> remixed or restyled from</span>
      <span><svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" className="evo-g-remix rebind" /></svg> same page, new data</span>
      <span><svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" className="evo-g-draw" /></svg> took parts from another isle</span>
      <span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" className="evo-k-dot" /></svg> a version</span>
      <span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" className="evo-k-dot last" /></svg> latest</span>
      <span><i className="evo-k-band" /> the isle you came from</span>
    </div>
  )
}

// ---- what the isle you came from is missing ----

function MissingPanel({ evo, feats, focus, onRing }: { evo: Evolution; feats: Features; focus: EvolutionIsle; onRing: (r: Set<string> | null) => void }) {
  const { me, toast } = useSession()
  const latest = focus.versions.at(-1)!
  const missing = useMemo(() => missingAt(feats, keyOf(focus.isle.id, latest.version)), [feats, focus.isle.id, latest.version])
  const [off, setOff] = useState<Set<string>>(new Set())
  const groups = useMemo(() => {
    const m = new Map<string, { e: EvolutionIsle; items: Feature[] }>()
    for (const f of missing) {
      const e = evo.isles.find((x) => x.isle.id === f.isle)!
      m.set(f.isle, { e, items: [...(m.get(f.isle)?.items ?? []), f] })
    }
    return [...m.values()]
  }, [missing, evo])
  useEffect(() => () => onRing(null), [onRing])

  if (!feats.family.size)
    return (
      <div className="evo-missing card pad">
        <b className="small">Features</b>
        <p className="tiny muted" style={{ margin: '4px 0 0' }}>
          None recorded in this family yet. They show up once a publish lists its <code>changes</code> part by part; then you can follow one across the family and see what each isle is missing.
        </p>
      </div>
    )
  const chosen = missing.filter((f) => !off.has(f.part))
  const mine = me?.id === focus.isle.owner.id
  const url = `${location.origin}/i/${focus.isle.id}`
  const sources = [...new Set(chosen.map((f) => f.isle))].map((id) => {
    const e = evo.isles.find((x) => x.isle.id === id)!
    const items = chosen.filter((f) => f.isle === id)
    return { e, version: Math.max(...items.map((f) => f.version)), items }
  })
  const prompt =
    `Using the Prolifica connector, read isle ${focus.isle.id} ("${focus.isle.title}", ${url}) with get_isle, including its HTML, and the isles below that have features it's missing, also with get_isle.\n\n` +
    `Bring these features into "${focus.isle.title}":\n` +
    sources.map((s) => `From ${s.e.isle.id} ("${s.e.isle.title}", v${s.version}):\n${s.items.map((f) => `- ${f.part}: ${f.what}`).join('\n')}`).join('\n\n') +
    `\n\n` +
    (mine
      ? `Update it in place with publish_isle (id: "${focus.isle.id}")`
      : `It isn't mine, so make my own version: publish_isle with parent: "${focus.isle.id}"`) +
    `, with draws_from naming each isle above, its version and the parts you took, and a changes list saying what each part now does. Fit each feature to this isle's own data and look rather than pasting it in. Keep every data-pid attribute stable so comments and stars stay attached. Tell me the link when it's done.`
  const ringOf = (items: Feature[]) => new Set(items.map((f) => keyOf(f.isle, f.version)))

  return (
    <div className="evo-missing card pad" onMouseLeave={() => onRing(null)}>
      <b className="small">What “{focus.isle.title}” is missing</b>
      {!missing.length ? (
        <p className="tiny muted" style={{ margin: '4px 0 0' }}>It has every feature recorded in its family.</p>
      ) : (
        <>
          <p className="tiny muted" style={{ margin: '2px 0 8px' }}>Features its relatives have that it doesn't. Hover one to see where it is; tick the ones you want.</p>
          {groups.map((g) => (
            <div key={g.e.isle.id} className="evo-missing-g" onMouseEnter={() => onRing(ringOf(g.items))}>
              <div className="tiny"><b>{g.e.isle.title}</b> <span className="muted">· {relationWords(g.e)} · {who(g.e.isle.owner)}</span></div>
              {g.items.map((f) => (
                <label key={f.part} className="evo-missing-i" onMouseEnter={() => onRing(ringOf([f]))} onMouseLeave={() => onRing(ringOf(g.items))}>
                  <input
                    type="checkbox"
                    checked={!off.has(f.part)}
                    onChange={() => setOff((o) => { const n = new Set(o); n.has(f.part) ? n.delete(f.part) : n.add(f.part); return n })}
                  />
                  <span className="grow small"><code>{f.part}</code> <span className="evo-what">{f.what}</span> <span className="tiny muted">v{f.version}</span></span>
                </label>
              ))}
            </div>
          ))}
          <div className="row" style={{ marginTop: 10, gap: 6 }}>
            <AskAiButton label={chosen.length > 1 && chosen.length === missing.length ? 'Add these features with' : `Add ${chosen.length} feature${chosen.length === 1 ? '' : 's'} with`} prompt={prompt} disabled={!chosen.length} onAsk={() => toast(mine ? 'Handed over; your AI will add them' : 'Handed over; your AI will make your version with them')} />
            <button className="btn ghost sm" disabled={!chosen.length} onClick={() => navigator.clipboard.writeText(prompt).then(() => toast('Prompt copied'))}><Icon name="copy" /> Copy prompt</button>
          </div>
          {!mine && <p className="tiny muted" style={{ margin: '6px 0 0' }}>It isn't yours, so your AI makes your own version with them.</p>}
        </>
      )}
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

