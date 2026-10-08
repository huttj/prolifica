import { describe, expect, it } from 'vitest'
import { applyJsonSets, applyTextEdits, EditError, grepLines, parsePath } from './edits'

describe('applyTextEdits', () => {
  it('replaces a unique match', () => expect(applyTextEdits('Who Runs Ithaca', [{ find: 'Ithaca', replace: 'Kennewick' }]).text).toBe('Who Runs Kennewick'))
  it('refuses an ambiguous match', () => expect(() => applyTextEdits('a b a', [{ find: 'a', replace: 'c' }])).toThrow(/appears 2 times/))
  it('replaces all when asked', () => expect(applyTextEdits('a b a', [{ find: 'a', replace: 'c', all: true }])).toEqual({ text: 'c b c', replaced: 2 }))
  it('refuses a missing match', () => expect(() => applyTextEdits('abc', [{ find: 'x', replace: 'y' }])).toThrow(EditError))
  it('treats $ in the replacement literally', () => expect(applyTextEdits('cost', [{ find: 'cost', replace: '$1 each' }]).text).toBe('$1 each'))
})

describe('applyJsonSets', () => {
  it('sets nested values, creating what is missing', () => {
    expect(applyJsonSets({ city: { name: 'Ithaca' } }, [{ path: 'city.name', value: 'Kennewick' }, { path: 'city.examples[0]', value: 'potholes' }])).toEqual({ city: { name: 'Kennewick', examples: ['potholes'] } })
  })
  it('removes', () => expect(applyJsonSets({ a: [1, 2, 3] }, [{ path: 'a[1]', remove: true }])).toEqual({ a: [1, 3] }))
  it('parses paths', () => expect(parsePath('topics[3].title')).toEqual(['topics', 3, 'title']))
})

describe('grepLines', () => {
  it('returns numbered matches with context', () => {
    const r = grepLines('one\ntwo Ithaca\nthree\nfour\nfive\nsix Ithaca', 'ithaca', 1)
    expect(r.matches).toBe(2)
    expect(r.lines).toContain('2: two Ithaca')
    expect(r.lines).toContain('…')
  })
})
