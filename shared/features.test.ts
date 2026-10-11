import { describe, expect, it } from 'vitest'
import { familyOffers } from './features'
import type { Evolution, EvolutionIsle, EvolutionStep } from './types'

const step = (version: number, pageKey: string, at: number, extra: Partial<EvolutionStep> = {}): EvolutionStep => ({ version, note: null, createdAt: at, page: null, pageKey, data: [], ...extra })
const isle = (id: string, parentId: string | null, parentVersion: number | null, versions: EvolutionStep[], relation: EvolutionIsle['isle']['relation'] = null): EvolutionIsle => ({
  isle: { id, title: id, shortTitle: null, viewName: null, description: null, owner: { id: 'u', handle: 'h', name: null }, visibility: 'public', parentId, relation, starCount: 0, version: versions.at(-1)!.version, createdAt: 0, updatedAt: 0, frameUrl: '', shotUrl: '' } as EvolutionIsle['isle'],
  parentId, parentVersion, depth: 0, versions,
})

// orig v1 (A) -> v2 (B, adds a legend). mine rebinds orig v1. sib restyles orig v1 (C, phone layout). sib's rebind runs C too.
const evo: Evolution = {
  rootId: 'orig', focusId: 'mine', truncated: false,
  isles: [
    isle('orig', null, null, [step(1, 'A', 1), step(2, 'B', 5, { note: 'clickable legend', changes: [{ part: 'legend', what: 'click to filter' }] })]),
    isle('mine', 'orig', 1, [step(1, 'A', 2)], 'rebind'),
    isle('kid', 'mine', 1, [step(1, 'A', 3)], 'rebind'),
    isle('sib', 'orig', 1, [step(1, 'C', 4, { note: 'phone layout' })], 'restyle'),
    isle('sibkid', 'sib', 1, [step(1, 'C', 6)], 'rebind'),
  ],
}

describe('familyOffers', () => {
  const { pages, features } = familyOffers(evo, 'mine')
  it('lists pages the line never ran, one per page, newest first, with where they sit', () => {
    expect(pages.map((p) => [p.id, p.where])).toEqual([['sibkid', 'beside'], ['orig', 'above']])
    expect(pages.find((p) => p.id === 'orig')!.notes).toEqual([{ version: 2, note: 'clickable legend' }])
  })
  it('lists features the line lacks, grouped by the isle that has them', () => {
    expect(features).toEqual([{ isle: 'orig', title: 'orig', version: 2, features: [{ part: 'legend', what: 'click to filter' }] }])
  })
  it('offers nothing a line already has', () => {
    expect(familyOffers(evo, 'orig').features).toEqual([])
    expect(familyOffers(evo, 'orig').pages.map((p) => p.id)).toEqual(['sibkid'])
  })
})
