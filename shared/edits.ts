/**
 * Small, exact edits to a page or a dataset, so an agent can change a few words without reading and
 * resending the whole thing. Every find must match exactly once (or pass all: true); anything else is
 * refused with a message saying why, so a wrong edit never lands silently.
 */

export interface TextEdit {
  find: string
  replace: string
  /** replace every occurrence instead of requiring exactly one */
  all?: boolean
}

export class EditError extends Error {}

const count = (s: string, sub: string) => {
  let n = 0
  for (let i = s.indexOf(sub); i !== -1; i = s.indexOf(sub, i + sub.length)) n++
  return n
}

export function applyTextEdits(text: string, edits: TextEdit[]): { text: string; replaced: number } {
  if (!Array.isArray(edits) || !edits.length) throw new EditError('Give at least one edit: { find, replace }')
  let out = text
  let replaced = 0
  edits.forEach((e, i) => {
    if (typeof e?.find !== 'string' || typeof e.replace !== 'string' || !e.find) throw new EditError(`Edit ${i + 1}: find (non-empty) and replace must both be strings`)
    const n = count(out, e.find)
    if (!n) throw new EditError(`Edit ${i + 1}: "${e.find.slice(0, 80)}" isn't in the text (edits apply in order, so an earlier edit may have changed it)`)
    if (n > 1 && !e.all) throw new EditError(`Edit ${i + 1}: "${e.find.slice(0, 80)}" appears ${n} times; add surrounding text to make it unique, or pass all: true`)
    out = e.all ? out.split(e.find).join(e.replace) : out.replace(e.find, () => e.replace)
    replaced += e.all ? n : 1
  })
  return { text: out, replaced }
}

/** "city.name", "topics[3].title" or ["topics", 3, "title"] */
export type JsonPath = string | (string | number)[]

export function parsePath(path: JsonPath): (string | number)[] {
  if (Array.isArray(path)) return path
  const out: (string | number)[] = []
  for (const part of String(path).split('.')) {
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part)
    if (!m) throw new EditError(`Can't read the path "${path}"`)
    if (m[1]) out.push(m[1])
    for (const idx of m[2]!.matchAll(/\[(\d+)\]/g)) out.push(Number(idx[1]))
  }
  if (!out.length) throw new EditError('An empty path')
  return out
}

/** Set (or, with remove, delete) values inside parsed JSON. Missing objects on the way are created. */
export function applyJsonSets(value: unknown, sets: { path: JsonPath; value?: unknown; remove?: boolean }[]): unknown {
  if (!Array.isArray(sets) || !sets.length) throw new EditError('Give at least one { path, value }')
  const root = value
  for (const [i, s] of sets.entries()) {
    const keys = parsePath(s.path)
    let cur: any = root // eslint-disable-line @typescript-eslint/no-explicit-any
    for (let k = 0; k < keys.length - 1; k++) {
      const key = keys[k]!
      if (cur === null || typeof cur !== 'object') throw new EditError(`Set ${i + 1}: ${keys.slice(0, k).join('.') || 'the top'} isn't an object or array`)
      if (cur[key] === undefined || cur[key] === null) cur[key] = typeof keys[k + 1] === 'number' ? [] : {}
      cur = cur[key]
    }
    const last = keys[keys.length - 1]!
    if (cur === null || typeof cur !== 'object') throw new EditError(`Set ${i + 1}: can't set ${String(last)} inside a ${cur === null ? 'null' : typeof cur}`)
    if (s.remove) {
      if (Array.isArray(cur) && typeof last === 'number') cur.splice(last, 1)
      else delete cur[last]
    } else {
      if (!('value' in s)) throw new EditError(`Set ${i + 1}: give a value (or remove: true)`)
      cur[last] = s.value
    }
  }
  return root
}

/** Lines of text matching a pattern, with a few around each: what an agent reads instead of the whole file. */
export function grepLines(text: string, pattern: string, context = 2, max = 60): { matches: number; lines: string } {
  let re: RegExp
  try {
    re = new RegExp(pattern, 'i')
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }
  const lines = text.split('\n')
  const keep = new Set<number>()
  let matches = 0
  for (let i = 0; i < lines.length && matches < max; i++)
    if (re.test(lines[i]!)) {
      matches++
      for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep.add(j)
    }
  const out: string[] = []
  let prev = -2
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i !== prev + 1 && out.length) out.push('…')
    const l = lines[i]!
    out.push(`${i + 1}: ${l.length > 400 ? l.slice(0, 400) + '…' : l}`)
    prev = i
  }
  return { matches, lines: out.join('\n') }
}
