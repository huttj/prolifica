import { describe, expect, it } from 'vitest'
import { EditError } from './edits'
import { runExpression } from './transform'

const thread = {
  messages: [
    { id: 1, author: { handle: 'a' }, text: 'first', likes: 10, category: 'joke' },
    { id: 2, author: { handle: 'b' }, text: 'second', likes: 2, category: 'take' },
    { id: 3, author: { handle: 'a' }, text: 'third', likes: 40, category: 'joke' },
  ],
}
const scores = [{ i: 1, s: 3 }, { i: 3, s: 1 }]

// the GUIDE's examples, so they keep working
describe('runExpression', () => {
  it('slims posts', async () =>
    expect(await runExpression('messages.{"id": id, "who": author.handle, "text": text, "likes": likes}', thread)).toEqual([
      { id: 1, who: 'a', text: 'first', likes: 10 }, { id: 2, who: 'b', text: 'second', likes: 2 }, { id: 3, who: 'a', text: 'third', likes: 40 },
    ]))
  it('merges scores onto posts by id across named sources', async () => {
    const all = { posts: thread, scores }
    const out = (await runExpression('$posts.messages.($p := $; $merge([$p, $scores[i = $p.id]]))', all, all)) as Record<string, unknown>[]
    expect(out[0]).toMatchObject({ id: 1, text: 'first', i: 1, s: 3 })
    expect(out[1]).not.toHaveProperty('s')
  })
  it('counts by category', async () => expect(await runExpression('messages{category: $count(id)}', thread)).toEqual({ joke: 2, take: 1 }))
  it('joins through a lookup index, as the guide shows', async () => {
    const all = { posts: thread, scores }
    const out = (await runExpression('($by := $scores{$string(i): $}; $posts.messages.$merge([$, $lookup($by, $string(id))]))', all, all)) as Record<string, unknown>[]
    expect(out.map((o) => o.s)).toEqual([3, undefined, 1])
    expect(out[2]).toMatchObject({ text: 'third' })
  })
  it('keeps a one-row result an array when asked', async () => expect(await runExpression('[messages[likes > 30].id]', thread)).toEqual([3]))
  it('explains a syntax error', async () => expect(runExpression('messages[', thread)).rejects.toThrow(/JSONata/))
  it('says when nothing matched', async () => expect(runExpression('posts', thread)).rejects.toThrow(/matched nothing/))
  it('stops runaway work', async () => expect(runExpression('$sum([1..100000].($ * 2))', {}, {}, { steps: 1000, stack: 400, sequence: 2_000_000 })).rejects.toThrow(/steps/))
  it('stops runaway recursion', async () => expect(runExpression('($f := function($n){ $f($n + 1) }; $f(0))', {})).rejects.toThrow(EditError))
})
