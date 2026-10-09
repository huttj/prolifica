import { useMemo, useState } from 'react'
import { siteOf } from '../shared/site'
import { COLLECTION_METHODS, type Dataset } from '../shared/types'
import { ago, fmtBytes } from './api'
import { onLinkClick } from './navigate'
import { Link } from './ui'

/**
 * Data as folders: paths are split on "/" into a tree, with a search box and a filter by the site the
 * data came from. Folders start closed (which are open is remembered per browser); a search or a site
 * filter opens every folder that has a match. Used by My data (rows link to the data) and by "Use my
 * data" (rows and whole folders can be ticked).
 */

interface Folder {
  name: string
  path: string
  folders: Folder[]
  files: Dataset[]
  /** every file below it, at any depth */
  all: Dataset[]
}

function buildTree(datasets: Dataset[]): Folder {
  const root: Folder = { name: '', path: '', folders: [], files: [], all: [] }
  for (const d of datasets) {
    const parts = d.path.split('/')
    let node = root
    node.all.push(d)
    for (let k = 0; k < parts.length - 1; k++) {
      const path = parts.slice(0, k + 1).join('/')
      let next = node.folders.find((f) => f.path === path)
      if (!next) node.folders.push((next = { name: parts[k]!, path, folders: [], files: [], all: [] }))
      next.all.push(d)
      node = next
    }
    node.files.push(d)
  }
  const tidy = (f: Folder): Folder => {
    // a folder holding nothing but one folder reads as one ("regulations-gov/USCIS-2026-0298")
    let g = f
    while (g !== root && !g.files.length && g.folders.length === 1) {
      const only = g.folders[0]!
      g = { ...only, name: `${g.name}/${only.name}` }
    }
    return {
      ...g,
      folders: g.folders.map(tidy).sort((a, b) => a.name.localeCompare(b.name)),
      files: [...g.files].sort((a, b) => a.path.localeCompare(b.path)),
    }
  }
  return tidy(root)
}

export const siteOfData = (d: Dataset) => siteOf(d.source?.url)

const readOpen = (key: string) => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(key) ?? '[]'))
  } catch {
    return new Set<string>()
  }
}

type Pick = { chosen: Set<string>; setChosen: (ids: string[], on: boolean) => void }

export function DataTree({ datasets, storageKey, pick, compact = false, empty, onOpen, selected }: {
  datasets: Dataset[]
  /** where the open folders are remembered */
  storageKey: string
  /** tick files and folders instead of linking to them */
  pick?: Pick
  compact?: boolean
  empty?: React.ReactNode
  /** a plain click opens the data here (a side panel) instead of going to its page */
  onOpen?: (d: Dataset) => void
  /** the one open in the side panel */
  selected?: string | null
}) {
  const [q, setQ] = useState('')
  const [site, setSite] = useState('')
  const [open, setOpenState] = useState(() => readOpen(`pf:open:${storageKey}`))
  const toggle = (path: string) =>
    setOpenState((o) => {
      const n = new Set(o)
      n.has(path) ? n.delete(path) : n.add(path)
      try {
        localStorage.setItem(`pf:open:${storageKey}`, JSON.stringify([...n]))
      } catch {
        /* storage unavailable */
      }
      return n
    })

  const sites = useMemo(() => {
    const n = new Map<string, number>()
    for (const d of datasets) {
      const s = siteOfData(d)
      if (s) n.set(s, (n.get(s) ?? 0) + 1)
    }
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [datasets])

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const filtering = words.length > 0 || !!site
  const shown = useMemo(
    () =>
      datasets.filter((d) => {
        const s = siteOfData(d)
        if (site && (site === '-' ? s : s !== site)) return false
        const hay = `${d.path} ${d.description ?? ''} ${s ?? ''} ${d.kind}`.toLowerCase()
        return words.every((w) => hay.includes(w))
      }),
    [datasets, site, q], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const tree = useMemo(() => buildTree(shown), [shown])

  const renderFolder = (f: Folder, depth: number): React.ReactNode => {
    const isOpen = filtering || open.has(f.path)
    const ids = f.all.map((d) => d.id)
    const ticked = pick ? ids.filter((id) => pick.chosen.has(id)).length : 0
    return (
      <div key={f.path}>
        <div className="dt-folder" style={{ paddingLeft: 10 + depth * 16 }} onClick={() => !filtering && toggle(f.path)}>
          {pick && (
            <input
              type="checkbox"
              checked={ticked === ids.length}
              ref={(el) => { if (el) el.indeterminate = ticked > 0 && ticked < ids.length }}
              onClick={(e) => e.stopPropagation()}
              onChange={() => pick.setChosen(ids, ticked < ids.length)}
              title="Choose everything in this folder"
            />
          )}
          <span className={`dt-caret ${isOpen ? 'open' : ''}`} aria-hidden="true">▸</span>
          <FolderGlyph />
          <span className="grow ellipsis">{f.name}</span>
          <span className="tiny muted">{f.all.length} file{f.all.length === 1 ? '' : 's'}</span>
          {!compact && <span className="tiny muted dt-num">{fmtBytes(f.all.reduce((n, d) => n + d.size, 0))}</span>}
          {!compact && <span className="tiny muted dt-num hide-sm">{ago(Math.max(...f.all.map((d) => d.updatedAt)))}</span>}
        </div>
        {isOpen && (
          <>
            {f.folders.map((c) => renderFolder(c, depth + 1))}
            {f.files.map((d) => renderFile(d, f.path, depth + 1))}
          </>
        )}
      </div>
    )
  }

  const renderFile = (d: Dataset, folder: string, depth: number) => {
    const name = folder ? d.path.slice(folder.length + 1) : d.path
    const s = siteOfData(d)
    const pad = { paddingLeft: 10 + depth * 16 }
    if (pick)
      return (
        <label key={d.id} className={`umd-item ${pick.chosen.has(d.id) ? 'on' : ''}`} style={pad}>
          <input type="checkbox" checked={pick.chosen.has(d.id)} onChange={() => pick.setChosen([d.id], !pick.chosen.has(d.id))} />
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="ellipsis small" style={{ display: 'block' }} title={d.path}>{name}</span>
            {d.description && <span className="ellipsis tiny muted" style={{ display: 'block' }}>{d.description}</span>}
          </span>
          {s && <span className="tiny muted hide-sm">{s}</span>}
          <span className="kind">{d.kind}</span>
          <span className="tiny muted">{fmtBytes(d.size)}</span>
        </label>
      )
    return (
      <a
        key={d.id}
        href={`/d/${d.id}`}
        className={`file ${selected === d.id ? 'on' : ''}`}
        onClick={(e) => {
          if (onOpen && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault()
            onOpen(d)
          } else onLinkClick(e)
        }}
      >
        <span style={{ width: depth * 16, flex: 'none', marginRight: -10 }} aria-hidden="true" />
        <span className="kind">{d.kind}</span>
        <span className="grow ellipsis" title={d.path}>{name}</span>
        {d.derivedFrom.length > 0 && <span className="chip accent">derived</span>}
        {s ? <span className="chip">{s}</span> : d.source?.method && d.source.method !== 'upload' ? <span className="chip">{COLLECTION_METHODS[d.source.method]}</span> : null}
        {d.public && <span className="chip">public</span>}
        <span className="tiny muted dt-num">{fmtBytes(d.size)}</span>
        <span className="tiny muted dt-num hide-sm">{ago(d.updatedAt)}</span>
      </a>
    )
  }

  const unsourced = datasets.filter((d) => !siteOfData(d)).length
  return (
    <div className="dt">
      <div className="dt-bar">
        <input className="field grow" placeholder={compact ? 'Search your data' : 'Search names, descriptions, sites'} value={q} onChange={(e) => setQ(e.target.value)} />
        {sites.length > 0 && (
          <select className="field dt-site" value={site} onChange={(e) => setSite(e.target.value)} title="Where the data came from">
            <option value="">All sites</option>
            {sites.map(([s, n]) => <option key={s} value={s}>{s} ({n})</option>)}
            {unsourced > 0 && <option value="-">No site ({unsourced})</option>}
          </select>
        )}
      </div>
      {site && site !== '-' && !pick && (
        <p className="tiny muted" style={{ margin: '6px 2px 0' }}>
          <Link to={`/s/${site}`}>Everything collected from {site} →</Link>
        </p>
      )}
      <div className={pick ? 'umd-list' : 'card dt-list'}>
        {!datasets.length ? (
          <div className="tiny muted" style={{ padding: 12 }}>{empty ?? 'No data yet.'}</div>
        ) : !shown.length ? (
          <div className="tiny muted" style={{ padding: 12 }}>Nothing matches.</div>
        ) : (
          <>
            {tree.folders.map((f) => renderFolder(f, 0))}
            {tree.files.map((d) => renderFile(d, '', 0))}
          </>
        )}
      </div>
    </div>
  )
}

function FolderGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M3 6.5A1.5 1.5 0 014.5 5H9l2 2.5h8.5A1.5 1.5 0 0121 9v9.5a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5z" />
    </svg>
  )
}
