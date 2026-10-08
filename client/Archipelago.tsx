import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Relation } from '../shared/relation'
import type { SeaChart } from '../shared/types'
import { api } from './api'
import { navigate } from './navigate'
import { ErrorBox, Icon, RelationChip, Thumb, useAsync } from './ui'

/**
 * The archipelago as a sea chart: every public isle is an island. Isles that run the same page (the same
 * view, whatever data they show) form one island group on a shared shelf, named for the view; a remix
 * that changes the look sails off to start a group of its own, and routes show who came from whom.
 * The data lies under the water as sandbanks, and isles whose data comes from the same original source
 * are joined by soft sandbars across the groups. Views are shared far more than data, so views decide
 * where an island sits and data only draws lines.
 * Drawn on a canvas with level of detail, so thousands of isles pan and zoom smoothly. Families are
 * placed oldest first along a spiral, so the sea grows outward and old isles keep their spot.
 */

// ---- seeded randomness: an isle always gets the same coastline and the same spot ----

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function rng(seed: number) {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let SHAPES: Path2D[] = []
/** A few dozen unit coastlines (radius about 1), shared by every island and sandbank. */
function shapes() {
  if (SHAPES.length) return SHAPES
  for (let s = 0; s < 32; s++) {
    const r = rng(s * 7919 + 13)
    const n = 9 + Math.floor(r() * 4)
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.5
      const d = 0.8 + r() * 0.32
      return [Math.cos(a) * d, Math.sin(a) * d] as const
    })
    const p = new Path2D()
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n]!
      const p1 = pts[i]!
      const p2 = pts[(i + 1) % n]!
      const p3 = pts[(i + 2) % n]!
      if (i === 0) p.moveTo(p1[0], p1[1])
      p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1])
    }
    p.closePath()
    SHAPES.push(p)
  }
  return SHAPES
}

// ---- the world ----

interface Isl {
  id: string
  title: string
  by: string
  stars: number
  relation: Relation | null
  shotUrl: string
  data: number[]
  parent: Isl | null
  kids: Isl[]
  fam: Fam
  depth: number
  leaves: number
  descendants: number
  x: number
  y: number
  r: number
  shape: number
  tint: number
  /** the original data behind what it shows (chart data indexes) */
  srcs: number[]
  page: number
  /** its same-view group (index into World.views), or -1 when no other isle runs its page */
  view: number
  /** the layout tree inside its view group: its real parent when that's in the group, else the group's first isle */
  lk: Isl[]
  ld: number
  seed: number
}

interface Shoal {
  id: string | null
  name: string | null
  kind: string
  users: Isl[]
  x: number
  y: number
  rx: number
  ry: number
  shape: number
}

/** One island group: the isles that share a view. */
interface Fam {
  /** what the view is called, from its isles' titles ("Discourse map" from "Discourse map: …") */
  name: string
  root: Isl
  members: Isl[]
  shoals: Shoal[]
  x: number
  y: number
  R: number
}

interface World {
  isles: Isl[]
  byId: Map<string, Isl>
  fams: Fam[]
  shoals: Shoal[]
  /** By the chart's data index; empty where no public isle shows that data. */
  shoalAt: (Shoal | undefined)[]
  grid: Map<string, Isl[]>
  bounds: { x0: number; y0: number; x1: number; y1: number }
  /** groups of two or more isles running the same page */
  views: Isl[][]
  /** isles by the original data they draw on */
  bySource: Map<number, Isl[]>
  /** what to draw for the kinships: sandbars between families on the same data, lines within a view group not already joined by a route */
  dataLinks: [Isl, Isl][]
  viewLinks: [Isl, Isl][]
}

const CELL = 256
const cellKey = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`

function buildWorld(chart: SeaChart): World {
  const byId = new Map<string, Isl>()
  const isles: Isl[] = chart.isles.map(([id, , title, p, stars, relation, , , data, shot, page], n) => {
    const [handle, name] = chart.people[p] ?? [null, null]
    const seed = hash(id)
    const isl = {
      id,
      title,
      by: handle ? `@${handle}` : (name ?? 'someone'),
      stars,
      relation,
      shotUrl: `/api/isles/${id}/shot?v=${shot}`,
      data,
      parent: null,
      kids: [],
      depth: 0,
      leaves: 1,
      descendants: 0,
      x: 0,
      y: 0,
      r: 0,
      shape: seed % 32,
      tint: (seed >>> 5) % 4,
      seed,
      // data with no recorded sources is its own source
      srcs: [...new Set(data.flatMap((d) => (chart.data[d]?.[3]?.length ? chart.data[d]![3]! : [d])))],
      page: page ?? -1 - n,
      view: -1,
    } as unknown as Isl
    byId.set(id, isl)
    return isl
  })
  chart.isles.forEach(([id, parentId]) => {
    const me = byId.get(id)!
    const parent = parentId ? byId.get(parentId) : undefined
    if (parent && parent !== me) {
      me.parent = parent
      parent.kids.push(me)
    }
  })

  // lineage, guarding against a loop in bad data: anything not reached from a root starts its own line
  const seen = new Set<Isl>()
  const gather = (root: Isl) => {
    const stack: Isl[] = [root]
    root.depth = 0
    while (stack.length) {
      const n = stack.pop()!
      if (seen.has(n)) continue
      seen.add(n)
      n.kids = n.kids.filter((k) => !seen.has(k))
      for (const k of n.kids) {
        k.depth = n.depth + 1
        stack.push(k)
      }
    }
  }
  for (const i of isles) if (!i.parent) gather(i)
  for (const i of isles)
    if (!seen.has(i)) {
      i.parent?.kids.splice(i.parent.kids.indexOf(i), 1)
      i.parent = null
      i.relation = null
      gather(i)
    }
  const countDesc = (n: Isl): number => (n.descendants = n.kids.reduce((t, k) => t + 1 + countDesc(k), 0))
  for (const i of isles) if (!i.parent) countDesc(i)

  // same view: the same page, or a rebind of its parent (same page, new data) even if the parent has moved on since
  const up = new Map<Isl, Isl>()
  const find = (a: Isl): Isl => {
    let r = a
    while (up.has(r)) r = up.get(r)!
    while (up.has(a)) { const n = up.get(a)!; up.set(a, r); a = n }
    return r
  }
  const join = (a: Isl, b: Isl) => { const x = find(a), y = find(b); if (x !== y) up.set(x, y) }
  const byPage = new Map<number, Isl>()
  for (const i of isles) {
    const first = byPage.get(i.page)
    if (first) join(i, first)
    else byPage.set(i.page, i)
    if (i.parent && i.relation === 'rebind') join(i, i.parent)
  }
  const groups = new Map<Isl, Isl[]>()
  for (const i of isles) { const r = find(i); const g = groups.get(r); if (g) g.push(i); else groups.set(r, [i]) }

  // each group is laid out as one tree: inside it, an isle hangs off its real parent when that's in the group,
  // otherwise off the group's oldest isle (isles are oldest first)
  const fams: Fam[] = []
  for (const members of groups.values()) {
    const root = members[0]!
    const inGroup = new Set(members)
    const fam: Fam = { name: viewName(members), root, members, shoals: [], x: 0, y: 0, R: 0 }
    for (const m of members) { m.fam = fam; m.lk = []; m.ld = 0 }
    for (const m of members) if (m !== root) (m.parent && inGroup.has(m.parent) ? m.parent : root).lk.push(m)
    const depth = (n: Isl, d: number) => { n.ld = d; for (const k of n.lk) depth(k, d + 1) }
    depth(root, 0)
    fams.push(fam)
  }
  for (const f of fams) layoutFamily(f)

  // sandbanks: one per dataset, under the family of the first isle that showed it
  const shoals: Shoal[] = chart.data.map(([id, path, kind]) => ({ id, name: path ? (path.split('/').pop() ?? path) : null, kind, users: [], x: 0, y: 0, rx: 0, ry: 0, shape: 0 }))
  for (const i of isles) for (const d of i.data) shoals[d]?.users.push(i)
  for (const [k, s] of shoals.entries()) {
    if (!s.users.length) continue
    const fam = s.users[0]!.fam
    const local = s.users.filter((u) => u.fam === fam)
    const rand = rng(k * 31 + 7 + hash(s.users[0]!.id))
    s.shape = Math.floor(rand() * 32)
    if (local.length === 1) {
      const u = local[0]!
      const a = rand() * Math.PI * 2
      s.x = u.x + Math.cos(a) * u.r * 0.45
      s.y = u.y + Math.sin(a) * u.r * 0.45
      s.rx = u.r * (1.6 + rand() * 0.4)
      s.ry = u.r * (1.4 + rand() * 0.4)
    } else {
      s.x = local.reduce((t, u) => t + u.x, 0) / local.length
      s.y = local.reduce((t, u) => t + u.y, 0) / local.length
      const rad = Math.max(...local.map((u) => Math.hypot(u.x - s.x, u.y - s.y) + u.r * 1.3))
      s.rx = rad * (1.0 + rand() * 0.15)
      s.ry = rad * (0.9 + rand() * 0.15)
    }
    fam.shoals.push(s)
  }
  for (const f of fams) {
    f.R = Math.max(...f.members.map((m) => Math.hypot(m.x, m.y) + m.r * 1.9), ...f.shoals.map((s) => Math.hypot(s.x, s.y) + Math.max(s.rx, s.ry))) + 26
  }

  packFamilies(fams)

  const grid = new Map<string, Isl[]>()
  for (const f of fams) {
    for (const m of f.members) {
      m.x += f.x
      m.y += f.y
      const key = cellKey(m.x, m.y)
      const list = grid.get(key)
      if (list) list.push(m)
      else grid.set(key, [m])
    }
    for (const s of f.shoals) {
      s.x += f.x
      s.y += f.y
    }
  }
  const bounds = fams.length
    ? {
        x0: Math.min(...fams.map((f) => f.x - f.R)),
        y0: Math.min(...fams.map((f) => f.y - f.R)),
        x1: Math.max(...fams.map((f) => f.x + f.R)),
        y1: Math.max(...fams.map((f) => f.y + f.R)),
      }
    : { x0: -200, y0: -200, x1: 200, y1: 200 }
  const views = [...groups.values()].filter((g) => g.length > 1)
  views.forEach((g, n) => { for (const i of g) i.view = n })
  const viewLinks: [Isl, Isl][] = []

  // same data: everything drawn from one original source; within a group the shared sandbank says it, so sandbars only cross between groups
  const bySource = new Map<number, Isl[]>()
  for (const i of isles) for (const s of i.srcs) { const l = bySource.get(s); if (l) l.push(i); else bySource.set(s, [i]) }
  const dataLinks: [Isl, Isl][] = []
  const linked = new Set<string>()
  for (const users of bySource.values()) {
    const fams = [...new Set(users.map((u) => u.fam))]
    if (fams.length < 2) continue
    // one isle per family (its oldest user of this source), chained nearest-first
    const reps = fams.map((f) => users.find((u) => u.fam === f)!)
    const left = new Set(reps.slice(1))
    let cur = reps[0]!
    while (left.size) {
      let best: Isl | null = null
      for (const o of left) if (!best || Math.hypot(o.x - cur.x, o.y - cur.y) < Math.hypot(best.x - cur.x, best.y - cur.y)) best = o
      left.delete(best!)
      const key = [cur.id, best!.id].sort().join(' ')
      if (!linked.has(key)) { linked.add(key); dataLinks.push([cur, best!]) }
      cur = best!
    }
  }
  return { isles, byId, fams, shoals: shoals.filter((s) => s.users.length), shoalAt: shoals.map((s) => (s.users.length ? s : undefined)), grid, bounds, views, bySource, dataLinks, viewLinks }
}

/** The isles that run the same page as this one, and those whose data comes from the same original source. */
function kin(w: World, m: Isl) {
  const view = m.view >= 0 ? w.views[m.view]!.filter((o) => o !== m) : []
  const data = [...new Set(m.srcs.flatMap((s) => w.bySource.get(s) ?? []))].filter((o) => o !== m)
  return { view, data }
}

/**
 * A group's name: the part before a colon most of its titles share ("Discourse map"), else the longest run
 * of words they all share ("Argument graph" from "Dark matter argument graph" and "Argument graph: …"),
 * else its first isle's title.
 */
function viewName(members: Isl[]): string {
  const heads = members.map((m) => (/^(.{3,40}?):\s/.exec(m.title)?.[1] ?? '').trim()).filter(Boolean)
  const counts = new Map<string, number>()
  for (const h of heads) counts.set(h, (counts.get(h) ?? 0) + 1)
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]
  if (best && best[1] >= Math.max(2, members.length / 2)) return best[0]
  if (members.length > 1) {
    const words = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean)
    const first = members[0]!.title.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean)
    const lower = first.map((w) => w.toLowerCase())
    const others = members.slice(1, 40).map((m) => ` ${words(m.title).join(' ')} `)
    let run: string[] = []
    for (let i = 0; i < lower.length; i++)
      for (let j = lower.length; j > i + run.length; j--) {
        const phrase = ` ${lower.slice(i, j).join(' ')} `
        if (others.every((o) => o.includes(phrase))) { run = first.slice(i, j); break }
      }
    const name = run.join(' ')
    if (name.length >= 4 && !/^(the|a|an|of|on|and|in)$/i.test(name)) return name[0]!.toUpperCase() + name.slice(1)
  }
  return members[0]!.title
}

/** A radial tree around the root: each remix gets a wedge in proportion to what grew from it. */
function layoutFamily(f: Fam) {
  const count = (n: Isl): void => {
    n.lk.forEach(count)
    n.leaves = n.lk.length ? n.lk.reduce((t, k) => t + k.leaves, 0) : 1
  }
  count(f.root)
  for (const m of f.members) {
    const r = 18 + 6 * Math.log2(1 + m.stars) + 3.5 * Math.log2(1 + m.descendants) + (m === f.root && m.descendants ? 4 : 0)
    m.r = Math.min(r, 72)
  }
  const levels: Isl[][] = []
  for (const m of f.members) (levels[m.ld] ??= []).push(m)
  const ring = [0]
  for (let d = 1; d < levels.length; d++) {
    const prev = Math.max(...levels[d - 1]!.map((m) => m.r))
    const cur = Math.max(...levels[d]!.map((m) => m.r))
    const around = levels[d]!.reduce((t, m) => t + 2 * m.r + 26, 0) / (Math.PI * 2)
    ring[d] = Math.max(ring[d - 1]! + prev + cur + 34, around)
  }
  const rand = rng(f.root.seed)
  const place = (n: Isl, a0: number, a1: number) => {
    let a = a0
    for (const k of n.lk) {
      const span = ((a1 - a0) * k.leaves) / n.leaves
      const mid = a + span / 2 + (rand() - 0.5) * span * 0.3
      const dist = ring[k.ld]! * (0.92 + rand() * 0.16)
      k.x = Math.cos(mid) * dist
      k.y = Math.sin(mid) * dist
      // past the first ring, keep a branch heading outward instead of curling back past the root
      const half = Math.min(span, Math.PI * 0.9) / 2
      place(k, mid - half, mid + half)
      a += span
    }
  }
  const start = rand() * Math.PI * 2
  place(f.root, start, start + Math.PI * 2)

  // nudge apart anything that still overlaps (small families only; big ones are already spread)
  if (f.members.length > 1 && f.members.length <= 400) {
    for (let it = 0; it < 24; it++) {
      let moved = false
      for (let i = 0; i < f.members.length; i++)
        for (let j = i + 1; j < f.members.length; j++) {
          const p = f.members[i]!
          const q = f.members[j]!
          const dx = q.x - p.x
          const dy = q.y - p.y
          const d = Math.hypot(dx, dy) || 0.01
          const need = p.r + q.r + 16
          if (d >= need) continue
          moved = true
          const push = (need - d) / 2
          const ux = dx / d
          const uy = dy / d
          if (p !== f.root) {
            p.x -= ux * push
            p.y -= uy * push
          }
          if (q !== f.root) {
            q.x += ux * push
            q.y += uy * push
          }
        }
      if (!moved) break
    }
  }
}

/** Oldest family in the middle, the rest along a golden-angle spiral, wider than tall. */
function packFamilies(fams: Fam[]) {
  const G = 300
  const grid = new Map<string, Fam[]>()
  const cells = (x: number, y: number, R: number) => {
    const out: string[] = []
    for (let cx = Math.floor((x - R) / G); cx <= Math.floor((x + R) / G); cx++)
      for (let cy = Math.floor((y - R) / G); cy <= Math.floor((y + R) / G); cy++) out.push(`${cx},${cy}`)
    return out
  }
  const clear = (x: number, y: number, R: number) => {
    for (const c of cells(x, y, R))
      for (const f of grid.get(c) ?? []) if (Math.hypot(f.x - x, f.y - y) < f.R + R + 22) return false
    return true
  }
  let t0 = 0
  for (const f of fams) {
    const rand = rng(f.root.seed + 1)
    let t = Math.max(0, t0 - 400)
    for (;; t++) {
      const rad = 30 * Math.sqrt(t)
      const a = t * 2.399963
      const x = Math.cos(a) * rad * 1.55 + (rand() - 0.5) * 30
      const y = Math.sin(a) * rad + (rand() - 0.5) * 30
      if (clear(x, y, f.R)) {
        f.x = x
        f.y = y
        break
      }
    }
    t0 = t
    for (const c of cells(f.x, f.y, f.R)) {
      const list = grid.get(c)
      if (list) list.push(f)
      else grid.set(c, [f])
    }
  }
}

/** A made-up sea for trying the map at scale: /tree?demo=3000 */
function demoChart(n: number): SeaChart {
  const r = rng(42)
  const words = ['Rainfall', 'Tensor', 'Discourse', 'Commute', 'Garden', 'Budget', 'Tides', 'Reading', 'Sleep', 'Coffee', 'Votes', 'Bike', 'Thread', 'Market', 'Bird', 'Steps']
  const kinds = ['map', 'chart', 'timeline', 'atlas', 'ledger', 'graph', 'heatmap', 'explorer']
  const chart: SeaChart = { islesOrigin: location.origin, people: [], data: [], isles: [] }
  for (let p = 0; p < Math.max(5, n / 12); p++) chart.people.push([`person${p}`, null])
  for (let d = 0; d < n / 3; d++) chart.data.push([null, `data/${words[d % words.length]!.toLowerCase()}-${d}.csv`, 'csv'])
  const rels: Relation[] = ['rebind', 'restyle', 'remix']
  for (let i = 0; i < n; i++) {
    const parent = i > 5 && r() < 0.45 ? chart.isles[Math.floor(Math.pow(r(), 2.2) * i)]! : null
    const data = parent && r() < 0.6 ? parent[8] : [Math.floor(r() * chart.data.length)]
    const title = `${words[Math.floor(r() * words.length)]} ${kinds[Math.floor(r() * kinds.length)]}`
    chart.isles.push([`demo${i}`, parent?.[0] ?? null, title, Math.floor(r() * chart.people.length), Math.floor(Math.pow(r(), 6) * 40), parent ? rels[Math.floor(r() * 3)]! : null, i, 1, data, 0])
  }
  return chart
}

// ---- drawing ----

interface View {
  x: number
  y: number
  k: number
}

interface Theme {
  deep: string
  contour: string
  shallow: string
  bank: string
  bankInk: string
  sand: string
  lands: string[]
  hill: string
  wave: string
  ink: string
  muted: string
  accent: string
  font: string
}

function readTheme(el: Element): Theme {
  const cs = getComputedStyle(el)
  const v = (n: string) => cs.getPropertyValue(n).trim()
  return {
    deep: v('--sea-deep'),
    contour: v('--sea-contour'),
    shallow: v('--sea-shallow'),
    bank: v('--sea-bank'),
    bankInk: v('--sea-ink'),
    sand: v('--sand'),
    lands: [v('--land-1'), v('--land-2'), v('--land-3'), v('--land-4')],
    hill: v('--hill'),
    wave: v('--wave'),
    ink: v('--ink'),
    muted: v('--muted'),
    accent: v('--accent-2'),
    font: v('--font'),
  }
}

const ROUTE: Record<string, string> = { rebind: '#6f8fe0', restyle: '#d36aa6', remix: '#d9a03a' }
export interface Layers { views: boolean; data: boolean }

type Target = { isle: Isl; shoal?: undefined } | { shoal: Shoal; isle?: undefined }

const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** Break text into at most `max` lines no wider than `width`, with an ellipsis if it doesn't fit. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const fits = (l: string) => ctx.measureText(l).width <= width
  let lines: string[] = []
  let line = ''
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (!line || fits(next)) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  lines.push(line)
  if (lines.length > max) lines = [...lines.slice(0, max - 1), lines.slice(max - 1).join(' ')]
  return lines.map((l) => {
    if (fits(l)) return l
    while (l.length > 1 && !fits(l + '…')) l = l.slice(0, -1)
    return l.trimEnd() + '…'
  })
}

function render(ctx: CanvasRenderingContext2D, w: World, v: View, size: { w: number; h: number; dpr: number }, t: Theme, hover: Target | null, layers: Layers) {
  const { w: W, h: H, dpr } = size
  const S = shapes()
  const k = v.k
  const sx = (x: number) => (x - v.x) * k + W / 2
  const sy = (y: number) => (y - v.y) * k + H / 2
  const x0 = v.x - W / 2 / k
  const x1 = v.x + W / 2 / k
  const y0 = v.y - H / 2 / k
  const y1 = v.y + H / 2 / k
  const base = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const blob = (shape: number, x: number, y: number, rx: number, ry = rx) => {
    ctx.setTransform(dpr * rx, 0, 0, dpr * ry, dpr * x, dpr * y)
    ctx.fill(S[shape]!)
  }

  base()
  ctx.fillStyle = t.deep
  ctx.fillRect(0, 0, W, H)

  // wave marks, spaced for the screen at any zoom
  const step = Math.pow(2, Math.round(Math.log2(120 / k)))
  ctx.beginPath()
  for (let gx = Math.floor(x0 / step) - 1; gx <= Math.ceil(x1 / step); gx++)
    for (let gy = Math.floor(y0 / step) - 1; gy <= Math.ceil(y1 / step); gy++) {
      const h = hash(`${gx},${gy},${step}`)
      if (h % 3 === 0) continue
      const px = sx((gx + ((h >>> 4) % 100) / 100) * step)
      const py = sy((gy + ((h >>> 12) % 100) / 100) * step)
      ctx.moveTo(px - 6, py)
      ctx.quadraticCurveTo(px - 3, py - 3, px, py)
      ctx.quadraticCurveTo(px + 3, py + 3, px + 6, py)
    }
  ctx.strokeStyle = t.wave
  ctx.lineWidth = 1.2
  ctx.stroke()

  const fams = w.fams.filter((f) => f.x + f.R > x0 && f.x - f.R < x1 && f.y + f.R > y0 && f.y - f.R < y1)
  const isles: Isl[] = []
  for (const f of fams) for (const m of f.members) if (m.x + m.r * 2 > x0 && m.x - m.r * 2 < x1 && m.y + m.r * 2 > y0 && m.y - m.r * 2 < y1) isles.push(m)

  // far out, an island is a dot
  ctx.fillStyle = t.lands[0]!
  for (const m of isles) {
    const r = m.r * k
    if (r < 1.6) ctx.fillRect(sx(m.x) - 1, sy(m.y) - 1, 2, 2)
  }
  const shown = isles.filter((m) => m.r * k >= 1.6)

  // a view's isles stand on one shelf: pale water joining them, deep water between views
  base()
  ctx.fillStyle = t.contour
  ctx.strokeStyle = t.contour
  ctx.lineCap = 'round'
  for (const f of fams) {
    if (f.members.length < 2 || f.R * k < 6) continue
    for (const m of f.members) {
      if (m === f.root) continue
      const p = m.parent && m.parent.fam === f ? m.parent : f.root
      ctx.lineWidth = Math.min(m.r, p.r) * k * 2.6
      ctx.beginPath()
      ctx.moveTo(sx(p.x), sy(p.y))
      ctx.lineTo(sx(m.x), sy(m.y))
      ctx.stroke()
    }
    for (const m of f.members) blob(m.shape, sx(m.x), sy(m.y), m.r * k * 2.3)
    base()
  }
  ctx.lineCap = 'butt'
  for (const m of shown) if (m.r * k >= 3) blob(m.shape, sx(m.x), sy(m.y), m.r * k * 1.9)

  // the data underneath
  ctx.fillStyle = t.bank
  for (const f of fams) for (const s of f.shoals) if (Math.max(s.rx, s.ry) * k >= 3) blob(s.shape, sx(s.x), sy(s.y), s.rx * k, s.ry * k)

  ctx.fillStyle = t.shallow
  for (const m of shown) blob(m.shape, sx(m.x), sy(m.y), m.r * k * 1.4)

  // routes from each isle to its remixes
  base()
  ctx.lineWidth = 1.6
  ctx.setLineDash([5, 4])
  for (const m of shown) {
    if (!m.parent) continue
    const p = m.parent
    const ax = sx(p.x)
    const ay = sy(p.y)
    const bx = sx(m.x)
    const by = sy(m.y)
    const d = Math.hypot(bx - ax, by - ay)
    if (d < 6) continue
    const ux = (bx - ax) / d
    const uy = (by - ay) / d
    const bend = (((m.seed >>> 3) % 2) * 2 - 1) * d * 0.12
    ctx.strokeStyle = ROUTE[m.relation ?? ''] ?? t.muted
    ctx.beginPath()
    ctx.moveTo(ax + ux * p.r * k * 1.1, ay + uy * p.r * k * 1.1)
    ctx.quadraticCurveTo((ax + bx) / 2 - uy * bend, (ay + by) / 2 + ux * bend, bx - ux * m.r * k * 1.1, by - uy * m.r * k * 1.1)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // kinship: sandbars between families on the same data, a line in the group's colour between isles on the same page
  const onScreen = (a: Isl, b: Isl) => Math.max(a.x, b.x) > x0 && Math.min(a.x, b.x) < x1 && Math.max(a.y, b.y) > y0 && Math.min(a.y, b.y) < y1
  const link = (a: Isl, b: Isl) => {
    const ax = sx(a.x), ay = sy(a.y), bx = sx(b.x), by = sy(b.y), d = Math.hypot(bx - ax, by - ay)
    if (d < 4) return
    const ux = (bx - ax) / d, uy = (by - ay) / d, bend = d * 0.08
    ctx.moveTo(ax + ux * a.r * k * 1.25, ay + uy * a.r * k * 1.25)
    ctx.quadraticCurveTo((ax + bx) / 2 - uy * bend, (ay + by) / 2 + ux * bend, bx - ux * b.r * k * 1.25, by - uy * b.r * k * 1.25)
  }
  // same data: a soft sandbar under the water, wide and faint so it blends into the sea
  const bar = (strong: boolean) => {
    const wide = Math.max(5, Math.min(22, 9 * Math.sqrt(k)))
    ctx.lineCap = 'round'
    ctx.strokeStyle = t.sand
    for (const [width, alpha] of strong ? [[wide * 1.5, 0.35], [wide, 0.55], [wide * 0.35, 0.9]] : [[wide * 1.5, 0.16], [wide, 0.24], [wide * 0.4, 0.38]]) {
      ctx.globalAlpha = alpha
      ctx.lineWidth = width
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.lineCap = 'butt'
  }
  if (layers.data && w.dataLinks.length) {
    ctx.beginPath()
    for (const [a, b] of w.dataLinks) if (onScreen(a, b)) link(a, b)
    bar(false)
  }

  ctx.fillStyle = t.sand
  for (const m of shown) blob(m.shape, sx(m.x), sy(m.y), m.r * k * 1.1)
  for (const m of shown) {
    ctx.fillStyle = t.lands[m.tint]!
    blob(m.shape, sx(m.x), sy(m.y), m.r * k)
  }
  ctx.fillStyle = t.hill
  for (const m of shown) {
    const r = m.r * k
    if (r < 8) continue
    blob((m.shape + 7) % 32, sx(m.x) + r * 0.12 * ((m.seed % 3) - 1), sy(m.y) - r * 0.1, r * 0.45)
    if (m.stars > 2 && r > 16) blob((m.shape + 13) % 32, sx(m.x) - r * 0.28, sy(m.y) + r * 0.2, r * 0.22)
  }

  // what the pointer is on: everything else washes out; its kin come back, joined to it
  base()
  const lit = new Set<Isl>()
  if (hover?.isle) {
    const m = hover.isle
    const { view, data } = kin(w, m)
    lit.add(m)
    for (const o of view) lit.add(o)
    for (const o of data) lit.add(o)
    ctx.globalAlpha = 0.55
    ctx.fillStyle = t.deep
    ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = 1
    for (const o of lit) {
      if (o.r * k < 1.6) continue
      ctx.fillStyle = t.sand
      blob(o.shape, sx(o.x), sy(o.y), o.r * k * 1.1)
      ctx.fillStyle = t.lands[o.tint]!
      blob(o.shape, sx(o.x), sy(o.y), o.r * k)
    }
    base()
    if (data.length) {
      ctx.beginPath()
      for (const o of data) link(m, o)
      bar(true)
    }
  }
  if (hover) {
    ctx.strokeStyle = t.accent
    const outline = (shape: number, x: number, y: number, rx: number, ry = rx) => {
      ctx.setTransform(dpr * rx, 0, 0, dpr * ry, dpr * x, dpr * y)
      ctx.lineWidth = 2 / Math.max(rx, ry)
      ctx.stroke(S[shape]!)
    }
    if (hover.isle) {
      const m = hover.isle
      ctx.strokeStyle = t.bankInk
      for (const d of m.data) {
        const s = w.shoalAt[d]
        if (s) outline(s.shape, sx(s.x), sy(s.y), Math.max(s.rx * k, 4), Math.max(s.ry * k, 4))
      }
      ctx.strokeStyle = t.accent
      outline(m.shape, sx(m.x), sy(m.y), Math.max(m.r * k * 1.1, 3))
    } else {
      const s = hover.shoal
      outline(s.shape, sx(s.x), sy(s.y), Math.max(s.rx * k, 4), Math.max(s.ry * k, 4))
      for (const u of s.users) outline(u.shape, sx(u.x), sy(u.y), Math.max(u.r * k * 1.1, 3))
    }
    base()
  }

  // labels, most-starred first, never on top of each other
  const taken: [number, number, number, number][] = []
  const free = (a: number, b: number, c: number, d: number) => {
    for (const [p, q, r, s] of taken) if (a < r && c > p && b < s && d > q) return false
    taken.push([a, b, c, d])
    return true
  }
  const cands = shown
    .filter((m) => m.r * k >= (m.kids.length ? 6 : 9))
    .sort((a, b) => b.stars - a.stars || b.r - a.r)
    .slice(0, 500)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  for (const m of cands) {
    const r = m.r * k
    ctx.font = `600 12px ${t.font}`
    // titles wrap under the island; more lines as you get closer
    const lines = wrapText(ctx, m.title, Math.max(170, Math.min(240, r * 2.6)), r >= 20 ? 3 : 2)
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width))
    const x = sx(m.x)
    const y = sy(m.y) + r * 1.12 + 13
    const sub = r >= 20 ? `${m.by}${m.stars ? `  ★ ${m.stars}` : ''}` : ''
    const subY = y + (lines.length - 1) * 14 + 14
    if (!free(x - tw / 2 - 3, y - 12, x + tw / 2 + 3, (sub ? subY : subY - 14) + 4)) continue
    ctx.globalAlpha = lit.size && !lit.has(m) ? 0.35 : 1
    ctx.strokeStyle = t.deep
    ctx.lineWidth = 3.5
    ctx.fillStyle = t.ink
    lines.forEach((l, i) => {
      ctx.strokeText(l, x, y + i * 14)
      ctx.fillText(l, x, y + i * 14)
    })
    if (sub) {
      ctx.font = `500 11px ${t.font}`
      ctx.strokeText(sub, x, subY)
      ctx.fillStyle = t.muted
      ctx.fillText(sub, x, subY)
    }
  }
  ctx.globalAlpha = 1
  // each view's group is named over its shelf, the way a chart names an island group
  ctx.font = `italic 600 12px ${t.font}`
  for (const f of fams) {
    if (f.members.length < 2) continue
    const top = f.members.reduce((a, m) => (m.y - m.r < a.y - a.r ? m : a), f.members[0]!)
    const cx = f.members.reduce((t2, m) => t2 + m.x, 0) / f.members.length
    const x = sx(cx)
    const y = sy(top.y) - top.r * k * 2.3 - 8
    if (f.R * k < 40 || y < 14 || y > H || x < -100 || x > W + 100) continue
    const label = trim(f.name.toUpperCase(), 40)
    const spaced = label.split('').join('\u2009')
    const tw = ctx.measureText(spaced).width
    if (!free(x - tw / 2, y - 12, x + tw / 2, y + 4)) continue
    ctx.globalAlpha = lit.size && !f.members.some((m2) => lit.has(m2)) ? 0.35 : 1
    ctx.fillStyle = t.bankInk
    ctx.fillText(spaced, x, y)
    ctx.globalAlpha = 1
  }
  // close in, the sandbanks are named, the way a chart names its waters
  ctx.font = `italic 500 11px ${t.font}`
  for (const f of fams)
    for (const s of f.shoals) {
      if (!s.name || s.rx * k < 70) continue
      const x = sx(s.x)
      const y = sy(s.y) + s.ry * k * 0.82
      const label = trim(s.name, 32)
      const tw = ctx.measureText(label).width
      if (!free(x - tw / 2, y - 10, x + tw / 2, y + 3)) continue
      ctx.fillStyle = t.bankInk
      ctx.fillText(label, x, y)
    }
}

// ---- the page ----

export function Archipelago() {
  const demo = Number(new URLSearchParams(location.search).get('demo')) || 0
  const chart = useAsync(() => (demo ? Promise.resolve(demoChart(Math.min(demo, 20000))) : api.chart()), [demo])
  const world = useMemo(() => (chart.data ? buildWorld(chart.data) : null), [chart.data])
  if (chart.error) return <div className="wrap" style={{ paddingTop: 30 }}><ErrorBox error={chart.error} /></div>
  return <div className="sea">{world ? <Sea world={world} /> : <div className="sea-loading muted">Charting the sea…</div>}</div>
}

const K_MAX = 8

function Sea({ world }: { world: World }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef<View>({ x: 0, y: 0, k: 1 })
  const size = useRef({ w: 0, h: 0, dpr: 1 })
  const theme = useRef<Theme | null>(null)
  const hoverRef = useRef<Target | null>(null)
  const [hover, setHoverState] = useState<Target | null>(null)
  const [pinned, setPinned] = useState(false)
  const [layers, setLayers] = useState<Layers>({ views: true, data: true })
  const layersRef = useRef(layers)
  layersRef.current = layers
  const [, setTick] = useState(0)
  const frame = useRef(0)
  const flight = useRef(0)
  const kMin = useRef(0.05)

  const draw = useCallback(() => {
    frame.current = 0
    const c = canvas.current
    if (!c || !theme.current || !size.current.w) return
    render(c.getContext('2d')!, world, view.current, size.current, theme.current, hoverRef.current, layersRef.current)
    if (hoverRef.current) setTick((n) => n + 1)
  }, [world])
  const redraw = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw)
  }, [draw])
  useEffect(() => redraw(), [layers, redraw])
  const setHover = useCallback(
    (t: Target | null) => {
      const same = t?.isle ? t.isle === hoverRef.current?.isle : t?.shoal ? t.shoal === hoverRef.current?.shoal : !hoverRef.current
      if (same) return
      hoverRef.current = t
      setHoverState(t)
      redraw()
    },
    [redraw],
  )

  // keep the address in sync with where you are, so a view can be shared or reloaded
  const saveTimer = useRef(0)
  const saveView = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const v = view.current
      history.replaceState(history.state, '', `${location.pathname}${location.search}#${Math.round(v.x)},${Math.round(v.y)},${+v.k.toFixed(3)}`)
    }, 300)
  }, [])

  const fit = useCallback(
    (animate: boolean) => {
      const { w, h } = size.current
      const b = world.bounds
      const k = Math.min(K_MAX / 4, Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0)) * 0.92)
      kMin.current = Math.min(k * 0.6, 0.5)
      flyTo({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, k }, animate)
    },
    [world], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const flyTo = useCallback(
    (to: View, animate = true) => {
      cancelAnimationFrame(flight.current)
      const from = { ...view.current }
      if (!animate) {
        view.current = to
        redraw()
        saveView()
        return
      }
      const t0 = performance.now()
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / 520)
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
        view.current = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e) }
        draw()
        if (p < 1) flight.current = requestAnimationFrame(step)
        else saveView()
      }
      flight.current = requestAnimationFrame(step)
    },
    [draw, redraw, saveView],
  )

  const zoomAt = useCallback(
    (px: number, py: number, factor: number) => {
      cancelAnimationFrame(flight.current)
      const v = view.current
      const { w, h } = size.current
      const k = Math.max(kMin.current, Math.min(K_MAX, v.k * factor))
      const wx = v.x + (px - w / 2) / v.k
      const wy = v.y + (py - h / 2) / v.k
      view.current = { x: wx - (px - w / 2) / k, y: wy - (py - h / 2) / k, k }
      redraw()
      saveView()
    },
    [redraw, saveView],
  )

  // size, theme and first view
  useEffect(() => {
    const el = wrap.current!
    const c = canvas.current!
    theme.current = readTheme(el)
    let first = true
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      size.current = { w: r.width, h: r.height, dpr }
      c.width = Math.round(r.width * dpr)
      c.height = Math.round(r.height * dpr)
      if (first && r.width > 0) {
        first = false
        const m = /^#(-?[\d.]+),(-?[\d.]+),([\d.]+)$/.exec(location.hash)
        const focus = new URLSearchParams(location.search).get('isle')
        const target = focus ? world.byId.get(focus) : undefined
        fit(false)
        if (target) flyTo({ x: target.x, y: target.y, k: Math.min(K_MAX, 70 / target.r) }, true)
        else if (m) flyTo({ x: +m[1]!, y: +m[2]!, k: Math.max(kMin.current, Math.min(K_MAX, +m[3]!)) }, false)
      }
      draw()
    })
    ro.observe(el)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => {
      theme.current = readTheme(el)
      redraw()
    }
    mq.addEventListener('change', onScheme)
    return () => {
      ro.disconnect()
      mq.removeEventListener('change', onScheme)
      cancelAnimationFrame(frame.current)
      cancelAnimationFrame(flight.current)
    }
  }, [world, draw, redraw, fit, flyTo])

  const hit = useCallback(
    (px: number, py: number): Target | null => {
      const v = view.current
      const { w, h } = size.current
      const x = v.x + (px - w / 2) / v.k
      const y = v.y + (py - h / 2) / v.k
      let best: Isl | null = null
      let bestD = Infinity
      const cx = Math.floor(x / CELL)
      const cy = Math.floor(y / CELL)
      for (let i = cx - 1; i <= cx + 1; i++)
        for (let j = cy - 1; j <= cy + 1; j++)
          for (const m of world.grid.get(`${i},${j}`) ?? []) {
            const d = Math.hypot(m.x - x, m.y - y)
            const reach = Math.max(m.r * 1.15, 7 / v.k)
            if (d < reach && d / reach < bestD) {
              best = m
              bestD = d / reach
            }
          }
      if (best) return { isle: best }
      for (const s of world.shoals) {
        // a bank wider than the screen is just the water you're in; its name is written on it instead
        const big = Math.max(s.rx, s.ry) * v.k
        if (big < 10 || big > Math.min(w, h) * 0.45) continue
        if (((s.x - x) / s.rx) ** 2 + ((s.y - y) / s.ry) ** 2 < 0.8) return { shoal: s }
      }
      return null
    },
    [world],
  )

  // pointers: drag to pan, pinch to zoom, click to open, tap once to look and again to open
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ moved: number; startDist: number; startK: number; downAt: { x: number; y: number } } | null>(null)
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const open = useCallback((t: Target) => {
    if (t.isle) navigate(`/i/${t.isle.id}`)
    else if (t.shoal.id) navigate(`/d/${t.shoal.id}`)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    canvas.current!.setPointerCapture(e.pointerId)
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    cancelAnimationFrame(flight.current)
    const pts = [...pointers.current.values()]
    gesture.current = {
      moved: 0,
      startDist: pts.length === 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0,
      startK: view.current.k,
      downAt: p,
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e)
    const prev = pointers.current.get(e.pointerId)
    if (!prev) {
      if (e.pointerType === 'mouse' && !pinned) setHover(hit(p.x, p.y))
      return
    }
    pointers.current.set(e.pointerId, p)
    const g = gesture.current!
    const pts = [...pointers.current.values()]
    if (pts.length === 2 && g.startDist) {
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)
      const mx = (pts[0]!.x + pts[1]!.x) / 2
      const my = (pts[0]!.y + pts[1]!.y) / 2
      zoomAt(mx, my, (g.startK * (d / g.startDist)) / view.current.k)
      g.moved += 10
      return
    }
    const dx = p.x - prev.x
    const dy = p.y - prev.y
    g.moved += Math.abs(dx) + Math.abs(dy)
    if (g.moved > 4) {
      if (hoverRef.current && !pinned) setHover(null)
      view.current = { ...view.current, x: view.current.x - dx / view.current.k, y: view.current.y - dy / view.current.k }
      redraw()
      saveView()
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current
    pointers.current.delete(e.pointerId)
    if (pointers.current.size) return
    gesture.current = null
    if (!g || g.moved > 4) return
    const p = local(e)
    const t = hit(p.x, p.y)
    if (e.pointerType === 'mouse') {
      if (t) open(t)
      else if (pinned) {
        setPinned(false)
        setHover(null)
      }
      return
    }
    // touch: the first tap shows what it is, a second tap on it opens it
    const cur = hoverRef.current
    if (t && pinned && ((t.isle && t.isle === cur?.isle) || (t.shoal && t.shoal === cur?.shoal))) return open(t)
    setHover(t)
    setPinned(!!t)
  }

  useEffect(() => {
    const c = canvas.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = local(e)
      // a pinch (or ctrl+wheel) zooms; a mouse wheel zooms; a trackpad's two-finger scroll pans
      const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY))
      if (e.ctrlKey || mouseWheel) {
        const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
        zoomAt(p.x, p.y, Math.exp(-d * (e.ctrlKey ? 0.012 : 0.0025)))
      } else {
        cancelAnimationFrame(flight.current)
        const v = view.current
        view.current = { ...v, x: v.x + e.deltaX / v.k, y: v.y + e.deltaY / v.k }
        redraw()
        saveView()
      }
      if (!pinned) setHover(hit(p.x, p.y))
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
  }, [zoomAt, redraw, saveView, hit, setHover, pinned])

  const zoomBy = (f: number) => {
    const v = view.current
    flyTo({ ...v, k: Math.max(kMin.current, Math.min(K_MAX, v.k * f)) })
  }
  const onKey = (e: React.KeyboardEvent) => {
    const v = view.current
    const pan = 120 / v.k
    if (e.key === '+' || e.key === '=') zoomBy(1.6)
    else if (e.key === '-') zoomBy(1 / 1.6)
    else if (e.key === '0') fit(true)
    else if (e.key === 'ArrowLeft') flyTo({ ...v, x: v.x - pan })
    else if (e.key === 'ArrowRight') flyTo({ ...v, x: v.x + pan })
    else if (e.key === 'ArrowUp') flyTo({ ...v, y: v.y - pan })
    else if (e.key === 'ArrowDown') flyTo({ ...v, y: v.y + pan })
    else return
    e.preventDefault()
  }

  const goTo = (m: Isl) => {
    flyTo({ x: m.x, y: m.y, k: Math.max(view.current.k, Math.min(K_MAX, 70 / m.r)) })
    hoverRef.current = { isle: m }
    setHoverState({ isle: m })
    setPinned(true)
  }

  const families = world.fams.length
  return (
    <div className="sea-map" ref={wrap}>
      <canvas
        ref={canvas}
        tabIndex={0}
        aria-label={`A chart of ${world.isles.length} isles. Drag to move, scroll or pinch to zoom, click an island to open it.`}
        style={{ cursor: hover?.isle || hover?.shoal?.id ? 'pointer' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && !pinned && !pointers.current.size && setHover(null)}
        onDoubleClick={(e) => {
          const p = local(e)
          const v = view.current
          const { w, h } = size.current
          flyTo({ x: v.x + (p.x - w / 2) / v.k, y: v.y + (p.y - h / 2) / v.k, k: Math.min(K_MAX, v.k * 2) })
        }}
        onKeyDown={onKey}
      />
      <div className="sea-title card">
        <h1>The archipelago</h1>
        <p className="small muted">
          {world.isles.length.toLocaleString()} isle{world.isles.length === 1 ? '' : 's'} on {families.toLocaleString()} view{families === 1 ? '' : 's'}. Isles that share a view stand together on one shelf; routes lead to remixes; sandbanks are the data they show. Hover an isle to see its kin.
        </p>
        <div className="kin-keys">
          <span className="kin-key static" title="Isles that run the same page, whatever data they show, stand together on one shelf">
            <b className="shelf-key" /><span>Same view<small>{world.views.length ? ` · ${world.views.length} shared` : ' · none shared yet'}</small></span>
          </span>
          <button className="kin-key" aria-pressed={layers.data} onClick={() => setLayers((l) => ({ ...l, data: !l.data }))} title="Isles whose data comes from the same original source are joined by a dotted sandbar">
            <b className="bar-key" /><span>Same data<small>{` · ${[...world.bySource.values()].filter((u) => u.length > 1).length || 'none yet'}`}{[...world.bySource.values()].some((u) => u.length > 1) ? ' shared' : ''}</small></span>
          </button>
        </div>
        <div className="legend">
          <span><i style={{ background: ROUTE.rebind }} />new data</span>
          <span><i style={{ background: ROUTE.restyle }} />new look</span>
          <span><i style={{ background: ROUTE.remix }} />remixed</span>
          <span><b className="bank-key" />data</span>
        </div>
      </div>
      <SeaSearch world={world} onPick={goTo} />
      <div className="sea-zoom card">
        <button title="Zoom in (+)" onClick={() => zoomBy(1.6)}>+</button>
        <button title="Zoom out (−)" onClick={() => zoomBy(1 / 1.6)}>−</button>
        <button title="See everything (0)" onClick={() => fit(true)}><Icon name="fit" /></button>
      </div>
      {hover && <HoverCard target={hover} world={world} view={view.current} size={size.current} pinned={pinned} onOpen={() => open(hover)} />}
    </div>
  )
}

function SeaSearch({ world, onPick }: { world: World; onPick: (m: Isl) => void }) {
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const found = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return world.isles.filter((m) => m.title.toLowerCase().includes(s) || m.by.toLowerCase().includes(s)).sort((a, b) => b.stars - a.stars).slice(0, 8)
  }, [q, world])
  const pick = (m: Isl) => {
    onPick(m)
    setQ('')
  }
  return (
    <div className="sea-search">
      <input
        className="field"
        placeholder="Find an isle or a person…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setAt(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setAt((a) => Math.min(found.length - 1, a + 1))
          else if (e.key === 'ArrowUp') setAt((a) => Math.max(0, a - 1))
          else if (e.key === 'Enter' && found[at]) pick(found[at]!)
          else if (e.key === 'Escape') setQ('')
          else return
          e.preventDefault()
        }}
      />
      {q.trim() && (
        <div className="sea-results card">
          {found.length ? (
            found.map((m, i) => (
              <button key={m.id} className={i === at ? 'on' : ''} onMouseEnter={() => setAt(i)} onClick={() => pick(m)}>
                <span className="ellipsis grow">{m.title}</span>
                <span className="tiny muted">{m.by}</span>
              </button>
            ))
          ) : (
            <div className="small muted" style={{ padding: '8px 10px' }}>No isle by that name.</div>
          )}
        </div>
      )}
    </div>
  )
}

function HoverCard({ target, world, view, size, pinned, onOpen }: { target: Target; world: World; view: View; size: { w: number; h: number }; pinned: boolean; onOpen: () => void }) {
  const x = target.isle ? target.isle.x : target.shoal.x
  const y = target.isle ? target.isle.y : target.shoal.y
  const r = target.isle ? target.isle.r * 1.2 : target.shoal.rx * 0.6
  const px = (x - view.x) * view.k + size.w / 2
  const py = (y - view.y) * view.k + size.h / 2
  const W = 260
  const right = px + r * view.k + 14 + W < size.w - 8
  const left = right ? px + r * view.k + 14 : Math.max(8, px - r * view.k - 14 - W)
  const top = Math.max(8, Math.min(size.h - 300, py - 60))
  const style: React.CSSProperties = { left, top, width: W, pointerEvents: pinned ? 'auto' : 'none' }

  if (target.shoal) {
    const s = target.shoal
    return (
      <div className="sea-card card" style={{ ...style, padding: '10px 12px' }}>
        <div className="row"><span className="kind">{s.kind}</span><b className="ellipsis grow">{s.name ?? 'Private data'}</b></div>
        <p className="small muted" style={{ margin: '6px 0 0' }}>Shown by {s.users.length} isle{s.users.length === 1 ? '' : 's'}{s.users.length > 1 ? ` on ${new Set(s.users.map((u) => u.fam)).size} view${new Set(s.users.map((u) => u.fam)).size === 1 ? '' : 's'}` : ''}.</p>
        {pinned && s.id && <button className="btn sm primary" style={{ marginTop: 8 }} onClick={onOpen}>Open data</button>}
      </div>
    )
  }
  const m = target.isle
  const data = m.data.map((d) => world.shoalAt[d]).filter((s): s is Shoal => !!s)
  return (
    <div className="sea-card card" style={style}>
      <div className="sea-thumb"><Thumb src={m.shotUrl} title={m.title} /></div>
      <div style={{ padding: '8px 10px 10px' }}>
        <b className="ellipsis" style={{ display: 'block' }}>{m.title}</b>
        <div className="row small muted" style={{ gap: 6, marginTop: 2 }}>
          <span className="ellipsis">{m.by}</span>
          <RelationChip relation={m.relation} />
          <span className="grow" />
          {m.stars > 0 && <span className="stars"><Icon name="star" filled /> {m.stars}</span>}
        </div>
        {(m.descendants > 0 || data.length > 0) && (
          <div className="tiny muted" style={{ marginTop: 4 }}>
            {m.descendants > 0 && <>{m.descendants} remix{m.descendants === 1 ? '' : 'es'} grew from it</>}
            {m.descendants > 0 && data.length > 0 && ' · '}
            {data.length > 0 && <>on {data.map((s) => s.name ?? 'private data').join(', ')}</>}
          </div>
        )}
        <Kin world={world} m={m} />
        {pinned && <button className="btn sm primary" style={{ marginTop: 8 }} onClick={onOpen}>Open isle</button>}
      </div>
    </div>
  )
}

function Kin({ world, m }: { world: World; m: Isl }) {
  const { view, data } = kin(world, m)
  if (!view.length && !data.length) return null
  const names = (l: Isl[]) => l.slice(0, 3).map((o) => o.title).join(' · ') + (l.length > 3 ? ` · and ${l.length - 3} more` : '')
  return (
    <div className="kin tiny">
      {view.length > 0 && <div><b className="shelf-key" /><span><b>Same view as {view.length}:</b> {names(view)}</span></div>}
      {data.length > 0 && <div><b className="bar-key" /><span><b>Same data as {data.length}:</b> {names(data)}</span></div>}
    </div>
  )
}

