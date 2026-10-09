import { EditError, parsePath, type JsonPath } from './edits'

/**
 * Working on JSON data where it lives, so an agent can read a slice of a megabyte export, add rows or
 * fields to a dataset, or make a slim copy of one, without the whole thing passing through its output.
 * Everything here is declarative (a Worker can't run an agent's code): paths, field lists and simple filters.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The value at a path ("messages", "a.b[0].c"); no path is the whole value. */
export function getAt(value: unknown, path?: JsonPath | null): unknown {
  if (path === undefined || path === null || path === '') return value
  let cur: any = value
  const keys = parsePath(path)
  for (const [i, k] of keys.entries()) {
    if (cur === null || typeof cur !== 'object' || !(k in cur)) throw new EditError(`Nothing at ${keys.slice(0, i + 1).join('.')}${i ? '' : ' (top-level keys: ' + topKeys(value) + ')'}`)
    cur = cur[k]
  }
  return cur
}

const topKeys = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).slice(0, 30).join(', ') || 'none' : Array.isArray(v) ? 'it is an array' : 'it is not an object')

/** A field list: ["id", "author.name"] keeps those (nested ones keep their nesting); {who: "author.name"} renames. */
export type Fields = string[] | Record<string, string>

function dig(row: any, path: string): unknown {
  let cur = row
  for (const k of parsePath(path)) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = cur[k]
  }
  return cur
}

function pickOne(row: unknown, fields: Fields): unknown {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return row
  const out: any = {}
  if (Array.isArray(fields)) {
    for (const f of fields) {
      const v = dig(row, f)
      if (v === undefined) continue
      // "author.name" stays nested: { author: { name } }
      const keys = parsePath(f)
      let cur = out
      for (const k of keys.slice(0, -1)) cur = cur[k] ??= typeof k === 'number' ? [] : {}
      cur[keys[keys.length - 1]!] = v
    }
  } else for (const [to, from] of Object.entries(fields)) { const v = dig(row, from); if (v !== undefined) out[to] = v }
  return out
}

/** Keep only some fields: of each row when it's an array, of the object itself otherwise. */
export function pick(value: unknown, fields: Fields | undefined | null): unknown {
  if (!fields || (Array.isArray(fields) ? !fields.length : !Object.keys(fields).length)) return value
  return Array.isArray(value) ? value.map((r) => pickOne(r, fields)) : pickOne(value, fields)
}

/** A simple row filter: { field, op, value }. */
export interface Where {
  field: string
  op?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'exists' | 'missing' | 'in'
  value?: unknown
}

export function matches(row: unknown, w: Where): boolean {
  const v = dig(row, w.field)
  const op = w.op ?? 'eq'
  switch (op) {
    case 'eq': return v === w.value || (v != null && w.value != null && String(v) === String(w.value))
    case 'ne': return !(v === w.value || (v != null && w.value != null && String(v) === String(w.value)))
    case 'gt': return v != null && (v as any) > (w.value as any)
    case 'gte': return v != null && (v as any) >= (w.value as any)
    case 'lt': return v != null && (v as any) < (w.value as any)
    case 'lte': return v != null && (v as any) <= (w.value as any)
    case 'contains': return Array.isArray(v) ? v.some((x) => String(x) === String(w.value)) : typeof v === 'string' && v.toLowerCase().includes(String(w.value).toLowerCase())
    case 'exists': return v !== undefined && v !== null
    case 'missing': return v === undefined || v === null
    case 'in': return Array.isArray(w.value) && w.value.some((x) => x === v || String(x) === String(v))
    default: throw new EditError(`Unknown op "${op}" (eq, ne, gt, gte, lt, lte, contains, exists, missing, in)`)
  }
}

/** A slim or filtered copy: the array (or object) at path, rows kept by every where, fields picked. */
export function derive(value: unknown, opts: { path?: string | null; fields?: Fields | null; where?: Where[] | null; limit?: number | null }): unknown {
  let out = getAt(value, opts.path)
  if (opts.where?.length) {
    if (!Array.isArray(out)) throw new EditError('where filters rows, so the path must lead to an array')
    out = out.filter((r) => opts.where!.every((w) => matches(r, w)))
  }
  if (opts.limit && Array.isArray(out)) out = out.slice(0, Math.max(0, opts.limit))
  return pick(out, opts.fields)
}

/** Add rows to the end of the array at path (created when missing). */
export function appendAt(value: unknown, path: string | null | undefined, rows: unknown[]): { value: unknown; length: number } {
  if (!Array.isArray(rows) || !rows.length) throw new EditError('append needs rows: a non-empty array')
  if (!path) {
    if (!Array.isArray(value)) throw new EditError(`The data isn't an array at the top (keys: ${topKeys(value)}); give the path of the array to append to`)
    value.push(...rows)
    return { value, length: value.length }
  }
  const keys = parsePath(path)
  let cur: any = value
  for (const k of keys.slice(0, -1)) {
    if (cur === null || typeof cur !== 'object') throw new EditError(`Can't reach ${path}`)
    cur = cur[k] ??= typeof k === 'number' ? [] : {}
  }
  const last = keys[keys.length - 1]!
  if (cur === null || typeof cur !== 'object') throw new EditError(`Can't reach ${path}`)
  cur[last] ??= []
  if (!Array.isArray(cur[last])) throw new EditError(`${path} isn't an array`)
  cur[last].push(...rows)
  return { value, length: cur[last].length }
}

/**
 * Join patches onto the rows of the array at path by a key field: { i: 12, score: 3 } sets score on the row
 * whose i is 12. Unmatched patches are appended when upsert, else reported.
 */
export function mergeAt(value: unknown, path: string | null | undefined, key: string, patches: unknown[], upsert = false): { value: unknown; merged: number; added: number; unmatched: unknown[] } {
  if (!key) throw new EditError('merge needs key: the field that identifies a row, e.g. "id"')
  if (!Array.isArray(patches) || !patches.length) throw new EditError('merge needs rows: a non-empty array of objects, each with the key field')
  const rows = getAt(value, path)
  if (!Array.isArray(rows)) throw new EditError(`${path || 'The data'} isn't an array`)
  const index = new Map<string, any>()
  for (const r of rows) { const k = dig(r, key); if (k !== undefined && k !== null && !index.has(String(k))) index.set(String(k), r) }
  let merged = 0, added = 0
  const unmatched: unknown[] = []
  for (const [i, p] of patches.entries()) {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) throw new EditError(`merge row ${i + 1} isn't an object`)
    const k = dig(p, key)
    if (k === undefined || k === null) throw new EditError(`merge row ${i + 1} has no ${key}`)
    const target = index.get(String(k))
    if (target && typeof target === 'object') { Object.assign(target, p); merged++ }
    else if (upsert) { rows.push(p); index.set(String(k), p); added++ }
    else unmatched.push(k)
  }
  return { value, merged, added, unmatched }
}

/** Long strings cut down, for samples. */
function clip(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > 160 ? v.slice(0, 160) + '…' : v
  if (Array.isArray(v)) return depth > 2 ? `[${v.length} items]` : v.slice(0, 3).map((x) => clip(x, depth + 1)).concat(v.length > 3 ? [`… ${v.length - 3} more`] : [])
  if (v && typeof v === 'object') {
    if (depth > 2) return `{${Object.keys(v).length} keys}`
    const e = Object.entries(v)
    const o: any = {}
    for (const [k, x] of e.slice(0, 40)) o[k] = clip(x, depth + 1)
    if (e.length > 40) o['…'] = `${e.length - 40} more keys`
    return o
  }
  return v
}

const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

/**
 * What's in a JSON value without reading it all: keys and their types, arrays' lengths with the fields
 * their rows have and one sample row, a couple of levels down. Objects with many keys (maps by id) show
 * a count and one sample entry.
 */
export function shapeOf(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) {
    const out: any = { array: v.length }
    const rows = v.slice(0, 200).filter((r) => r && typeof r === 'object' && !Array.isArray(r))
    if (rows.length) {
      const fields: Record<string, Set<string>> = {}
      for (const r of rows) for (const [k, x] of Object.entries(r)) (fields[k] ??= new Set()).add(typeOf(x))
      out.fields = Object.fromEntries(Object.entries(fields).slice(0, 60).map(([k, t]) => [k, [...t].join('|')]))
      if (depth < 2) {
        const nested = Object.entries(rows[0]!).filter(([, x]) => x && typeof x === 'object')
        if (nested.length) out.nested = Object.fromEntries(nested.slice(0, 10).map(([k, x]) => [k, shapeOf(x, depth + 1)]))
      }
    } else if (v.length) out.items = [...new Set(v.slice(0, 200).map(typeOf))].join('|')
    if (v.length) out.sample = clip(v[0])
    return out
  }
  if (v && typeof v === 'object') {
    const e = Object.entries(v)
    // a map keyed by ids: count and one entry, not every key
    if (e.length > 40) return { object: e.length, keys_like: e.slice(0, 3).map(([k]) => k), entry: depth < 3 ? shapeOf(e[0]![1], depth + 1) : typeOf(e[0]![1]) }
    if (depth >= 3) return `object(${e.length} keys)`
    return Object.fromEntries(e.map(([k, x]) => [k, x && typeof x === 'object' ? shapeOf(x, depth + 1) : typeof x === 'string' && x.length > 60 ? `string(${x.length})` : typeOf(x)]))
  }
  return typeOf(v)
}

/** Rows of objects as CSV: the given columns first, then any others in first-seen order. */
export function toCsv(rows: unknown[], first: string[] = []): string {
  const cols: string[] = [...first]
  for (const r of rows) if (r && typeof r === 'object') for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k)
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell((r as any)?.[c])).join(','))].join('\n') + '\n'
}
