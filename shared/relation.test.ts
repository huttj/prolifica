import { describe, expect, it } from 'vitest'
import { classifyRelation, pageSimilarity, resolveBindings, sameBindings } from './relation'

describe('classifyRelation', () => {
  const parent = { source: 'h1', bindings: { rows: 'd1' } }
  it('same page, new data is a rebind', () => {
    expect(classifyRelation(parent, { source: 'h1', bindings: { rows: 'd2' } })).toBe('rebind')
  })
  it('new page, same data is a restyle', () => {
    expect(classifyRelation(parent, { source: 'h2', bindings: { rows: 'd1' } })).toBe('restyle')
  })
  it('both changed is a remix', () => {
    expect(classifyRelation(parent, { source: 'h2', bindings: { rows: 'd2' } })).toBe('remix')
  })
  it('a nearly identical page with new data is a rebind', () => {
    expect(classifyRelation(parent, { source: 'h2', bindings: { rows: 'd2' } }, { similarity: 0.96 })).toBe('rebind')
  })
  it('what the publisher says wins over similarity', () => {
    expect(classifyRelation(parent, { source: 'h2', bindings: { rows: 'd2' } }, { similarity: 0.99, view: 'new' })).toBe('remix')
    expect(classifyRelation(parent, { source: 'h2', bindings: { rows: 'd2' } }, { similarity: 0.1, view: 'same' })).toBe('rebind')
  })
  it('nothing changed is a remix (a fork)', () => {
    expect(classifyRelation(parent, { source: 'h1', bindings: { rows: 'd1' } })).toBe('remix')
  })
})

describe('sameBindings', () => {
  it('ignores key order', () => {
    expect(sameBindings({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true)
  })
  it('notices an extra slot', () => {
    expect(sameBindings({ a: '1' }, { a: '1', b: '2' })).toBe(false)
  })
})

describe('pageSimilarity', () => {
  const page = Array.from({ length: 60 }, (_, i) => `<div class="row${i}">Row ${i}</div>`).join('\n')
  it('is 1 for the same page', () => expect(pageSimilarity(page, page)).toBe(1))
  it('stays high when a few labels change', () => expect(pageSimilarity(page, page.replace('Row 3<', 'Kennewick<').replace('Row 9<', 'WA<'))).toBeGreaterThan(0.95))
  it('is low for a different page', () => expect(pageSimilarity(page, '<main><h1>Other</h1><p>x</p></main>')).toBeLessThan(0.1))
})

describe('resolveBindings', () => {
  const own = { posts: 'd1', people: 'd2', media: 'd3' }
  it('keeps the basis when no bindings are given', () => {
    expect(resolveBindings(own, undefined, { update: true })).toEqual(own)
  })
  it('an update changes only the slots it names', () => {
    expect(resolveBindings(own, { people: 'd9', avatars: 'd4' }, { update: true })).toEqual({ posts: 'd1', people: 'd9', media: 'd3', avatars: 'd4' })
  })
  it('null unbinds a slot on an update', () => {
    expect(resolveBindings(own, { media: null }, { update: true })).toEqual({ posts: 'd1', people: 'd2' })
  })
  it('an update with new slots unbinds the slots the page no longer has', () => {
    expect(resolveBindings(own, { avatars: 'd4' }, { update: true, slots: { posts: {}, people: {}, avatars: {} } })).toEqual({ posts: 'd1', people: 'd2', avatars: 'd4' })
  })
  it('an update that changes nothing keeps the order of the slots', () => {
    expect(JSON.stringify(resolveBindings(own, { media: 'd3', posts: 'd1' }, { update: true }))).toBe(JSON.stringify(own))
  })
  it('a new isle gets exactly the bindings given', () => {
    expect(resolveBindings(own, { posts: 'd7', media: null }, { update: false })).toEqual({ posts: 'd7' })
  })
})
