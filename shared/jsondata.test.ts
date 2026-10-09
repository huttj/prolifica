import { describe, expect, it } from 'vitest'
import { EditError } from './edits'
import { appendAt, derive, getAt, mergeAt, pick, shapeOf, toCsv } from './jsondata'

const thread = () => ({
  meta: { title: 'Bike' },
  messages: [
    { id: 1, author: { handle: 'a', avatar: 'x.png' }, text: 'first', likes: 10 },
    { id: 2, author: { handle: 'b', avatar: 'y.png' }, text: 'second post', likes: 2 },
    { id: 3, author: { handle: 'a', avatar: 'x.png' }, text: 'third', likes: 40 },
  ],
})

describe('getAt / pick', () => {
  it('reads a path', () => expect(getAt(thread(), 'messages[1].text')).toBe('second post'))
  it('says what is there when a path misses', () => expect(() => getAt(thread(), 'posts')).toThrow(/top-level keys: meta, messages/))
  it('keeps fields of each row, nested ones nested', () =>
    expect(pick(getAt(thread(), 'messages'), ['id', 'author.handle'])).toEqual([{ id: 1, author: { handle: 'a' } }, { id: 2, author: { handle: 'b' } }, { id: 3, author: { handle: 'a' } }]))
  it('renames', () => expect(pick({ author: { handle: 'a' } }, { who: 'author.handle' })).toEqual({ who: 'a' }))
})

describe('derive', () => {
  it('filters, limits and slims', () =>
    expect(derive(thread(), { path: 'messages', where: [{ field: 'likes', op: 'gte', value: 10 }], fields: ['id', 'likes'], limit: 5 })).toEqual([{ id: 1, likes: 10 }, { id: 3, likes: 40 }]))
  it('matches text loosely with contains', () => expect((derive(thread(), { path: 'messages', where: [{ field: 'text', op: 'contains', value: 'POST' }] }) as unknown[]).length).toBe(1))
  it('refuses where on a non-array', () => expect(() => derive(thread(), { path: 'meta', where: [{ field: 'x' }] })).toThrow(EditError))
})

describe('appendAt', () => {
  it('appends to an array at a path', () => {
    const v = thread()
    expect(appendAt(v, 'messages', [{ id: 4 }]).length).toBe(4)
    expect(v.messages[3]).toEqual({ id: 4 })
  })
  it('creates a missing array', () => expect(appendAt({}, 'scores', [1, 2])).toEqual({ value: { scores: [1, 2] }, length: 2 }))
  it('appends to a top-level array', () => expect(appendAt([1], null, [2]).value).toEqual([1, 2]))
  it('refuses a top-level object with no path', () => expect(() => appendAt({ a: 1 }, null, [1])).toThrow(/give the path/))
})

describe('mergeAt', () => {
  it('joins patches onto rows by key, matching numbers and strings', () => {
    const v = thread()
    const r = mergeAt(v, 'messages', 'id', [{ id: 2, score: 3 }, { id: '3', score: 1 }, { id: 9, score: 0 }])
    expect(r).toMatchObject({ merged: 2, added: 0, unmatched: [9] })
    expect(v.messages[1]).toMatchObject({ text: 'second post', score: 3 })
  })
  it('adds unmatched rows with upsert', () => {
    const rows = [{ id: 1 }]
    expect(mergeAt(rows, null, 'id', [{ id: 2, x: 1 }], true)).toMatchObject({ added: 1 })
    expect(rows).toHaveLength(2)
  })
  it('refuses a patch without the key', () => expect(() => mergeAt([{ id: 1 }], null, 'id', [{ x: 1 }])).toThrow(/has no id/))
})

describe('shapeOf', () => {
  it('summarizes arrays with their fields and a sample', () => {
    const sh = shapeOf(thread()) as { messages: { array: number; fields: Record<string, string>; sample: unknown } }
    expect(sh.messages.array).toBe(3)
    expect(sh.messages.fields).toEqual({ id: 'number', author: 'object', text: 'string', likes: 'number' })
    expect(sh.messages.sample).toMatchObject({ id: 1 })
  })
  it('counts maps keyed by id instead of listing them', () => {
    const big = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`t${i}`, { kind: 'gif' }]))
    expect(shapeOf({ tweets: big })).toMatchObject({ tweets: { object: 100, entry: { kind: 'string' } } })
  })
})

describe('toCsv', () => {
  it('quotes what needs it and keeps column order', () => expect(toCsv([{ b: 'x,y', a: 1 }, { a: 2, c: 'say "hi"' }], ['a'])).toBe('a,b,c\n1,"x,y",\n2,,"say ""hi"""\n'))
})
