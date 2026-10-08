import { describe, expect, it } from 'vitest'
import { parseCsv, parseCsvRows } from './csv'

describe('parseCsv', () => {
  it('reads quoted fields with commas, quotes and newlines', () => {
    expect(parseCsvRows('a,b\n"x, y","he said ""hi""\nthen left"\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"\nthen left'],
    ])
  })
  it('keys rows by header and turns numbers into numbers', () => {
    expect(parseCsv('name,score\r\nada,3.5\r\nbob,\r\n')).toEqual([
      { name: 'ada', score: 3.5 },
      { name: 'bob', score: '' },
    ])
  })
  it('handles a missing trailing newline and a BOM', () => {
    expect(parseCsv('﻿k\n1')).toEqual([{ k: 1 }])
  })
})
