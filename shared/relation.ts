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

export function classifyRelation(
  parent: { source: string; bindings: Record<string, string> },
  child: { source: string; bindings: Record<string, string> },
): Relation {
  const sameSource = parent.source === child.source
  const sameData = sameBindings(parent.bindings, child.bindings)
  if (sameSource && !sameData) return 'rebind'
  if (!sameSource && sameData) return 'restyle'
  return 'remix'
}

export const RELATION_LABEL: Record<Relation, string> = {
  remix: 'remixed',
  rebind: 'new data',
  restyle: 'new look',
}
