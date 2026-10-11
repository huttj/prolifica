import type { Evolution, EvolutionStep } from './types'

/**
 * Features of a family: the parts its publishes name in `changes` (and take with `draws_from`). Each line of
 * the family carries the ones it has picked up, so any isle can see what its relatives have that it hasn't.
 */

export type StepKey = string
export const keyOf = (isle: string, version: number): StepKey => `${isle}:${version}`

export interface Feature {
  part: string
  what: string
  /** taken from another isle (draws_from) rather than made here */
  from?: { isle: string; title: string; version: number }
  isle: string
  version: number
  at: number
}

export interface Features {
  /** the features a step's line has, once that step is made */
  at: Map<StepKey, Map<string, Feature>>
  /** what each step did to its line's features: new to the line, or changed */
  delta: Map<StepKey, { added: Feature[]; changed: Feature[] }>
  /** every feature anywhere in the family, with each step that touched it, oldest first */
  family: Map<string, Feature[]>
}

/** A part and what it does, before it's pinned to a step. */
export type FeatureText = { part?: string; what: string; from?: Feature['from'] }

/** What a step says it changed, plus the parts it took from other isles. */
export function stepParts(v: EvolutionStep): (FeatureText & { part: string })[] {
  const out: (FeatureText & { part: string })[] = [...(v.changes ?? [])]
  for (const d of v.draws ?? []) for (const p of d.parts) if (!out.some((o) => o.part === p)) out.push({ part: p, what: d.note ?? '', from: { isle: d.isle, title: d.title, version: d.version } })
  return out
}

/** A feature's description as plain text (for prompts). */
export const whatText = (f: FeatureText) => (f.from ? `from "${f.from.title}" v${f.from.version}${f.what ? `: ${f.what}` : ''}` : f.what)

export function featuresOf(evo: Evolution): Features {
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
        const f: Feature = { part: c.part, what: c.what, from: c.from, isle: e.isle.id, version: v.version, at: v.createdAt }
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
export function missingAt(feats: Features, step: StepKey): Feature[] {
  const have = feats.at.get(step) ?? new Map()
  const out: Feature[] = []
  for (const [part, touches] of feats.family) if (!have.has(part)) out.push(touches[touches.length - 1]!)
  return out.sort((a, b) => a.part.localeCompare(b.part))
}

/**
 * What the rest of an isle's family has that its line doesn't: named parts (features) it lacks, and pages
 * it has never run, each with the notes that say what changed. An isle's line is its own versions and each
 * ancestor's up to the version it was made from.
 */
export function familyOffers(evo: Evolution, id: string) {
  const byId = new Map(evo.isles.map((e) => [e.isle.id, e]))
  const me = byId.get(id)
  if (!me) return { features: [], pages: [] }
  const line = new Set(me.versions.map((v) => v.pageKey))
  const above = new Set<string>()
  for (let e = me, i = 0; e.parentId && i < 50; i++) {
    const p = byId.get(e.parentId)
    if (!p) break
    above.add(p.isle.id)
    const upto = e.parentVersion ?? p.versions.at(-1)!.version
    for (const v of p.versions) if (v.version <= upto) line.add(v.pageKey)
    e = p
  }
  // isles come depth-first from the root, so a remix comes after its parent
  const below = new Set<string>()
  for (const e of evo.isles) if (e.parentId && (e.parentId === id || below.has(e.parentId))) below.add(e.isle.id)

  const seen = new Set<string>()
  const pages = evo.isles
    .filter((e) => e.isle.id !== id && !line.has(e.versions.at(-1)!.pageKey))
    .sort((a, b) => b.versions.at(-1)!.createdAt - a.versions.at(-1)!.createdAt)
    .filter((e) => !seen.has(e.versions.at(-1)!.pageKey) && !!seen.add(e.versions.at(-1)!.pageKey))
    .slice(0, 12)
    .map((e) => ({
      id: e.isle.id, title: e.isle.title, by: e.isle.owner.handle,
      where: above.has(e.isle.id) ? 'above' : below.has(e.isle.id) ? 'below' : 'beside',
      relation: e.isle.relation, version: e.isle.version, updated: new Date(e.versions.at(-1)!.createdAt).toISOString(),
      notes: e.versions.filter((v) => v.note && !line.has(v.pageKey)).slice(-6).map((v) => ({ version: v.version, note: v.note!.slice(0, 400) })),
    }))

  const groups = new Map<string, { isle: string; title: string; version: number; features: { part: string; what: string }[] }>()
  for (const f of missingAt(featuresOf(evo), keyOf(id, me.versions.at(-1)!.version))) {
    const g = groups.get(f.isle) ?? groups.set(f.isle, { isle: f.isle, title: byId.get(f.isle)?.isle.title ?? f.isle, version: f.version, features: [] }).get(f.isle)!
    g.version = Math.max(g.version, f.version)
    if (g.features.length < 20) g.features.push({ part: f.part, what: whatText(f).slice(0, 400) })
  }
  return { features: [...groups.values()].slice(0, 12), pages }
}
