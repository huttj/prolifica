import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Enough markdown for notes and documents: headings, paragraphs, lists, quotes, fenced code, rules,
 * and inline code, bold, italic and links. Builds React elements (never HTML strings), and only
 * http(s) and mailto links become links, so it is safe for anything people write.
 */

const SAFE_URL = /^(https?:\/\/|mailto:)/i

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`+)([\s\S]*?)\1|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|(?<![\w])_([^_\s][^_]*)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g
  let last = 0
  let m: RegExpExecArray | null
  let n = key
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `i${n++}`
    if (m[1]) out.push(<code key={k}>{m[2]}</code>)
    else if (m[3] ?? m[4]) out.push(<strong key={k}>{inline((m[3] ?? m[4])!, n * 100)}</strong>)
    else if (m[5] ?? m[6]) out.push(<em key={k}>{inline((m[5] ?? m[6])!, n * 100)}</em>)
    else if (m[7]) {
      const href = m[8]!
      out.push(SAFE_URL.test(href) ? <a key={k} href={href} target="_blank" rel="noreferrer noopener">{inline(m[7], n * 100)}</a> : m[0])
    } else if (m[9]) out.push(<a key={k} href={m[9]} target="_blank" rel="noreferrer noopener">{m[9]}</a>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  const k = () => `b${blocks.length}`
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) body.push(lines[i++]!)
      i++
      blocks.push(<pre key={k()} className="md-code"><code>{body.join('\n')}</code></pre>)
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const level = Math.min(6, h[1]!.length + 2)
      const Tag = `h${level}` as 'h3'
      blocks.push(<Tag key={k()}>{inline(h[2]!)}</Tag>)
      i++
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={k()} />)
      i++
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*>\s?/, ''))
      blocks.push(<blockquote key={k()}><Markdown text={body.join('\n')} /></blockquote>)
      continue
    }
    const item = /^\s*([-*+]|\d+[.)])\s+/
    if (item.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: string[] = []
      while (i < lines.length && (item.test(lines[i]!) || (/^\s{2,}\S/.test(lines[i]!) && items.length))) {
        if (item.test(lines[i]!)) items.push(lines[i]!.replace(item, ''))
        else items[items.length - 1] += ' ' + lines[i]!.trim()
        i++
      }
      const List = ordered ? 'ol' : 'ul'
      blocks.push(<List key={k()}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</List>)
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() && !/^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s)/.test(lines[i]!)) para.push(lines[i++]!)
    if (!para.length) para.push(lines[i++]!)
    blocks.push(<p key={k()}>{inline(para.join('\n'))}</p>)
  }
  return <div className={`md ${className ?? ''}`}>{blocks}</div>
}

/** Markdown that starts folded to a few lines, with a toggle when there's more. */
export function FoldedMarkdown({ text, lines = 3 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false)
  const [long, setLong] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) setLong(el.scrollHeight > el.clientHeight + 4)
  }, [text])
  return (
    <div className="folded">
      <div ref={ref} className={`folded-body ${open ? 'open' : ''} ${long && !open ? 'faded' : ''}`} style={open ? undefined : { maxHeight: `${lines * 1.5}em` }}>
        <Markdown text={text} />
      </div>
      {(long || open) && (
        <button className="link-btn tiny" onClick={() => setOpen((o) => !o)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

/**
 * Plain text with its links made clickable: full URLs, bare domains ("joshuahutt.com/notes") and
 * email addresses. Nothing else is interpreted, so it suits short things people write about themselves.
 */
export function Linkified({ text }: { text: string }) {
  const out: ReactNode[] = []
  const re = /\b(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>()]*[^\s<>().,;:!?'"])?)/gi
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const t = m[0]
    // "e.g." and "v1.2" aren't links: a bare domain needs a real-looking ending
    if (!/^https?:/i.test(t) && !t.includes('@') && !/\.[a-z]{2,}(\/|$)/i.test(t)) continue
    if (m.index > last) out.push(text.slice(last, m.index))
    const href = /^https?:/i.test(t) ? t : t.includes('@') ? `mailto:${t}` : `https://${t}`
    out.push(<a key={m.index} href={href} target="_blank" rel="noreferrer noopener">{t.replace(/^https?:\/\/(www\.)?/i, '')}</a>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}
