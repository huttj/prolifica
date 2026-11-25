/**
 * Isles for agents that only have an address: no MCP, no sign-in, often no JavaScript.
 *
 *   /llms.txt             what Prolifica is and the addresses below
 *   /i/<id>.md            an isle as markdown: what it is, its instructions, its data with raw addresses
 *   /i/<id> (the app)     the same links in its <head>, and a plain list that the app replaces when it runs
 *
 * The JSON behind them is GET /api/isles/<id>/data (Store.isleData).
 */

import type { IsleData, IsleDataFile } from '../shared/types'
import { esc } from './pages'

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
const who = (p: { handle: string | null; name: string | null }) => (p.handle ? `@${p.handle}` : p.name || 'someone')
const day = (t: number) => new Date(t).toISOString().slice(0, 10)

/** Inline code that the text cannot close early. */
function code(s: string) {
  const ticks = Math.max(0, ...[...s.matchAll(/`+/g)].map((m) => m[0].length))
  const fence = '`'.repeat(ticks + 1)
  return ticks ? `${fence} ${s} ${fence}` : `${fence}${s}${fence}`
}

/** One line of user text: no line breaks, so it cannot start a heading or a list. */
const line = (s: string) => s.replace(/\s+/g, ' ').trim()

/** How a page reads its data, for an agent that wants to run or remix one. */
export function howPagesRead(mcp: string) {
  return [
    'An isle is one HTML page that does not contain its data. The page asks for each data file by slot name:',
    '`await prolifica.data("<slot>")` gives a csv slot as an array of objects (numbers parsed), a json slot as the parsed value,',
    'a text or markdown slot as a string, and an image slot as a URL. `prolifica.dataUrl("<slot>")` gives the raw address.',
    'So the same page runs over any data of the same shape. To run it outside Prolifica, read the page HTML and give',
    '`window.prolifica` a `data(slot)` function that fetches the slot addresses above. To remix it on Prolifica (same page',
    `with new data, new page with the same data, or both), connect the MCP server at ${mcp} and use publish_isle with`,
    'parent set to this isle.',
  ].join(' ')
}

function fileLines(f: IsleDataFile, names: Map<string, string>): string[] {
  const out: string[] = []
  out.push(`- Dataset: ${code(f.path)} (id ${code(f.id)}), ${f.contentType}, ${fmtSize(f.size)}, by ${who(f.owner)}`)
  if (f.description) out.push(`- Description: ${line(f.description)}`)
  if (f.raw) out.push(`- Raw dataset: ${f.raw}`)
  if (f.derivedFrom.length) out.push(`- Made from: ${f.derivedFrom.map((id) => `${code(names.get(id) ?? id)} (${code(id)})`).join(', ')}`)
  if (f.transform) out.push(`- How it was made: ${line(f.transform.split(/\n\s*\n/)[0]!)}`)
  if (f.source) {
    const s = f.source
    const parts = [s.method && `method ${s.method}`, s.url && `from ${s.url}`, s.collectedAt && `collected ${day(s.collectedAt)}`].filter(Boolean)
    if (parts.length) out.push(`- Collected: ${parts.join(', ')}`)
    if (s.notes) out.push(`- Collection notes: ${line(s.notes)}`)
    if (s.code) out.push(`- Collector code: ${s.code}`)
  }
  return out
}

/** The agent view of an isle: GET /i/<id>.md. */
export function isleMarkdown(d: IsleData, mcp: string): string {
  const { isle } = d
  const l = isle.links
  const names = new Map([...d.slots.flatMap((s) => (s.dataset ? [[s.dataset.id, s.dataset.path] as const] : [])), ...d.sources.map((s) => [s.id, s.path] as const)])
  const out: string[] = []
  out.push(`# ${line(isle.title)}`, '')
  const version = isle.version < isle.latest ? `version ${isle.version} (the latest is ${isle.latest})` : `version ${isle.version}`
  out.push(`An isle on Prolifica by ${who(isle.owner)}, ${version}, ${isle.visibility}.`, '')
  if (isle.description) out.push(isle.description.trim(), '')
  out.push('## Addresses', '')
  out.push(`- Page (an app; needs JavaScript): ${l.page}`)
  if (l.live) out.push(`- The page running with its data: ${l.live}`)
  out.push(`- Page HTML as the author wrote it (read it to see how the page uses the data): ${l.html}`)
  out.push(`- Data list (JSON): ${l.data}`)
  out.push(`- Isle (JSON): ${l.json}`)
  out.push(`- Lineage (JSON): ${l.lineage}`)
  if (l.parent) out.push(`- Parent isle${isle.relation ? ` (this isle is a ${isle.relation} of it)` : ''}: ${l.parent}`)
  out.push('')
  out.push('## Instructions for agents', '')
  if (isle.instructions?.trim()) {
    out.push(`The author of the isle wrote these notes about the page and its data.`, '')
    // their headings go under this section's (##): # becomes ###
    out.push(isle.instructions.trim().replace(/^(#{1,4}) /gm, '$1## '), '')
  } else out.push('The author wrote no instructions for this page.', '')
  out.push('## Data', '')
  if (!d.slots.length) out.push('This page has no data slots.', '')
  for (const s of d.slots) {
    out.push(`### Slot ${code(s.slot)}${s.kind ? ` (${s.kind})` : ''}`, '')
    if (s.slotDescription) out.push(`- What the page expects: ${line(s.slotDescription)}`)
    if (s.dataset) out.push(`- Content: ${s.url}`, ...fileLines(s.dataset, names))
    else out.push('- No data is bound to this slot.')
    out.push('')
  }
  if (d.sources.length) {
    out.push('## Sources', '', 'The data that the data above was made from.', '')
    for (const s of d.sources) {
      out.push(`### ${code(s.path)}`, '')
      if (s.feeds.length) out.push(`- Feeds the slots: ${s.feeds.map(code).join(', ')}`)
      out.push(...fileLines(s, names), '')
    }
  }
  out.push('## How pages read data', '', howPagesRead(mcp), '')
  return out.join('\n')
}

/** For the isle's page in the app: links to the agent views in <head>, and a plain list of the data. */
export function isleShellParts(d: IsleData): { head: string; body: string } {
  const l = d.isle.links
  const head =
    `<link rel="alternate" type="application/json" href="${esc(l.json)}">` +
    `<link rel="alternate" type="text/markdown" href="${esc(l.markdown)}">` +
    (d.isle.visibility === 'unlisted' ? '<meta name="robots" content="noindex">' : '') +
    // the plain list is for readers that do not run scripts; the app replaces it
    `<script>document.documentElement.classList.add('js')</script><style>.js .pf-plain{display:none}</style>`
  const a = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`
  const items = d.slots
    .filter((s) => s.dataset)
    .map((s) => `<li><code>${esc(s.slot)}</code> (${esc(s.dataset!.kind)}, ${esc(s.dataset!.path)}): ${a(s.url, s.url)}</li>`)
    .join('')
  const body =
    `<div class="pf-plain"><h1>${esc(d.isle.title)}</h1><p>An isle on Prolifica by ${esc(who(d.isle.owner))}.</p>` +
    (d.isle.description ? `<p>${esc(d.isle.description)}</p>` : '') +
    `<p>For agents: ${a(l.markdown, 'agent view (markdown, with instructions)')}, ${a(l.data, 'data list (JSON)')}, ${a(l.json, 'isle (JSON)')}, ${a(l.html, 'page HTML')}.</p>` +
    (items ? `<h2>Data</h2><ul>${items}</ul>` : '') +
    `</div>`
  return { head, body }
}

/** A file name at the root or under /i/ ("/AGENTS.md", "/i/x.txt"); app pages have no dot there. */
export const looksLikeFile = (path: string) => /^\/(?:i\/)?[^/]*\.[^/]*$/.test(path)

/** The static file, or a 404 when there is none: never the app's page with status 200, which misleads agents. */
export async function assetOr404(request: Request, env: Env): Promise<Response> {
  const res = await env.ASSETS.fetch(request)
  if (res.headers.get('content-type')?.includes('text/html') && !/\.html?$/i.test(new URL(request.url).pathname)) {
    return new Response('Not found. Agents: see /llms.txt', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' } })
  }
  return res
}

/** GET /llms.txt */
export function llmsTxt(origin: string, isles: string): string {
  return `# Prolifica

> Prolifica is a site of small HTML pages ("isles") over people's data. Each isle is one page bound to data files by named slots, so anyone can run the same page over other data, or show the same data with a new page. Each remix keeps a link to what it came from.

An isle's page in the app (${origin}/i/<id>) is a JavaScript app. Agents that have only that address can read the isle, its data and the author's instructions at the addresses below, with plain GET requests and no sign-in. Public and unlisted isles answer to anyone who has the address; private isles and private data do not appear at these addresses. Responses without sign-in send \`Access-Control-Allow-Origin: *\`.

## From a page address to its data

- ${origin}/i/<id>.md: the isle as markdown. It gives the title, the author, the description, the author's instructions for agents, each data slot with the raw address of its content, the data the bound data was made from, and links to the page HTML and the parent isle. Start here.
- ${origin}/api/isles/<id>/data: the same data list as JSON. For each slot: name, kind, slot description, dataset id, path, description, content type, size, the content address (url) and the dataset's own raw address (raw). Then the sources, with what each was made from.
- ${origin}/api/isles/<id>/data/<slot>: the content of one slot.
- ${origin}/api/isles/<id>: the isle as JSON (slots, bindings with addresses, instructions, parent).
- ${origin}/api/isles/<id>/source: the page's HTML as text, to see how the page uses its data.
- ${isles}/<id>: the page running with its data.
- ${origin}/api/isles/<id>/lineage: the family of the isle (its parent, remixes and data) as JSON.
- ${origin}/api/data/<dataset id>/raw: the content of a public dataset. ${origin}/api/data/<dataset id> gives its metadata as JSON.

Add \`?v=<n>\` to the .md, data and source addresses to read an older version of an isle: each version keeps its own data bindings and instructions.

To find isles: ${origin}/api/isles?q=<words> lists public isles that match, as JSON.

## How a page reads its data

${howPagesRead(`${origin}/mcp`)}

## With the MCP server

To make, publish, rebind or remix isles, and to keep data, connect an MCP client to ${origin}/mcp (OAuth sign-in by email). Its guide tool explains the rest.
`
}
