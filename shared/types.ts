import type { Relation } from './relation'

export interface Person {
  id: string
  handle: string | null
  name: string | null
  bio: string | null
}

export interface Me extends Person {
  email: string
  isAdmin: boolean
  usage: number
  /** null: no limit */
  quota: number | null
}

export type DataKind = 'csv' | 'json' | 'text' | 'markdown' | 'image' | 'binary'

export interface DatasetRef {
  id: string
  path: string
  kind: DataKind
  owner: Person
}

export const COLLECTION_METHODS = {
  upload: 'Uploaded a file',
  bookmarklet: 'Bookmarklet',
  extension: 'Browser extension',
  userscript: 'Userscript',
  agent: 'Agent browsing or scraping',
  script: 'Script or program',
  api: 'API or export',
  manual: 'Typed or copied by hand',
  other: 'Other',
} as const
export type CollectionMethod = keyof typeof COLLECTION_METHODS

/** How the data was collected. */
export interface DataSource {
  url: string | null
  method: CollectionMethod | null
  notes: string | null
  collectedAt: number | null
  /** the collector's code, fetched separately (it can be long) */
  code: { hash: string; size: number; language: string | null } | null
}

export interface Dataset extends DatasetRef {
  contentType: string
  size: number
  description: string | null
  transform: string | null
  public: boolean
  createdAt: number
  updatedAt: number
  derivedFrom: DatasetRef[]
  source: DataSource | null
}

export interface SlotSpec {
  kind?: DataKind | 'any'
  description?: string
}

export type Visibility = 'public' | 'unlisted' | 'private'

export interface IsleSummary {
  id: string
  title: string
  /** one to three words naming what's particular to it, for the map */
  shortTitle: string | null
  /** what kind of page it is ("Discourse map"), shared by its same-view group */
  viewName: string | null
  description: string | null
  owner: Person
  visibility: Visibility
  parentId: string | null
  relation: Relation | null
  starCount: number
  version: number
  createdAt: number
  updatedAt: number
  /** Where the page itself runs (another origin), signed when the isle is private. */
  frameUrl: string
  /** A screenshot of it (404 until the first one is taken). */
  shotUrl: string
}

export interface Isle extends IsleSummary {
  slots: Record<string, SlotSpec>
  bindings: Record<string, DatasetRef | null>
  parent: IsleSummary | null
  childCount: number
  uses: { isle: IsleSummary; selector: string | null; label: string | null }[]
}

export interface Anchor {
  selector: string
  label?: string
  tag?: string
  text?: string
  /** The view the piece was marked in, so it can be shown again (see AnchorState). */
  state?: AnchorState
}

/**
 * How to get an isle back to where a piece was marked: the isle's own state (from prolifica.onState),
 * its URL hash, and, failing those, the last few clicks and changes that led there, to replay.
 */
export interface AnchorState {
  app?: unknown
  hash?: string
  trail?: { sel: string; value?: string }[]
}

export type MarkKind = 'star' | 'react' | 'comment'

export interface Mark {
  id: string
  user: Person
  isleId: string
  kind: MarkKind
  anchorKey: string
  anchor: Anchor | null
  emoji: string | null
  body: string | null
  parentId: string | null
  createdAt: number
  updatedAt: number
  /** emoji reactions on a comment */
  reactions?: Record<string, { count: number; mine: boolean }>
}

export interface IsleVersion {
  version: number
  note: string | null
  createdAt: number
  current: boolean
}

/** A starred thing or a note, with the isle it belongs to: one card on the library board. */
export interface LibraryItem {
  mark: Mark
  isle: IsleSummary
  snippet: string | null
}

export interface TreeNode {
  kind: 'isle' | 'dataset'
  id: string
  title: string
  owner: Person
  relation: Relation | 'derived' | 'binds' | null
  starCount?: number
  children: TreeNode[]
}

export interface Lineage {
  /** From the root down to (not including) the subject. */
  ancestors: TreeNode[]
  /** The subject, with everything that came from it. */
  tree: TreeNode
  /** For data: the isles that show it. For isles: the data they show. */
  related: TreeNode[]
}

export interface ApiToken {
  id: string
  label: string
  prefix: string
  createdAt: number
  lastUsedAt: number | null
}

/** Everything Prolifica knows about collecting from one site. */
export interface SiteCollector {
  hash: string
  language: string | null
  size: number
  methods: CollectionMethod[]
  /** datasets gathered with it, and by how many people */
  uses: number
  people: number
  lastUsed: number
  notes: string[]
  example: DatasetRef
}

export interface SiteDataset extends DatasetRef {
  size: number
  description: string | null
  method: CollectionMethod | null
  url: string | null
  collectedAt: number | null
  updatedAt: number
}

export interface SiteInfo {
  site: string
  datasets: SiteDataset[]
  collectors: SiteCollector[]
  /** how data from here was collected, code or not */
  methods: Partial<Record<CollectionMethod, number>>
  isles: IsleSummary[]
}

export interface SiteSummary {
  site: string
  datasets: number
  collectors: number
  people: number
  lastUsed: number
}

/**
 * The whole public archipelago, packed small enough to send thousands of isles at once. Rows are
 * tuples; people and data are referred to by index.
 */
export interface SeaChart {
  islesOrigin: string
  /** [handle, name] */
  people: [string | null, string | null][]
  /**
   * [id, path, kind, sources, bytes]. Data that isn't public still shows (as an unnamed shoal), so id and path are null.
   * sources: the original data it was derived from (indexes into this list; empty when it is itself original).
   * Original data that no isle shows directly is listed too, so two isles on data derived from the same
   * source can be seen to share it.
   */
  data: [string | null, string | null, string, number[]?, number?][]
  /**
   * [id, parentId, title, person, stars, relation, createdAt, version, data, shot version (0: none yet), page, short title, view name].
   * page: isles with the same number run the same page (the same HTML), whatever data they show.
   * short title: one to three words for the map, when its publisher gave one.
   * view name: what kind of page it is ("Discourse map"), naming its group on the map.
   */
  isles: [string, string | null, string, number, number, Relation | null, number, number, number[], number, number?, (string | null)?, (string | null)?][]
}

/** How one step in a family's history differs from the one before it. */
export interface PageDelta {
  /** 0..1; 1 means the same page */
  similarity: number
  /** roughly how many lines (and CSS rules and tags) came and went */
  added: number
  removed: number
}

export interface DataDelta {
  slot: string
  /** dataset paths; null where the slot had no data */
  from: string | null
  to: string | null
}

export interface EvolutionStep {
  version: number
  /** what the publisher said changed (for version 1 of a remix: what it changed from its parent) */
  note: string | null
  createdAt: number
  /** compared with the step before: the previous version, or for version 1 the parent as it was then */
  page: PageDelta | null
  data: DataDelta[]
  title?: string
  /** changes this version pulled in from other isles (besides its own past and its parent) */
  draws?: { isle: string; version: number; note: string | null; parts: string[]; title: string; inFamily: boolean }[]
  /** what it changed, component by component ("legend", "tweet-text"): a component's own lineage */
  changes?: { part: string; what: string }[]
}

export interface EvolutionIsle {
  isle: IsleSummary
  parentId: string | null
  /** which version of the parent it was made from */
  parentVersion: number | null
  depth: number
  /** oldest first */
  versions: EvolutionStep[]
}

/** A whole family, from the original down, for seeing how it evolved. */
export interface Evolution {
  rootId: string
  focusId: string
  /** depth-first from the root */
  isles: EvolutionIsle[]
  /** true when the family is bigger than what's shown */
  truncated: boolean
}
