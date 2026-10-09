import { useEffect, useRef, useState } from 'react'
import type { TreeNode } from '../shared/types'
import { who } from './api'
import { navigate } from './navigate'
import { Link } from './ui'

/**
 * A family tree drawn left to right: roots on the left, every remix (or derived dataset) to the right
 * of what it came from. Edge colour says how it came: new data, new look, remixed, derived.
 */

const W = 190
const H = 44
const GAP_X = 46
const GAP_Y = 12

interface Placed {
  node: TreeNode
  x: number
  y: number
  parent: Placed | null
}

function layout(roots: TreeNode[]): { placed: Placed[]; width: number; height: number } {
  const placed: Placed[] = []
  let row = 0
  let maxDepth = 0
  const walk = (node: TreeNode, depth: number, parent: Placed | null): number => {
    maxDepth = Math.max(maxDepth, depth)
    const me: Placed = { node, x: depth * (W + GAP_X), y: 0, parent }
    placed.push(me)
    if (!node.children.length) {
      me.y = row++ * (H + GAP_Y)
    } else {
      const ys = node.children.map((c) => walk(c, depth + 1, me))
      me.y = (ys[0]! + ys[ys.length - 1]!) / 2
    }
    return me.y
  }
  for (const r of roots) {
    walk(r, 0, null)
    row += 0.5
  }
  return { placed, width: (maxDepth + 1) * (W + GAP_X) - GAP_X + 2, height: Math.max(H, Math.ceil(row) * (H + GAP_Y)) }
}

const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export function TreeView({ roots, current, maxHeight }: { roots: TreeNode[]; current?: string; maxHeight?: number }) {
  const { placed, width, height } = layout(roots)
  return (
    <div className="tree-wrap tree" style={{ maxHeight }}>
      <svg width={width + 24} height={height + 24} role="img" aria-label="Family tree">
        <g transform="translate(12,12)">
          {placed.map((p) =>
            p.parent ? (
              <path
                key={`e-${p.node.kind}-${p.node.id}`}
                className={`edge ${p.node.relation ?? ''}`}
                d={`M${p.parent.x + W},${p.parent.y + H / 2} C${p.parent.x + W + GAP_X / 2},${p.parent.y + H / 2} ${p.x - GAP_X / 2},${p.y + H / 2} ${p.x},${p.y + H / 2}`}
              />
            ) : null,
          )}
          {placed.map((p) => (
            <g
              key={`n-${p.node.kind}-${p.node.id}`}
              className={`node ${p.node.kind} ${p.node.id === current ? 'current' : ''}`}
              transform={`translate(${p.x},${p.y})`}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(p.node.kind === 'isle' ? `/i/${p.node.id}` : `/d/${p.node.id}`)}
            >
              <title>{`${p.node.title} · ${who(p.node.owner)}`}</title>
              <rect width={W} height={H} rx={p.node.kind === 'isle' ? 10 : 4} />
              <text x={10} y={18}>
                {p.node.kind === 'dataset' ? '▤ ' : ''}
                {trim(p.node.title, 26)}
              </text>
              <text x={10} y={34} className="by">
                {trim(who(p.node.owner), 18)}
                {p.node.starCount ? `  ★ ${p.node.starCount}` : ''}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}

/**
 * A family as a thread: one row per isle or dataset, remixes indented under what they came from, with
 * an elbow from each parent's dot to its children's. Reads top to bottom in a narrow panel, however deep
 * or wide the family gets. Each row says how it came from its parent; the current one is highlighted
 * and scrolled into view.
 */
export function ThreadView({ roots, current }: { roots: TreeNode[]; current?: string }) {
  const here = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    here.current?.scrollIntoView({ block: 'nearest' })
  }, [current])
  return (
    <ul className="thread">
      {roots.map((n) => (
        <ThreadNode key={`${n.kind}-${n.id}`} node={n} current={current} depth={0} here={here} />
      ))}
    </ul>
  )
}

const SHOW = 8

function contains(node: TreeNode, id: string | undefined): boolean {
  return !!id && (node.id === id || node.children.some((c) => contains(c, id)))
}

function ThreadNode({ node, current, depth, here }: { node: TreeNode; current?: string; depth: number; here: React.RefObject<HTMLAnchorElement | null> }) {
  const onPath = contains(node, current)
  // open along the way to the current one and a little below it; deep or far-off branches start folded
  const [open, setOpen] = useState(onPath || depth < 2)
  const [limit, setLimit] = useState(SHOW)
  const isCurrent = node.id === current
  const kids = node.children
  const total = (n: TreeNode): number => n.children.reduce((t, c) => t + 1 + total(c), 0)
  const how = depth > 0 && node.relation && node.relation !== 'binds' ? RELATION_SHORT[node.relation] : null
  return (
    <li className={kids.length && open ? 'has-kids' : ''}>
      <div className="t-line">
        <Link
          to={node.kind === 'isle' ? `/i/${node.id}` : `/d/${node.id}`}
          className={`t-row ${isCurrent ? 'current' : ''}`}
          title={`${node.title} · ${who(node.owner)}${node.relation && node.relation !== 'binds' ? ` · ${RELATION_TEXT[node.relation]}` : ''}`}
          ref={isCurrent ? here : undefined}
        >
          <i className={`t-dot ${depth > 0 ? (node.relation ?? '') : 'root'} ${node.kind}`} />
          <span className="t-text">
            <span className="t-title ellipsis">{node.title}</span>
            <span className="t-meta">
              {how && <span className={`t-how ${node.relation}`}>{how}</span>}
              <span>{who(node.owner)}</span>
              {node.starCount ? <span>★ {node.starCount}</span> : null}
              {isCurrent && <span className="t-here">you're here</span>}
            </span>
          </span>
        </Link>
        {kids.length > 0 && (
          <button className={`t-fold ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={open ? 'Fold' : 'Unfold'}>
            {open ? '▾' : '▸'} {total(node)}
          </button>
        )}
      </div>
      {open && kids.length > 0 && (
        <ul className="thread">
          {kids.slice(0, limit).map((c) => (
            <ThreadNode key={`${c.kind}-${c.id}`} node={c} current={current} depth={depth + 1} here={here} />
          ))}
          {kids.length > limit && (
            <li className="t-more-li">
              <button className="link-btn tiny t-more" onClick={() => setLimit((l) => l + SHOW * 4)}>
                Show {Math.min(SHOW * 4, kids.length - limit)} more of {kids.length - limit}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

const RELATION_SHORT: Record<string, string> = { rebind: 'new data', restyle: 'new look', remix: 'remixed', derived: 'derived' }
const RELATION_TEXT: Record<string, string> = { rebind: 'New data, same page', restyle: 'New look, same data', remix: 'Remixed', derived: 'Derived data' }
