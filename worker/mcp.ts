import { COLLECTION_METHODS, type Anchor, type DataSource, type IsleSummary, type Visibility } from '../shared/types'
import { appOrigin, islesOrigin, quotaFor } from './auth'
import { checkIsle, shootLater } from './shots'
import { applyJsonSets, applyTextEdits, EditError, grepLines, type TextEdit } from '../shared/edits'
import { Db, type UserRow } from './db'
import { Store, StoreError, fmtBytes, type Layer, type SourceInput } from './store'

/**
 * The MCP endpoint: JSON-RPC over POST, stateless, never streams (the desktop.fyi shape).
 * Whoever is asking was settled before we got here: an OAuth grant or a personal key, both
 * arrive as ctx.props.userId.
 */

const PROTOCOL = '2025-06-18'
const SERVER = { name: 'prolifica', title: 'Prolifica', version: '0.1.0' }

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }

const reply = (id: Rpc['id'], result: unknown) => Response.json({ jsonrpc: '2.0', id: id ?? null, result })
const fail = (id: Rpc['id'] | null, code: number, message: string, status = 200) => Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { status })

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
const text = (value: unknown, isError = false) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] as Content[],
  isError,
})

export const GUIDE = `# Prolifica, for agents

Prolifica is an archipelago of small pages ("isles") over people's data. Everything you
make here is public by default and can be remixed by anyone.

## Data
- Each person has a few MB (see whoami). Data is any file: csv, json, markdown, text, images.
- Paths are folders: "tweets/2024.csv". Writing to an existing path replaces it.
- A transformation is just new data with derived_from (the inputs) and transform (what you
  did, in a sentence or the prompt itself). Keep the original; derive, don't overwrite.
- Say how original data was collected with source: url (where), method (bookmarklet,
  extension, userscript, agent, script, api, upload, manual, other), collected_at, notes
  (what's in and what was left out) and code: the bookmarklet, scraper or script itself, in
  full, so anyone can collect more the same way. If you scraped it, the code you ran is the
  code. Data gathered by identical code is linked up automatically.
- Before collecting from a website, call site with its URL: it returns the collectors that have
  worked there (with code) and the data already gathered from it. Reuse before you rewrite.
- Data is private until something public shows it. Publishing a public isle bound to your
  private data makes that data public; say so to the person before you do it.

## Isles
An isle is ONE self-contained HTML page plus named data slots. The page never embeds the
data: it asks for it by slot name, so anyone can run their own data through it.

    <script>
      const rows = await prolifica.data('tweets')   // csv -> array of objects (numbers parsed)
      // json -> parsed value, text/markdown -> string, image -> URL string
      // prolifica.dataUrl('tweets') gives the raw URL, prolifica.bindings the dataset info
    </script>

- Declare slots when publishing: slots: { tweets: { kind: "csv", description: "one row per tweet: date, text, likes" } }
  and bind them: bindings: { tweets: "<dataset id>" }. Describe the columns you rely on, so
  a rebinder knows what shape of data fits.
- Use <script type="module"> (top-level await works) and libraries from a CDN
  (https://cdn.jsdelivr.net/npm/..., https://esm.sh/...). No build step.
- Put data-pid="something-stable" on the pieces people will want to star or comment on
  (each chart, card, control). Element marks anchor to those; without them anchors fall
  back to brittle positional selectors.
- If the page has views (tabs, filters, a selected item, a time window), tell Prolifica how to
  read and restore them, so a comment on a piece in another view can bring it back:
    prolifica.onState({ get: () => ({ tab, filter }), set: (st) => { tab = st.tab; filter = st.filter; render() } })
  Keep the state small and JSON-able. Without it, the URL hash and replayed clicks are tried.
- Make it work at any width and in light and dark (prefers-color-scheme). Size charts from
  their container and redraw on resize (a ResizeObserver): isles are shown full-size, as
  thumbnails and inside other pages, and may first run before they have a size.
- Don't rely on localStorage for anything important; isles share one origin.

## Remixing (the point of the place)
- Same page, new data: publish_isle with from=<isle> (or parent=<isle>) and new bindings,
  no html. That's a "rebind", and it stands on the same island group as its parent.
- Same data, new look: parent=<isle>, new html, keep bindings. That's a "restyle".
- Both: parent=<isle>, new html, new bindings. A "remix".
- A remix means a real change to how the page looks or works. If you only need different words in
  the page for different data (a city's name, a title, a date range, a unit), don't fork the page to
  swap them: those belong in the data. Make the page read them from a slot (a small "meta" JSON is
  fine) — update the original in place if it's yours, otherwise publish that as a restyle — and then
  rebind. The next person with their own data can then use the page as it is.
- Always pass a note saying what you changed, on a remix as on an update: people compare a family's
  steps side by side, and the note is what tells them why each one exists.

## Getting the relations right (they draw the family graph)
- parent: the isle you started from. Set once, when the remix is made; never change it later.
- An update to your own isle (id + note) is a new version on the same line.
- draws_from: when a version brings in changes from another isle that isn't its parent — a sibling
  remix's new feature, a newer version of the original, a fix someone else made — pass
  draws_from: [{isle, version, note: what you took}] on the publish (or edit_isle) that brings them in.
  Works with no other change too (publish_isle with id and draws_from only) to record it afterwards.
- uses: specific pieces (an element, a chart) you lifted from other isles into yours.
- changes: alongside the note, list what changed part by part — [{part: "legend", what: "clicking an
  entry selects its posts"}] — naming parts by their data-pid. Pass parts on draws_from too, so one
  component (a legend, a sidebar) can be followed from isle to isle.
- Bringing a change to several isles (propagating it)? If they run the same page, update the page
  once and rebind or point the others at it; otherwise edit each, and give each one draws_from the
  isle/version the change came from, with the same part names.
- view: "same" or "new" whenever you pass html with a parent (see above).
- short_title: one to three words for the map, naming what's particular to this isle ("Kennewick",
  "Bike assault"): its content.
- view_name: what kind of page it is ("Discourse map", "City guide"): its format, which names its group
  on the map. Give it when you make a new page; a rebind inherits it.
- When you do pass html, say what you changed with view: "same" (you only adapted it to the data or
  fixed something small; it is the same view) or view: "new" (it looks or works differently). If you
  don't say, a near-identical page counts as the same view.
- Always pass parent when you build on someone's isle, and uses=[{isle, selector, label}] for
  the pieces you borrowed from elsewhere (starred elements especially). That is how the
  lineage trees get drawn and how credit flows.
- Update your own isle in place with id=<isle> and a short note saying what changed; each
  update keeps the old version, and people can look back through the history.

## Small changes are cheap
Don't read or resend a whole page to change a few words. get_isle with grep (or lines) returns just the
matching lines; edit_isle applies exact find/replace edits on the server (to your isle as a new version,
or as_remix to publish your own version of someone else's); edit_data sets fields in a JSON dataset by
path ("city.name", "topics[3].title") or edits text data in place. Then check_isle.

## Test what you publish
check_isle opens an isle in a real browser and returns a screenshot with its script errors, failed
requests and how each data slot loaded. After every publish_isle, check it (at desktop width, and at
390 for phones when layout matters). If there are errors, a slot failed, or the page is empty or
wrong, fix the data or the page, update in place (id + note) and check again until it's right.

## Running someone's data through an isle
Data almost never arrives in the exact shape a page expects. Read the isle's slot descriptions (and its
HTML, to see which fields it really uses), then write a transformed copy of the person's data that fits
(derived_from the originals, transform saying how) and bind that. Never overwrite their originals. Prefer
a rebind (from + parent, same page); change the page only when the data can't be made to fit it.

## The person's taste
library() returns what they've starred (whole isles and single elements, with the element's
markup) and what they've commented. When you make something new for them, look there first
and lean on those pieces: they are their go-tos.

## Marks
star and comment take an optional selector to mark one element instead of the page. Emoji
reactions go on comments only (react takes a comment id). Comments come in layers (mine,
author, following, everyone) so busy isles stay quiet.`

const s = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra })
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

const ANCHOR_PROPS = {
  selector: s('CSS selector of one element in the isle, e.g. [data-pid="mood-chart"]. Omit to mean the whole page.'),
  label: s('A short human name for that element, e.g. "mood over time chart"'),
}

const SOURCE_SCHEMA = {
  type: 'object',
  description: 'How the data was collected. Record it whenever you know: where, how, and the code if any was used.',
  properties: {
    url: s('Where it came from (the page, site, API or file location)'),
    method: s('How it was collected', { enum: Object.keys(COLLECTION_METHODS) }),
    notes: s('What was collected and what was left out, limits, caveats'),
    collected_at: s('When (ISO date)'),
    code: s('The collector itself: the bookmarklet, userscript, scraper or script that gathered it, in full'),
    code_language: s('e.g. javascript, python, bookmarklet'),
  },
  additionalProperties: false,
}

const drawsOf = (v: unknown) =>
  Array.isArray(v)
    ? v.filter((d) => d && typeof d === 'object' && typeof (d as { isle?: unknown }).isle === 'string').map((d) => ({ isle: String(d.isle), version: Number(d.version) || undefined, note: typeof d.note === 'string' ? d.note : undefined, parts: Array.isArray(d.parts) ? d.parts.map(String) : undefined }))
    : undefined
const changesOf = (v: unknown) =>
  Array.isArray(v) ? v.filter((c) => c && typeof c === 'object' && typeof c.part === 'string' && typeof c.what === 'string').map((c) => ({ part: String(c.part), what: String(c.what) })) : undefined

const sourceOf = (v: unknown): SourceInput | undefined => {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const pick = (k: string) => (k in o ? (o[k] === null ? null : String(o[k])) : undefined)
  return { url: pick('url'), method: pick('method'), notes: pick('notes'), collectedAt: pick('collected_at'), code: pick('code'), codeLanguage: pick('code_language') }
}

const TOOLS = [
  {
    name: 'guide',
    description: 'How Prolifica works for agents: data, isles (pages with data slots), remixing, marks. Read this once before making or remixing isles.',
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'whoami',
    description: 'The signed-in person: handle, storage used and left, links, and counts of their data and isles.',
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_data',
    description: "List the person's data (or another person's public data), optionally inside a folder.",
    inputSchema: obj({ folder: s('Folder path, e.g. "tweets"'), handle: s("Someone else's handle, to list their public data") }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_data',
    description: 'Read one dataset: its details and contents (text formats as text, paged by characters; images as images).',
    inputSchema: obj({ id: s('Dataset id'), offset: { type: 'integer', description: 'Character offset for long text' }, limit: { type: 'integer', description: 'Characters to return (default 60000)' }, collector_code: { type: 'boolean', description: 'Include the code it was collected with (default true)' } }, ['id']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'write_data',
    description:
      'Save data (create, or replace the file at that path / that id). For a transformation, pass derived_from and transform so the lineage is kept. Counts against the person\'s storage.',
    inputSchema: obj(
      {
        path: s('Folder path and file name, e.g. "tweets/mood.csv". The extension sets the type.'),
        content: s('The contents, as text (csv, json, markdown, ...)'),
        base64: s('Or the contents base64-encoded, for images and other binary files'),
        content_type: s('MIME type, when the extension does not say'),
        description: s('What this is, in a sentence: shape, columns, source'),
        derived_from: { type: 'array', items: { type: 'string' }, description: 'Ids of the datasets this was made from' },
        transform: s('How it was made from those (the prompt or a sentence)'),
        public: { type: 'boolean', description: 'Make it public now (default: private until a public isle shows it)' },
        source: SOURCE_SCHEMA,
        id: s('Replace this dataset (instead of going by path)'),
      },
      ['path'],
    ),
  },
  {
    name: 'update_data',
    description: 'Rename/move a dataset, change its description or provenance (source), or make it public/private, without touching its contents.',
    inputSchema: obj({ id: s('Dataset id'), path: s('New path'), description: s('New description'), public: { type: 'boolean' }, source: SOURCE_SCHEMA }, ['id']),
  },
  {
    name: 'delete_data',
    description: 'Delete one of the person\'s datasets. Refused while an isle still shows it.',
    inputSchema: obj({ id: s('Dataset id') }, ['id']),
    annotations: { destructiveHint: true },
  },
  {
    name: 'site',
    description:
      'Before collecting data from a website, ask here: how people have collected from it (methods, notes, and the collector code itself, most trusted first), what data from it already exists, and the isles built on it. Without a site, lists the sites data has come from.',
    inputSchema: obj({
      site: s('A site or any URL on it, e.g. "x.com" or "https://x.com/someone/status/1"'),
      code: { type: 'boolean', description: 'Include each collector\'s code (default true; the top 3)' },
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'browse',
    description: 'Find public isles: newest or most starred, by text, or by person.',
    inputSchema: obj({
      query: s('Words in the title or description'),
      handle: s("Only this person's isles"),
      sort: s('recent (default) or stars', { enum: ['recent', 'stars'] }),
      limit: { type: 'integer', description: 'Default 20' },
      mine: { type: 'boolean', description: "The person's own isles, private ones included" },
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_isle',
    description: 'One isle: details, slots, bound data, parent, what it borrowed, and (by default) its HTML source. Read this before remixing.',
    inputSchema: obj({
      id: s('Isle id'),
      source: { type: 'boolean', description: 'Include the whole HTML (default true, unless grep or lines is given). Pages can be large: for a small change, grep for what you need and use edit_isle.' },
      grep: s('Return only the page lines matching this pattern (a regex, case-insensitive), numbered, with a little context'),
      context: { type: 'integer', description: 'Lines of context around each grep match (default 2)' },
      lines: s('Return just these page lines, e.g. "120-180"'),
    }, ['id']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'edit_isle',
    description:
      'Change a few things in an isle\'s page without resending it: exact find/replace edits applied on the server. On your own isle it becomes a new version (with note); with as_remix it publishes your own version of any isle (parent set for you). Each find must match exactly once unless all: true. Use get_isle with grep to find the text first, then check_isle.',
    inputSchema: obj({
      id: s('Isle id'),
      edits: { type: 'array', description: 'Applied in order', items: obj({ find: s('Exact text to find (include enough around it to be unique)'), replace: s('What to put instead'), all: { type: 'boolean', description: 'Replace every occurrence' } }, ['find', 'replace']) },
      note: s('What changed, for the version history (or, as a remix, what you changed from the original)'),
      view: s('"same" if the page is still the same view (adapted to data, small fixes), "new" if it now looks or works differently', { enum: ['same', 'new'] }),
      as_remix: { type: 'boolean', description: 'Publish the edited page as a new isle with this one as its parent, instead of updating it' },
      title: s('With as_remix: the new isle\'s title'),
      short_title: s('With as_remix: one to three words for the map'),
      bindings: { type: 'object', description: 'With as_remix: slot -> dataset id for the new isle (default: keep the original\'s)', additionalProperties: { type: 'string' } },
      changes: { type: 'array', description: 'What this version changed, part by part: [{part, what}], part being a component of the page (use its data-pid when it has one, e.g. "legend", "selected-tweet"). Lets people follow one component\'s history across the family.', items: obj({ part: s('The component'), what: s('What changed in it') }, ['part', 'what']) },
      draws_from: { type: 'array', description: 'Other isles this version pulls changes from (not its parent): e.g. you brought in a sibling remix\'s new sidebar. [{isle, version (default: its latest), note: what you took}]. Shown as a converging edge in the family graph.', items: obj({ isle: s('Isle id'), version: { type: 'integer' }, note: s('What you took from it'), parts: { type: 'array', items: { type: 'string' }, description: 'Which components you took (data-pid names)' } }, ['isle']) },
    }, ['id', 'edits']),
  },
  {
    name: 'edit_data',
    description:
      'Change a dataset in place without resending it: set or remove fields of JSON data by path ("city.name", "topics[3].title"), or exact find/replace edits on any text data. Keeps its id, description, source and lineage; isles bound to it show the change.',
    inputSchema: obj({
      id: s('Dataset id'),
      set: { type: 'array', description: 'For JSON data', items: obj({ path: s('Dot path with [n] for arrays, e.g. "city.name" or "wards[2].members"'), value: { description: 'The new value (any JSON)' }, remove: { type: 'boolean', description: 'Delete it instead' } }, ['path']) },
      edits: { type: 'array', description: 'For any text data (csv, markdown, json as text)', items: obj({ find: s('Exact text to find'), replace: s('What to put instead'), all: { type: 'boolean' } }, ['find', 'replace']) },
    }, ['id']),
  },
  {
    name: 'check_isle',
    description:
      'Open an isle in a headless browser and see it: a screenshot, script and console errors, failed requests, how each data slot loaded, and the visible text. Use it after every publish_isle to test what you made, and fix until it is clean.',
    inputSchema: obj({
      id: s('Isle id'),
      width: { type: 'integer', description: 'Window width in px (default 1280; 390 for a phone)' },
      height: { type: 'integer', description: 'Window height in px (default 800)' },
      dark: { type: 'boolean', description: 'Use the dark colour scheme' },
      wait: { type: 'integer', description: 'Extra milliseconds to wait after loading before looking (default 1500)' },
    }, ['id']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'publish_isle',
    description:
      'Publish an isle (an HTML page with data slots), update your own (id), or remix someone\'s (parent). For a rebind (same page, new data) pass from or parent plus bindings and no html. Read guide first.',
    inputSchema: obj({
      html: s('The whole page. Reads data with await prolifica.data("slot").'),
      title: s('Title'),
      short_title: s('One to three words for the map, naming what is particular to this one ("Kennewick", "Bike assault", "OpenAI firings"): the map already shows what kind of page it is'),
      view_name: s('What kind of page this is, the format not the content, in one to three words ("Discourse map", "City guide", "Concept map"). Names its group on the map. A rebind inherits its parent\'s; give it for a new page or when a remix makes a different kind of page.'),
      description: s('What it shows and what data shape it expects'),
      slots: { type: 'object', description: 'Slot name -> { kind: csv|json|text|markdown|image|any, description }', additionalProperties: { type: 'object' } },
      bindings: { type: 'object', description: 'Slot name -> dataset id', additionalProperties: { type: 'string' } },
      parent: s('The isle this builds on (sets the lineage)'),
      from: s('Take the page from this isle instead of passing html'),
      uses: { type: 'array', description: 'Pieces borrowed from other isles', items: obj({ isle: s('Isle id'), ...ANCHOR_PROPS }, ['isle']) },
      visibility: s('public (default), unlisted, or private', { enum: ['public', 'unlisted', 'private'] }),
      id: s('Update this isle of yours in place (keeps the old version)'),
      note: s('What changed, in a sentence or two. For an update: what this version changed. For a new remix: what you changed from the original and why. Shown in the family\'s evolution view, so be specific ("swapped in Kennewick\'s data; city name now read from meta.city").'),
      view: s('With html and a parent: "same" if you only adapted the page to new data or fixed something small, "new" if it now looks or works differently. Decides whether it joins its parent\'s island group.', { enum: ['same', 'new'] }),
      changes: { type: 'array', description: 'What this version changed, part by part: [{part, what}], part being a component of the page (use its data-pid when it has one, e.g. "legend", "selected-tweet"). Lets people follow one component\'s history across the family.', items: obj({ part: s('The component'), what: s('What changed in it') }, ['part', 'what']) },
      draws_from: { type: 'array', description: 'Other isles this version pulls changes from (not its parent): e.g. you brought in a sibling remix\'s new sidebar. [{isle, version (default: its latest), note: what you took}]. Shown as a converging edge in the family graph.', items: obj({ isle: s('Isle id'), version: { type: 'integer' }, note: s('What you took from it'), parts: { type: 'array', items: { type: 'string' }, description: 'Which components you took (data-pid names)' } }, ['isle']) },
    }),
  },
  {
    name: 'delete_isle',
    description: "Delete one of the person's isles. Remixes of it stay.",
    inputSchema: obj({ id: s('Isle id') }, ['id']),
    annotations: { destructiveHint: true },
  },
  {
    name: 'lineage',
    description: 'The family tree of an isle (ancestors, every remix below it, the data it shows) or of a dataset (what it was derived from, what was derived from it, the isles that show it).',
    inputSchema: obj({ isle: s('Isle id'), data: s('Dataset id') }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'library',
    description: "The person's starred isles and elements (with each element's markup) and their comments: their taste. Look here before designing something new for them.",
    inputSchema: obj({ kind: s('star or comment (default both)', { enum: ['star', 'comment'] }), limit: { type: 'integer' } }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'star',
    description: 'Star (or unstar) an isle or one element of it, for the person\'s library.',
    inputSchema: obj({ isle: s('Isle id'), ...ANCHOR_PROPS, on: { type: 'boolean', description: 'false to unstar (default true)' } }, ['isle']),
  },
  {
    name: 'react',
    description: 'Toggle an emoji reaction on a comment.',
    inputSchema: obj({ isle: s('Isle id'), comment: s('Comment id'), emoji: s('One emoji'), on: { type: 'boolean' } }, ['isle', 'comment', 'emoji']),
  },
  {
    name: 'comment',
    description: 'Comment on an isle or one element of it, or reply to a comment.',
    inputSchema: obj({ isle: s('Isle id'), body: s('The comment (markdown)'), ...ANCHOR_PROPS, reply_to: s('Comment id to reply to') }, ['isle', 'body']),
  },
  {
    name: 'comments',
    description: 'Stars and comments (with their reactions) on an isle, per element. Comments by layer: mine, author, following (default), everyone.',
    inputSchema: obj({ isle: s('Isle id'), layer: s('Which comments', { enum: ['mine', 'author', 'following', 'everyone'] }) }, ['isle']),
    annotations: { readOnlyHint: true },
  },
]

const storageLeft = (env: Env, user: UserRow, used: number) => {
  const q = quotaFor(env, user)
  return Number.isFinite(q) ? { left: fmtBytes(Math.max(0, q - used)), quota: fmtBytes(q) } : { left: 'unlimited', quota: 'unlimited' }
}

const sourceBrief = (src: DataSource | null) =>
  src ? { url: src.url, method: src.method, notes: src.notes, collected_at: src.collectedAt ? new Date(src.collectedAt).toISOString().slice(0, 10) : null, has_code: !!src.code } : null

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined)
const anchorOf = (a: Record<string, unknown>): Anchor | null => (str(a.selector) ? { selector: str(a.selector)!, label: str(a.label) } : null)

function b64decode(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function b64encode(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export async function handleMcp(request: Request, env: Env, userId: string, ctx?: ExecutionContext): Promise<Response> {
  if (request.method === 'GET') return new Response('This MCP server answers POSTed JSON-RPC; it does not stream.', { status: 405, headers: { allow: 'POST, DELETE' } })
  if (request.method === 'DELETE') return new Response(null, { status: 200 })
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST, DELETE' } })

  const user = await new Db(env.DB).userById(userId)
  if (!user) return fail(null, -32000, 'That account is gone', 401)

  let rpc: Rpc
  try {
    rpc = (await request.json()) as Rpc
  } catch {
    return fail(null, -32700, 'Parse error', 400)
  }
  if (Array.isArray(rpc)) return fail(null, -32600, 'One request at a time, please', 400)
  if (!rpc || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') return fail(null, -32600, 'Invalid request', 400)
  const params = rpc.params ?? {}

  switch (rpc.method) {
    case 'initialize':
      return reply(rpc.id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {}, resources: {} },
        serverInfo: SERVER,
        instructions: `You act as ${user.handle ? '@' + user.handle : user.email} on Prolifica: their data (a few MB), their isles (small HTML pages bound to data by named slots), and their library of starred pieces. Read the guide tool once before making or remixing an isle. Build on what exists: browse and get_isle before writing from scratch, pass parent when remixing, and check library() for the person's go-tos.`,
      })
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return new Response(null, { status: 202 })
    case 'ping':
      return reply(rpc.id, {})
    case 'tools/list':
      return reply(rpc.id, { tools: TOOLS })
    case 'resources/list':
      return reply(rpc.id, { resources: [{ uri: 'prolifica://guide', name: 'Prolifica for agents', mimeType: 'text/markdown', description: 'Data, isles, remixing and marks' }] })
    case 'resources/read':
      if (params.uri === 'prolifica://guide') return reply(rpc.id, { contents: [{ uri: 'prolifica://guide', mimeType: 'text/markdown', text: GUIDE }] })
      return fail(rpc.id, -32002, 'No such resource')
    case 'prompts/list':
      return reply(rpc.id, { prompts: [] })
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      const args = (params.arguments ?? {}) as Record<string, unknown>
      try {
        return reply(rpc.id, await callTool(env, request, user, name, args, ctx))
      } catch (e) {
        if (!(e instanceof StoreError)) console.error('mcp tool failed', name, e)
        return reply(rpc.id, text(e instanceof Error ? e.message : String(e), true))
      }
    }
    default:
      return fail(rpc.id, -32601, `Unknown method ${rpc.method}`)
  }
}

async function callTool(env: Env, request: Request, user: UserRow, name: string, args: Record<string, unknown>, ctx?: ExecutionContext) {
  const store = new Store(env, request, user)
  const app = appOrigin(request, env)
  const isleLink = (i: Pick<IsleSummary, 'id'>) => `${app}/i/${i.id}`
  const brief = (i: IsleSummary) => ({
    id: i.id, title: i.title, description: i.description, by: i.owner.handle, url: isleLink(i), stars: i.starCount,
    relation: i.relation, parent: i.parentId, visibility: i.visibility, updated: new Date(i.updatedAt).toISOString(),
  })

  switch (name) {
    case 'guide':
      return text(GUIDE)

    case 'whoami': {
      const { bytes } = await store.usage(user.id)
      const counts = await env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM datasets WHERE owner_id = ?1 AND deleted_at IS NULL) AS data, (SELECT COUNT(*) FROM isles WHERE owner_id = ?1 AND deleted_at IS NULL) AS isles`,
      ).bind(user.id).first<{ data: number; isles: number }>()
      return text({
        handle: user.handle, name: user.name, email: user.email,
        storage: { used: fmtBytes(bytes), ...storageLeft(env, user, bytes) },
        data: counts?.data ?? 0, isles: counts?.isles ?? 0,
        profile: user.handle ? `${app}/@${user.handle}` : `${app}/settings (pick a handle)`,
        library: `${app}/library`,
      })
    }

    case 'list_data': {
      let ownerId = user.id
      if (str(args.handle)) {
        const other = await new Db(env.DB).userByHandle(str(args.handle)!.replace(/^@/, ''))
        if (!other) throw new StoreError(404, `No one is @${args.handle}`)
        ownerId = other.id
      }
      const list = await store.listDatasets({ ownerId, folder: str(args.folder) })
      return text(list.map((d) => ({ id: d.id, path: d.path, kind: d.kind, size: fmtBytes(d.size), description: d.description, public: d.public, derived_from: d.derivedFrom.map((p) => p.id), source: sourceBrief(d.source), url: `${app}/d/${d.id}` })))
    }

    case 'read_data': {
      const { dataset, row } = await store.getDataset(String(args.id ?? ''))
      const code = dataset.source?.code && args.collector_code !== false ? await store.collectorCode(dataset.id) : null
      const info = {
        id: dataset.id, path: dataset.path, kind: dataset.kind, content_type: dataset.contentType, size: fmtBytes(dataset.size), description: dataset.description,
        transform: dataset.transform, derived_from: dataset.derivedFrom.map((d) => ({ id: d.id, path: d.path })), public: dataset.public,
        source: dataset.source ? { ...sourceBrief(dataset.source), code } : null,
        url: `${app}/d/${dataset.id}`,
      }
      const obj = await store.getBlob(row.blob)
      if (!obj) return text({ ...info, error: 'The bytes are missing' }, true)
      if (dataset.kind === 'image' && dataset.size <= 1024 * 1024 && dataset.contentType !== 'image/svg+xml') {
        const bytes = new Uint8Array(await obj.arrayBuffer())
        return { content: [{ type: 'text', text: JSON.stringify(info) }, { type: 'image', data: b64encode(bytes), mimeType: dataset.contentType }] as Content[], isError: false }
      }
      if (dataset.kind === 'binary' || dataset.kind === 'image') return text({ ...info, note: 'Binary data; not shown as text' })
      const all = await obj.text()
      const offset = Math.max(0, Number(args.offset) || 0)
      const limit = Math.min(200_000, Math.max(1, Number(args.limit) || 60_000))
      const content = all.slice(offset, offset + limit)
      return text({ ...info, offset, length: all.length, truncated: offset + limit < all.length, content })
    }

    case 'write_data': {
      const path = str(args.path)
      if (!path) throw new StoreError(400, 'path is required')
      let bytes: Uint8Array<ArrayBuffer>
      if (typeof args.base64 === 'string') bytes = b64decode(args.base64)
      else if (typeof args.content === 'string') bytes = new TextEncoder().encode(args.content)
      else throw new StoreError(400, 'Give content (text) or base64')
      const d = await store.writeDataset({
        id: str(args.id), path, bytes, contentType: str(args.content_type), description: str(args.description), transform: str(args.transform),
        derivedFrom: Array.isArray(args.derived_from) ? args.derived_from.map(String) : undefined, public: bool(args.public),
        source: sourceOf(args.source),
      })
      const { bytes: used } = await store.usage(user.id)
      return text({ id: d.id, path: d.path, kind: d.kind, size: fmtBytes(d.size), public: d.public, url: `${app}/d/${d.id}`, storage_left: storageLeft(env, user, used).left })
    }

    case 'update_data': {
      const d = await store.updateDatasetMeta(String(args.id ?? ''), { path: str(args.path), description: typeof args.description === 'string' ? args.description : undefined, public: bool(args.public), source: sourceOf(args.source) })
      return text({ id: d.id, path: d.path, description: d.description, public: d.public, source: sourceBrief(d.source), url: `${app}/d/${d.id}` })
    }

    case 'delete_data':
      await store.deleteDataset(String(args.id ?? ''))
      return text('Deleted')

    case 'site': {
      if (!str(args.site)) {
        return text((await store.sites(100)).map((x) => ({ site: x.site, datasets: x.datasets, collectors: x.collectors, people: x.people, url: `${app}/s/${x.site}` })))
      }
      const info = await store.site(str(args.site)!)
      const withCode = args.code !== false
      const collectors = []
      for (const [k, c] of info.collectors.entries()) {
        collectors.push({
          methods: c.methods, language: c.language, used_for: c.uses, by_people: c.people, last_used: new Date(c.lastUsed).toISOString().slice(0, 10),
          notes: c.notes, example_data: { id: c.example.id, path: c.example.path, by: c.example.owner.handle },
          code: withCode && k < 3 ? await store.collectorByHash(c.hash) : undefined,
        })
      }
      return text({
        site: info.site,
        url: `${app}/s/${info.site}`,
        how_collected: info.methods,
        collectors,
        data: info.datasets.slice(0, 50).map((d) => ({ id: d.id, path: d.path, by: d.owner.handle, kind: d.kind, method: d.method, from: d.url, description: d.description })),
        isles: info.isles.slice(0, 20).map((i) => ({ id: i.id, title: i.title, by: i.owner.handle, url: isleLink(i) })),
        advice: collectors.length
          ? 'Reuse the top collector if it fits (it has worked here before); if you change it, save your version as the new data\'s source code.'
          : 'Nobody has collected from here yet. Whatever you write to collect it, save it as the data\'s source code so the next person can reuse it.',
      })
    }

    case 'browse': {
      let ownerId: string | undefined
      if (args.mine) ownerId = user.id
      else if (str(args.handle)) {
        const other = await new Db(env.DB).userByHandle(str(args.handle)!.replace(/^@/, ''))
        if (!other) throw new StoreError(404, `No one is @${args.handle}`)
        ownerId = other.id
      }
      const list = await store.listIsles({ ownerId, q: str(args.query), sort: args.sort === 'stars' ? 'stars' : 'recent', limit: Number(args.limit) || 20 })
      return text(list.map(brief))
    }

    case 'get_isle': {
      const id = String(args.id ?? '')
      const { isle, row } = await store.getIsle(id)
      const out: Record<string, unknown> = {
        ...brief(isle),
        version: isle.version,
        slots: isle.slots,
        bindings: Object.fromEntries(Object.entries(isle.bindings).map(([k, d]) => [k, d ? { id: d.id, path: d.path, kind: d.kind, by: d.owner.handle } : null])),
        parent: isle.parent ? brief(isle.parent) : null,
        remixes: isle.childCount,
        uses: isle.uses.map((u) => ({ isle: u.isle.id, title: u.isle.title, selector: u.selector, label: u.label })),
        versions: (await store.versions(id)).map((v) => ({ version: v.version, note: v.note, at: new Date(v.createdAt).toISOString() })),
        // where its data came from: what someone making their own version will need to collect, and how
        data_sources: (await store.isleSources(id)).sources.map((x) => ({ original: { id: x.dataset.id, path: x.dataset.path }, feeds: x.slots, site: x.site, method: x.method, has_collector: !!x.code, collected_by_person_in_browser: x.selfServe })),
      }
      const wantSlice = str(args.grep) || str(args.lines)
      if (wantSlice || args.source !== false) {
        const html = await store.blobText(row.source_blob)
        const total = html.split('\n').length
        if (str(args.grep)) {
          const g = grepLines(html, str(args.grep)!, Math.max(0, Math.min(20, Number(args.context ?? 2))))
          out.source = { lines_total: total, bytes: html.length, matches: g.matches, excerpt: g.lines }
        } else if (str(args.lines)) {
          const m = /^(\d+)\s*-\s*(\d+)$/.exec(str(args.lines)!)
          if (!m) throw new StoreError(400, 'lines looks like "120-180"')
          const a = Math.max(1, Number(m[1])), b = Math.min(total, Number(m[2]), a + 400)
          out.source = { lines_total: total, bytes: html.length, from: a, to: b, excerpt: html.split('\n').slice(a - 1, b).map((l, i) => `${a + i}: ${l}`).join('\n') }
        } else out.html = html
      }
      return text(out)
    }

    case 'edit_isle': {
      const id = String(args.id ?? '')
      const { isle, row } = await store.getIsle(id)
      let html: string
      let replaced: number
      try {
        ;({ text: html, replaced } = applyTextEdits(await store.blobText(row.source_blob), args.edits as TextEdit[]))
      } catch (e) {
        if (e instanceof EditError) throw new StoreError(400, e.message)
        throw e
      }
      const view = args.view === 'same' || args.view === 'new' ? args.view : undefined
      const mine = row.owner_id === user.id
      if (!mine && !args.as_remix) throw new StoreError(403, `"${isle.title}" isn't yours, so it can't change in place. Pass as_remix: true to publish your own version with these edits.`)
      const { isle: out } = args.as_remix
        ? await store.publishIsle({ parent: id, html, title: str(args.title) ?? `${isle.title} (remix)`, shortTitle: str(args.short_title), bindings: args.bindings && typeof args.bindings === 'object' ? (Object.fromEntries(Object.entries(args.bindings).map(([k, v]) => [k, String(v)])) as Record<string, string>) : undefined, note: str(args.note), view, drawsFrom: drawsOf(args.draws_from), changes: changesOf(args.changes) })
        : await store.publishIsle({ id, html, note: str(args.note), view, drawsFrom: drawsOf(args.draws_from), changes: changesOf(args.changes) })
      shootLater(ctx, env, out.id, islesOrigin(request, env))
      return text({ ...brief(out), version: out.version, url: isleLink(out), replaced, next: 'check_isle to see it' })
    }

    case 'edit_data': {
      const { dataset, row } = await store.getDataset(String(args.id ?? ''))
      if (dataset.kind === 'image' || dataset.kind === 'binary') throw new StoreError(400, 'edit_data works on text and JSON data')
      const before = await store.blobText(row.blob)
      let after: string
      try {
        if (Array.isArray(args.set) && args.set.length) {
          if (dataset.kind !== 'json') throw new EditError('set works on JSON data; use edits for text')
          let value: unknown
          try { value = JSON.parse(before) } catch { throw new EditError('That dataset isn\'t valid JSON, so set can\'t be used; use edits') }
          const pretty = /\n\s+["{[\]]/.test(before.slice(0, 2000))
          after = JSON.stringify(applyJsonSets(value, args.set as never), null, pretty ? 2 : undefined)
          if (Array.isArray(args.edits) && args.edits.length) after = applyTextEdits(after, args.edits as TextEdit[]).text
        } else after = applyTextEdits(before, args.edits as TextEdit[]).text
      } catch (e) {
        if (e instanceof EditError) throw new StoreError(400, e.message)
        throw e
      }
      if (dataset.kind === 'json') { try { JSON.parse(after) } catch { throw new StoreError(400, 'Those edits would leave the JSON invalid, so nothing was changed') } }
      const d = await store.writeDataset({ id: dataset.id, path: dataset.path, bytes: new TextEncoder().encode(after), contentType: dataset.contentType })
      return text({ id: d.id, path: d.path, size: fmtBytes(d.size), was: fmtBytes(before.length), url: `${app}/d/${d.id}` })
    }

    case 'check_isle': {
      const { isle } = await store.getIsle(String(args.id ?? ''))
      const r = await checkIsle(env, isle, islesOrigin(request, env), { width: Number(args.width) || undefined, height: Number(args.height) || undefined, dark: bool(args.dark), wait: Number.isFinite(Number(args.wait)) && args.wait !== undefined ? Number(args.wait) : undefined })
      const unbound = Object.entries(isle.bindings).filter(([, d]) => !d).map(([k]) => k)
      const report = {
        isle: isle.id, version: isle.version, url: isleLink(isle), window: `${r.width}×${r.height} ${r.scheme}`,
        ok: !r.errors.length && !r.failed.length && !unbound.length && r.slots.every((x) => x.status < 400) && r.text.length > 0,
        errors: r.errors, failed_requests: r.failed,
        slots: Object.keys(isle.slots).map((k) => ({ slot: k, bound: isle.bindings[k]?.path ?? null, loaded: r.slots.find((x) => x.slot === k)?.status ?? 'not requested' })),
        overflow: r.scroll.width > r.width ? `the page is ${r.scroll.width}px wide in a ${r.width}px window (sideways scroll)` : null,
        visible_text: r.text,
      }
      return { content: [{ type: 'text', text: JSON.stringify(report, null, 1) }, { type: 'image', data: b64encode(r.image), mimeType: 'image/jpeg' }] as Content[], isError: false }
    }

    case 'publish_isle': {
      const { isle, madePublic } = await store.publishIsle({
        id: str(args.id),
        html: typeof args.html === 'string' ? args.html : undefined,
        from: str(args.from),
        parent: str(args.parent),
        title: str(args.title),
        description: typeof args.description === 'string' ? args.description : undefined,
        slots: args.slots && typeof args.slots === 'object' ? (args.slots as never) : undefined,
        bindings: args.bindings && typeof args.bindings === 'object' ? (Object.fromEntries(Object.entries(args.bindings).map(([k, v]) => [k, String(v)])) as Record<string, string>) : undefined,
        uses: Array.isArray(args.uses) ? (args.uses as { isle: string; selector?: string; label?: string }[]).filter((u) => u && typeof u.isle === 'string') : undefined,
        visibility: str(args.visibility) as Visibility | undefined,
        note: str(args.note),
        view: args.view === 'same' || args.view === 'new' ? args.view : undefined,
        drawsFrom: drawsOf(args.draws_from),
        changes: changesOf(args.changes),
        shortTitle: typeof args.short_title === 'string' ? args.short_title : undefined,
        viewName: typeof args.view_name === 'string' ? args.view_name : undefined,
      })
      shootLater(ctx, env, isle.id, islesOrigin(request, env))
      const unbound = Object.entries(isle.bindings).filter(([, d]) => !d).map(([k]) => k)
      const missing = Object.keys(isle.slots).filter((k) => !(k in isle.bindings))
      return text({
        ...brief(isle),
        version: isle.version,
        url: isleLink(isle),
        made_public: madePublic.map((d) => d.path),
        warnings: [
          ...unbound.map((k) => `slot "${k}" is bound to data that no longer exists`),
          ...missing.map((k) => `slot "${k}" has no data bound`),
        ],
      })
    }

    case 'delete_isle':
      await store.deleteIsle(String(args.id ?? ''))
      return text('Deleted')

    case 'lineage': {
      if (str(args.isle)) return text(await store.isleLineage(str(args.isle)!))
      if (str(args.data)) return text(await store.dataLineage(str(args.data)!))
      throw new StoreError(400, 'Name an isle or a dataset')
    }

    case 'library': {
      const items = await store.library(user.id, { kind: args.kind === 'star' || args.kind === 'comment' ? args.kind : undefined, limit: Number(args.limit) || 100 })
      return text(
        items.map((it) => ({
          kind: it.mark.kind,
          isle: { id: it.isle.id, title: it.isle.title, by: it.isle.owner.handle, url: isleLink(it.isle) },
          element: it.mark.anchor,
          comment: it.mark.body,
          markup: it.snippet,
          at: new Date(it.mark.createdAt).toISOString(),
        })),
      )
    }

    case 'star': {
      const on = await store.star(String(args.isle ?? ''), { anchor: anchorOf(args), on: bool(args.on) ?? true })
      return text(on ? 'Starred' : 'Unstarred')
    }

    case 'react': {
      const on = await store.react(String(args.isle ?? ''), String(args.comment ?? ''), String(args.emoji ?? ''), { on: bool(args.on) })
      return text(on ? 'Reacted' : 'Removed')
    }

    case 'comment': {
      const m = await store.comment(String(args.isle ?? ''), String(args.body ?? ''), { anchor: anchorOf(args), replyTo: str(args.reply_to) })
      return text({ id: m.id, anchor: m.anchor, url: `${isleLink({ id: m.isleId })}#c-${m.id}` })
    }

    case 'comments': {
      const layer = (['mine', 'author', 'following', 'everyone'] as const).includes(args.layer as Layer) ? (args.layer as Layer) : 'following'
      const r = await store.marks(String(args.isle ?? ''), layer)
      return text({
        elements: r.tallies.map((t) => ({ selector: t.anchorKey || null, label: t.anchor?.label ?? null, stars: t.stars, comments: t.comments })),
        comments: r.comments.map((c) => ({
          id: c.id, by: c.user.handle, selector: c.anchorKey || null, body: c.body, reply_to: c.parentId, at: new Date(c.createdAt).toISOString(),
          reactions: Object.fromEntries(Object.entries(c.reactions ?? {}).map(([e, x]) => [e, x.count])),
        })),
        hidden_in_other_layers: r.layers.everyone - r.comments.length,
      })
    }

    default:
      throw new StoreError(400, `Unknown tool ${name}`)
  }
}
