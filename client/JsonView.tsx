import { useMemo, useState } from 'react'

/**
 * JSON as a tree you unfold: the top level is open, everything under it starts folded with a peek at
 * what's inside. Big arrays open a hundred items at a time and long strings are cut short, so a
 * many-megabyte file stays quick.
 */

type J = null | boolean | number | string | J[] | { [k: string]: J }

const PAGE = 100
const LONG = 280

function peek(v: J): string {
  if (Array.isArray(v)) return `${v.length.toLocaleString()} item${v.length === 1 ? '' : 's'}`
  if (v && typeof v === 'object') {
    const keys = Object.keys(v)
    const shown = keys.slice(0, 4).join(', ')
    return keys.length > 4 ? `${shown}, … ${keys.length - 4} more` : shown
  }
  return ''
}

function Scalar({ v }: { v: J }) {
  const [all, setAll] = useState(false)
  if (v === null) return <span className="j-null">null</span>
  if (typeof v === 'boolean') return <span className="j-bool">{String(v)}</span>
  if (typeof v === 'number') return <span className="j-num">{v}</span>
  const s = v as string
  if (s.length <= LONG || all) return <span className="j-str">"{s}"</span>
  return (
    <span className="j-str">
      "{s.slice(0, LONG)}
      <button className="j-more" onClick={() => setAll(true)}>… {(s.length - LONG).toLocaleString()} more</button>"
    </span>
  )
}

function Node({ name, v, depth, last }: { name: string | number | null; v: J; depth: number; last: boolean }) {
  const branch = v !== null && typeof v === 'object'
  const [open, setOpen] = useState(depth === 0)
  const [limit, setLimit] = useState(PAGE)
  const label =
    name === null ? null : typeof name === 'number' ? <span className="j-idx">{name}</span> : <span className="j-key">"{name}"</span>
  const comma = last ? '' : ','
  if (!branch)
    return (
      <div className="j-row">
        {label}
        {label && <span className="j-p">: </span>}
        <Scalar v={v} />
        <span className="j-p">{comma}</span>
      </div>
    )
  const arr = Array.isArray(v)
  const entries: [string | number, J][] = arr ? (v as J[]).map((x, i) => [i, x]) : Object.entries(v as Record<string, J>)
  const [o, c] = arr ? ['[', ']'] : ['{', '}']
  if (!entries.length)
    return (
      <div className="j-row">
        {label}
        {label && <span className="j-p">: </span>}
        <span className="j-p">{o + c + comma}</span>
      </div>
    )
  return (
    <div>
      <div className="j-row j-branch" onClick={() => setOpen((x) => !x)}>
        <span className={`j-caret ${open ? 'open' : ''}`}>▸</span>
        {label}
        {label && <span className="j-p">: </span>}
        <span className="j-p">{o}</span>
        {!open && (
          <>
            <span className="j-peek">{peek(v)}</span>
            <span className="j-p">{c + comma}</span>
          </>
        )}
      </div>
      {open && (
        <>
          <div className="j-kids">
            {entries.slice(0, limit).map(([k, x], i) => (
              <Node key={k} name={k} v={x} depth={depth + 1} last={i === entries.length - 1} />
            ))}
            {entries.length > limit && (
              <button className="j-more" onClick={() => setLimit((l) => l + PAGE * 5)}>
                Show {Math.min(PAGE * 5, entries.length - limit).toLocaleString()} more of {(entries.length - limit).toLocaleString()}
              </button>
            )}
          </div>
          <div className="j-row">
            <span className="j-p">{c + comma}</span>
          </div>
        </>
      )}
    </div>
  )
}

export function JsonView({ text }: { text: string }) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, v: JSON.parse(text) as J }
    } catch (e) {
      return { ok: false as const, error: (e as Error).message }
    }
  }, [text])
  const [raw, setRaw] = useState(false)
  if (!parsed.ok) {
    return (
      <div>
        <p className="small muted">This isn't valid JSON ({parsed.error}), so here it is as text.</p>
        <pre className="preview">{text.length > 60_000 ? text.slice(0, 60_000) + '\n…' : text}</pre>
      </div>
    )
  }
  return (
    <div>
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 6 }}>
        <div className="seg">
          <button className={raw ? '' : 'on'} onClick={() => setRaw(false)}>Tree</button>
          <button className={raw ? 'on' : ''} onClick={() => setRaw(true)}>Text</button>
        </div>
      </div>
      {raw ? (
        <PrettyText v={parsed.v} />
      ) : (
        <div className="json-view">
          <Node name={null} v={parsed.v} depth={0} last />
        </div>
      )}
    </div>
  )
}

function PrettyText({ v }: { v: J }) {
  const pretty = useMemo(() => JSON.stringify(v, null, 2), [v])
  return <pre className="preview code">{pretty.length > 200_000 ? pretty.slice(0, 200_000) + '\n…' : pretty}</pre>
}
