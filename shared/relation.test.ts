import { describe, expect, it } from 'vitest'
import { classifyRelation, sameBindings } from './relation'

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
