/**
 * How an isle relates to the one it came from. Three kinds of remix:
 *   rebind   same page, different data    ("run my data through your chart")
 *   restyle  same data, different page    ("tweak the visuals")
 *   remix    both changed
 * A child identical to its parent in both is still a remix (a fork with a new title).
 */
export type Relation = 'remix' | 'rebind' | 'restyle'

export function sameBindings(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k])
}

/**
 * What an isle's slots or bindings become after a publish. With none given, the basis's (the isle's own on
 * an update, else its parent's or the page's isle's). On an update, the given ones are merged into the
 * isle's: the isle's keep their order, a key given as null goes, new keys come last. A new isle (a remix or
 * rebind) that gives some gets those only.
 */
export function mergeOnUpdate<T>(basis: Record<string, T>, given: Record<string, T | null> | undefined, update: boolean): Record<string, T> {
  if (!given) return basis
  const out: Record<string, T> = {}
  // the isle's own keys first, in their order, so an update that changes nothing stores the same JSON
  if (update) for (const [k, v] of Object.entries(basis)) if (!(k in given)) out[k] = v
    else if (given[k] != null) out[k] = given[k]!
  for (const [k, v] of Object.entries(given)) if (v != null && !(k in out)) out[k] = v
  return out
}

/**
 * The bindings a publish ends with: merged like mergeOnUpdate, and a slot removed from the slots (given as
 * null there) loses its data too.
 */
export function resolveBindings(
  basis: Record<string, string>,
  given: Record<string, string | null> | undefined,
  opts: { update: boolean; slots?: Record<string, unknown> | null },
): Record<string, string> {
  const out = mergeOnUpdate(basis, given, opts.update)
  const gone = Object.entries(opts.slots ?? {}).filter(([, v]) => v === null).map(([k]) => k)
  return gone.some((k) => k in out) ? Object.fromEntries(Object.entries(out).filter(([k]) => !gone.includes(k))) : out
}

/**
 * How alike two pages are, 0 to 1: the share of their lines (and CSS rules and tags, so minified pages
 * count too) they have in common. A page adapted to new data (a few names and labels swapped) scores
 * about .95; two different visualizations score under .2.
 */
export function pageSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const bag = (s: string) => {
    const m = new Map<string, number>()
    for (const t of s.split(/\n|(?<=>)|(?<=;)|(?<=\})/)) { const k = t.trim(); if (k) m.set(k, (m.get(k) ?? 0) + 1) }
    return m
  }
  const A = bag(a), B = bag(b)
  let common = 0, na = 0, nb = 0
  for (const [k, n] of A) { na += n; common += Math.min(n, B.get(k) ?? 0) }
  for (const n of B.values()) nb += n
  return na + nb ? (2 * common) / (na + nb) : 1
}

/** How much one page differs from another: its similarity, and roughly how many lines came and went. */
export function pageChanges(a: string, b: string): { similarity: number; added: number; removed: number } {
  if (a === b) return { similarity: 1, added: 0, removed: 0 }
  const bag = (s: string) => {
    const m = new Map<string, number>()
    for (const t of s.split(/\n|(?<=>)|(?<=;)|(?<=\})/)) { const k = t.trim(); if (k) m.set(k, (m.get(k) ?? 0) + 1) }
    return m
  }
  const A = bag(a), B = bag(b)
  let added = 0, removed = 0
  for (const [k, n] of B) added += Math.max(0, n - (A.get(k) ?? 0))
  for (const [k, n] of A) removed += Math.max(0, n - (B.get(k) ?? 0))
  return { similarity: pageSimilarity(a, b), added, removed }
}

/** Pages at least this alike count as the same view when the publisher doesn't say. */
export const SAME_VIEW = 0.95

/**
 * view: what the publisher says, which wins: 'same' when they only adapted the page to their data or fixed
 * something small, 'new' when they changed how it looks or works. Without it, a near-identical page
 * (similarity >= SAME_VIEW) counts as the same view.
 */
export function classifyRelation(
  parent: { source: string; bindings: Record<string, string> },
  child: { source: string; bindings: Record<string, string> },
  opts: { view?: 'same' | 'new'; similarity?: number } = {},
): Relation {
  const sameView = opts.view ? opts.view === 'same' : parent.source === child.source || (opts.similarity ?? 0) >= SAME_VIEW
  const sameData = sameBindings(parent.bindings, child.bindings)
  if (sameView && !sameData) return 'rebind'
  if (!sameView && sameData) return 'restyle'
  return 'remix'
}

export const RELATION_LABEL: Record<Relation, string> = {
  remix: 'remixed',
  rebind: 'new data',
  restyle: 'new look',
}
