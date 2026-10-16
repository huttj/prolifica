import { describe, expect, it } from 'vitest'
import { forAi, imageToken, imagesIn, splitImages } from './images'

describe('images in text', () => {
  const text = `look ${imageToken('abc123')} and ${imageToken('zz9')} then ${imageToken('abc123')}`

  it('splits text and images in order', () => {
    expect(splitImages(`a${imageToken('x1')}b`)).toEqual([{ text: 'a' }, { id: 'x1' }, { text: 'b' }])
  })

  it('lists each image once', () => {
    expect(imagesIn(text)).toEqual(['abc123', 'zz9'])
  })

  it('leaves images from elsewhere alone', () => {
    expect(imagesIn('![x](https://evil.example/a.png) ![y](/api/data/../me/raw)')).toEqual([])
  })

  it('names each image by its data id for an AI that reads text only', () => {
    expect(forAi(text)).toBe('look [image abc123] and [image zz9] then [image abc123]\n\n(Each [image <id>] is Prolifica data: look at it with read_data.)')
    expect(forAi('no pictures')).toBe('no pictures')
  })
})
