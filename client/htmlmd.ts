// Rich text pasted into a text field (from a web page, a mail, Google Docs, a
// message here) comes in as HTML; this turns it into the markdown the field
// holds, keeping bold, italic, code, links, headings, lists and quotes.
//
// Blocks leave break marks in the text, worked out at the end: a line break
// (SOFT, a <div>) or a blank line (HARD, a <p>), never more than one blank
// line. Spaces that must stay (indents, code) are kept as NBSP and newlines in
// code as NL, so tidying around the break marks cannot touch them.

const SOFT = '\u0003', HARD = '\u0004', NL = '\u0005', NBSP = ' '
const BREAKS = /[ \t\n\u0003\u0004]*[\n\u0003\u0004][ \t\n\u0003\u0004]*/g

export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return resolve(kids(doc.body, false), 2).replaceAll(NBSP, ' ').replaceAll(NL, '\n').trim()
}

// Turn the break marks into newlines, at most max of them in a row.
function resolve(s: string, max: number): string {
  return s.replace(BREAKS, (run, at: number) => {
    if (at === 0 || at + run.length === s.length) return ''
    let n = (run.match(/\n/g)?.length ?? 0) + (run.includes(SOFT) ? 1 : 0)
    if (run.includes(HARD)) n = Math.max(n, 2)
    return '\n'.repeat(Math.min(n, max))
  })
}

const kids = (n: Node, pre: boolean) => [...n.childNodes].map((k) => node(k, pre)).join('')

// Markers around inline text, outside its edge spaces and on each of its lines.
function wrap(s: string, a: string, b = a): string {
  return s.split(/([\n\u0003\u0004]+)/).map((part, i) => {
    if (i % 2) return part
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(part)!
    return m[2] ? `${m[1]}${a}${m[2]}${b}${m[3]}` : part
  }).join('')
}

function node(n: Node, pre: boolean): string {
  if (n.nodeType === Node.TEXT_NODE) {
    const t = n.textContent ?? ''
    return pre ? t.replace(/ /g, NBSP).replace(/\t/g, NBSP.repeat(4)).replace(/\r?\n/g, NL) : t.replace(/[ \t\r\n\f]+/g, ' ')
  }
  if (!(n instanceof HTMLElement)) return ''
  const el = n, tag = el.tagName, st = el.style
  pre ||= /^pre/.test(st.whiteSpace)
  const inner = () => kids(el, pre)
  switch (tag) {
    case 'SCRIPT': case 'STYLE': case 'META': case 'TITLE': case 'HEAD': case 'IMG': return ''
    case 'BR': return pre ? NL : '\n'
    case 'P': case 'TABLE': return HARD + inner() + HARD
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
      return `${HARD}${'#'.repeat(Number(tag[1]))} ${resolve(inner(), 0).trim()}${HARD}`
    case 'UL': case 'OL': return list(el, tag === 'OL', pre)
    case 'BLOCKQUOTE': return HARD + resolve(inner(), 2).trim().split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n') + HARD
    case 'PRE': return `${HARD}\`\`\`${NL}${node(document.createTextNode(el.textContent ?? ''), true).replace(new RegExp(`${NL}+$`), '')}${NL}\`\`\`${HARD}`
    case 'CODE': return pre ? inner() : wrap((el.textContent ?? '').replace(/\s+/g, ' '), '`')
    case 'HR': return `${HARD}---${HARD}`
    case 'A': {
      const href = el.getAttribute('href') ?? '', text = inner()
      if (!text.trim() || !/^(https?:|mailto:)/.test(href)) return text
      return text.trim() === href ? text : wrap(text, '[', `](${href})`)
    }
  }
  let out = inner()
  if (/^(DIV|SECTION|ARTICLE|HEADER|FOOTER|MAIN|NAV|ASIDE|FIGURE|LI|DT|DD|TR|DL)$/.test(tag)) return SOFT + out + SOFT
  if (tag === 'TD' || tag === 'TH') return ` ${out} `
  // Bold and italic by tag or by style (Google Docs wraps all it copies in a <b> that is not bold).
  const fw = st.fontWeight
  const weight = fw === 'bold' || fw === 'bolder' ? 700 : fw === 'normal' || fw === 'lighter' ? 400 : Number(fw) || 0
  const bold = weight ? weight >= 600 : tag === 'B' || tag === 'STRONG'
  const italic = st.fontStyle ? st.fontStyle === 'italic' : tag === 'I' || tag === 'EM'
  const strike = /line-through/.test(st.textDecoration) || tag === 'S' || tag === 'DEL' || tag === 'STRIKE'
  if (pre) return out
  if (strike) out = wrap(out, '~~')
  if (italic) out = wrap(out, '_')
  if (bold) out = wrap(out, '**')
  return out
}

// Each item on its own line, its later lines (and the lists in it) indented under its text.
function list(el: HTMLElement, ordered: boolean, pre: boolean): string {
  let i = Number(el.getAttribute('start')) || 1
  const lines: string[] = []
  for (const k of el.children) {
    if (k.tagName === 'UL' || k.tagName === 'OL') {
      // A list put straight in a list (some editors do this) goes under the item before it.
      const sub = resolve(list(k as HTMLElement, k.tagName === 'OL', pre), 1).trim()
      lines.push(...sub.split('\n').map((l) => NBSP.repeat(2) + l))
      continue
    }
    if (k.tagName !== 'LI') continue
    const marker = ordered ? `${i++}. ` : '- '
    const body = resolve(kids(k, pre), 1).trim().split('\n')
    lines.push(marker + body[0], ...body.slice(1).map((l) => NBSP.repeat(marker.length) + l))
  }
  return HARD + lines.join('\n') + HARD
}
